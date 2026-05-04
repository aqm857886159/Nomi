import type { AppContext } from "../../types";
import { TaskResultSchema, type TaskKind, type TaskResultDto } from "./task.schemas";
import {
	getTaskResultByTaskId,
	upsertTaskResult,
	type TaskResultRow,
} from "./task-result.repo";
import { getVendorTaskRefByTaskId } from "./vendor-task-refs.repo";
import {
	normalizeDispatchVendor,
	normalizeProxyVendorHint,
	shouldUseGrsaiDrawPollingForImageTask,
} from "./task.vendor";
import { pollTaskResultWithVendorRegistry } from "./task.vendor-status-registry";

export type TaskPollingMode = "public" | "internal";

export type TaskPollingOutcome =
	| { ok: true; vendor: string; result: TaskResultDto }
	| { ok: false; status: number; body: unknown };

function resolveRefKind(taskKind: TaskKind | null): "video" | "image" | null {
	if (taskKind === "text_to_video" || taskKind === "image_to_video") return "video";
	if (taskKind === "text_to_image" || taskKind === "image_edit") return "image";
	return null;
}

export async function fetchTaskResultForPolling(
	c: AppContext,
	userId: string,
	input: {
		taskId: string;
		vendor?: string | null;
		taskKind?: TaskKind | null;
		prompt?: string | null;
		modelKey?: string | null;
		mode: TaskPollingMode;
	},
): Promise<TaskPollingOutcome> {
	const taskId = (input.taskId || "").trim();
	const taskKind = input.taskKind ?? null;
	const prompt = typeof input.prompt === "string" ? input.prompt : null;
	const modelKey = typeof input.modelKey === "string" ? input.modelKey.trim() : "";
	const vendorInput = typeof input.vendor === "string" ? input.vendor.trim() : "";

	// 1) Stored result fast-path: only terminal results should short-circuit polling.
	let storedRow: TaskResultRow | null = null;
	let storedTaskResult: TaskResultDto | null = null;
	try {
		storedRow = await getTaskResultByTaskId(c.env.DB, userId, taskId);
		if (storedRow?.result) {
			const payload: unknown = JSON.parse(storedRow.result);
			const parsed = TaskResultSchema.safeParse(payload);
			if (parsed.success) {
				storedTaskResult = parsed.data;
				if (
					parsed.data.status === "succeeded" ||
					parsed.data.status === "failed"
				) {
					return {
						ok: true,
						vendor:
							typeof storedRow.vendor === "string" && storedRow.vendor.trim()
								? String(storedRow.vendor).trim()
								: "",
						result: parsed.data,
					};
				}
			}
		}
	} catch {
		// ignore and fall back to vendor polling
	}

	const resolved: { vendor: string; kind: "video" | "image" | null } = {
		vendor: vendorInput,
		kind: resolveRefKind(taskKind),
	};

	if (!resolved.kind && storedRow?.kind) {
		resolved.kind = resolveRefKind(
			typeof storedRow.kind === "string" ? (storedRow.kind as TaskKind) : null,
		);
	}

	if (!resolved.kind && storedTaskResult) {
		resolved.kind = resolveRefKind(storedTaskResult.kind);
	}

	if (!resolved.vendor && storedRow?.vendor) {
		resolved.vendor = String(storedRow.vendor).trim();
	}

	let inferredFromVendorRef = false;
	if (!resolved.vendor || resolved.vendor.toLowerCase() === "auto") {
		const tryKinds: Array<"video" | "image"> = resolved.kind
			? [resolved.kind]
			: ["video", "image"];
		for (const k of tryKinds) {
			const ref = await getVendorTaskRefByTaskId(c.env.DB, userId, k, taskId);
			if (ref?.vendor) {
				resolved.vendor = ref.vendor;
				resolved.kind = k;
				inferredFromVendorRef = true;
				break;
			}
		}
	}

	resolved.vendor = resolved.vendor.trim();
	if (!resolved.vendor || resolved.vendor.toLowerCase() === "auto") {
		return {
			ok: false,
			status: 400,
			body: {
				error:
					"vendor is required (or the task vendor cannot be inferred)",
				code: "vendor_required",
			},
		};
	}

	// If the stored vendor encodes a proxy/channel (e.g. "comfly:veo"),
	// force that proxy so polling hits the correct upstream.
	{
		const raw = resolved.vendor.trim().toLowerCase();
		const head = raw.split(":")[0]?.trim() || "";
		if (head === "direct") {
			try {
				c.set("proxyDisabled", true);
			} catch {
				// ignore
			}
		}
		const hint = normalizeProxyVendorHint(raw);
		if (hint) {
			try {
				c.set("proxyVendorHint", hint);
			} catch {
				// ignore
			}
		}
	}

	// Hint proxy selector: prefer higher-success channels for this task kind.
	if (taskKind) c.set("routingTaskKind", taskKind);

	const dispatch = normalizeDispatchVendor(resolved.vendor);
	const useGrsaiDrawImagePolling =
		resolved.kind === "image" &&
		shouldUseGrsaiDrawPollingForImageTask(resolved.vendor);
	const pollingResult = await pollTaskResultWithVendorRegistry({
		c,
		userId,
		taskId,
		vendor: resolved.vendor,
		dispatch,
		kind: resolved.kind,
		taskKind,
		prompt,
		modelKey,
		mode: input.mode,
		useGrsaiDrawImagePolling,
		storedTaskResult,
	});
	if (!pollingResult.ok) return pollingResult;

	const parsedResult = TaskResultSchema.parse(pollingResult.result);
	if (storedRow || inferredFromVendorRef) {
		const nowIso = new Date().toISOString();
		const completedAt =
			parsedResult.status === "succeeded" || parsedResult.status === "failed"
				? nowIso
				: null;
		try {
			await upsertTaskResult(c.env.DB, {
				userId,
				taskId,
				vendor: resolved.vendor,
				kind: String(parsedResult.kind),
				status: parsedResult.status,
				result: parsedResult,
				completedAt,
				nowIso,
			});
		} catch {
			// ignore
		}
	}

	return { ok: true, vendor: resolved.vendor, result: parsedResult };
}
