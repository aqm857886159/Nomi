/**
 * 方式参数 owner（概念 generation.mode-params，设计卡 docs/plan/2026-11-12-mode-params-owner.md）的两个发送口对账。
 *
 * - 第 5 条：同一节点，渲染层 buildCatalogTaskRequest 冻结的请求里，档案管辖的键 ⊆ 这次实际发出的方式声明的键；
 *   主进程 applyHeadlessParamDefaults 对同一份请求再过一遍，管辖键逐值不变（幂等，所以批的 = 发的）。
 * - 尺子 paramsKeysByMode 里画布路剩下的 6 个 happyhorse「X → 编辑」样本是量具假象：画布按输入现算方式，
 *   没有源视频时发出去的是文生，不是编辑。这里正面证明它们真正发出去的请求只含文生声明的键。
 * - 第 9 条：带变体的节点，渲染层和主进程按同一个变体特化（主进程以前漏了变体特化）。
 */
import { afterAll, describe, expect, it, vi } from "vitest";
import { writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

vi.mock("electron", async () => {
  const nodeFs = await import("node:fs");
  const os = await import("node:os");
  const nodePath = await import("node:path");
  const { electronStub } = await import("./parityElectronMock");
  return electronStub(nodeFs.mkdtempSync(nodePath.join(os.tmpdir(), "nomi-mode-params-ports-")));
});
vi.mock("../capabilityCore/rendererBridge", () => ({
  requestRendererDecision: async () => ({ confirmed: true }),
  requestRenderer: async (operation: string) => {
    throw new Error(`no renderer bridge in mode-params ports: ${operation}`);
  },
}));

import { resolveArchetypeForModel } from "../shared/modelArchetypes";
import { declaredModeParams, effectiveModeParams } from "../shared/modelArchetypes/modeParams";
import variantsSnapshot from "./modeParamsVariants.snapshot.json";
import { modeTransportFor } from "../shared/videoCapabilities/modeTransport";
import { applyHeadlessParamDefaults } from "../catalog/taskParams";
import { createGenerationNode } from "../../src/workbench/generationCanvas/model/graphOps";
import { buildCatalogTaskRequest } from "../../src/workbench/generationCanvas/runner/catalogTaskActions";
import { resolveGenerationReferences } from "../../src/workbench/generationCanvas/runner/generationReferenceResolver";
import { driveEngineA, installFetchCapture, seedParityCatalog } from "./generationParityTestUtils";
import { recordFields, type OutboundRecord } from "./outboundRecord";

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

const IMAGE_SLOT_KINDS = ["first_frame", "last_frame", "image_ref"];
const refUrl = (i: number) => `https://assets.example.com/ref/img-${i}.png`;

/** 节点上存的值：下拉取第一个非默认档、数值取上限、布尔取反（与参数键对比尺同一取法），图片地址类不放。 */
function storedValueOf(control: Control): string | number | boolean | undefined {
  if (control.type === "image-url") return undefined;
  const fallback = control.defaultValue ?? control.options[0]?.value ?? (typeof control.min === "number" ? control.min : control.type === "boolean" ? false : "stored");
  if (control.options.length) return control.options.find((option) => option.value !== fallback)?.value ?? fallback;
  if (control.type === "boolean") return !fallback;
  if (typeof control.max === "number" && control.max !== fallback) return control.max;
  return fallback;
}

function storedOf(modes: readonly Mode[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const mode of modes) for (const control of mode.params) {
    const value = storedValueOf(control);
    if (value !== undefined && !(control.key in out)) out[control.key] = value;
  }
  return out;
}

const governedKeysOf = (archetype: Archetype) => new Set(archetype.modes.flatMap((mode) => [...mode.params.map((c) => c.key), ...Object.keys(mode.fixedParams ?? {})]));

function imageRefCountFor(mode: Mode, archetype: Archetype, vendorKey: string): number {
  const slots = mode.slots.filter((slot: { kind: string }) => IMAGE_SLOT_KINDS.includes(slot.kind));
  const floor = slots.reduce((sum: number, slot: { min: number }) => sum + slot.min, 0);
  const needsImage = ["image_to_video", "image_edit", "image_to_3d"].includes(modeTransportFor(mode, archetype, vendorKey) ?? "");
  return slots.length === 0 ? 0 : needsImage ? Math.max(1, floor) : floor;
}

function canvasRequest(row: Row, archetype: Archetype, modeId: string, params: Record<string, unknown>, refCount = 0, variantId?: string) {
  const node = {
    ...createGenerationNode({ id: "n", kind: archetype.kind, prompt: "一个镜头" }),
    meta: {
      modelKey: row.modelKey, modelVendor: row.vendorKey, vendor: row.vendorKey,
      archetype: { id: archetype.id, modeId, ...(variantId ? { variantId } : {}) },
      ...params,
      ...(refCount ? { referenceImageUrls: Array.from({ length: refCount }, (_, i) => refUrl(i + 1)) } : {}),
    },
  } as never;
  return buildCatalogTaskRequest(node, { references: resolveGenerationReferences(node, { nodes: [node], edges: [] }) }).request;
}

const sentModeIdOf = (extras: Record<string, unknown>): string => String((extras.archetype as { modeId?: unknown } | undefined)?.modeId ?? "");

/** 冻结请求里档案管辖、但这次发出的方式没声明的键（非空 = 漏键）。 */
function undeclaredGovernedKeys(extras: Record<string, unknown>, archetype: Archetype, variantId?: string): string[] {
  const declared = declaredModeParams({ archetype, variantId, modeId: sentModeIdOf(extras) });
  if (!declared) return [`<方式认不出:${sentModeIdOf(extras)}>`];
  const own = new Set([...declared.controls.map((c) => c.key), ...Object.keys(declared.fixedParams)]);
  const governed = governedKeysOf(archetype);
  return Object.keys(extras).filter((key) => governed.has(key) && !own.has(key)).sort();
}

const governedProjection = (extras: Record<string, unknown> | undefined, governed: Set<string>) =>
  JSON.stringify(Object.entries(extras ?? {}).filter(([key]) => governed.has(key)).sort(([a], [b]) => (a < b ? -1 : 1)));

function multiModeRows(): Array<{ row: Row; archetype: Archetype }> {
  return seeded.models
    .map((row) => ({ row, archetype: resolveArchetypeForModel({ modelKey: row.modelKey, modelAlias: row.modelAlias, vendorKey: row.vendorKey, meta: row.meta }) }))
    .filter((entry): entry is { row: Row; archetype: Archetype } => Boolean(entry.archetype && entry.archetype.modes.length > 1));
}

describe("方式参数 owner：渲染层与主进程是同一份答案", () => {
  it("每个多方式档案 × 目录行 × 方式：冻结请求只含这次发出方式声明的键；主进程再过一遍管辖键逐值不变", () => {
    const leaks: string[] = [];
    const diffs: string[] = [];
    const archetypes = new Set<string>();
    let checked = 0;
    for (const { row, archetype } of multiModeRows()) {
      const governed = governedKeysOf(archetype);
      const stored = storedOf(archetype.modes);
      for (const mode of archetype.modes) {
        const request = canvasRequest(row, archetype, mode.id, stored, imageRefCountFor(mode, archetype, row.vendorKey));
        const extras = request.extras as Record<string, unknown>;
        const where = `${archetype.id}@${row.vendorKey}/${row.modelKey} 存 ${mode.id} → 发 ${sentModeIdOf(extras)}`;
        const leaked = undeclaredGovernedKeys(extras, archetype);
        if (leaked.length) leaks.push(`${where}: ${leaked.join(",")}`);
        let main: Record<string, unknown> | undefined;
        try {
          main = applyHeadlessParamDefaults(extras, { modelKey: row.modelKey, modelAlias: row.modelAlias, vendorKey: row.vendorKey, modelMeta: row.meta, taskKind: request.kind, modeId: sentModeIdOf(extras) }, undefined);
        } catch (error) {
          // 能力声明闸拒发的组合与本卡无关（两边都不发），只记不比。
          if (/capabilit|声明/i.test((error as Error).message)) continue;
          throw error;
        }
        if (governedProjection(extras, governed) !== governedProjection(main, governed)) {
          diffs.push(`${where}: 渲染层 ${governedProjection(extras, governed)} ≠ 主进程 ${governedProjection(main, governed)}`);
        }
        archetypes.add(archetype.id);
        checked++;
      }
    }
    expect(leaks).toEqual([]);
    expect(diffs).toEqual([]);
    expect(archetypes.size).toBeGreaterThan(20);
    expect(checked).toBeGreaterThan(100);
  });

  it("反例自检：冻结请求里塞一个编辑方式才有的键 → 判漏键", () => {
    const row = seeded.models.find((candidate) => candidate.vendorKey === "kie" && candidate.modelKey === "happyhorse")!;
    const archetype = resolveArchetypeForModel({ modelKey: row.modelKey, vendorKey: row.vendorKey, meta: row.meta })!;
    const extras = canvasRequest(row, archetype, "t2v", {}).extras;
    expect(undeclaredGovernedKeys(extras as Record<string, unknown>, archetype)).toEqual([]);
    expect(undeclaredGovernedKeys({ ...(extras as Record<string, unknown>), audio_setting: "auto" }, archetype)).toEqual(["audio_setting"]);
  });
});

/** 请求体字段（去掉 body. 前缀）。 */
function bodyOf(record: OutboundRecord): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [path, value] of recordFields(record)) if (path.startsWith("body.")) out[path.slice(5)] = value;
  return out;
}

describe("参数键对比尺画布路剩下的 6 个 happyhorse「X → 编辑」样本：真正发出去的是文生，只含文生声明的键", () => {
  const SAMPLES = [
    ["kie", "happyhorse", "i2v"], ["kie", "happyhorse", "ref"], ["kie", "happyhorse", "t2v"],
    ["runway", "happyhorse_1_0", "i2v"], ["runway", "happyhorse_1_0", "ref"], ["runway", "happyhorse_1_0", "t2v"],
  ] as const;
  for (const [vendorKey, modelKey, fromModeId] of SAMPLES) {
    it(`happyhorse|${vendorKey}|${modelKey}|${fromModeId}->edit`, async () => {
      const row = seeded.models.find((candidate) => candidate.vendorKey === vendorKey && candidate.modelKey === modelKey)!;
      const archetype = resolveArchetypeForModel({ modelKey, modelAlias: row.modelAlias, vendorKey, meta: row.meta })!;
      const from = archetype.modes.find((mode) => mode.id === fromModeId)!;
      const edit = archetype.modes.find((mode) => mode.id === "edit")!;
      const refCount = imageRefCountFor(edit, archetype, vendorKey);
      const request = canvasRequest(row, archetype, "edit", storedOf([from]), refCount);
      const extras = request.extras as Record<string, unknown>;
      // 没有源视频，画布现算出的方式不是编辑。
      expect(sentModeIdOf(extras)).toBe("t2v");
      expect(undeclaredGovernedKeys(extras, archetype)).toEqual([]);
      // 真正发出去的请求体 = 只存文生声明的键时发出去的请求体（漏键会让两份不同）。
      const t2v = archetype.modes.find((mode) => mode.id === "t2v")!;
      const t2vKeys = new Set(t2v.params.map((c) => c.key));
      const onlyT2v = Object.fromEntries(Object.entries(storedOf([from])).filter(([key]) => t2vKeys.has(key)));
      const sent = await driveEngineA(capture, { vendorKey, kind: request.kind, prompt: request.prompt, extras: { ...extras, projectId: "parity-project" } });
      const clean = canvasRequest(row, archetype, "edit", onlyT2v, refCount);
      const expected = await driveEngineA(capture, { vendorKey, kind: clean.kind, prompt: clean.prompt, extras: { ...(clean.extras as Record<string, unknown>), projectId: "parity-project" } });
      expect(sent.request, JSON.stringify(sent.failure)).toBeTruthy();
      expect(bodyOf(sent)).toEqual(bodyOf(expected));
      expect(Object.keys(bodyOf(sent)).some((field) => /audio_setting/.test(field))).toBe(false);
    });
  }
});

describe("变体：渲染层和主进程按同一个变体特化", () => {
  it("带收窄变体的目录行 × 变体 × 方式：冻结请求只含按变体特化后的声明键，主进程管辖键逐值不变", () => {
    const leaks: string[] = [];
    const diffs: string[] = [];
    let checked = 0;
    for (const row of seeded.models) {
      const archetype = resolveArchetypeForModel({ modelKey: row.modelKey, modelAlias: row.modelAlias, vendorKey: row.vendorKey, meta: row.meta });
      if (!archetype?.variants?.some((variant) => variant.paramOverrides)) continue;
      const governed = governedKeysOf(archetype);
      const stored = storedOf(archetype.modes);
      for (const variant of archetype.variants) {
        for (const mode of archetype.modes) {
          const request = canvasRequest(row, archetype, mode.id, stored, imageRefCountFor(mode, archetype, row.vendorKey), variant.id);
          const extras = request.extras as Record<string, unknown>;
          const where = `${archetype.id}@${row.vendorKey}/${row.modelKey} 变体 ${variant.id} 发 ${sentModeIdOf(extras)}`;
          const leaked = undeclaredGovernedKeys(extras, archetype, variant.id);
          if (leaked.length) leaks.push(`${where}: ${leaked.join(",")}`);
          let main: Record<string, unknown> | undefined;
          try {
            main = applyHeadlessParamDefaults(extras, { modelKey: row.modelKey, modelAlias: row.modelAlias, vendorKey: row.vendorKey, modelMeta: row.meta, taskKind: request.kind, modeId: sentModeIdOf(extras) }, undefined);
          } catch (error) {
            if (/capabilit|声明/i.test((error as Error).message)) continue;
            throw error;
          }
          if (governedProjection(extras, governed) !== governedProjection(main, governed)) {
            diffs.push(`${where}: 渲染层 ${governedProjection(extras, governed)} ≠ 主进程 ${governedProjection(main, governed)}`);
          }
          checked++;
        }
      }
    }
    expect(leaks).toEqual([]);
    expect(diffs).toEqual([]);
    expect(checked).toBeGreaterThan(0);
  });
});

// 带变体目录行的主进程默认值护栏：修前指纹 + 这次允许新增的键（和官方请求体矩阵同口径：ref / 多模态方式自己控件上的比例默认值以前没发、现在发）。
type VariantsSnapshot = { note: string; added: Array<{ cell: string; key: string; value: unknown }>; defaults: Record<string, string> };
const VARIANTS_PATH = fileURLToPath(new URL("./modeParamsVariants.snapshot.json", import.meta.url));
const canonical = (value: unknown): string => value && typeof value === "object"
  ? (Array.isArray(value) ? `[${value.map(canonical).join(",")}]` : `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonical((value as Record<string, unknown>)[k])}`).join(",")}}`)
  : JSON.stringify(value ?? null);
const fingerprint = (value: unknown) => createHash("sha256").update(canonical(JSON.parse(JSON.stringify(value ?? null)))).digest("hex").slice(0, 16);

function variantDefaults(): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const row of seeded.models) {
    const archetype = resolveArchetypeForModel({ modelKey: row.modelKey, modelAlias: row.modelAlias, vendorKey: row.vendorKey, meta: row.meta });
    if (!archetype?.variants?.length) continue;
    const call = (extras: Record<string, unknown>, taskKind: string, modeId?: string) => {
      try {
        return applyHeadlessParamDefaults(extras, { modelKey: row.modelKey, modelAlias: row.modelAlias, vendorKey: row.vendorKey, modelMeta: row.meta, taskKind, ...(modeId ? { modeId } : {}) }, undefined);
      } catch (error) {
        return `throw:${(error as Error).message.slice(0, 60)}`;
      }
    };
    for (const variant of archetype.variants) for (const mode of archetype.modes) {
      out[`canvas:${archetype.id}|${row.vendorKey}|${row.modelKey}|${variant.id}|${mode.id}`] = call({ modelKey: row.modelKey, archetype: { id: archetype.id, modeId: mode.id, variantId: variant.id } }, modeTransportFor(mode, archetype, row.vendorKey) ?? "", mode.id);
    }
    for (const kind of new Set(archetype.modes.map((mode) => modeTransportFor(mode, archetype, row.vendorKey) ?? ""))) {
      out[`run:${archetype.id}|${row.vendorKey}|${row.modelKey}|${kind}`] = call({}, kind);
    }
  }
  return out;
}

describe("变体：主进程默认值只许多登记的那几个键", () => {
  it("带变体目录行 × 变体 × 方式 / 任务类型：去掉登记的新增键后与修前指纹相同", () => {
    const snapshot = variantsSnapshot as VariantsSnapshot;
    const current = variantDefaults();
    if (process.env.NOMI_UPDATE_MODE_PARAMS_VARIANTS === "1") {
      writeFileSync(VARIANTS_PATH, `${JSON.stringify({ note: snapshot.note, added: [], defaults: Object.fromEntries(Object.keys(current).sort().map((k) => [k, fingerprint(current[k])])) }, null, 1)}\n`);
      return;
    }
    const drift: string[] = [];
    expect(Object.keys(current).sort()).toEqual(Object.keys(snapshot.defaults).sort());
    for (const [cell, value] of Object.entries(current)) {
      const rest = value && typeof value === "object" ? { ...(value as Record<string, unknown>) } : value;
      for (const a of snapshot.added.filter((entry) => entry.cell === cell)) {
        const got = rest && typeof rest === "object" ? (rest as Record<string, unknown>)[a.key] : undefined;
        if (canonical(got) !== canonical(a.value)) drift.push(`${cell}: 登记新增 ${a.key}=${JSON.stringify(a.value)}，实际 ${JSON.stringify(got)}`);
        if (rest && typeof rest === "object") delete (rest as Record<string, unknown>)[a.key];
      }
      if (fingerprint(rest) !== snapshot.defaults[cell]) drift.push(`${cell}: 与修前指纹不同（多键 / 少键 / 改值）`);
    }
    expect(drift).toEqual([]);
    expect(snapshot.added).toHaveLength(8);
  });

  it("变体收窄引起的默认值差异 = 0：按变体特化与不按变体特化，本方式填出的默认值逐键相同", () => {
    const diffs: string[] = [];
    let checked = 0;
    for (const row of seeded.models) {
      const archetype = resolveArchetypeForModel({ modelKey: row.modelKey, modelAlias: row.modelAlias, vendorKey: row.vendorKey, meta: row.meta });
      if (!archetype?.variants?.length) continue;
      const unspecialized = { ...archetype, variants: undefined };
      for (const variant of archetype.variants) for (const mode of archetype.modes) {
        const withVariant = effectiveModeParams({ archetype, variantId: variant.id, modeId: mode.id, stored: {} }).params;
        const without = effectiveModeParams({ archetype: unspecialized, modeId: mode.id, stored: {} }).params;
        if (canonical(withVariant) !== canonical(without)) diffs.push(`${archetype.id}@${row.vendorKey} ${variant.id}/${mode.id}: ${canonical(without)} → ${canonical(withVariant)}`);
        checked++;
      }
    }
    expect(diffs).toEqual([]);
    expect(checked).toBeGreaterThan(50);
  });
});

describe("无界面路：键按方式收、缺的补默认；已给的值一个字节不动（不在选项里的也不换成默认、不升档）", () => {
  // 2026-11-12：下拉修正（fixDropdownsBeforeSend）只在渲染层发送前调。主进程若也调它，Agent / MCP 直调传来的
  // "768p"（选项是 "768P"）会被悄悄换成默认 "2K"（升档多花钱），这条就红。
  it.each([
    { label: "MiniMax-H3 图生 resolution 768p（选项 2K / 768P）", archetypeId: "minimax-h3-apimart", vendorKey: "apimart", taskKind: "image_to_video", modeId: "first", key: "resolution", value: "768p" },
    { label: "火山 Seedream 文生图 size 1024x1024（不在选项里）", archetypeId: "volcengine-seedream", vendorKey: "volcengine", taskKind: "text_to_image", modeId: undefined, key: "size", value: "1024x1024" },
  ])("$label", ({ archetypeId, vendorKey, taskKind, modeId, key, value }) => {
    const selected = { modelKey: archetypeId, vendorKey, modelMeta: { archetypeId }, taskKind, ...(modeId ? { modeId } : {}) };
    const archetype = resolveArchetypeForModel({ modelKey: archetypeId, vendorKey, meta: { archetypeId } });
    expect(archetype, "前提：认得出档案").toBeTruthy();
    const options = archetype!.modes.flatMap((mode) => mode.params).filter((control) => control.key === key).flatMap((control) => control.options.map((option) => option.value));
    expect(options.length, "前提：这个键是下拉").toBeGreaterThan(0);
    expect(options, "前提：传入值不在选项里").not.toContain(value);
    const extras = { [key]: value, ...(modeId ? { archetype: { id: archetypeId, modeId } } : {}) };
    expect(applyHeadlessParamDefaults(extras, selected, undefined)?.[key]).toBe(value);
  });
});
