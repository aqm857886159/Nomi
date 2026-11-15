/**
 * 「Agent 定的 = 节点上的 = 节点上点 ↑ 发出的」：候选落到画布节点的那条投影，逐格核。
 *
 * 为什么有它：对等矩阵（generationParity.matrix）比的是「同一份**显式**参数两台发动机发出一样」，
 * 不比「Agent 起草 → 落地节点」这一步。于是 2026-10-22 核查（R-d2-defaults #2）实测：Agent 选 Seedance 2.0
 * 标准 / Mini、Veo 3.1 Quality / Lite，候选、付费卡、宿主派发都是所选变体，**落地节点停在默认 Fast**，
 * 在节点上点 ↑ 发的是 `*-fast`——卡上一个档，节点路扣另一个档。矩阵一直是绿的。
 *
 * 每一格都走真函数，不花钱：
 *   候选（宿主真归一 `normalizeVideoCandidate`）→ 落地报文（真 `buildMaterializeShotsPayload`）
 *   → 节点 meta（真 `buildPlannedNodeMeta`，喂它的是报文里的候选身份）
 *   → 节点路请求体（真 `buildCatalogTaskRequest` + 真 `runtime.runTask`）vs 宿主路请求体（真编译 + 真 provider），
 *   上游是本机假上游（`installFetchCapture`），抓的是真请求体。
 *
 * 修前（@203886f10）85 格里 33 格对不上（数字记在 docs/plan/2026-10-22-landing-defaults.md）；修后只剩
 * 另一类的 Runway wan3 那 3 格仍用 `it.fails` 标着（见 HOST_MODEL_REWRITE_SPLIT）——那一类修好时 `it.fails` 会红，提醒翻回 `it`。
 *
 * 渲染层那一步（报文 → `buildPlannedNodeMeta` 入参）调的是生产里首落与重绑定共用的那一个函数
 * （`plannedInputFromCandidate`），不是这里另写一份。
 */
import { afterAll, describe, expect, it, vi } from "vitest";

vi.mock("electron", async () => {
  const nodeFs = await import("node:fs");
  const os = await import("node:os");
  const path = await import("node:path");
  const { electronStub } = await import("./parityElectronMock");
  return electronStub(nodeFs.mkdtempSync(path.join(os.tmpdir(), "nomi-landing-parity-")));
});

// 付费确认等的是人：这里替他点头，钱闸本身照旧真跑。
vi.mock("../capabilityCore/rendererBridge", () => ({
  requestRendererDecision: async () => ({ confirmed: true }),
  requestRenderer: async (operation: string) => { throw new Error(`付费路径不该走带超时的桥: ${operation}`); },
}));

import type { CatalogState } from "../catalog/types";
import type { PlanCandidate } from "../capabilityCore/executionContract";
import type { ProductionGenerationShot, ProductionRun } from "../productionRun/productionRunTypes";
import { buildMaterializeShotsPayload } from "../productionRun/multiShotCanvasLanding";
import { EVERY_VARIANT, resolveModelArchetype, rescopeArchetypeVariant, type ModelArchetype } from "../shared/modelArchetypes";
import { buildVideoModelCandidates, videoArchetypeIdFromMeta, type VideoModelCandidate } from "../shared/videoCapabilities";
import { modeTransportFor } from "../shared/videoCapabilities/modeTransport";
import { toCatalogModelOptions } from "../../src/config/modelOptionMappers";
import type { ModelOption } from "../../src/config/models";
import { buildAgentModelEntries, type AgentModelEntry } from "../../src/workbench/generationCanvas/agent/availableModels";
import { buildModelEntryIndex, buildPlannedNodeMeta } from "../../src/workbench/generationCanvas/agent/plannedNodeMeta";
import { plannedInputFromCandidate } from "../../src/workbench/generationCanvas/agent/candidateNodeMeta";
import { currentArchetypeVariant } from "../../src/workbench/generationCanvas/nodes/controls/archetypeMeta";
import { createGenerationNode } from "../../src/workbench/generationCanvas/model/graphOps";
import { buildCatalogTaskRequest } from "../../src/workbench/generationCanvas/runner/catalogTaskActions";
import { resolveGenerationReferences } from "../../src/workbench/generationCanvas/runner/generationReferenceResolver";
import type { GenerationCanvasNode } from "../../src/workbench/generationCanvas/model/generationCanvasTypes";
import { driveEngineA, installFetchCapture, seedParityCatalog, type FetchCapture } from "./generationParityTestUtils";

const NOW = "2026-10-22T00:00:00.000Z";
const PROMPT = "一个镜头";

// ── 收集阶段就要知道有哪些格（it.fails 只能在收集时声明），所以目录在顶层种好。 ──
const capture: FetchCapture = installFetchCapture();
// 带变体的行分布在这几家：都存一把（假）钥匙，宿主才把它们算成可用、按真规则归一变体。
const catalog: CatalogState = await seedParityCatalog(["apimart", "kie", "volcengine", "runway", "dreamina"]);
const options: ModelOption[] = toCatalogModelOptions(catalog.models.map((model) => ({
  modelKey: model.modelKey, modelAlias: model.modelAlias, vendorKey: model.vendorKey, kind: model.kind,
  labelZh: model.labelZh, meta: model.meta,
})) as Parameters<typeof toCatalogModelOptions>[0]);
const entryByKey: ReadonlyMap<string, AgentModelEntry> = buildModelEntryIndex(buildAgentModelEntries(options), ["apimart"]);
const videoModels = catalog.models.filter((model) => model.kind === "video");
const videoCandidates: VideoModelCandidate[] = buildVideoModelCandidates(videoModels.map((model) => ({
  provider: model.vendorKey, modelKey: model.modelKey, label: model.labelZh, archetypeId: videoArchetypeIdFromMeta(model.meta),
})));

type Row = { vendorKey: string; modelKey: string; archetype: ModelArchetype; source: VideoModelCandidate };

function rowOf(model: CatalogState["models"][number]): Row | null {
  const source = videoCandidates.find((candidate) => candidate.provider === model.vendorKey && candidate.modelKey === model.modelKey);
  const archetype = resolveModelArchetype({ modelKey: model.modelKey, vendorKey: model.vendorKey, meta: model.meta }, { variant: EVERY_VARIANT });
  return source && archetype ? { vendorKey: model.vendorKey, modelKey: model.modelKey, archetype, source } : null;
}

/** 真实内置目录里每一条带 ≥2 个变体的视频行（所有供应商，不只 APIMart）。新接一个带变体的模型自动进来。 */
const variantRows: Row[] = videoModels.map(rowOf).filter((row): row is Row => Boolean(row && (row.archetype.variants?.length ?? 0) > 1 && textOnlyMode(row)));
/** APIMart 的视频行（核查报告 13 个模型里的 9 个视频模型）。 */
const apimartVideoRows: Row[] = videoModels.filter((model) => model.vendorKey === "apimart").map(rowOf).filter((row): row is Row => Boolean(row && textOnlyMode(row)));

afterAll(() => { capture.restore(); });

/** 不需要参考图就能发的那个方式（默认方式优先）：这条测试比的是变体 / 比例，不是参考通道。 */
function textOnlyMode(row: Row) {
  const modes = row.source.archetype.modes;
  const free = modes.filter((mode) => !mode.slots.some((slot) => slot.min >= 1));
  return free.find((mode) => mode.id === row.source.archetype.defaultModeId) ?? free[0];
}

/** 宿主那一侧：Agent 起草的候选经宿主真归一（变体 / 方式 / 出站 model 都在这一步定）。 */
async function hostCandidate(row: Row, extra: Partial<PlanCandidate> = {}): Promise<PlanCandidate> {
  const { normalizeVideoCandidate } = await import("../capabilityCore/mcpGenerationVideoResolve");
  const { deriveUsableVideoModelCandidates } = await import("../capabilityCore/usableVideoModelCandidates");
  const mode = textOnlyMode(row)!;
  return normalizeVideoCandidate({
    candidateId: "cand-1", revision: 1, moduleId: "generation.single-shot",
    providerId: row.vendorKey, modelId: row.modelKey,
    mode: modeTransportFor(mode, row.source.archetype, row.source.provider) ?? "text_to_video", modeId: mode.id,
    prompt: PROMPT, parameters: {}, references: [],
    ...extra,
  } as PlanCandidate, deriveUsableVideoModelCandidates());
}

/** 一个只有这一镜的 Run（落地报文只从 Run 投影）。 */
function runWith(candidate: PlanCandidate): ProductionRun {
  const shot: ProductionGenerationShot = { shotId: "shot-1", candidate, updatedAt: NOW };
  return {
    schemaVersion: 1, runId: "run-landing", projectId: "proj-landing", revision: 1, status: "running", stageId: "generate",
    playbook: { name: "generation.single-shot", version: "1.0.0" }, origin: { host: "semantic-mcp" },
    policy: { trustedHosts: [], allowedProviders: [], allowedModels: [], maxSpend: null, maxAttemptsPerJob: 1, minimizeUploads: true },
    budget: { currency: "CNY", authorized: 0, reserved: 0, actual: 0, unsettled: 0, unknownInFlight: 0 }, planVersion: 1, snapshotCursor: 0,
    stages: [], gates: [], jobs: [], artifacts: [],
    generationPlan: { operationId: "run-landing", state: "submitted", candidate, shots: [shot], updatedAt: NOW },
    createdAt: NOW, updatedAt: NOW, brief: { goal: "landing parity" },
  } as ProductionRun;
}

/** 候选 → 落地报文 → 节点 meta（与生产同一个投影 + 同一个构造器）。 */
function landedNodeMeta(candidate: PlanCandidate): Record<string, unknown> {
  const payload = buildMaterializeShotsPayload(runWith(candidate), { projectRoot: null });
  const wire = payload?.shots[0]?.candidate;
  expect(wire, "落地报文里有这一镜的候选身份").toBeTruthy();
  expect(wire, "落地报文不带内部投影").not.toHaveProperty("transportModelId");
  const input = plannedInputFromCandidate(wire);
  expect(input, "候选有模型身份").toBeTruthy();
  const meta = buildPlannedNodeMeta(input!, entryByKey);
  expect(meta, `${candidate.providerId}/${candidate.modelId} 在可用清单里`).toBeTruthy();
  return meta!;
}

/** 节点上点 ↑：真 `buildCatalogTaskRequest` → 真 `runtime.runTask`，抓请求体。 */
async function canvasWireBody(meta: Record<string, unknown>): Promise<Record<string, unknown> | string> {
  const base = createGenerationNode({ id: "landed-node", kind: "video", prompt: PROMPT });
  const node = { ...base, meta } as GenerationCanvasNode;
  const request = buildCatalogTaskRequest(node, { references: resolveGenerationReferences(node, { nodes: [node], edges: [] }) }).request;
  const record = await driveEngineA(capture, { vendorKey: String(meta.modelVendor ?? ""), kind: request.kind, prompt: request.prompt, extras: request.extras as Record<string, unknown> });
  return (record.request?.body as Record<string, unknown> | undefined) ?? `failure: ${record.failure?.code}`;
}

/** 宿主路（Agent 路）：真编译 + 真 provider，抓请求体。 */
async function hostWireBody(candidate: PlanCandidate): Promise<Record<string, unknown> | string> {
  capture.reset();
  const store = await import("../catalog/catalogStore");
  const state = store.readCatalog();
  const { createGenerationProviderBootstrap } = await import("../capabilityCore/generationProviderBootstrap");
  const bootstrap = createGenerationProviderBootstrap(state, { catalogReader: () => store.readCatalog() });
  const provider = bootstrap.providers.find((item) => item.providerId === candidate.providerId);
  if (!provider) return `failure: no provider ${candidate.providerId}`;
  const { createCatalogModuleRegistry } = await import("../capabilityCore/moduleCatalogBootstrap");
  const { compileExecutionContract } = await import("../capabilityCore/executionContract");
  const contract = compileExecutionContract(candidate, createCatalogModuleRegistry(state, { readinessByProvider: bootstrap.readinessByProvider }), {});
  // 合同 → provider 输入用宿主同一个投影（运行时适配器的 prepareAuthorization），不在测试里手抄字段表：
  // 手抄的那份漂过一次——#1207 改成靠 variantId 让线上模型名 owner 选型号后，这里还在传已删的 transportModelId（2026-10-24）。
  const { createGenerationRuntimeAdapter } = await import("../capabilityCore/generationRuntimeAdapter");
  const { providerRequest } = createGenerationRuntimeAdapter({ providers: [provider] }).prepareAuthorization({ contract, providerIdempotencyKey: "landing-parity" });
  try { await provider.submit(providerRequest, "landing-parity"); } catch { /* 假上游不回任务号：只比提交那一下 */ }
  return (capture.calls[0]?.body as Record<string, unknown> | undefined) ?? "failure: no outbound request";
}

/**
 * 另一类、不归本次修的格（2026-10-22 本测试发现，已报协调）：宿主归一把候选的 modelId 换成档案的
 * `catalogModelKey`（`videoCandidateForPlan` 的 baseModelId），而 Wan 3.0 档案的 catalogModelKey 是 KIE 那一行的 key
 * `wan/3-0-video`——Runway 的 wan3 候选被改成一个 Runway 目录里没有的模型，落地节点认不出模型。
 */
const HOST_MODEL_REWRITE_SPLIT = new Set(["runway/wan3"]);

describe("目录前提（否则下面的格子是空转）", () => {
  it("内置目录里有带变体的视频行，且含 APIMart 的 Seedance 2.0 与 Veo 3.1", () => {
    const keys = variantRows.map((row) => `${row.vendorKey}/${row.modelKey}`);
    expect(keys).toContain("apimart/doubao-seedance-2.0");
    expect(keys).toContain("apimart/veo3.1-fast");
    expect(apimartVideoRows.length).toBeGreaterThanOrEqual(9);
  });
});

describe("类级：任一带变体的模型 × 任一变体，落地节点的变体 === 宿主归一后的候选变体（全部内置供应商）", () => {
  for (const row of variantRows) {
    const variants: Array<string | undefined> = [undefined, ...(row.archetype.variants ?? []).map((variant) => variant.id)];
    for (const variantId of variants) {
      const label = `${row.vendorKey}/${row.modelKey} 变体=${variantId ?? "（不写）"}`;
      const knownSplit = HOST_MODEL_REWRITE_SPLIT.has(`${row.vendorKey}/${row.modelKey}`);
      (knownSplit ? it.fails : it)(label, async () => {
        const candidate = await hostCandidate(row, variantId ? { variantId } : {});
        expect(candidate.variantId, `${label}：宿主归一出了变体`).toBeTruthy();
        const meta = landedNodeMeta(candidate);
        expect(currentArchetypeVariant(row.archetype, meta)?.id, `${label}：节点显示的变体`).toBe(candidate.variantId);
      });
    }
  }
});

describe("APIMart：节点上点 ↑ 发出的 model === 宿主路发出的 model（本机假上游抓真请求体）", () => {
  for (const row of apimartVideoRows) {
    const variants: Array<string | undefined> = [undefined, ...((row.archetype.variants?.length ?? 0) > 1 ? row.archetype.variants!.map((variant) => variant.id) : [])];
    for (const variantId of variants) {
      const label = `apimart/${row.modelKey} 变体=${variantId ?? "（不写）"}`;
      it(label, async () => {
        const candidate = await hostCandidate(row, variantId ? { variantId } : {});
        const host = await hostWireBody(candidate);
        const canvas = await canvasWireBody(landedNodeMeta(candidate));
        expect(typeof host, `${label}：宿主路发出了请求`).toBe("object");
        expect(typeof canvas, `${label}：节点路发出了请求`).toBe("object");
        expect((canvas as Record<string, unknown>).model, label).toBe((host as Record<string, unknown>).model);
      }, 60_000);
    }
  }
});

/**
 * 比例（R-d2-defaults #1 的护栏）：Agent 写了非 16:9 的比例，**落地这一步**本身是对的——节点 meta 与两条路发出的
 * 比例一致。对不上的是「点开节点」那个挂载 effect（它不在这条函数链上，PR-b 用真组件挂载测试钉）。
 * 这里钉住落地 + 发出这一半，PR-b 删 effect 时不许把它弄坏。
 */
describe("APIMart：Agent 写的视频比例，落地节点 = 节点路发出 = 宿主路发出（默认方式）", () => {
  for (const row of apimartVideoRows) {
    const spec = rescopeArchetypeVariant(row.archetype, { variantId: row.archetype.defaultVariantId, modelId: undefined });
    const mode = spec.modes.find((item) => item.id === textOnlyMode(row)!.id) ?? spec.modes[0]!;
    const control = mode.params.find((param) => /ratio|size/i.test(param.key)
      && (param.options ?? []).some((option) => option.value === "9:16"));
    if (!control) continue;
    it(`apimart/${row.modelKey} ${control.key}=9:16`, async () => {
      const candidate = await hostCandidate(row, { parameters: { [control.key]: "9:16" } });
      const meta = landedNodeMeta(candidate);
      expect(meta[control.key], "落地节点").toBe("9:16");
      const host = await hostWireBody(candidate);
      const canvas = await canvasWireBody(meta);
      expect(typeof host).toBe("object");
      expect(typeof canvas).toBe("object");
      const aspectOf = (body: Record<string, unknown>) => body.size ?? body.aspect_ratio ?? body.ratio;
      expect(aspectOf(canvas as Record<string, unknown>), "节点路").toBe(aspectOf(host as Record<string, unknown>));
    }, 60_000);
  }
});

