import { TaskStatusSchema } from "./task.schemas";

export type TaskStatus = ReturnType<typeof TaskStatusSchema.parse>;

export function clampProgress(value?: number | null): number | undefined {
	if (typeof value !== "number" || Number.isNaN(value)) return undefined;
	return Math.max(0, Math.min(100, value));
}

export function mapTaskStatus(status?: string | null): "running" | "succeeded" | "failed" {
	const normalized = typeof status === "string" ? status.toLowerCase() : null;
	if (normalized === "failed") return "failed";
	if (normalized === "succeeded") return "succeeded";
	return "running";
}

export type ComflyGenerationStatus =
	| "NOT_START"
	| "SUBMITTED"
	| "QUEUED"
	| "IN_PROGRESS"
	| "SUCCESS"
	| "FAILURE";

export function normalizeComflyStatus(value: unknown): ComflyGenerationStatus | null {
	if (typeof value !== "string") return null;
	const upper = value.trim().toUpperCase();
	if (
		upper === "NOT_START" ||
		upper === "SUBMITTED" ||
		upper === "QUEUED" ||
		upper === "IN_PROGRESS" ||
		upper === "SUCCESS" ||
		upper === "FAILURE"
	) {
		return upper;
	}
	return null;
}

export function mapComflyStatusToTaskStatus(status: ComflyGenerationStatus | null): TaskStatus {
	if (status === "SUCCESS") return "succeeded";
	if (status === "FAILURE") return "failed";
	if (status === "IN_PROGRESS") return "running";
	return "queued";
}

export function parseComflyProgress(value: unknown): number | undefined {
	if (typeof value === "number" && Number.isFinite(value)) {
		return clampProgress(value);
	}
	if (typeof value !== "string") return undefined;
	const raw = value.trim();
	if (!raw) return undefined;
	const percentMatch = raw.match(/^(\d+(?:\.\d+)?)\s*%$/);
	if (percentMatch) {
		const num = Number(percentMatch[1]);
		return clampProgress(Number.isFinite(num) ? num : undefined);
	}
	const num = Number(raw);
	return clampProgress(Number.isFinite(num) ? num : undefined);
}

export function normalizeAsyncDataTaskStatus(value: unknown): TaskStatus {
	return normalizeStringTaskStatus(value, {
		succeeded: ["completed", "complete", "succeeded", "success", "done"],
		failed: ["failed", "failure", "error", "cancelled", "canceled"],
		queued: ["queued", "pending", "submitted"],
		running: ["running", "processing", "generating", "in_progress", "in-progress"],
	});
}

export function normalizeGrsaiDrawTaskStatus(value: unknown): TaskStatus {
	return normalizeStringTaskStatus(value, {
		succeeded: ["succeeded", "success", "completed"],
		failed: ["failed", "failure", "error"],
		queued: ["queued", "submitted"],
		running: ["processing", "in_progress", "running"],
	});
}

export function normalizeApimartTaskStatus(value: unknown): TaskStatus {
	return normalizeStringTaskStatus(value, {
		succeeded: ["completed"],
		failed: ["failed", "cancelled"],
		queued: ["submitted", "pending"],
		running: ["processing"],
	});
}

export function normalizeYunwuVideoTaskStatus(value: unknown): TaskStatus {
	return normalizeStringTaskStatus(value, {
		succeeded: ["succeed", "success", "succeeded", "completed", "done"],
		failed: ["failed", "failure", "error", "cancelled", "canceled"],
		queued: ["pending", "submitted", "queued"],
		running: ["processing", "running", "in_progress", "in-progress"],
	});
}

export function normalizeTuziVideoTaskStatus(value: unknown): TaskStatus {
	if (typeof value === "number" && Number.isFinite(value)) {
		const code = Math.floor(value);
		if (code === 0) return "queued";
		if (code === 1) return "running";
		if (code === 2) return "succeeded";
		if (code === 3 || code === -1) return "failed";
	}
	return normalizeStringTaskStatus(value, {
		succeeded: ["completed", "complete", "succeeded", "success", "done"],
		failed: ["failed", "failure", "error", "cancelled", "canceled"],
		queued: ["queued", "pending", "submitted", "waiting"],
		running: ["running", "processing", "generating", "in_progress", "in-progress"],
	});
}

export function normalizeMiniMaxStatus(value: unknown): TaskStatus {
	if (typeof value === "number" && Number.isFinite(value)) {
		const code = Math.floor(value);
		if (code === 2) return "succeeded";
		if (code === 3 || code === -1) return "failed";
		if (code === 0) return "queued";
		return "running";
	}
	if (typeof value === "boolean") {
		return value ? "succeeded" : "running";
	}
	return normalizeStringTaskStatus(value, {
		succeeded: ["success", "succeeded", "completed", "done", "finish", "finished"],
		failed: ["fail", "failed", "failure", "error"],
		queued: ["queued", "queue", "pending", "waiting"],
		running: ["running", "processing", "in_progress", "in-progress", "generating"],
	});
}

function normalizeStringTaskStatus(
	value: unknown,
	groups: {
		succeeded: readonly string[];
		failed: readonly string[];
		queued: readonly string[];
		running: readonly string[];
	},
): TaskStatus {
	if (typeof value !== "string") return "running";
	const normalized = value.trim().toLowerCase();
	if (!normalized) return "running";
	if (groups.succeeded.includes(normalized)) return "succeeded";
	if (groups.failed.includes(normalized)) return "failed";
	if (groups.queued.includes(normalized)) return "queued";
	if (groups.running.includes(normalized)) return "running";
	return "running";
}
