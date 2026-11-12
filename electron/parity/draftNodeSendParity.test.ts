/**
 * 「Agent 起草的 = 落地节点上的 = 节点生成框显示的 = 节点上发出去的」：四层同值（D2 第③步，对等矩阵的新一维）。
 *
 * 为什么有它：D2 之后付费卡只读节点，卡上点「生成」就是节点上点 ↑（画布单节点那一条路）。Agent 起草的东西
 * 必须原样落到节点上，节点上显示的就是会发出去的。2026-10-22 那次核查用一次性探针串过这四层（基线 203886f10），
 * 对不上的格集中在视频比例、变体、参考图三处；三处修好之后，这里把同一条链做成常驻测试——以后任何一层的
 * 默认值、变体、参考对不上，这里会红。
 *
 * 每一格都走真函数、不花钱：
 *   ① 起草：真 `semanticCandidateFromParams`（draft_shots 的短路径）→ 真 `normalizeAuthoredCandidate`
 *      → 真准入（`admitShotIdentity` + `admitPlanCandidate`，草稿落库前同一道）；
 *   ② 落地：真 `buildMaterializeShotsPayload`（参考经宿主解析口换成地址）→ 真渲染层 `materializeShots`
 *      （create_canvas_nodes 写边界 → `buildPlannedNodeMeta`；参考经 `placeLandedReferences` 摆上节点）；
 *   ③ 显示：真 `resolveRenderedControls` + `parameterChipValue`（生成框底栏、⚙ 面板读的同一条链；
 *      打开节点不改 meta 由 `src/workbench/generationCanvas/nodes/composerKeepsAspect.test.tsx` 真挂组件钉）；
 *   ④ 发出：真 `buildCatalogTaskRequest` → 画布单镜 Run 那一条（`driveEngineCanvasRun`）→ 本机假上游抓真请求体。
 *
 * 覆盖：APIMart 内置目录里每一个认得档案的视频 / 图片模型（含核查点名的 13 个）× 每个方式 × 两种起草
 * （默认 = 只点名模型和方式；改过 = 变体和每个参数都写成非默认值）。新接一个模型自动进来。
 *
 * 「发出」这一层怎么核：线上的键名由各模型的映射翻译（`aspect_ratio` → `size` 之类），这里不抄一张翻译表——
 *   · 显示出来的每个参数都写在节点上（不靠发出时的缺省兜底：缺省按「主方式」取，和显示的可能不是同一个）；
 *   · 把它在生成框上改成另一个合法值，发出去的请求体就跟着变（显示的那个值真的到了线上）；
 *   · 变体 → 线上的 model 是宿主为这个变体归一出的那个发出型号；参考 → 每一张都在请求体里。
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("electron", async () => {
  const nodeFs = await import("node:fs");
  const os = await import("node:os");
  const path = await import("node:path");
  const { electronStub } = await import("./parityElectronMock");
  return electronStub(nodeFs.mkdtempSync(path.join(os.tmpdir(), "nomi-draft-node-send-")));
});

// 付费确认等的是人：这里替他点头，钱闸本身照旧真跑。
vi.mock("../capabilityCore/rendererBridge", () => ({
  requestRendererDecision: async () => ({ confirmed: true }),
  requestRenderer: async (operation: string) => { throw new Error(`付费路径不该走带超时的桥: ${operation}`); },
}));

// 渲染层落地要问「Agent 能用哪些模型」（桌面桥）；这里接到同一份真目录投影出来的清单上（见下方 agentModels.entries）。
const agentModels = vi.hoisted(() => ({ entries: [] as unknown[] }));
vi.mock("../../src/workbench/generationCanvas/agent/availableModels", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/workbench/generationCanvas/agent/availableModels")>()),
  listAvailableModelsForAgent: async () => agentModels.entries,
}));
vi.mock("../../src/workbench/project/workbenchProjectSession", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/workbench/project/workbenchProjectSession")>()),
  persistActiveWorkbenchProjectNow: async () => null,
}));

import type { CatalogState } from "../catalog/types";
import { admitPlanCandidate, type PlanCandidate } from "../capabilityCore/executionContract";
import { admitShotIdentity, semanticCandidateFromParams } from "../capabilityCore/semanticGenerationCandidate";
import { normalizeAuthoredCandidate, videoCompileOptions } from "../capabilityCore/mcpGenerationVideoResolve";
import { generationCandidateSchema } from "../shared/agentCapabilities/generationPlanSchemas";
import type { ProductionGenerationShot, ProductionRun } from "../productionRun/productionRunTypes";
import { buildMaterializeShotsPayload } from "../productionRun/multiShotCanvasLanding";
import {
  resolveArchetypeForModel, resolveArchetypeVariant, specializeArchetypeForVariant,
  type ArchetypeMode, type ModelArchetype,
} from "../shared/modelArchetypes";
import type { ArchetypeReferenceSlotKind, ModelParameterControl } from "../shared/videoCapabilities/types";
import { constrainParameterControls } from "../shared/videoCapabilities/crossFieldConstraints";
import { isParamValueAllowed } from "../shared/videoCapabilities/paramConstraints";
import { modeTransportFor } from "../shared/videoCapabilities/modeTransport";
import { toCatalogModelOptions } from "../../src/config/modelOptionMappers";
import type { ModelOption } from "../../src/config/models";
import { buildAgentModelEntries, type AgentModelEntry } from "../../src/workbench/generationCanvas/agent/availableModels";
import { buildModelEntryIndex } from "../../src/workbench/generationCanvas/agent/plannedNodeMeta";
import { materializeShots } from "../../src/workbench/capability/multiShotCanvasLanding";
import { resetClientIdRegistry } from "../../src/workbench/generationCanvas/agent/applyCanvasToolCall";
import { useGenerationCanvasStore } from "../../src/workbench/generationCanvas/store/generationCanvasStore";
import { createProjectSessionTestHarness, type ProjectSessionTestHarness } from "../../src/workbench/project/projectSessionTestHarness";
import { resolveRenderedControls } from "../../src/workbench/generationCanvas/nodes/nodeModelArchetype";
import { parameterChipOptions, parameterChipValue } from "../../src/workbench/generationCanvas/nodes/primaryParameterChips";
import { isParameterControl, parseControlInput, type DynamicModelControl } from "../../src/workbench/generationCanvas/nodes/controls/parameterControlModel";
import { applyArchetypeVariantSwitch, currentArchetypeVariant } from "../../src/workbench/generationCanvas/nodes/controls/archetypeMeta";
import { modeWrittenInMeta } from "../../src/workbench/generationCanvas/nodes/controls/modeTestHelpers";
import { buildCatalogTaskRequest } from "../../src/workbench/generationCanvas/runner/catalogTaskActions";
import { resolveGenerationReferences } from "../../src/workbench/generationCanvas/runner/generationReferenceResolver";
import type { GenerationCanvasNode } from "../../src/workbench/generationCanvas/model/generationCanvasTypes";
import { driveEngineCanvasRun, installFetchCapture, seedParityCatalog, type CapturedCall, type FetchCapture } from "./generationParityTestUtils";

const VENDOR = "apimart";
const PROJECT_ID = "proj-draft-parity";
const NOW = "2026-10-24T00:00:00.000Z";
const PROMPT = "雨夜的街口，一个人撑着伞慢慢走过";

/** 2026-10-22 核查点名的 13 个模型（视频 9、图片 4）。目录里少了任何一个，下面的格子就不算数。 */
const NAMED_IN_AUDIT = [
  "doubao-seedance-2.0", "doubao-seedance-2.5", "wan2.7", "wan3.0-video", "kling-v3", "kling-3.0-turbo",
  "veo3.1-fast", "happyhorse-1.1", "MiniMax-H3",
  "gpt-image-2", "gpt-image-2.5-flare", "doubao-seedream-4.5", "doubao-seedream-5-0-pro",
] as const;

/**
 * 显示了、但这个方式**故意不发**的参数（映射里明示 drop）。棘轮：只许减；某天开始发了，这里会红，提醒删掉这条。
 * 键 = `模型/方式/参数`。付费卡的摘要行读的是节点显示，所以这几格同样是「卡上写着、线上没有」——见设计卡 §四。
 */
const NOT_SENT_BY_DESIGN: Readonly<Record<string, string>> = {
  "kling-v3/i2v/aspect_ratio": "APIMart 图生视频：比例由首 / 尾帧决定，映射 i2vDrops 明示不发（electron/catalog/apimartVideos.ts）",
  "veo3.1-fast/frame/aspect_ratio": "APIMart 首尾帧：比例跟首帧图走，映射 i2vDrops 明示不发（electron/catalog/apimartVideos.ts）",
  "veo3.1-fast/reference/aspect_ratio": "APIMart 参考图：比例跟参考图走，映射 i2vDrops 明示不发（electron/catalog/apimartVideos.ts）",
};

/**
 * 档案声明了、APIMart 目录没给这个模型发布的方式（Agent 起草当场被宿主拒：「cannot do …」），不进格子。
 * 棘轮：目录哪天发布了，下面「目录前提」会红，提醒把它移回格子里。键 = `模型/方式`。
 */
const UNPUBLISHED_ARCHETYPE_MODES: Readonly<Record<string, string>> = {
  "grok-imagine-2.0-ext/i2i": "APIMart 只给这一行发布了文生图（electron/catalog/apimartImages.ts）",
};

// ── 收集阶段就要知道有哪些格，所以目录在顶层种好。 ──
const capture: FetchCapture = installFetchCapture();
const catalog: CatalogState = await seedParityCatalog([VENDOR]);
const options: ModelOption[] = toCatalogModelOptions(catalog.models.map((model) => ({
  modelKey: model.modelKey, modelAlias: model.modelAlias, vendorKey: model.vendorKey, kind: model.kind,
  labelZh: model.labelZh, meta: model.meta,
})) as Parameters<typeof toCatalogModelOptions>[0]);
const agentEntries: AgentModelEntry[] = buildAgentModelEntries(options);
agentModels.entries = agentEntries;
const entryByKey = buildModelEntryIndex(agentEntries, [VENDOR]);

const store = await import("../catalog/catalogStore");
const { createGenerationProviderBootstrap } = await import("../capabilityCore/generationProviderBootstrap");
const { createCatalogModuleRegistry } = await import("../capabilityCore/moduleCatalogBootstrap");
const { deriveUsableVideoModelCandidates } = await import("../capabilityCore/usableVideoModelCandidates");
const bootstrap = createGenerationProviderBootstrap(store.readCatalog(), { catalogReader: () => store.readCatalog() });
const registry = createCatalogModuleRegistry(store.readCatalog(), { readinessByProvider: bootstrap.readinessByProvider });
const videoCandidates = deriveUsableVideoModelCandidates();

afterAll(() => { capture.restore(); });

/** 目录给这个模型发布了哪些任务种类（宿主定种类时问的同一份 registry 快照）。 */
function publishedTaskKinds(modelKey: string): Set<string> {
  const kinds = new Set<string>();
  for (const manifest of registry.snapshot?.() ?? []) {
    for (const provider of ((manifest as { providers?: unknown }).providers as Array<{ providerId?: string; models?: Array<{ modelId?: string; modes?: unknown[] }> }> | undefined) ?? []) {
      if (provider?.providerId !== VENDOR) continue;
      for (const model of provider.models ?? []) {
        if (model?.modelId === modelKey) for (const mode of model.modes ?? []) if (typeof mode === "string") kinds.add(mode);
      }
    }
  }
  return kinds;
}

type Row = { modelKey: string; kind: "video" | "image"; archetype: ModelArchetype; option: ModelOption };

const rows: Row[] = catalog.models
  .filter((model) => model.vendorKey === VENDOR && (model.kind === "video" || model.kind === "image"))
  .flatMap((model): Row[] => {
    const archetype = resolveArchetypeForModel({ modelKey: model.modelKey, vendorKey: model.vendorKey, meta: model.meta });
    const option = options.find((candidate) => candidate.vendor === VENDOR && (candidate.modelKey || candidate.value) === model.modelKey);
    const listed = entryByKey.has(`${VENDOR}::${model.modelKey}`);
    return archetype && option && listed ? [{ modelKey: model.modelKey, kind: model.kind as Row["kind"], archetype, option }] : [];
  });

// ── 起草 ──

type Draft = "default" | "changed";
type DraftedReference = { assetId: string; kind: "image" | "video" | "audio"; role: "character" | "first_frame" | "last_frame" | "reference" | "audio" };

const SLOT_REFERENCE: Record<ArchetypeReferenceSlotKind, Omit<DraftedReference, "assetId">> = {
  first_frame: { kind: "image", role: "first_frame" },
  last_frame: { kind: "image", role: "last_frame" },
  image_ref: { kind: "image", role: "reference" },
  video_ref: { kind: "video", role: "reference" },
  audio_ref: { kind: "audio", role: "audio" },
  source_video: { kind: "video", role: "reference" },
};
const EXTENSION = { image: "png", video: "mp4", audio: "mp3" } as const;
const referenceUrl = (assetId: string): string => {
  const kind = assetId.split("-")[0] as keyof typeof EXTENSION;
  return `https://assets.example.com/draft-parity/${assetId}.${EXTENSION[kind] ?? "png"}`;
};

/** 这个方式要发得出去最少要带的参考（必填槽各按下限；全是可选槽、又不是纯文生的方式，带一张进第一个槽）。 */
function draftedReferences(mode: ArchetypeMode): DraftedReference[] {
  const required = mode.slots.flatMap((slot) => Array.from({ length: slot.min }, () => slot));
  const slots = required.length > 0 ? required : mode.intent === "text" ? [] : mode.slots.slice(0, 1);
  const seen = new Map<string, number>();
  return slots.map((slot) => {
    const reference = { ...SLOT_REFERENCE[slot.kind], ...(slot.characterIndexed ? { role: "character" as const } : {}) };
    const index = (seen.get(reference.kind) ?? 0) + 1;
    seen.set(reference.kind, index);
    return { assetId: `${reference.kind}-${index}`, ...reference };
  });
}

/** 一个合法的、和 `current` 不同的值（选项型取第一个不同项；开关取反；数值取上 / 下限；文本写一句）。 */
function alternativeValue(control: ModelParameterControl, current: unknown): string | number | boolean | undefined {
  const same = (value: unknown) => String(value) === String(current);
  if (control.type === "boolean") return !(current === true || current === "true");
  if (control.options.length > 0) return control.options.map((option) => option.value).find((value) => !same(value));
  if (control.type === "number") {
    const numeric = Number(current);
    const candidates = [control.max, control.min, Number.isFinite(numeric) && current !== undefined && current !== "" ? numeric + (control.step ?? 1) : 42]
      .filter((value): value is number => typeof value === "number" && Number.isFinite(value) && !same(value));
    return candidates.find((value) => isParamValueAllowed(control, value));
  }
  if (control.type === "text") return "low quality, blurry";
  return undefined;
}

/** 「改过」那一稿：每个参数都写成非默认值，一个个定（跨字段约束按已定的值收窄后再挑下一个）。 */
function changedParameters(params: readonly ModelParameterControl[]): Record<string, string | number | boolean> {
  const chosen: Record<string, string | number | boolean> = {};
  for (const control of params) {
    if (control.type === "image-url") continue;
    const constrained = constrainParameterControls([...params], chosen).find((candidate) => candidate.key === control.key) ?? control;
    const value = alternativeValue(constrained, constrained.defaultValue ?? constrained.options[0]?.value);
    if (value !== undefined && isParamValueAllowed(constrained, value)) chosen[control.key] = value;
  }
  // 后挑的值可能收窄了先挑的：收窄后不再合法的那几个退回默认（不写），保证这一稿本身是合法的。
  const final = constrainParameterControls([...params], chosen);
  return Object.fromEntries(Object.entries(chosen).filter(([key, value]) => {
    const control = final.find((candidate) => candidate.key === key);
    return control ? isParamValueAllowed(control, value) : false;
  }));
}

function nonDefaultVariantId(archetype: ModelArchetype): string | undefined {
  const variants = archetype.variants ?? [];
  if (variants.length < 2) return undefined;
  const running = resolveArchetypeVariant(archetype, {})?.id;
  return variants.find((variant) => variant.id !== running)?.id;
}

/** Agent 起草这一镜：draft_shots 的短路径 + 宿主归一 + 落库前的同一道准入。 */
function draftCandidate(row: Row, mode: ArchetypeMode, draft: Draft): { candidate: PlanCandidate; references: DraftedReference[] } {
  const variantId = draft === "changed" ? nonDefaultVariantId(row.archetype) : undefined;
  const surface = specializeArchetypeForVariant(row.archetype, resolveArchetypeVariant(row.archetype, { ...(variantId ? { variantId } : {}), modelId: row.modelKey })?.id);
  const surfaceMode = surface.modes.find((candidate) => candidate.id === mode.id) ?? mode;
  const references = draftedReferences(mode);
  const params = {
    prompt: PROMPT, providerId: VENDOR, modelId: row.modelKey,
    taskKind: modeTransportFor(mode, row.archetype, VENDOR), modeId: mode.id,
    ...(variantId ? { variantId } : {}),
    parameters: draft === "changed" ? changedParameters(surfaceMode.params) : {},
    ...(references.length ? { references: references.map(({ assetId, role }) => ({ assetId, role })) } : {}),
  };
  const semantic = semanticCandidateFromParams({
    operationId: "draft-parity", params,
    candidateFrom: (value) => generationCandidateSchema.parse(value) as PlanCandidate,
    registry,
    resolveAssetReferenceIdentity: (assetId) => {
      const reference = references.find((candidate) => candidate.assetId === assetId);
      return reference ? { contentHash: `hash-${assetId}`, version: 1, kind: reference.kind } : undefined;
    },
  });
  const candidate = normalizeAuthoredCandidate(semantic, registry, videoCandidates);
  admitShotIdentity(candidate, registry);
  admitPlanCandidate(candidate, registry, videoCompileOptions(candidate, videoCandidates));
  return { candidate, references };
}

// ── 落地 ──

function runWith(candidate: PlanCandidate): ProductionRun {
  const shot: ProductionGenerationShot = { shotId: "shot-1", candidate, updatedAt: NOW };
  return {
    schemaVersion: 1, runId: "run-draft-parity", projectId: PROJECT_ID, revision: 1, status: "running", stageId: "generate",
    playbook: { name: "generation.single-shot", version: "1.0.0" }, origin: { host: "nomi" },
    policy: { trustedHosts: [], allowedProviders: [], allowedModels: [], maxSpend: null, maxAttemptsPerJob: 1, minimizeUploads: true },
    budget: { currency: "CNY", authorized: 0, reserved: 0, actual: 0, unsettled: 0, unknownInFlight: 0 }, planVersion: 1, snapshotCursor: 0,
    stages: [], gates: [], jobs: [], artifacts: [],
    generationPlan: { operationId: "run-draft-parity", state: "submitted", candidate, shots: [shot], updatedAt: NOW },
    createdAt: NOW, updatedAt: NOW, brief: { goal: "draft node send parity" },
  } as ProductionRun;
}

/** 起草 → 主进程落地报文 → 渲染层真落地 → 画布上那一个节点。 */
async function landNode(candidate: PlanCandidate, kind: Row["kind"]): Promise<GenerationCanvasNode> {
  const payload = buildMaterializeShotsPayload(runWith(candidate), {
    projectRoot: null,
    resolveReferenceUrl: (_projectId, reference) => referenceUrl(reference.assetId),
  });
  expect(payload, "落地报文").toBeTruthy();
  const shots = payload!.shots.map((shot) => ({ ...shot, kind }));
  await materializeShots({ ...payload!, shots } as Parameters<typeof materializeShots>[0]);
  const node = useGenerationCanvasStore.getState().nodes.find((candidateNode) => (candidateNode.meta as Record<string, unknown> | undefined)?.productionShotId === "shot-1");
  expect(node, "画布上落了这一镜的节点").toBeTruthy();
  return node!;
}

// ── 发出 ──

function createCall(): CapturedCall | undefined {
  return capture.calls.find((call) => call.method.toUpperCase() === "POST" && call.body !== null && typeof call.body === "object");
}

/** 节点上点 ↑：真 `buildCatalogTaskRequest` → 画布单镜 Run 那一条 → 抓到的创建请求体。 */
async function sendFromNode(node: GenerationCanvasNode): Promise<Record<string, unknown> | string> {
  const { nodes, edges } = useGenerationCanvasStore.getState();
  const graphNodes = nodes.map((candidate) => (candidate.id === node.id ? node : candidate));
  const built = buildCatalogTaskRequest(node, { references: resolveGenerationReferences(node, { nodes: graphNodes, edges }) });
  const record = await driveEngineCanvasRun(capture, { vendorKey: VENDOR, kind: built.request.kind, prompt: built.request.prompt, extras: built.request.extras as Record<string, unknown> });
  const call = createCall();
  return (call?.body as Record<string, unknown> | undefined) ?? `failure: ${record.failure?.code ?? "no create request"} ${record.failure?.message ?? ""}`;
}

// ── 显示 ──

const metaOf = (node: GenerationCanvasNode): Record<string, unknown> => (node.meta ?? {}) as Record<string, unknown>;

function renderedControls(row: Row, node: GenerationCanvasNode): DynamicModelControl[] {
  return resolveRenderedControls(row.option, metaOf(node), row.kind === "image", row.kind === "video");
}

/**
 * 生成框上把这个参数改成另一个合法值：底栏有档位就点另一档（显示串 → meta 值走生成框同一个 `parseControlInput`），
 * 没有档位（开关 / 大区间数值 / 文本）就按控件声明取一个不同的合法值。
 */
function editedNode(node: GenerationCanvasNode, control: DynamicModelControl): GenerationCanvasNode | null {
  const meta = metaOf(node);
  const shown = parameterChipValue(control, meta);
  const chip = parameterChipOptions(control).find((option) => option.value !== shown)?.value;
  const value = !isParameterControl(control) ? chip
    : chip !== undefined && control.type !== "boolean" ? parseControlInput(control, chip)
    : alternativeValue(control, meta[control.key] ?? control.defaultValue);
  if (value === undefined || value === null) return null;
  return { ...node, meta: { ...meta, [control.key]: value } };
}

/** 生成框上切到另一个变体（变体分段那一个写口）。 */
function variantSwitchedNode(row: Row, node: GenerationCanvasNode): GenerationCanvasNode | null {
  const running = currentArchetypeVariant(row.archetype, metaOf(node))?.id;
  const other = (row.archetype.variants ?? []).find((variant) => variant.id !== running);
  return other ? { ...node, meta: applyArchetypeVariantSwitch({ ...metaOf(node) }, row.archetype, other.id) } : null;
}

// ── 格子 ──

describe("目录前提（否则下面的格子是空转）", () => {
  it("核查点名的 13 个模型都在 APIMart 内置目录里，并且认得档案", () => {
    const keys = rows.map((row) => row.modelKey);
    for (const modelKey of NAMED_IN_AUDIT) expect(keys, modelKey).toContain(modelKey);
  });

  it("不进格子的方式只有登记过的那几条（档案声明了、目录没发布）", () => {
    const unpublished = rows.flatMap((row) => row.archetype.modes
      .filter((mode) => !publishedTaskKinds(row.modelKey).has(modeTransportFor(mode, row.archetype, VENDOR) ?? ""))
      .map((mode) => `${row.modelKey}/${mode.id}`));
    expect(unpublished.sort()).toEqual(Object.keys(UNPUBLISHED_ARCHETYPE_MODES).sort());
  });
});

describe("起草 → 落地节点 → 生成框显示 → 节点上发出：四层同值（APIMart 视频 / 图片 × 每个方式 × 默认 / 改过）", () => {
  let session: ProjectSessionTestHarness;
  beforeEach(async () => {
    session = createProjectSessionTestHarness();
    await session.open(PROJECT_ID);
    resetClientIdRegistry();
    useGenerationCanvasStore.getState().restoreSnapshot({ nodes: [], edges: [], groups: [] });
  });
  afterEach(() => session.dispose());

  for (const row of rows) {
    for (const mode of row.archetype.modes) {
      if (`${row.modelKey}/${mode.id}` in UNPUBLISHED_ARCHETYPE_MODES) continue;
      for (const draft of ["default", "changed"] as const) {
        const label = `${row.modelKey} 方式=${mode.id} 起草=${draft === "default" ? "默认" : "改过"}`;
        it(label, async () => {
          const { candidate, references } = draftCandidate(row, mode, draft);
          const node = await landNode(candidate, row.kind);
          const meta = metaOf(node);

          // ② 落地：方式 / 变体 / 起草写出的每个参数，节点上一个不差。
          expect(modeWrittenInMeta(meta, row.archetype).id, `${label}：节点上的方式`).toBe(candidate.modeId ?? mode.id);
          if ((row.archetype.variants?.length ?? 0) > 1) {
            // 起草没写变体时，宿主与节点问的是同一个 owner（`resolveArchetypeVariant`）：落到默认变体。
            const drafted = resolveArchetypeVariant(row.archetype, { ...(candidate.variantId ? { variantId: candidate.variantId } : {}), modelId: candidate.modelId })?.id;
            expect(currentArchetypeVariant(row.archetype, meta)?.id, `${label}：节点上的变体`).toBe(drafted);
          }
          for (const [key, value] of Object.entries(candidate.parameters)) {
            expect(meta[key], `${label}：节点上的 ${key}`).toEqual(value);
          }

          // ③ 显示：生成框上每个参数显示的 = 节点上存的（起草写了的就是起草的值），而且都存在节点上，不靠发出时的缺省兜底。
          const controls = renderedControls(row, node);
          for (const control of controls) {
            const shown = parameterChipValue(control, meta);
            if (control.key in candidate.parameters) expect(shown, `${label}：显示的 ${control.key}`).toBe(String(candidate.parameters[control.key]));
            // 显示了一个值（不是空着的自由输入框）就必须写在节点上：没写的那一格发出时按映射缺省补，补的是「主方式」的默认。
            if (shown !== "") expect(Object.prototype.hasOwnProperty.call(meta, control.key), `${label}：显示的 ${control.key}=${shown} 写在节点上`).toBe(true);
          }

          // ④ 发出：画布单节点那一条路真发出去。
          const body = await sendFromNode(node);
          expect(typeof body, `${label}：节点上发得出去（${String(body)}）`).toBe("object");
          const wire = body as Record<string, unknown>;
          const serialized = JSON.stringify(wire);
          for (const reference of references) {
            expect(serialized, `${label}：参考 ${reference.assetId} 发出去了`).toContain(referenceUrl(reference.assetId));
          }

          // 显示的值真的到了线上：生成框上改一个参数（或切一个变体），请求体跟着变。只在「默认」那一稿逐个核（与起草无关，核一次够）。
          // 变体 → 线上型号与宿主路一致另由 landingProjectionParity 逐变体核（那里比的是两台发动机）。
          if (draft !== "default") return;
          const switched = variantSwitchedNode(row, node);
          if (switched) expect(await sendFromNode(switched), `${label}：切了变体，发出去的没变`).not.toEqual(wire);
          for (const control of controls) {
            const edited = editedNode(node, control);
            if (!edited) continue;
            const editedBody = await sendFromNode(edited);
            const cell = `${row.modelKey}/${mode.id}/${control.key}`;
            if (cell in NOT_SENT_BY_DESIGN) {
              expect(editedBody, `${cell}：登记为「故意不发」——现在发了，删掉 NOT_SENT_BY_DESIGN 里这一条`).toEqual(wire);
              continue;
            }
            expect(typeof editedBody, `${cell}：改过之后仍发得出去（${String(editedBody)}）`).toBe("object");
            expect(editedBody, `${cell}：生成框上改了它，发出去的请求体却没变（显示了不发）`).not.toEqual(wire);
          }
        }, 120_000);
      }
    }
  }
});
