/**
 * 参数键对比尺：节点上留着「别的方式」的参数，换到另一个方式发送，请求体里到底带了哪些键。
 *
 * 只记事实、不判对错，今天算出来的结果钉成快照（paramsKeysByMode.snapshot.json）。
 * 以后每收掉一处「别的方式的键被照发」，快照就要更新、差异在 PR 里看得见。
 *
 * 样本：内置目录里每个认得档案的模型行（档案 × 供应商 × 型号）× 档案内每一对方式（A≠B，从 A 换到 B）。
 * 驱动全部复用 `generationParityTestUtils`（画布路 = 引擎 A runTask；Run 路 = 引擎 B 生成 provider），
 * 「B 声明了哪些键」直接读档案里 B 的 params / fixedParams，不在这里重写任何「方式认哪些键」的逻辑。
 *
 * 三样事实（每条路各记一份）：
 *   leaks            节点放着 A 声明、B 没声明的键，发 B 时请求体里多出来的字段（键名 + 字段路径）。
 *                    判据 = 「只放这一个键」对「什么参数都不放」的请求体逐字段差异。
 *   defaultCarried   节点什么参数都不放、直接发 B，请求体里有、但 B 自己没声明的键（候选键 = 该档案的
 *                    线缆默认值表 + 它所有方式声明过的键；按「字段路径末段 = 键名」认字段）。
 *   emptyDuration    B 没有时长控件，请求体里有没有 duration、值是什么。
 *
 * 已知局限：字段认法按「路径末段 = 键名」，供应商把键改名后落到别的字段名的，认不出来；
 * 值取 A 控件里一个不等于默认值的可选值（只有一个可选值才用默认值），以免泄漏恰好等于 B 线缆默认值而被吞；只有一个可选值的键仍可能被吞；
 * 需要视频 / 音频参考才能受理的方式，量到的是「被拒」（status 记 refused:<code>），量不到键。
 * image-url 类控件（要真素材）不放进节点参数。
 *
 * 更新快照：NOMI_UPDATE_PARAMS_KEYS_SNAPSHOT=1 pnpm exec vitest run electron/parity/paramsKeysByMode.matrix.test.ts
 */
/// <reference types="vite/client" />
import { afterAll, describe, expect, it, vi } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

vi.mock("electron", async () => {
  const nodeFs = await import("node:fs");
  const os = await import("node:os");
  const nodePath = await import("node:path");
  const { electronStub } = await import("./parityElectronMock");
  return electronStub(nodeFs.mkdtempSync(nodePath.join(os.tmpdir(), "nomi-params-keys-")));
});
vi.mock("../capabilityCore/rendererBridge", () => ({
  requestRendererDecision: async () => ({ confirmed: true }),
  requestRenderer: async (operation: string) => {
    throw new Error(`no renderer bridge in params-keys matrix: ${operation}`);
  },
}));

import { resolveArchetypeForModel } from "../shared/modelArchetypes";
import { modeTransportFor } from "../shared/videoCapabilities/modeTransport";
import { spendReferenceKey } from "../shared/contracts/pendingSpendConfirm";
import { ARCHETYPE_WIRE_DEFAULTS } from "../catalog/archetypeWireDefaults.generated";
import { createGenerationNode } from "../../src/workbench/generationCanvas/model/graphOps";
import { buildCatalogTaskRequest } from "../../src/workbench/generationCanvas/runner/catalogTaskActions";
import { resolveGenerationReferences } from "../../src/workbench/generationCanvas/runner/generationReferenceResolver";
import { placeUploadedImages } from "../../src/workbench/generationCanvas/nodes/controls/referenceList";
import { driveEngineA, driveEngineB, installFetchCapture, seedParityCatalog, seedUserRelayConnection } from "./generationParityTestUtils";
import { recordFields, type OutboundRecord } from "./outboundRecord";

const SNAPSHOT_PATH = fileURLToPath(new URL("./paramsKeysByMode.snapshot.json", import.meta.url));
const updateSnapshot = process.env.NOMI_UPDATE_PARAMS_KEYS_SNAPSHOT === "1";

const capture = installFetchCapture();
const seeded = await seedParityCatalog([]);
{
  const store = await import("../catalog/catalogStore");
  for (const vendor of seeded.vendors) store.upsertModelCatalogVendorApiKey(vendor.key, { apiKey: `sk-parity-${vendor.key}` });
}
afterAll(() => capture.restore());

type Archetype = NonNullable<ReturnType<typeof resolveArchetypeForModel>>;
type Mode = Archetype["modes"][number];
type Control = Mode["params"][number];
type Row = (typeof seeded.models)[number];

const REF = "https://assets.example.com/ref/";
const refUrl = (i: number) => `${REF}img-${i}.png`;
const IMAGE_SLOT_KINDS = ["first_frame", "last_frame", "image_ref"];

// ───────────── 工具 ─────────────

/** 控件的默认值；没有默认值取第一个档位，再取范围下限。 */
function declaredDefaultOf(control: Control): string | number | boolean {
  if (control.defaultValue !== undefined) return control.defaultValue;
  if (control.options.length) return control.options[0].value;
  if (typeof control.min === "number") return control.min;
  if (control.type === "boolean") return false;
  return "gauge";
}

/**
 * 放进节点的值：可选值不止一个时取一个**不等于默认值**的（下拉取第一个非默认档；数值范围取上限，
 * 上限等于默认就取下限；布尔取反），这样泄漏的键不会因为恰好等于 B 的线缆默认值而被吞；
 * 只有一个可选值时才用默认值。image-url 类（要真素材）返回 undefined。
 */
function defaultValueOf(control: Control): string | number | boolean | undefined {
  if (control.type === "image-url") return undefined;
  const fallback = declaredDefaultOf(control);
  if (control.options.length) return control.options.find((option) => option.value !== fallback)?.value ?? fallback;
  if (control.type === "boolean") return !fallback;
  if (typeof control.max === "number" && typeof control.min === "number") {
    if (control.max !== fallback) return control.max;
    return control.min !== fallback ? control.min : fallback;
  }
  return fallback;
}

function nodeParamsOf(mode: Mode): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  for (const control of mode.params) {
    const value = defaultValueOf(control);
    if (value !== undefined) out[control.key] = value;
  }
  return out;
}

const declaredKeysOf = (mode: Mode): Set<string> => new Set([...mode.params.map((c) => c.key), ...Object.keys(mode.fixedParams ?? {})]);

/** 字段路径末段（跳过数组下标）。 */
function leafName(path: string): string {
  const parts = path.split(".").filter((part) => !/^\d+$/.test(part));
  return parts[parts.length - 1] ?? path;
}

const bodyFields = (record: OutboundRecord): Map<string, unknown> => {
  const out = new Map<string, unknown>();
  for (const [path, value] of recordFields(record)) if (path.startsWith("body.")) out.set(path.slice(5), value);
  return out;
};

const statusOf = (record: OutboundRecord): string => (record.request ? "sent" : `refused:${record.failure?.code ?? "unknown"}`);

type Wire = OutboundRecord;
type SampleContext = { row: Row; archetype: Archetype; mode: Mode; refCount: number };

/** 画布 / 分镜那条路：节点（meta 里平放参数）→ 真实的 buildCatalogTaskRequest → 引擎 A。 */
async function sendCanvas(ctx: SampleContext, params: Record<string, unknown>): Promise<Wire> {
  const { row, archetype, mode, refCount } = ctx;
  const urls = Array.from({ length: refCount }, (_, i) => refUrl(i + 1));
  const node = {
    ...createGenerationNode({ id: "n", kind: archetype.kind, prompt: "一个镜头" }),
    meta: {
      modelKey: row.modelKey,
      modelVendor: row.vendorKey,
      vendor: row.vendorKey,
      archetype: { id: archetype.id, modeId: mode.id },
      ...params,
      ...(refCount ? { referenceImageUrls: urls } : {}),
    },
  } as never;
  try {
    const req = buildCatalogTaskRequest(node, { references: resolveGenerationReferences(node, { nodes: [node], edges: [] }) }).request;
    return await driveEngineA(capture, { vendorKey: row.vendorKey, kind: req.kind, prompt: req.prompt, extras: { ...(req.extras as Record<string, unknown>), projectId: "parity-project" } });
  } catch (error) {
    return { failure: { code: "throw", message: (error as Error).message } };
  }
}

/** Agent / 无界面那条路：引擎 B（生成 provider）。 */
async function sendRun(ctx: SampleContext, params: Record<string, unknown>): Promise<Wire> {
  const { row, archetype, mode, refCount } = ctx;
  const urls = Array.from({ length: refCount }, (_, i) => refUrl(i + 1));
  try {
    const placed = placeUploadedImages(mode, urls);
    const refs: Array<{ assetId: string; contentHash: string; version: number; kind: "image"; role: string }> = [];
    mode.slots.forEach((slot: { kind: string }, i: number) =>
      (placed.bySlot[i] ?? []).forEach((u: string) =>
        refs.push({
          assetId: u,
          contentHash: `h-${refs.length}`,
          version: 1,
          kind: "image",
          role: slot.kind === "first_frame" ? "first_frame" : slot.kind === "last_frame" ? "last_frame" : "reference",
        }),
      ),
    );
    return await driveEngineB(capture, {
      vendorKey: row.vendorKey,
      modelId: row.modelKey,
      mode: modeTransportFor(mode, archetype, row.vendorKey) ?? "",
      ...(archetype.kind === "video" ? { modeId: mode.id } : {}),
      prompt: "一个镜头",
      parameters: params,
      references: refs as never,
      referenceUrls: Object.fromEntries(refs.map((r) => [spendReferenceKey(r as never), r.assetId])),
    });
  } catch (error) {
    return { failure: { code: "throw", message: (error as Error).message } };
  }
}

type PathName = "canvas" | "run";
const SENDERS: Record<PathName, (ctx: SampleContext, params: Record<string, unknown>) => Promise<Wire>> = { canvas: sendCanvas, run: sendRun };

type Leak = { key: string; fields: string[] };
type Carried = { key: string; fields: string[] };
type PathFacts = {
  status: string;
  /** 放上「A 有 B 没」的键后的发送状态（与 status 不同说明这些键改变了受理结果）。 */
  statusWithParams: string;
  leaks: Leak[];
  defaultCarried: Carried[];
  emptyDuration: { field: string; value: unknown } | null;
};
type Sample = { id: string; canvas: PathFacts; run: PathFacts };

function diffFields(base: Map<string, unknown>, next: Map<string, unknown>): string[] {
  const paths = new Set([...base.keys(), ...next.keys()]);
  return [...paths].filter((path) => !Object.is(base.get(path), next.get(path))).sort();
}

/** 「什么参数都不放、直接发 B」只取决于（模型行, B, 哪条路），与 A 无关，所以每个 B 只发一次、供所有 A→B 共用。 */
type BaselineFacts = { baseline: Wire; baseFields: Map<string, unknown>; defaultCarried: Carried[]; emptyDuration: PathFacts["emptyDuration"] };
const baselineCache = new Map<string, BaselineFacts>();

async function baselineOf(path: PathName, ctx: SampleContext): Promise<BaselineFacts> {
  const cacheKey = `${path}|${ctx.row.vendorKey}|${ctx.row.modelKey}|${ctx.mode.id}`;
  const hit = baselineCache.get(cacheKey);
  if (hit) return hit;
  const declaredB = declaredKeysOf(ctx.mode);
  const baseline = await SENDERS[path](ctx, {});
  const baseFields = bodyFields(baseline);

  // 默认值带过来的键。
  const defaultCarried: Carried[] = [];
  if (baseline.request) {
    const taskKind = modeTransportFor(ctx.mode, ctx.archetype, ctx.row.vendorKey) ?? "";
    const perKind = ARCHETYPE_WIRE_DEFAULTS[ctx.archetype.id]?.[taskKind];
    const candidates = new Set<string>([
      ...Object.keys(perKind?.[ctx.row.vendorKey] ?? perKind?.["*"] ?? {}),
      ...ctx.archetype.modes.flatMap((mode) => mode.params.map((c) => c.key)),
    ]);
    for (const key of [...candidates].sort()) {
      if (declaredB.has(key)) continue;
      const fields = [...baseFields.keys()].filter((p) => leafName(p) === key).sort();
      if (fields.length) defaultCarried.push({ key, fields });
    }
  }

  // 空时长：B 没有时长控件，请求体里有没有 duration。
  let emptyDuration: PathFacts["emptyDuration"] = null;
  if (baseline.request && !ctx.mode.params.some((c) => c.key === "duration")) {
    const field = [...baseFields.keys()].filter((p) => leafName(p) === "duration").sort()[0];
    if (field) emptyDuration = { field, value: baseFields.get(field) };
  }
  const facts = { baseline, baseFields, defaultCarried, emptyDuration };
  baselineCache.set(cacheKey, facts);
  return facts;
}

async function measurePath(path: PathName, ctx: SampleContext, from: Mode): Promise<PathFacts> {
  const send = SENDERS[path];
  const declaredB = declaredKeysOf(ctx.mode);
  const paramsA = nodeParamsOf(from);
  const leakedKeys = Object.keys(paramsA).filter((key) => !declaredB.has(key)).sort();
  const { baseline, baseFields, defaultCarried, emptyDuration } = await baselineOf(path, ctx);

  // 漏过去的键：只放这一个键 vs 什么都不放。
  const leaks: Leak[] = [];
  let statusWithParams = statusOf(baseline);
  if (leakedKeys.length) {
    const all = await send(ctx, Object.fromEntries(leakedKeys.map((key) => [key, paramsA[key]])));
    statusWithParams = statusOf(all);
    if (statusOf(baseline) === "sent" && all.request && diffFields(baseFields, bodyFields(all)).length) {
      for (const key of leakedKeys) {
        const one = leakedKeys.length === 1 ? all : await send(ctx, { [key]: paramsA[key] });
        const fields = one.request ? diffFields(baseFields, bodyFields(one)) : [];
        if (fields.length) leaks.push({ key, fields });
      }
    }
  }
  return { status: statusOf(baseline), statusWithParams, leaks, defaultCarried, emptyDuration };
}

/** 放几张图：图槽下限之和；走图生通道（图生视频 / 改图 / 图生 3D）的方式至少放一张，否则被「缺参考图」挡在发送之前、量不到键。 */
function imageRefCountFor(mode: Mode, archetype: Archetype, vendorKey: string): number {
  const slots = mode.slots.filter((slot: { kind: string }) => IMAGE_SLOT_KINDS.includes(slot.kind));
  const floor = slots.reduce((sum: number, slot: { min: number }) => sum + slot.min, 0);
  const needsImage = ["image_to_video", "image_edit", "image_to_3d"].includes(modeTransportFor(mode, archetype, vendorKey) ?? "");
  return slots.length === 0 ? 0 : needsImage ? Math.max(1, floor) : floor;
}

// ───────────── 样本枚举 ─────────────

type Plan = { id: string; row: Row; archetype: Archetype; from: Mode; to: Mode };

function enumeratePlans(): Plan[] {
  const plans: Plan[] = [];
  for (const row of seeded.models) {
    const archetype = resolveArchetypeForModel({ modelKey: row.modelKey, modelAlias: row.modelAlias, vendorKey: row.vendorKey, meta: row.meta });
    if (!archetype) continue;
    for (const from of archetype.modes) {
      for (const to of archetype.modes) {
        if (from.id === to.id) continue;
        plans.push({ id: `${archetype.id}|${row.vendorKey}|${row.modelKey}|${from.id}->${to.id}`, row, archetype, from, to });
      }
    }
  }
  return plans.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

async function measureSample(plan: Plan): Promise<Sample> {
  const ctx: SampleContext = { row: plan.row, archetype: plan.archetype, mode: plan.to, refCount: imageRefCountFor(plan.to, plan.archetype, plan.row.vendorKey) };
  return { id: plan.id, canvas: await measurePath("canvas", ctx, plan.from), run: await measurePath("run", ctx, plan.from) };
}

// ───────────── 没有方式记录的节点（老节点、自建中转） ─────────────

const LEGACY_PROBE_PARAMS = { aspect_ratio: "16:9", resolution: "1080p", duration: 5, size: "1024x1024", seed: 7, n: 2 };

type LegacySample = { id: string; canvas: LegacyFacts; run: LegacyFacts };
type LegacyFacts = { status: string; probeFields: Record<string, unknown>; bodyFieldPaths: string[] };

function legacyFacts(record: OutboundRecord): LegacyFacts {
  const fields = bodyFields(record);
  const probeFields: Record<string, unknown> = {};
  for (const [path, value] of [...fields].sort(([a], [b]) => (a < b ? -1 : 1))) {
    if (Object.keys(LEGACY_PROBE_PARAMS).includes(leafName(path))) probeFields[path] = value;
  }
  return { status: statusOf(record), probeFields, bodyFieldPaths: [...fields.keys()].sort() };
}

async function measureLegacy(): Promise<LegacySample[]> {
  const vendorKey = await seedUserRelayConnection([
    { modelKey: "relay-gauge-image", labelZh: "中转图片", kind: "image" },
    { modelKey: "relay-gauge-video", labelZh: "中转视频", kind: "video" },
  ], { vendorName: "Params Keys Gauge Relay" });
  const out: LegacySample[] = [];
  for (const [modelKey, kind, taskKind] of [["relay-gauge-image", "image", "text_to_image"], ["relay-gauge-video", "video", "text_to_video"]] as const) {
    const node = {
      ...createGenerationNode({ id: "n", kind, prompt: "一个镜头" }),
      meta: { modelKey, modelVendor: vendorKey, vendor: vendorKey, ...LEGACY_PROBE_PARAMS },
    } as never;
    let canvas: OutboundRecord;
    try {
      const req = buildCatalogTaskRequest(node, { references: resolveGenerationReferences(node, { nodes: [node], edges: [] }) }).request;
      canvas = await driveEngineA(capture, { vendorKey, kind: req.kind, prompt: req.prompt, extras: req.extras as never });
    } catch (error) {
      canvas = { failure: { code: "throw", message: (error as Error).message } };
    }
    const run = await driveEngineB(capture, { vendorKey, modelId: modelKey, mode: taskKind, prompt: "一个镜头", parameters: LEGACY_PROBE_PARAMS });
    out.push({ id: `no-mode-record|relay|${kind}`, canvas: legacyFacts(canvas), run: legacyFacts(run) });
  }
  return out;
}

// ───────────── 汇总 ─────────────

type Snapshot = {
  summary: {
    samples: number;
    archetypes: number;
    samplesWithLeaks: { canvas: number; run: number; either: number };
    archetypesWithLeaks: number;
    topLeakedKeys: Array<{ key: string; samples: number }>;
    archetypesWithDefaultCarried: number;
    emptyDuration: { canvas: number; run: number; emptyValue: number };
    pathsDiffer: number;
  };
  /** 两条路都受理、事实却不同的样本，或一条受理一条被拒的样本。 */
  pathDifferences: Array<{ id: string; kind: "facts-differ" | "one-refused"; canvasStatus: string; runStatus: string }>;
  sampleIds: string[];
  /** 只列有事实的样本（没有漏键、没有带过来的默认键、没有空时长的不列）。 */
  samples: Sample[];
  noModeRecord: LegacySample[];
};

const hasFacts = (f: PathFacts): boolean => f.leaks.length > 0 || f.defaultCarried.length > 0 || f.emptyDuration !== null || f.status !== "sent" || f.statusWithParams !== f.status;

function factsEqual(a: PathFacts, b: PathFacts): boolean {
  return JSON.stringify([a.leaks, a.defaultCarried, a.emptyDuration]) === JSON.stringify([b.leaks, b.defaultCarried, b.emptyDuration]);
}

function summarize(all: Sample[], legacy: LegacySample[]): Snapshot {
  const leakKeyCount = new Map<string, number>();
  const leakArchetypes = new Set<string>();
  const carriedArchetypes = new Set<string>();
  const sampleArchetype = (id: string) => id.split("|")[0];
  let canvasLeak = 0, runLeak = 0, either = 0, durCanvas = 0, durRun = 0, durEmpty = 0;
  const pathDifferences: Snapshot["pathDifferences"] = [];
  for (const sample of all) {
    const c = sample.canvas, r = sample.run;
    if (c.leaks.length) canvasLeak++;
    if (r.leaks.length) runLeak++;
    if (c.leaks.length || r.leaks.length) {
      either++;
      leakArchetypes.add(sampleArchetype(sample.id));
      const keys = new Set([...c.leaks, ...r.leaks].map((leak) => leak.key));
      for (const key of keys) leakKeyCount.set(key, (leakKeyCount.get(key) ?? 0) + 1);
    }
    if (c.defaultCarried.length || r.defaultCarried.length) carriedArchetypes.add(sampleArchetype(sample.id));
    if (c.emptyDuration) durCanvas++;
    if (r.emptyDuration) durRun++;
    for (const d of [c.emptyDuration, r.emptyDuration]) if (d && (d.value === "" || d.value === null || d.value === undefined)) durEmpty++;
    if (c.status === "sent" && r.status === "sent") {
      if (!factsEqual(c, r)) pathDifferences.push({ id: sample.id, kind: "facts-differ", canvasStatus: c.status, runStatus: r.status });
    } else if (c.status === "sent" || r.status === "sent") {
      pathDifferences.push({ id: sample.id, kind: "one-refused", canvasStatus: c.status, runStatus: r.status });
    }
  }
  const topLeakedKeys = [...leakKeyCount].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, 5).map(([key, samples]) => ({ key, samples }));
  return {
    summary: {
      samples: all.length,
      archetypes: new Set(all.map((s) => sampleArchetype(s.id))).size,
      samplesWithLeaks: { canvas: canvasLeak, run: runLeak, either },
      archetypesWithLeaks: leakArchetypes.size,
      topLeakedKeys,
      archetypesWithDefaultCarried: carriedArchetypes.size,
      emptyDuration: { canvas: durCanvas, run: durRun, emptyValue: durEmpty },
      pathsDiffer: pathDifferences.length,
    },
    pathDifferences,
    sampleIds: all.map((s) => s.id),
    samples: all.filter((s) => hasFacts(s.canvas) || hasFacts(s.run)),
    noModeRecord: legacy,
  };
}

// ───────────── 测试 ─────────────

describe("参数键对比尺：模块与枚举先硬拦（不让空矩阵混成绿）", () => {
  it("目录加载、档案可解析、样本数大于 0", () => {
    expect(seeded.vendors.length).toBeGreaterThan(0);
    expect(seeded.models.length).toBeGreaterThan(0);
    const plans = enumeratePlans();
    expect(plans.length).toBeGreaterThan(0);
    expect(new Set(plans.map((p) => p.archetype.id)).size).toBeGreaterThan(0);
    expect(new Set(plans.map((p) => p.id)).size).toBe(plans.length);
  });
});

describe("参数键对比尺：节点留着别的方式的参数，发出去的请求带哪些键", () => {
  it("今天算出来的结果 = 快照", async () => {
    const plans = enumeratePlans();
    expect(plans.length, "样本数为 0：枚举被改空了").toBeGreaterThan(0);
    const samples: Sample[] = [];
    for (const plan of plans) samples.push(await measureSample(plan));
    const legacy = await measureLegacy();
    expect(legacy.length, "没有方式记录的样本为 0").toBeGreaterThan(0);
    const actual = summarize(samples, legacy);
    expect(actual.summary.samples).toBe(plans.length);
    // JSON 往返：和读回来的快照用同一种形状比（去掉 undefined）。
    const normalized = JSON.parse(JSON.stringify(actual)) as Snapshot;
    if (updateSnapshot) {
      writeFileSync(SNAPSHOT_PATH, `${JSON.stringify(normalized, null, 1)}\n`);
      return;
    }
    const pinned = JSON.parse(readFileSync(SNAPSHOT_PATH, "utf8")) as Snapshot;
    expect(normalized.summary, "汇总变了：更新快照请用 NOMI_UPDATE_PARAMS_KEYS_SNAPSHOT=1，并在 PR 里说明哪一处变了").toEqual(pinned.summary);
    expect(normalized.sampleIds).toEqual(pinned.sampleIds);
    expect(normalized.pathDifferences).toEqual(pinned.pathDifferences);
    expect(normalized.noModeRecord).toEqual(pinned.noModeRecord);
    expect(normalized.samples).toEqual(pinned.samples);
  }, 600_000);
});
