import { isTerminalTaskStatus, type TaskStatus } from "../shared/taskStatus";
import type { GenerationProvider, GenerationProviderOutput, GenerationProviderRequestInputV1, GenerationProviderTaskContext } from "./generationRuntimeAdapter";

/**
 * 画布那台（引擎 A）的传输，包成一个 `GenerationProvider` 挂到制作流程的提交出口后面（发动机收敛第一刀，岔路 B：
 * 先合钱口和状态，传输暂留两种实现挂同一接口）。这里**不复制任何传输代码**：交 = 运行时的 runTask（带 RUN_APPROVED_ADMISSION），
 * 查 = `runtime.fetchTaskResult`，都是画布今天走的那两个函数；批准已经住在 Run 的门上（手势收据），所以这里没有令牌。
 *
 * 合同里冻的就是渲染层拼好的那一份请求（`parameters = { vendor, request }`，见 `freezeCanvasExecutionContract`），
 * `buildRequest` 原样交回，于是「批的那一份」和「发出去的那一份」由提交出口的报文哈希逐字钉住。
 *
 * 设计卡：docs/plan/2026-10-05-engine-convergence-cut1-step12-design-card.md §6 格 3。
 */

export const CANVAS_PROVIDER_PREFIX = "canvas:";

export function canvasProviderId(vendorKey: string): string {
  return `${CANVAS_PROVIDER_PREFIX}${vendorKey}`;
}

export function isCanvasProviderId(providerId: string | undefined): boolean {
  return typeof providerId === "string" && providerId.startsWith(CANVAS_PROVIDER_PREFIX);
}

type CanvasTaskRequest = {
  kind: string;
  prompt: string;
  extras?: Record<string, unknown>;
  [key: string]: unknown;
};

type CanvasTaskAsset = { type: string; url: string; [key: string]: unknown };

/** 画布那台的任务结果（`runtime.TaskResult` 的结构子集；这里只读这些字段，不 import 运行时）。 */
export type CanvasTaskResult = {
  id: string;
  kind: string;
  status: TaskStatus;
  assets: CanvasTaskAsset[];
  raw?: unknown;
  error?: string;
  [key: string]: unknown;
};

export type CanvasWireRequest = { vendor: string; request: CanvasTaskRequest };

export type CanvasTransport = {
  /** 运行时的 runTask，带 RUN_APPROVED_ADMISSION：同一段执行，不核令牌、不认领（这两件归 Run）。 */
  execute: (payload: CanvasWireRequest) => Promise<CanvasTaskResult>;
  /** `runtime.fetchTaskResult`。 */
  fetchResult: (payload: Record<string, unknown>) => Promise<{ result: CanvasTaskResult }>;
  /**
   * 交的那一段每一次出网都在派发账上（见 `GenerationProvider.networkTransport`）。生产的 `lazyCanvasTransport` 是：runTask 的 HTTP
   * 只走 vendorHttp.requestVendor（含自定义调用脚本、同步音频、multipart）→ appFetch；process 分支（即梦 / Antigravity CLI）是子进程，
   * 由 `child_process` 诊断通道记账——跑起来了就算可能写出去（V-1047 B1）。
   */
  networkTransport?: "app-fetch";
};

/**
 * 交的那一刻供应商就给了结论的任务（同步出图、自定义调用脚本、同步音频、缓存命中）：没有供应商任务号可查，
 * 查询直接回这一份。进程内、有上限；重启后查不到就照旧去问运行时（它会如实说「找不回」）。
 */
const settledAtSubmit = new Map<string, CanvasTaskResult>();
const SETTLED_LIMIT = 500;

function rememberSettled(result: CanvasTaskResult): void {
  if (!isTerminalTaskStatus(result.status)) return;
  if (settledAtSubmit.size >= SETTLED_LIMIT) {
    const oldest = settledAtSubmit.keys().next().value;
    if (oldest !== undefined) settledAtSubmit.delete(oldest);
  }
  settledAtSubmit.set(result.id, structuredClone(result));
}

/** 交出去那一刻拿到的回执（受理号或同步结果）。渲染层的等待循环从它开始，和今天 `runTask` 回给它的是同一份。 */
const receiptsAtSubmit = new Map<string, CanvasTaskResult>();
/** 最近一次查到的那一份（含已落进项目的产物地址）：Run 的 poll 只记状态，节点要的是这一整份。 */
const lastResults = new Map<string, CanvasTaskResult>();

function remember(map: Map<string, CanvasTaskResult>, result: CanvasTaskResult): void {
  map.delete(result.id);
  map.set(result.id, structuredClone(result));
  if (map.size > SETTLED_LIMIT) {
    const oldest = map.keys().next().value;
    if (oldest !== undefined) map.delete(oldest);
  }
}

export function canvasSubmitReceipt(providerTaskId: string): CanvasTaskResult | undefined {
  const receipt = receiptsAtSubmit.get(providerTaskId);
  return receipt ? structuredClone(receipt) : undefined;
}

export function canvasLastResult(providerTaskId: string): CanvasTaskResult | undefined {
  const result = lastResults.get(providerTaskId) ?? settledAtSubmit.get(providerTaskId);
  return result ? structuredClone(result) : undefined;
}

function wire(input: Pick<GenerationProviderRequestInputV1, "parameters"> | GenerationProviderTaskContext | undefined): CanvasWireRequest {
  const parameters = (input?.parameters ?? {}) as Partial<CanvasWireRequest>;
  const vendor = typeof parameters.vendor === "string" ? parameters.vendor.trim() : "";
  const request = parameters.request;
  if (!vendor || !request || typeof request !== "object" || typeof request.kind !== "string") {
    throw new Error("Canvas transport contract is missing its frozen request");
  }
  return { vendor, request };
}

export function createCanvasTransportProvider(vendorKey: string, transport: CanvasTransport): GenerationProvider {
  const providerId = canvasProviderId(vendorKey);
  const submit = async (request: unknown): Promise<{ providerTaskId: string; raw?: unknown }> => {
    const payload = structuredClone(request as CanvasWireRequest);
    if (payload.vendor !== vendorKey) throw new Error(`Canvas transport ${providerId} cannot submit for ${payload.vendor}`);
    const result = await transport.execute(payload);
    const providerTaskId = typeof result.id === "string" ? result.id.trim() : "";
    if (!providerTaskId) throw new Error("Canvas transport returned an empty task id");
    remember(receiptsAtSubmit, result);
    rememberSettled(result);
    return { providerTaskId, raw: result };
  };
  return {
    providerId,
    capabilities: { submitIdempotency: false, query: true, reconcile: false, cancel: false, materialize: true },
    ...(transport.networkTransport ? { networkTransport: transport.networkTransport } : {}),
    buildRequest: (input) => structuredClone(wire(input)),
    submit,
    query: async (providerTaskId, context) => {
      const settled = settledAtSubmit.get(providerTaskId);
      if (settled) return { status: settled.status, raw: structuredClone(settled) };
      const { vendor, request } = wire(context);
      const extras = request.extras ?? {};
      const response = await transport.fetchResult({
        taskId: providerTaskId,
        vendor,
        taskKind: request.kind,
        prompt: request.prompt,
        ...(typeof extras.modelKey === "string" ? { modelKey: extras.modelKey } : {}),
        ...(typeof extras.projectId === "string" ? { projectId: extras.projectId } : {}),
      });
      rememberSettled(response.result);
      remember(lastResults, response.result);
      return { status: response.result.status, raw: response.result };
    },
    materialize: async ({ raw }) => {
      const result = raw as CanvasTaskResult | undefined;
      // 画布那台只取第一份产物（normalizeCatalogTaskResult 同口径）。
      const first = result?.assets?.find((asset) => asset && typeof asset.url === "string" && asset.url.trim());
      const kind = first?.type;
      if (!first || (kind !== "image" && kind !== "video" && kind !== "audio" && kind !== "model3d")) return { outputs: [], raw };
      const output: GenerationProviderOutput = { kind, url: first.url };
      return { outputs: [output], raw };
    },
  };
}

/** 画布传输按家各一个执行器（`canvas:<vendorKey>`），与目录执行器并列挂在提交出口后面。 */
export function canvasTransportProviders(vendorKeys: readonly string[], transport: CanvasTransport): GenerationProvider[] {
  return vendorKeys.map((vendorKey) => createCanvasTransportProvider(vendorKey, transport));
}

/** 运行时那两个函数（懒加载：能力核不在启动时拉起整个运行时）。交 = 带 RUN_APPROVED_ADMISSION 的 runTask。 */
export function lazyCanvasTransport(): CanvasTransport {
  return {
    networkTransport: "app-fetch",
    execute: async (payload) => {
      const [{ runTask }, { RUN_APPROVED_ADMISSION }] = await Promise.all([import("../runtime"), import("../tasks/taskSpend")]);
      return runTask(payload, RUN_APPROVED_ADMISSION) as Promise<CanvasTaskResult>;
    },
    fetchResult: async (payload) => (await import("../runtime")).fetchTaskResult(payload) as Promise<{ result: CanvasTaskResult }>,
  };
}
