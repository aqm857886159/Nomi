/**
 * 参数值的内部类型：点了就是发出的（设计卡 docs/plan/2026-11-17-param-value-type.md ★9.2，体验铁律 ⑩「说的 = 摆的」）。
 *
 * 一个参数值不管按哪种写法存进来（档案原文的 `"8"`、门里的 8），节点上显示的、约价算的、发给供应商的都是同一个值，
 * 报文按档案原文声明的写法发。修前这里有两类悄悄换值：
 *   · 存的类型和声明反了（字符串档案上存数字、数字档案上存字符串）→ 发送前被修成默认（行上 8、约价 8、发出 5）；
 *   · 分镜行在字符串时长档案上改时长 → 落进 params、被 durationSec 盖掉（选 12 发出 5）。
 *
 * 期望值不拿门自己的输出比：秒数 = 创作者点的那一档；报文写法 = 从档案源文件读出来、过声明门之前的那份声明
 * （`specializeArchetypeForVendor(getArchetypeById(...))`，测试可以直接读档案表）。每一格都走真函数、不花钱：
 *   显示 = 真 `resolveRenderedControls` + `parameterChipValue` / `composerHeadlineParts`（底栏、⚙ 面板、分镜行读的同一条链）；
 *   约价 = 真 `estimateNodePrice`（发送键约价、批量确认条、付费卡逐镜价读的同一份节点参数）；
 *   发出 = 画布那条 `buildCatalogTaskRequest` → `runTask`；外部助手那条走真宿主的编译口（`videoCompileOptions` 给的参数表）。
 * 出站全部被 installFetchCapture 接走（第一格先证明这一点），不连任何供应商。
 */
import { afterAll, describe, expect, it, vi } from "vitest";

vi.mock("electron", async () => {
  const nodeFs = await import("node:fs");
  const os = await import("node:os");
  const path = await import("node:path");
  const { electronStub } = await import("./parityElectronMock");
  return electronStub(nodeFs.mkdtempSync(path.join(os.tmpdir(), "nomi-param-value-type-")));
});
// 付费确认等的是人：这里替他点头，钱闸本身照旧真跑。
vi.mock("../capabilityCore/rendererBridge", () => ({
  requestRendererDecision: async () => ({ confirmed: true }),
  requestRenderer: async (operation: string) => { throw new Error(`no renderer bridge: ${operation}`); },
}));

import { getArchetypeById } from "../shared/modelArchetypes/builtInCatalog";
import { EVERY_VARIANT, resolveModelArchetype, specializeArchetypeForVendor, type ArchetypeMode, type ModelArchetype } from "../shared/modelArchetypes";
import type { ModelParameterControl } from "../shared/videoCapabilities/types";
import { admitNumber, admitParamValue } from "../shared/videoCapabilities/paramValue";
import { modeTransportFor } from "../shared/videoCapabilities/modeTransport";
import { recommendVideoGeneration } from "../shared/videoCapabilities/recommendation";
import { deriveShotPrice, type ModelPricing } from "../shared/contracts/shotPricingRule";
import { parseStoryboardPlan } from "../shared/storyboard/storyboardPlanSchema";
import type { PlanShot, StoryboardPlan } from "../shared/storyboard/storyboardPlan";
import { compileExecutionContract, type PlanCandidate } from "../capabilityCore/executionContract";
import { normalizeAuthoredCandidate, videoCompileOptions } from "../capabilityCore/mcpGenerationVideoResolve";
import { toCatalogModelOptions } from "../../src/config/modelOptionMappers";
import type { ModelOption } from "../../src/config/models";
import { createGenerationNode } from "../../src/workbench/generationCanvas/model/graphOps";
import type { GenerationCanvasNode } from "../../src/workbench/generationCanvas/model/generationCanvasTypes";
import { buildCatalogTaskRequest } from "../../src/workbench/generationCanvas/runner/catalogTaskActions";
import { resolveGenerationReferences } from "../../src/workbench/generationCanvas/runner/generationReferenceResolver";
import { resolveRenderedControls } from "../../src/workbench/generationCanvas/nodes/nodeModelArchetype";
import { parameterChipOptions, parameterChipValue } from "../../src/workbench/generationCanvas/nodes/primaryParameterChips";
import { composerHeadlineParts } from "../../src/workbench/generationCanvas/nodes/composerHeadlineSummary";
import { ensureArchetypeNodeMeta, referenceSlotStorage } from "../../src/workbench/generationCanvas/nodes/controls/archetypeMeta";
import { isParameterControl, type DynamicModelControl } from "../../src/workbench/generationCanvas/nodes/controls/parameterControlModel";
import { estimateNodePrice } from "../../src/workbench/generationCanvas/spend/planCostEstimate";
import { createEmptyStoryboardPlan, storyboardShotToCreateNodesArgs } from "../../src/workbench/generationCanvas/agent/storyboardPlan";
import { buildPlannedNodeMeta } from "../../src/workbench/generationCanvas/agent/plannedNodeMeta";
import { projectShotOntoNodeByPlanMode } from "../../src/workbench/creation/storyboard/exec/storyboardProjection";
import {
  composerEntryIndex,
  storyboardComposerChange,
  storyboardComposerControls,
  storyboardComposerMeta,
} from "../../src/workbench/creation/storyboard/shotRow/storyboardComposerModel";
import { driveEngineA, installFetchCapture, seedParityCatalog, seedUserRelayConnection, type CapturedCall } from "./generationParityTestUtils";

const PROMPT = "雨夜的街口，一个人撑着伞慢慢走过";
const PROJECT_ID = "proj-param-value-type";

// ── 出站：全部接到本机抓取上；中转视频走多部分表单，摊成 JSON 才看得到字段 ──
const capture = installFetchCapture();
const captured = globalThis.fetch;
(globalThis as { fetch: unknown }).fetch = (input: unknown, init?: RequestInit) => {
  if (init?.body instanceof FormData) {
    const fields: Record<string, unknown> = { __multipart: true };
    for (const [key, value] of init.body.entries()) fields[key] = typeof value === "string" ? value : "[file]";
    init = { ...init, body: JSON.stringify(fields) };
  }
  return (captured as (input: unknown, init?: RequestInit) => Promise<Response>)(input, init);
};
afterAll(() => { capture.restore(); });

// ── 真目录：全部内置供应商 + 一条自建中转 ──
const store = await import("../catalog/catalogStore");
store.ensureBuiltinModelSeeds();
await seedParityCatalog([...new Set(store.readCatalog().models.map((model) => model.vendorKey))]);
const relayVendor = await seedUserRelayConnection([{ modelKey: "sora-2", labelZh: "Sora 2", kind: "video" }]);
const catalog = store.readCatalog();
const options: ModelOption[] = toCatalogModelOptions(catalog.models.map((model) => ({
  modelKey: model.modelKey, modelAlias: model.modelAlias, vendorKey: model.vendorKey, kind: model.kind,
  labelZh: model.labelZh, meta: model.meta,
})) as Parameters<typeof toCatalogModelOptions>[0]);

const { createGenerationProviderBootstrap } = await import("../capabilityCore/generationProviderBootstrap");
const { createCatalogModuleRegistry } = await import("../capabilityCore/moduleCatalogBootstrap");
const { deriveUsableVideoModelCandidates } = await import("../capabilityCore/usableVideoModelCandidates");
const { createGenerationRuntimeAdapter } = await import("../capabilityCore/generationRuntimeAdapter");
const bootstrap = createGenerationProviderBootstrap(catalog, { catalogReader: () => store.readCatalog() });
const registry = createCatalogModuleRegistry(catalog, { readinessByProvider: bootstrap.readinessByProvider });
const videoCandidates = deriveUsableVideoModelCandidates();

type Row = { vendor: string; modelKey: string; kind: "video" | "image" | "audio"; archetype: ModelArchetype; option: ModelOption };
const rows: Row[] = catalog.models.flatMap((model): Row[] => {
  const archetype = resolveModelArchetype({ modelKey: model.modelKey, modelAlias: model.modelAlias, vendorKey: model.vendorKey, meta: model.meta }, { variant: EVERY_VARIANT });
  const option = options.find((candidate) => candidate.vendor === model.vendorKey && (candidate.modelKey || candidate.value) === model.modelKey);
  const kind = model.kind as Row["kind"];
  return archetype && option && ["video", "image", "audio"].includes(kind) ? [{ vendor: model.vendorKey, modelKey: model.modelKey, kind, archetype, option }] : [];
});
const rowOf = (vendor: string, modelKey: string): Row => {
  const row = rows.find((candidate) => candidate.vendor === vendor && candidate.modelKey === modelKey);
  if (!row) throw new Error(`目录里没有 ${vendor}/${modelKey}`);
  return row;
};
const modeOf = (row: Row, modeId: string): ArchetypeMode => {
  const mode = row.archetype.modes.find((candidate) => candidate.id === modeId);
  if (!mode) throw new Error(`${row.modelKey} 没有方式 ${modeId}`);
  return mode;
};

// ── 期望值的独立来源：档案源文件里、过声明门之前的那份声明 ──
function rawDeclaration(row: Row, modeId: string, key: string): ModelParameterControl | undefined {
  const base = getArchetypeById(row.archetype.id);
  return base ? specializeArchetypeForVendor(base, row.vendor).modes.find((mode) => mode.id === modeId)?.params.find((control) => control.key === key) : undefined;
}

/**
 * 供应商出口自己再编一层的（档案声明数字，供应商契约要字符串）：报文是声明值的字符串。只许减——哪天它不编了，下面会红。
 * 键 = `供应商/模型`。
 */
const VENDOR_EXIT_STRINGIFIES: Readonly<Record<string, string>> = {
  "kie/google/gemini-omni-flash-1-1": "electron/catalog/kieGeminiOmni11.ts：KIE 的 Omni 时长收字符串，档案按数字声明",
};

/**
 * 放上必填参考图后，画布这条在参数之外就被拦下的方式（默认参数一样拦，和时长怎么存无关）：参数对拍够不着它们。
 * 拦它们的是 electron/catalog/taskParamsGuard.ts 的「没有图生视频通道」，那个守卫和 Runway 目录本刀没碰。只许减——
 * 哪天能发了，「名单是实的」那一格会红，届时删掉这一行、让它进对拍。键 = `供应商/模型/方式`。
 */
const BLOCKED_BEFORE_PARAMS: ReadonlySet<string> = new Set([
  "runway/veo3.1/reference",
  "runway/veo3.1_fast/reference",
  "runway/gemini_omni_flash/reference",
]);
const blockedKey = (row: Row, modeId: string) => `${row.vendor}/${row.modelKey}/${modeId}`;

// ── 三条读法：显示、约价、发出 ──

const REFERENCE_URL = (index: number) => `https://assets.example.com/param-value-type/ref-${index}.png`;

/** 方式必填的参考槽各按下限放上地址（槽 → meta 存储键只问 referenceSlotStorage）：放大、图生视频这类不放就发不出去。 */
function requiredSlotMeta(mode: ArchetypeMode): Record<string, unknown> {
  const meta: Record<string, unknown> = {};
  mode.slots.forEach((slot, slotIndex) => {
    const storage = slot.min > 0 ? referenceSlotStorage(slot) : null;
    if (!storage) return;
    const urls = Array.from({ length: slot.min }, (_, index) => REFERENCE_URL(slotIndex * 10 + index));
    meta[storage.metaKey] = storage.isArray ? urls : urls[0];
  });
  return meta;
}

function canvasNode(row: Row, modeId: string, params: Record<string, unknown>): GenerationCanvasNode {
  return {
    ...createGenerationNode({ id: "n", kind: row.kind, prompt: PROMPT }),
    meta: {
      modelKey: row.modelKey, modelVendor: row.vendor, vendor: row.vendor,
      archetype: { id: row.archetype.id, modeId }, ...requiredSlotMeta(modeOf(row, modeId)), ...params,
    },
  } as GenerationCanvasNode;
}

const metaOf = (node: GenerationCanvasNode): Record<string, unknown> => (node.meta ?? {}) as Record<string, unknown>;

/** 节点上这个控件显示的那一档（生成框底栏 / ⚙ 面板同一条 meta → 默认值链）；显示串不是任何一档 → undefined。 */
function shownOnNode(row: Row, node: GenerationCanvasNode, key: string): { value: string; label: string } | undefined {
  const controls = resolveRenderedControls(row.option, metaOf(node), row.kind === "image", row.kind === "video", { node, graph: { nodes: [node], edges: [] } });
  const control = controls.find((candidate) => candidate.key === key);
  if (!control) return undefined;
  const shown = parameterChipValue(control, metaOf(node));
  return parameterChipOptions(control).find((option) => option.value === shown);
}

/** 价目：基价 100，每一档按「键:档」加档位那么多（用户在目录里配的就是这种按规格加价）。 */
function pricingFor(key: string, declared: ModelParameterControl): ModelPricing {
  return {
    cost: 100, enabled: true,
    specCosts: declared.options.map((option) => ({ specKey: `${key}:${String(option.value)}`, cost: Number(option.value), enabled: true })),
  };
}

function priceOnNode(row: Row, node: GenerationCanvasNode, pricing: ModelPricing): number | undefined {
  const price = estimateNodePrice(node, { ...row.option, pricing });
  return price.known ? price.amount - 100 : undefined;
}

type Sent = { body: Record<string, unknown>; failure?: string };

function flatten(prefix: string, value: unknown, sink: Record<string, unknown>): void {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) flatten(`${prefix}.${key}`, child, sink);
  } else {
    sink[prefix] = value;
  }
}
function bodyOf(call: CapturedCall | undefined): Record<string, unknown> {
  const sink: Record<string, unknown> = {};
  if (call) flatten("body", call.body, sink);
  return sink;
}

/** 画布那条：节点 → 请求 → 引擎 A（画布单镜、批量确认、Run 共用的那一处出口）。 */
async function sendNode(node: GenerationCanvasNode): Promise<Sent> {
  const request = buildCatalogTaskRequest(node, { references: resolveGenerationReferences(node, { nodes: [node], edges: [] }) }).request;
  const sent = await driveEngineA(capture, {
    vendorKey: String(metaOf(node).vendor), kind: request.kind, prompt: request.prompt,
    extras: { ...(request.extras as Record<string, unknown>), projectId: PROJECT_ID },
  });
  return sent.failure ? { body: {}, failure: `${sent.failure.code}: ${sent.failure.message.slice(0, 160)}` } : { body: bodyOf(capture.calls[0]) };
}

/** 外部助手那条：候选 → 真宿主的归一 + 编译口（参数表由 videoCompileOptions 给，和 mcpGenerationTools.contractFor 同一份）→ 供应商。 */
async function sendExternal(row: Row, modeId: string, parameters: Record<string, unknown>): Promise<Sent & { contractParameters?: Record<string, unknown> }> {
  capture.reset();
  const provider = bootstrap.providers.find((candidate) => candidate.providerId === row.vendor);
  if (!provider) return { body: {}, failure: "configured_provider" };
  try {
    const mode = modeOf(row, modeId);
    const candidate = normalizeAuthoredCandidate({
      candidateId: "param-value-type", revision: 1, moduleId: "generation.single-shot",
      providerId: row.vendor, modelId: row.modelKey, mode: modeTransportFor(mode, row.archetype, row.vendor) ?? "text_to_video", modeId,
      prompt: PROMPT, parameters, references: [],
    } as unknown as PlanCandidate, registry, videoCandidates);
    const contract = compileExecutionContract(candidate, registry, videoCompileOptions(candidate, videoCandidates));
    const { providerRequest } = createGenerationRuntimeAdapter({ providers: [provider] }).prepareAuthorization({ contract, providerIdempotencyKey: "param-value-type" });
    await provider.submit(providerRequest, "param-value-type").catch(() => undefined);
    return { body: bodyOf(capture.calls[0]), contractParameters: contract.parameters as Record<string, unknown> };
  } catch (error) {
    const coded = error as { code?: unknown; name?: unknown };
    return { body: {}, failure: typeof coded?.code === "string" ? coded.code : String(coded?.name ?? error) };
  }
}

/** 报文里等于期望值（值和类型都对）的字段。 */
const fieldsCarrying = (sent: Sent, wire: unknown): string[] => Object.entries(sent.body).filter(([, value]) => Object.is(value, wire)).map(([path]) => path);

// ── 目录里所有「数字档」下拉：按声明的形状认（档位全是数字、或全是规范数字串），不按键名——时长、放大倍数、出图张数、采样率…… ──

type NumericControl = { row: Row; mode: ArchetypeMode; control: ModelParameterControl; declared: ModelParameterControl; declaredAs: "string" | "number" };
const numericControls: NumericControl[] = rows.flatMap((row) => row.archetype.modes.flatMap((mode) => mode.params.flatMap((control): NumericControl[] => {
  if (control.type !== "select" || control.options.length === 0) return [];
  const declared = rawDeclaration(row, mode.id, control.key);
  const values = declared?.options.map((option) => option.value) ?? [];
  const declaredAs = values.every((value) => typeof value === "number") ? "number"
    : values.every((value) => typeof value === "string" && admitNumber(value) !== undefined) ? "string" : null;
  return declared && declaredAs ? [{ row, mode, control, declared, declaredAs }] : [];
})));
const wireFor = (entry: NumericControl, raw: string | number): string | number =>
  VENDOR_EXIT_STRINGIFIES[`${entry.row.vendor}/${entry.row.modelKey}`] ? String(raw) : raw;
const durationControls = numericControls.filter((entry) => entry.control.key === "duration" && entry.row.kind === "video");
const isBlocked = (entry: NumericControl) => BLOCKED_BEFORE_PARAMS.has(blockedKey(entry.row, entry.mode.id));
const sendableNumeric = numericControls.filter((entry) => !isBlocked(entry));
const sendableDurations = durationControls.filter((entry) => !isBlocked(entry));

describe("出站", () => {
  it("全部被本机抓取接走（不连任何供应商）", async () => {
    capture.reset();
    await globalThis.fetch("https://canary.example.com/param-value-type");
    expect(capture.calls.map((call) => call.url)).toEqual(["https://canary.example.com/param-value-type"]);
  });
});

describe("钉死四例：发出值 = 行上显示 = 约价（协调 2026-11-17 第 2 问）", () => {
  // 今天 = 修前主分支在同一条路上真发出去的（动代码前录的报文快照）；修后 = 创作者选的那一档，按档案声明的写法。
  const PINNED = [
    { vendor: "runninghub", modelKey: "bytedance/seedance-2.0-global", modeId: "text", stored: 8, today: "5", wire: "8" },
    { vendor: "apimart", modelKey: "MiniMax-Hailuo-2.3", modeId: "t2v", stored: "10", today: 6, wire: 10 },
    { vendor: "apimart", modelKey: "veo3.1-fast-official", modeId: "t2v", stored: "4", today: 8, wire: 4 },
  ] as const;

  it.each(PINNED)("$vendor $modelKey 存 $stored：今天发 $today，修后发 $wire，行上和约价都是这一档", async ({ vendor, modelKey, modeId, stored, wire }) => {
    const row = rowOf(vendor, modelKey);
    const node = canvasNode(row, modeId, { duration: stored });
    const sent = await sendNode(node);
    expect(sent.failure).toBeUndefined();
    expect(sent.body["body.duration"]).toBe(wire);
    expect(shownOnNode(row, node, "duration")?.value).toBe(String(wire));
    expect(priceOnNode(row, node, pricingFor("duration", rawDeclaration(row, modeId, "duration")!))).toBe(Number(wire));
  });

  it("外部助手给 Agnes 2.5 送数字 10：今天准入拒（parameter_type_mismatch），修后过准入、卡上是 10、约价按 10、发 \"10\"", async () => {
    const row = rowOf("agnes", "agnes-video-2.5");
    const sent = await sendExternal(row, "text", { duration: 10 });
    expect(sent.failure).toBeUndefined();
    expect(sent.contractParameters?.duration).toBe(10);
    expect(sent.body["body.seconds"]).toBe("10");
    // 落到画布上的那个节点（同一份合同参数）显示的也是 10。
    expect(shownOnNode(row, canvasNode(row, "text", sent.contractParameters!), "duration")?.value).toBe("10");
    const pricing = pricingFor("duration", rawDeclaration(row, "text", "duration")!);
    const price = deriveShotPrice({ candidate: { providerId: "agnes", modelId: row.modelKey, parameters: sent.contractParameters! }, resolvePricing: () => pricing });
    expect(price).toEqual({ known: true, amount: 110 });
  });
});

describe("全目录对拍：每个数字档下拉 × 每一档 × 存成数字或字符串", () => {
  it("覆盖设计卡点名的范围（字符串时长档 ≥ 20、数字时长档 ≥ 27、放大倍数）", () => {
    const count = (as: "string" | "number") => durationControls.filter((entry) => entry.declaredAs === as).length;
    expect(count("string")).toBeGreaterThanOrEqual(20);
    expect(count("number")).toBeGreaterThanOrEqual(27);
    expect(numericControls.some((entry) => entry.control.key === "upscale_factor")).toBe(true);
  });

  it("两种写法发出同一份报文，报文里是档案原文声明的那个值；节点显示这一档；约价按这一档", async () => {
    const mismatches: unknown[] = [];
    for (const entry of sendableNumeric) {
      const pricing = pricingFor(entry.control.key, entry.declared);
      const wires = new Set<string>();
      for (const declaredOption of entry.declared.options) {
        const raw = declaredOption.value as string | number;
        const seconds = admitNumber(raw)!;
        const wire = wireFor(entry, raw);
        const sends: Sent[] = [];
        for (const stored of [seconds, String(seconds)]) {
          const node = canvasNode(entry.row, entry.mode.id, { [entry.control.key]: stored });
          const sent = await sendNode(node);
          sends.push(sent);
          const where = { vendor: entry.row.vendor, model: entry.row.modelKey, mode: entry.mode.id, key: entry.control.key, stored };
          if (sent.failure) { mismatches.push({ ...where, failure: sent.failure }); continue; }
          if (fieldsCarrying(sent, wire).length === 0) mismatches.push({ ...where, wanted: wire, body: sent.body });
          const shown = shownOnNode(entry.row, node, entry.control.key);
          if (shown?.value !== String(seconds)) mismatches.push({ ...where, shown: shown ?? null });
          const priced = priceOnNode(entry.row, node, pricing);
          if (priced !== seconds) mismatches.push({ ...where, priced: priced ?? null });
        }
        if (JSON.stringify(sends[0]) !== JSON.stringify(sends[1])) {
          mismatches.push({ vendor: entry.row.vendor, model: entry.row.modelKey, mode: entry.mode.id, raw, numberForm: sends[0], stringForm: sends[1] });
        }
        wires.add(JSON.stringify(sends[0]?.body));
      }
      // 每一档都真的到了线上：换一档，报文就跟着变。
      if (wires.size !== entry.declared.options.length) mismatches.push({ vendor: entry.row.vendor, model: entry.row.modelKey, mode: entry.mode.id, distinctWires: wires.size });
    }
    expect(mismatches).toEqual([]);
  }, 600_000);

  it("供应商出口自己编字符串的名单是实的（不再编的那天删掉这一行）", async () => {
    for (const listed of Object.keys(VENDOR_EXIT_STRINGIFIES)) {
      const entry = durationControls.find((candidate) => `${candidate.row.vendor}/${candidate.row.modelKey}` === listed);
      expect(entry, listed).toBeDefined();
      const raw = entry!.declared.options[0]!.value as number;
      const sent = await sendNode(canvasNode(entry!.row, entry!.mode.id, { duration: raw }));
      expect(fieldsCarrying(sent, raw)).toEqual([]);
      expect(fieldsCarrying(sent, String(raw)).length).toBeGreaterThan(0);
    }
  });

  it("参数之外就发不出的名单是实的（默认参数照样被同一个守卫拦；能发了就删那一行）", async () => {
    const blocked = numericControls.filter(isBlocked);
    expect(blocked.map((entry) => blockedKey(entry.row, entry.mode.id)).sort()).toEqual([...BLOCKED_BEFORE_PARAMS].sort());
    for (const entry of blocked) {
      expect((await sendNode(canvasNode(entry.row, entry.mode.id, {}))).failure, blockedKey(entry.row, entry.mode.id)).toMatch(/没有「图生视频」通道/);
    }
  });

  it("外部助手（真宿主编译口）：每个时长档送数字、送规范数字串都过准入，报文是声明写法", async () => {
    const mismatches: unknown[] = [];
    const covered = new Set<string>();
    for (const entry of sendableDurations) {
      if (entry.mode.slots.length > 0) continue; // 带素材的方式在外部助手那条要素材库，这里只核纯文字方式的参数
      if (!bootstrap.providers.some((provider) => provider.providerId === entry.row.vendor)) continue;
      covered.add(`${entry.declaredAs}:${entry.row.vendor}/${entry.row.modelKey}`);
      const raw = (entry.declared.options.find((option) => option.value !== entry.declared.defaultValue) ?? entry.declared.options[0])!.value as string | number;
      const seconds = admitNumber(raw)!;
      for (const sentAs of [seconds, String(seconds)]) {
        const sent = await sendExternal(entry.row, entry.mode.id, { duration: sentAs });
        const where = { vendor: entry.row.vendor, model: entry.row.modelKey, mode: entry.mode.id, sentAs };
        if (sent.failure) mismatches.push({ ...where, failure: sent.failure });
        else if (sent.contractParameters?.duration !== seconds) mismatches.push({ ...where, contract: sent.contractParameters });
        else if (fieldsCarrying(sent, wireFor(entry, raw)).length === 0) mismatches.push({ ...where, wanted: wireFor(entry, raw), body: sent.body });
      }
    }
    expect(mismatches).toEqual([]);
    // 两种声明写法都真的走到了（字符串档 = 修前外部助手送数字被拒的那一类）。
    expect([...covered].filter((key) => key.startsWith("string:")).length).toBeGreaterThan(0);
    expect([...covered].filter((key) => key.startsWith("number:")).length).toBeGreaterThan(0);
  }, 300_000);
});

// ── 分镜行 ──

const entriesFor = (row: Row) => composerEntryIndex(row.option);
function rowShot(row: Row, modeId: string, durationSec: number, params: Record<string, unknown> = {}): PlanShot {
  return {
    index: 1, shotId: "shot-1", shotKind: "video", durationSec, anchorIds: [], prompt: PROMPT,
    modelKey: row.modelKey, modelVendor: row.vendor, modeId, params,
  } as PlanShot;
}
const planWith = (shot: PlanShot): StoryboardPlan => ({ ...createEmptyStoryboardPlan(), shots: [shot] }) as StoryboardPlan;

/** 分镜行底栏：和画布节点同一套控件，行级 meta 里时长来自 durationSec（ShotComposerBar 的 metaOverrides）。 */
function rowSurface(row: Row, shot: PlanShot): { controls: DynamicModelControl[]; meta: Record<string, unknown> } {
  const meta = { ...storyboardComposerMeta({ modelKey: shot.modelKey, modelVendor: shot.modelVendor, modeId: shot.modeId, params: shot.params ?? {} }, entriesFor(row)), duration: shot.durationSec };
  return { controls: storyboardComposerControls(row.option, meta, "video"), meta };
}
function rowHeadlineSeconds(row: Row, shot: PlanShot): string | undefined {
  const { controls, meta } = rowSurface(row, shot);
  return composerHeadlineParts({ isImageLike: false, isVideoLike: true, controls, meta, formatSeconds: (value) => `${value}s`, autoLabel: "auto" })
    .find((part) => part.key === "duration")?.text;
}

/** 新建节点那条：create_canvas_nodes 参数 → 落画布同一个构造器 buildPlannedNodeMeta（再补必填槽，分镜参考不在本格）。 */
function createdNode(row: Row, plan: StoryboardPlan, shot: PlanShot): GenerationCanvasNode {
  const args = storyboardShotToCreateNodesArgs(plan, shot);
  const planned = (args.nodes as Array<{ kind: string; params?: Record<string, unknown> }>).find((node) => node.kind === "video")!;
  const meta = buildPlannedNodeMeta({ modelKey: row.modelKey, modelVendor: row.vendor, modeId: shot.modeId, params: planned.params ?? {} }, entriesFor(row)) ?? {};
  return { ...createGenerationNode({ id: "n", kind: "video", prompt: PROMPT }), meta: { ...meta, vendor: row.vendor, ...requiredSlotMeta(modeOf(row, shot.modeId!)) } } as GenerationCanvasNode;
}
/**
 * 写回已有节点那条：projectShotOntoNodeByPlanMode。参考图归这一镜的锚点管，投影会按锚点重写参考槽（这里锚点为空就清空），
 * 所以必填槽在投影之后再放上——相当于这一镜挂了锚点。
 */
function writtenBackNode(row: Row, plan: StoryboardPlan, shot: PlanShot): GenerationCanvasNode {
  const node = canvasNode(row, shot.modeId!, {});
  const projected = projectShotOntoNodeByPlanMode(plan, shot, node);
  return { ...node, ...projected, meta: { ...(projected.meta ?? metaOf(node)), ...requiredSlotMeta(modeOf(row, shot.modeId!)) } } as GenerationCanvasNode;
}

describe("分镜行改时长 → 行上显示 → 新建节点 / 写回节点 → 发出（预测一）", () => {
  it("每个视频时长档：点一个非默认档，行上就是它，两条路发出去都是它（声明写法）", async () => {
    const mismatches: unknown[] = [];
    for (const entry of sendableDurations) {
      const raw = (entry.declared.options.find((option) => option.value !== entry.declared.defaultValue) ?? entry.declared.options[0])!.value as string | number;
      const seconds = admitNumber(raw)!;
      const where = { vendor: entry.row.vendor, model: entry.row.modelKey, mode: entry.mode.id, declaredAs: entry.declaredAs, picked: raw };
      const before = rowShot(entry.row, entry.mode.id, admitNumber(entry.declared.defaultValue) ?? 5);
      const { controls } = rowSurface(entry.row, before);
      const control = controls.find((candidate) => candidate.key === "duration");
      if (!control || !isParameterControl(control)) { mismatches.push({ ...where, control: "missing" }); continue; }
      const chip = parameterChipOptions(control).find((option) => option.value === String(seconds));
      if (!chip) { mismatches.push({ ...where, chips: parameterChipOptions(control) }); continue; }
      const change = storyboardComposerChange(control, chip.value, controls);
      if (change.kind !== "duration" || change.value !== seconds) { mismatches.push({ ...where, change }); continue; }
      const shot = rowShot(entry.row, entry.mode.id, change.value);
      const headline = rowHeadlineSeconds(entry.row, shot);
      if (!headline || !new RegExp(`^${seconds}(\\D|$)`).test(headline)) mismatches.push({ ...where, headline });
      const plan = planWith(shot);
      for (const [path, node] of [["新建节点", createdNode(entry.row, plan, shot)], ["写回节点", writtenBackNode(entry.row, plan, shot)]] as const) {
        const sent = await sendNode(node);
        if (sent.failure || fieldsCarrying(sent, wireFor(entry, raw)).length === 0) mismatches.push({ ...where, path, failure: sent.failure, body: sent.body });
      }
    }
    expect(mismatches).toEqual([]);
  }, 300_000);
});

describe("旧目录配置（时长键叫 durationSeconds）的模型在分镜行改时长（设计卡 ★9.12：先复现）", () => {
  // 只有没档案的模型才走旧目录配置（有档案的一律是档案的 duration 控件）。
  const legacy: ModelOption = {
    value: "legacy-video-model", modelKey: "legacy-video-model", label: "Legacy Video", vendor: "legacy-vendor", kind: "video",
    meta: { durs: [{ key: 5, label: "5s" }, { key: 10, label: "10s" }] },
  } as ModelOption;

  // 「改了不生效」复现得出，但根因不在值类型：没档案的视频模型整条落不进分镜方案的节点（Agent 名单层只收有档案的媒体模型），
  // 不光时长，模型本身和其它参数都到不了节点。这是模型身份那一层的事，本刀不改，这一格钉住事实，修那一层时它会红。
  it("没档案的模型：分镜行有旧目录的时长档，但行级 meta 和落画布的 meta 都是空的（模型整条没落下）", () => {
    expect(resolveModelArchetype({ modelKey: "legacy-video-model", vendorKey: "legacy-vendor", meta: legacy.meta }, { variant: EVERY_VARIANT })).toBeNull();
    const controls = storyboardComposerControls(legacy, {}, "video");
    const control = controls.find((candidate) => candidate.key === "durationSeconds");
    expect(control).toBeDefined();
    expect(composerEntryIndex(legacy).size).toBe(0);
    expect(storyboardComposerMeta({ modelKey: "legacy-video-model", modelVendor: "legacy-vendor", params: { durationSeconds: 10 } }, composerEntryIndex(legacy))).toEqual({});
    expect(buildPlannedNodeMeta({ modelKey: "legacy-video-model", modelVendor: "legacy-vendor", params: { duration: 5, durationSeconds: 10 } }, composerEntryIndex(legacy))).toBeUndefined();
  });
});

describe("两个时长字段打架的镜头（用户 / 协调 2026-11-17 定）", () => {
  const row = () => rowOf("runninghub", "bytedance/seedance-2.0-global");
  const read = (durationSec: number, duration: unknown): PlanShot => parseStoryboardPlan({
    ...createEmptyStoryboardPlan(), shots: [rowShot(row(), "text", durationSec, { duration })],
  }).shots[0]!;

  it("durationSec 5 + params.duration \"12\"：读入是 5、params 里没有 duration，行上 5s，两条路都发 \"5\"", async () => {
    const shot = read(5, "12");
    expect(shot.durationSec).toBe(5);
    expect(shot.params).not.toHaveProperty("duration");
    expect(rowHeadlineSeconds(row(), shot)).toMatch(/^5(\D|$)/);
    for (const node of [createdNode(row(), planWith(shot), shot), writtenBackNode(row(), planWith(shot), shot)]) {
      expect((await sendNode(node)).body["body.duration"]).toBe("5");
    }
  });

  it("durationSec 0 + params.duration \"12\"：读入收成 12；新建节点付钱前显示 12、约价按 12；两条路都发 \"12\"", async () => {
    const shot = read(0, "12");
    expect(shot.durationSec).toBe(12);
    expect(shot.params).not.toHaveProperty("duration");
    expect(rowHeadlineSeconds(row(), shot)).toMatch(/^12(\D|$)/);
    const created = createdNode(row(), planWith(shot), shot);
    expect(shownOnNode(row(), created, "duration")?.value).toBe("12");
    expect(priceOnNode(row(), created, pricingFor("duration", rawDeclaration(row(), "text", "duration")!))).toBe(12);
    for (const node of [created, writtenBackNode(row(), planWith(shot), shot)]) {
      expect((await sendNode(node)).body["body.duration"]).toBe("12");
    }
  });

  it("读不出秒数的 params.duration 原样留着，不当 0、不当默认", () => {
    expect(read(0, "12s")).toMatchObject({ durationSec: 0, params: { duration: "12s" } });
  });
});

describe("旧节点、中转草稿、不设时长、推荐器", () => {
  it("画布上存字符串 \"12\" 的 RunningHub Seedance 节点：打开不改写 meta，发 \"12\"", async () => {
    const row = rowOf("runninghub", "bytedance/seedance-2.0-global");
    const node = canvasNode(row, "text", { duration: "12" });
    expect(ensureArchetypeNodeMeta(metaOf(node), row.archetype)).toBeNull();
    expect((await sendNode(node)).body["body.duration"]).toBe("12");
  });

  it("中转草稿：存 \"8\"、存 8 都发 \"8\"，不设发 \"4\"，表单类型不变", async () => {
    const row = rows.find((candidate) => candidate.vendor === relayVendor)!;
    const seconds = async (meta: Record<string, unknown>) => (await sendNode(canvasNode(row, row.archetype.defaultModeId, meta))).body;
    for (const stored of ["8", 8]) expect(await seconds({ duration: stored })).toMatchObject({ "body.__multipart": true, "body.seconds": "8" });
    expect(await seconds({})).toMatchObject({ "body.__multipart": true, "body.seconds": "4" });
  });

  it("Agnes 2.5 / 2.5 Flash 不设时长发 \"5\"；Agnes V2.0 不设时长发 121 帧、24 帧率（编码在补默认之前，补进来的一个字节不动）", async () => {
    for (const modelKey of ["agnes-video-2.5", "agnes-video-2.5-flash"]) {
      expect((await sendNode(canvasNode(rowOf("agnes", modelKey), "text", {}))).body["body.seconds"]).toBe("5");
    }
    const v2 = rows.find((candidate) => candidate.vendor === "agnes" && candidate.kind === "video" && !candidate.modelKey.startsWith("agnes-video-2.5"))!;
    expect((await sendNode(canvasNode(v2, v2.archetype.defaultModeId, {}))).body).toMatchObject({ "body.num_frames": 121, "body.frame_rate": 24 });
  });

  it("放大倍数：门里是 2，报文是 \"2\"", async () => {
    const row = rowOf("kie", "topaz/image-upscale");
    expect(row.archetype.modes[0]!.params.find((control) => control.key === "upscale_factor")?.defaultValue).toBe(2);
    expect((await sendNode(canvasNode(row, "upscale", { upscale_factor: 2 }))).body["body.input.upscale_factor"]).toBe("2");
  });

  it("推荐器：RunningHub Kling 3.0 要 7 秒 → 推荐档位里最近的一档（6 或 8），发出去是那一档的字符串", async () => {
    const candidates = videoCandidates.filter((candidate) => candidate.provider === "runninghub" && candidate.archetype.id === "rh-kling-3.0");
    expect(candidates.length).toBeGreaterThan(0);
    const [top] = recommendVideoGeneration({ prompt: PROMPT, goals: { durationSeconds: 7 } }, candidates).recommendations;
    expect([6, 8]).toContain(top!.params.duration);
    const sent = await sendNode(canvasNode(rowOf("runninghub", top!.modelKey), top!.modeId, { ...top!.params }));
    expect(sent.body["body.duration"]).toBe(String(top!.params.duration));
  });

  it("不误伤：Suno 的文字 style（看着像数字也是文字）、Eleven 的 0–1 数字 style，门里门外原样", () => {
    // Suno 的音乐方式在这个对拍夹具里默认参数就发不出（主分支同样，和参数无关），这一格核门：声明不被改写、存的值不被改写。
    const styleOf = (prefix: string): [Row, ArchetypeMode, ModelParameterControl] => {
      for (const row of rows.filter((candidate) => candidate.archetype.id.startsWith(prefix))) {
        for (const mode of row.archetype.modes) {
          const control = mode.params.find((candidate) => candidate.key === "style");
          if (control) return [row, mode, control];
        }
      }
      throw new Error(`${prefix} 没有 style`);
    };
    const [suno, sunoMode, sunoStyle] = styleOf("suno");
    expect(sunoStyle).toEqual(rawDeclaration(suno, sunoMode.id, "style"));
    expect(sunoStyle.type).toBe("text");
    expect(admitParamValue(sunoStyle, "12")).toBe("12");
    const [eleven, elevenMode, elevenStyle] = styleOf("eleven");
    expect(elevenStyle).toEqual(rawDeclaration(eleven, elevenMode.id, "style"));
    expect(admitParamValue(elevenStyle, 0.35)).toBe(0.35);
  });

  it("不误伤：每个能发的文字参数填像数字的值，发出去还是那串字", async () => {
    const mismatches: unknown[] = [];
    let covered = 0;
    for (const row of rows) {
      for (const mode of row.archetype.modes.filter((candidate) => candidate.slots.every((slot) => slot.min === 0) && !BLOCKED_BEFORE_PARAMS.has(blockedKey(row, candidate.id)))) {
        for (const text of mode.params.filter((control) => control.type === "text" && rawDeclaration(row, mode.id, control.key)?.type === "text")) {
          const sent = await sendNode(canvasNode(row, mode.id, { [text.key]: "4217" }));
          if (sent.failure) continue; // 默认参数在夹具里就发不出的方式（如 Suno 音乐）不归这一格
          covered += 1;
          // 有的文字参数进的是地址（ElevenLabs 的 voice_id 在路径里），一样算发出去了。
          const inUrl = capture.calls[0]?.url.includes("/4217") ?? false;
          if ((fieldsCarrying(sent, "4217").length === 0 && !inUrl) || fieldsCarrying(sent, 4217).length > 0) {
            mismatches.push({ vendor: row.vendor, model: row.modelKey, mode: mode.id, key: text.key, body: sent.body });
          }
        }
      }
    }
    expect(mismatches).toEqual([]);
    expect(covered).toBeGreaterThan(0);
  }, 300_000);

  it("约价：价目「duration:12」对数字 12 和字符串 \"12\" 都命中", () => {
    const pricing: ModelPricing = { cost: 1, enabled: true, specCosts: [{ specKey: "duration:12", cost: 9, enabled: true }] };
    for (const duration of [12, "12"]) {
      expect(deriveShotPrice({ candidate: { providerId: "v", modelId: "m", parameters: { duration } }, resolvePricing: () => pricing })).toEqual({ known: true, amount: 10 });
    }
  });
});
