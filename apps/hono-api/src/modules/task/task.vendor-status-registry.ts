import type { AppContext } from "../../types";
import { fetchDreaminaTaskResult } from "../dreamina/dreamina.service";
import type { TaskKind, TaskResultDto } from "./task.schemas";
import {
	fetchApimartTaskResult,
	fetchAsyncDataTaskResult,
	fetchGrsaiDrawTaskResult,
	fetchMappedTaskResultForVendor,
	fetchTuziTaskResult,
} from "./task.service";

export type TaskPollingKindHint = "video" | "image" | null;
export type TaskPollingDispatchVendor =
	| "apimart"
	| "asyncdata"
	| "tuzi"
	| "dreamina-cli"
	| "dreamina"
	| "veo"
	| string;

export type TaskVendorPollingRequest = {
	c: AppContext;
	userId: string;
	taskId: string;
	vendor: string;
	dispatch: TaskPollingDispatchVendor;
	kind: TaskPollingKindHint;
	taskKind: TaskKind | null;
	prompt: string | null;
	modelKey: string;
	mode: "public" | "internal";
	useGrsaiDrawImagePolling: boolean;
	storedTaskResult: TaskResultDto | null;
};

export type TaskVendorPollingResult =
	| { ok: true; result: unknown }
	| { ok: false; status: number; body: unknown };

type TaskVendorStatusAdapter = {
	name: string;
	matches: (request: TaskVendorPollingRequest) => boolean;
	poll: (request: TaskVendorPollingRequest) => Promise<TaskVendorPollingResult>;
};

const pollMappedVendor = async (
	request: TaskVendorPollingRequest,
	vendor: string,
	kindHint: TaskPollingKindHint,
): Promise<unknown | null> =>
	fetchMappedTaskResultForVendor(request.c, request.userId, vendor, {
		taskId: request.taskId,
		taskKind: request.taskKind,
		kindHint,
		promptFromClient: request.prompt,
		modelKey: request.modelKey,
	});

const vendorStatusAdapters: readonly TaskVendorStatusAdapter[] = [
	{
		name: "apimart",
		matches: (request) => request.dispatch === "apimart",
		poll: async (request) => ({
			ok: true,
			result: await fetchApimartTaskResult(
				request.c,
				request.userId,
				request.taskId,
				request.prompt,
				{ taskKind: request.taskKind },
			),
		}),
	},
	{
		name: "grsai-draw-image",
		matches: (request) => request.useGrsaiDrawImagePolling,
		poll: async (request) => ({
			ok: true,
			result: await fetchGrsaiDrawTaskResult(
				request.c,
				request.userId,
				request.taskId,
				{
					taskKind: request.taskKind,
					promptFromClient: request.prompt,
				},
			),
		}),
	},
	{
		name: "asyncdata",
		matches: (request) => request.dispatch === "asyncdata",
		poll: async (request) => {
			if (request.kind === "image") {
				return {
					ok: false,
					status: 400,
					body: {
						error: "asyncdata 仅支持视频任务轮询",
						code: "invalid_task_kind",
					},
				};
			}
			return {
				ok: true,
				result: await fetchAsyncDataTaskResult(
					request.c,
					request.userId,
					request.taskId,
					{
						taskKind: request.taskKind,
						promptFromClient: request.prompt,
					},
				),
			};
		},
	},
	{
		name: "tuzi",
		matches: (request) => request.dispatch === "tuzi",
		poll: async (request) => {
			if (request.kind === "image") {
				return {
					ok: false,
					status: 400,
					body: {
						error:
							request.mode === "public"
								? "tuzi 图像任务通常为同步返回；如需轮询请携带创建接口返回的 taskId/vendor（或直接使用创建接口返回结果）"
								: "tuzi 图像任务通常为同步返回；请直接使用创建接口返回结果",
						code: "invalid_task_kind",
					},
				};
			}
			return {
				ok: true,
				result: await fetchTuziTaskResult(
					request.c,
					request.userId,
					request.taskId,
					{
						taskKind: request.taskKind,
						promptFromClient: request.prompt,
					},
				),
			};
		},
	},
	{
		name: "dreamina",
		matches: (request) =>
			request.dispatch === "dreamina-cli" || request.dispatch === "dreamina",
		poll: async (request) => {
			const storedRaw =
				request.storedTaskResult?.raw &&
				typeof request.storedTaskResult.raw === "object"
					? request.storedTaskResult.raw
					: {};
			return {
				ok: true,
				result: await fetchDreaminaTaskResult(request.c, request.userId, {
					taskId: request.taskId,
					taskKind:
						request.taskKind ??
						request.storedTaskResult?.kind ??
						"text_to_image",
					projectId:
						"projectId" in storedRaw && typeof storedRaw.projectId === "string"
							? storedRaw.projectId
							: null,
					accountId:
						"accountId" in storedRaw && typeof storedRaw.accountId === "string"
							? storedRaw.accountId
							: null,
				}),
			};
		},
	},
	{
		name: "mapped-image",
		matches: (request) => request.kind === "image",
		poll: async (request) => {
			const mapped = await pollMappedVendor(request, request.vendor, "image");
			if (!mapped) {
				return {
					ok: false,
					status: 400,
					body: {
						error:
							"该图像任务不支持轮询（请使用创建接口返回结果，或选择支持轮询的厂商）",
						code: "polling_not_supported",
					},
				};
			}
			return { ok: true, result: mapped };
		},
	},
	{
		name: "veo",
		matches: (request) => request.dispatch === "veo",
		poll: async (request) => {
			const mapped = await pollMappedVendor(request, "veo", "video");
			if (!mapped) {
				return {
					ok: false,
					status: 400,
					body: {
						error: "厂商 veo 未配置可用的视频结果映射（model_catalog_mappings）",
						code: "mapping_not_configured",
					},
				};
			}
			return { ok: true, result: mapped };
		},
	},
	{
		name: "mapped-default",
		matches: () => true,
		poll: async (request) => {
			const mapped = await pollMappedVendor(
				request,
				request.vendor,
				request.kind,
			);
			if (!mapped) {
				return {
					ok: false,
					status: 400,
					body: {
						error: "该任务未配置可用的结果映射（model_catalog_mappings）",
						code: "mapping_not_configured",
					},
				};
			}
			return { ok: true, result: mapped };
		},
	},
];

export async function pollTaskResultWithVendorRegistry(
	request: TaskVendorPollingRequest,
): Promise<TaskVendorPollingResult> {
	const adapter = vendorStatusAdapters.find((candidate) =>
		candidate.matches(request),
	);
	if (!adapter) {
		return {
			ok: false,
			status: 400,
			body: {
				error: "该任务未配置可用的结果映射（model_catalog_mappings）",
				code: "mapping_not_configured",
			},
		};
	}
	return adapter.poll(request);
}
