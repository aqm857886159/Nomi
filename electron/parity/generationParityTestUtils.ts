/**
 * 对等测试矩阵的夹具（零额度）。**不 import vitest**：`electron/tsconfig.json` 把
 * 除 `*.test.ts` 之外的 `electron/**` 全部编进主进程构建，测试运行器不能进产物。
 * 同 `agentPanelSpendConfirmTestUtils.ts` 的既有约定。
 *
 * 两台发动机都读**同一份真实内置目录**（`ensureBuiltinModelSeeds()` 种下来的 20 家 /
 * 156 个模型 / 248 条 mapping），供应商换成本机捕获器：
 *   · 引擎 A ＝ `electron/runtime.ts:309 runTask`（画布手动生成、分镜行、试跑、legacy MCP 单发）
 *   · 引擎 B ＝ `createGenerationProviderBootstrap()` 造出来的生成 provider
 *              （Agent 付款卡、提交执行计划、`nomi_start_generation`、全自动 / 批量 Run）
 * 出站在 `globalThis.fetch` 这一层捕获——两台都经过它，所以捕获点对两边是同一个。
 */
import type { CatalogState } from "../catalog/types";
import { redactAuthorization, type OutboundRecord } from "./outboundRecord";

export type CapturedCall = {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
};

export type FetchCapture = {
  calls: CapturedCall[];
  /** 下一次（及之后）出站的应答；默认是一次异步受理（`task_id` + `completed`）。 */
  respondWith(factory: (call: CapturedCall) => { status: number; payload: unknown }): void;
  reset(): void;
  restore(): void;
};

const DEFAULT_RESPONSE = () => ({
  status: 200,
  payload: { code: 200, data: [{ task_id: "parity-task-1", status: "completed" }] },
});

/** 在 `globalThis.fetch` 上装一个记录器。所有出站（两台发动机、四条鉴权路）都从这里过。 */
export function installFetchCapture(): FetchCapture {
  const original = globalThis.fetch;
  const calls: CapturedCall[] = [];
  let responder = DEFAULT_RESPONSE as (call: CapturedCall) => { status: number; payload: unknown };
  const impl = async (input: unknown, init: RequestInit = {}): Promise<Response> => {
    const url = typeof input === "string" ? input : String((input as { url?: string })?.url ?? input);
    let body: unknown = null;
    const raw = init.body;
    if (typeof raw === "string") {
      try { body = JSON.parse(raw); } catch { body = raw; }
    } else if (raw) {
      body = `[${raw.constructor?.name ?? "stream"}]`;
    }
    const headers: Record<string, string> = {};
    const source = init.headers as Record<string, string> | undefined;
    if (source) for (const [key, value] of Object.entries(source)) headers[key.toLowerCase()] = String(value);
    const call: CapturedCall = { url, method: String(init.method || "GET"), headers, body };
    calls.push(call);
    const { status, payload } = responder(call);
    return new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json" } });
  };
  (globalThis as { fetch: unknown }).fetch = impl;
  return {
    calls,
    respondWith(factory) { responder = factory; },
    reset() { calls.length = 0; responder = DEFAULT_RESPONSE; },
    restore() { (globalThis as { fetch: unknown }).fetch = original; },
  };
}

/** 真实内置目录 + 给点名的几家填上密钥（safeStorage 必须在测试里可用）。 */
export async function seedParityCatalog(vendorKeys: readonly string[] = ["apimart", "higgsfield"]): Promise<CatalogState> {
  const store = await import("../catalog/catalogStore");
  store.ensureBuiltinModelSeeds();
  for (const key of vendorKeys) store.upsertModelCatalogVendorApiKey(key, { apiKey: `sk-parity-${key}` });
  return store.readCatalog();
}

function recordFromCall(call: CapturedCall | undefined, notes?: Record<string, unknown>): OutboundRecord {
  if (!call) return { failure: { code: "no_outbound_request", message: "no outbound request was made" }, ...(notes ? { notes } : {}) };
  const url = new URL(call.url);
  return {
    request: {
      method: call.method.toUpperCase(),
      origin: url.origin,
      path: url.pathname,
      authorization: redactAuthorization(call.headers),
      contentType: call.headers["content-type"] ?? "(none)",
      body: call.body,
    },
    ...(notes ? { notes } : {}),
  };
}

function failureCode(error: unknown): string {
  const candidate = error as { code?: unknown; name?: unknown; message?: unknown };
  if (typeof candidate?.code === "string" && candidate.code.trim()) return candidate.code;
  const message = String(candidate?.message ?? error);
  // 供应商就绪那一步的机读身份（`mcpGenerationTools.ts:638` 的 `configured_provider`）。
  if (/configured_provider/.test(message)) return "configured_provider";
  if (/参数 .* 不符合当前模型的声明|contract_invalid/.test(message)) return "contract_invalid";
  return typeof candidate?.name === "string" && candidate.name ? candidate.name : "error";
}

export type EngineATaskInput = {
  vendorKey: string;
  kind: string;
  prompt: string;
  extras: Record<string, unknown>;
};

/** 引擎 A：`runtime.runTask`（付费令牌用真的 `mintSpendGrant` 铸，和画布确认卡同一把）。 */
export async function driveEngineA(capture: FetchCapture, input: EngineATaskInput): Promise<OutboundRecord> {
  capture.reset();
  const { mintSpendGrant } = await import("../spendGrant");
  const nodeId = String(input.extras.nodeId ?? "parity-node");
  const grantId = mintSpendGrant({ nodeIds: [nodeId] });
  const { runTask } = await import("../runtime");
  try {
    await runTask({
      vendor: input.vendorKey,
      request: { kind: input.kind, prompt: input.prompt, extras: { ...input.extras, grantId } },
    });
  } catch (error) {
    if (!capture.calls.length) return { failure: { code: failureCode(error), message: String((error as Error)?.message ?? error) } };
  }
  return recordFromCall(capture.calls[0]);
}

export type EngineBTaskInput = {
  vendorKey: string;
  modelId: string;
  /** 目录任务种类（`text_to_image` / `image_edit` / `image_to_video` …）。 */
  mode: string;
  /**
   * 用户选的那一档**档案模式**（`first` / `firstlast` / `omni` …）。真实宿主由
   * `normalizeVideoCandidate`（`mcpGenerationVideoResolve.ts:240`）写进合同；参考图落哪条
   * wire 通道由它决定，所以夹具必须带得动它，否则测的是一个没有模式的假世界。
   */
  modeId?: string;
  prompt: string;
  parameters: Record<string, unknown>;
  references?: Array<{ assetId: string; contentHash: string; version: number; kind?: "image" | "video" | "audio"; role?: "character" | "first_frame" | "last_frame" | "reference" | "audio" }>;
  /**
   * 已本地化成「供应商够得到的 URL」的参考素材表（key 由 `spendReferenceKey` 派生）。
   * 真实宿主在授权信封那一步就把它准备好了（`prepareProductionGenerationAuthorization.ts:237`），
   * 不给它 = 测一个宿主没接线的假世界，会把「参考图这条路今天走不通」误报成产品分裂。
   */
  referenceUrls?: Readonly<Record<string, string>>;
};

/**
 * 引擎 B：先问 `createGenerationProviderBootstrap` 要 provider（这一步就是 A3/BL-1 的现场：
 * 非 APIMart 一律拿不到），再走 `compileExecutionContract` → `provider.buildRequest` → `submit`。
 */
export async function driveEngineB(capture: FetchCapture, input: EngineBTaskInput): Promise<OutboundRecord> {
  capture.reset();
  const store = await import("../catalog/catalogStore");
  const state = store.readCatalog();
  const { createGenerationProviderBootstrap } = await import("../capabilityCore/generationProviderBootstrap");
  const bootstrap = createGenerationProviderBootstrap(state, { catalogReader: () => store.readCatalog() });
  const provider = bootstrap.providers.find((candidate) => candidate.providerId === input.vendorKey);
  if (!provider) {
    const readiness = bootstrap.readinessByProvider[input.vendorKey];
    return {
      failure: {
        code: readiness?.missingForSubmit?.[0] ?? "configured_provider",
        message: `the host built no generation provider for ${input.vendorKey}`,
      },
      notes: { providersBuilt: bootstrap.providers.map((candidate) => candidate.providerId) },
    };
  }
  const { createCatalogModuleRegistry } = await import("../capabilityCore/moduleCatalogBootstrap");
  const { compileExecutionContract } = await import("../capabilityCore/executionContract");
  const registry = createCatalogModuleRegistry(state, { readinessByProvider: bootstrap.readinessByProvider });
  let contract;
  try {
    const references = input.references ?? [];
    const { spendReferenceKey } = await import("../shared/contracts/pendingSpendConfirm");
    // 与真实宿主同形：`mcpGenerationTools.ts:334 referenceSourceUrlsFor` 把候选的每一条参考
    // 解析成「本项目素材库里的源 URL」，**与 references 同序**，再交给唯一的那个编译口。
    // 两个真实宿主都接了那个解析器（`mcpStdioServer.ts:334` / `appIntegration.ts:325`）；
    // 夹具不给，就会把「宿主没接线」当成「Run 路投影不出 @image1」报成产品分裂。
    const referenceSourceUrls = references.map((reference) => input.referenceUrls?.[spendReferenceKey(reference)]);
    // 与真实宿主同形：编译前先把候选归一到它在目录里的视频档案——变体、模式、出站 model（transportModelId）
    // 都在这一步定（`mcpGenerationTools.ts:330`，候选表 = `deriveUsableVideoModelCandidates`）。
    // 夹具以前跳过这一步，「宿主按哪个变体派」根本没进矩阵：2026-09-26 卡上 Fast、派出去 standard，矩阵一直是绿的。
    const { normalizeVideoCandidate } = await import("../capabilityCore/mcpGenerationVideoResolve");
    const { deriveUsableVideoModelCandidates } = await import("../capabilityCore/usableVideoModelCandidates");
    const candidate = normalizeVideoCandidate({
      candidateId: "parity-candidate",
      revision: 1,
      moduleId: "generation.single-shot",
      providerId: input.vendorKey,
      modelId: input.modelId,
      mode: input.mode,
      ...(input.modeId ? { modeId: input.modeId } : {}),
      prompt: input.prompt,
      parameters: input.parameters,
      references,
    }, deriveUsableVideoModelCandidates());
    contract = compileExecutionContract(candidate, registry, {
      ...(referenceSourceUrls.length ? { referenceSourceUrls } : {}),
    });
  } catch (error) {
    return { failure: { code: failureCode(error), message: String((error as Error)?.message ?? error) } };
  }
  // `droppedFields` 随 #837 一起删了（它全仓没有生产读者，而「悄悄丢掉」正是对拍要抓的病）：
  // 现在未知键在编译期就被拒，两侧的差异会以 `failure.code` 出现，不再需要一本丢弃账。
  const notes = {
    contractParameters: contract.parameters,
  };
  try {
    const request = provider.buildRequest({
      moduleId: contract.moduleId,
      providerId: contract.providerId,
      modelId: contract.modelId,
      mode: contract.mode,
      ...(contract.modeId ? { modeId: contract.modeId } : {}),
      prompt: contract.prompt,
      parameters: contract.parameters,
      references: contract.references,
      contractHash: contract.contractHash,
      idempotencyKey: "parity-idempotency-key",
      ...(input.referenceUrls ? { referenceUrls: input.referenceUrls } : {}),
      ...(contract.transportModelId ? { transportModelId: contract.transportModelId } : {}),
    });
    await provider.submit(request, "parity-idempotency-key");
  } catch (error) {
    if (!capture.calls.length) return { failure: { code: failureCode(error), message: String((error as Error)?.message ?? error) }, notes };
  }
  return recordFromCall(capture.calls[0], notes);
}
