/**
 * 发送前核输入的计数口径：看得清才判，看不清不拒（设计卡 docs/plan/2026-11-14-mode-input-check.md「计数口径」）。
 *
 * 性质测试（全目录扫，不抽样）：内置目录每一行 × 档案每个方式，按方式自己声明的槽给足下限的素材（调用方的标准输入键，
 * 在被各家键名改写之前），判定不许说「缺输入」；「这家没有这个方式」只准出现在下面点名的格子里（请求体真没有那一族素材的位置）。
 * 同一批格子换成「自定义脚本接管」（判定手里的 body 不是派发那份），一格都不许拒。
 */
import { afterAll, describe, expect, it, vi } from "vitest";

vi.mock("electron", async () => {
  const nodeFs = await import("node:fs");
  const os = await import("node:os");
  const nodePath = await import("node:path");
  const { electronStub } = await import("../parity/parityElectronMock");
  return electronStub(nodeFs.mkdtempSync(nodePath.join(os.tmpdir(), "nomi-mode-input-routes-")));
});
/** 最近一次发送前拒收的错误对象本身（原话后半句点名的方式号从这里按号取，不从句子里抠字）。 */
const lastRefusal = vi.hoisted(() => ({ error: undefined as undefined | { fitsModeId?: string } }));
vi.mock("./modeInputRefusal", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./modeInputRefusal")>();
  return { ...actual, modeInputRefusal: (...args: Parameters<typeof actual.modeInputRefusal>) => {
    const error = actual.modeInputRefusal(...args);
    lastRefusal.error = error as { fitsModeId?: string };
    return error;
  } };
});
/**
 * 全目录 Run 路扫描时目录不变：Run 路夹具每发一次都重装 provider 和模块表（约占每次 2/3 的时间），扫描期间各装一次复用。
 * 只在 `frozen` 打开时复用（扫描那一条用例里），其余用例照旧每次现装（它们会往目录里加中转）。
 */
const runHost = vi.hoisted(() => ({ frozen: false, bootstrap: undefined as unknown, registry: undefined as unknown }));
vi.mock("../capabilityCore/generationProviderBootstrap", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../capabilityCore/generationProviderBootstrap")>();
  return { ...actual, createGenerationProviderBootstrap: (...args: Parameters<typeof actual.createGenerationProviderBootstrap>) => {
    if (!runHost.frozen) return actual.createGenerationProviderBootstrap(...args);
    runHost.bootstrap ??= actual.createGenerationProviderBootstrap(...args);
    return runHost.bootstrap as ReturnType<typeof actual.createGenerationProviderBootstrap>;
  } };
});
vi.mock("../capabilityCore/moduleCatalogBootstrap", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../capabilityCore/moduleCatalogBootstrap")>();
  return { ...actual, createCatalogModuleRegistry: (...args: Parameters<typeof actual.createCatalogModuleRegistry>) => {
    if (!runHost.frozen) return actual.createCatalogModuleRegistry(...args);
    runHost.registry ??= actual.createCatalogModuleRegistry(...args);
    return runHost.registry as ReturnType<typeof actual.createCatalogModuleRegistry>;
  } };
});
vi.mock("../capabilityCore/rendererBridge", () => ({
  requestRendererDecision: async () => ({ confirmed: true }),
  requestRenderer: async (operation: string) => { throw new Error(`付费路径不该走带超时的桥: ${operation}`); },
}));

import { resolveArchetypeForModel } from "../shared/modelArchetypes";
import { modeTransportFor } from "../shared/videoCapabilities/modeTransport";
import { applyHeadlessParamDefaults, sendRouteFor, type SendRoute } from "./taskParams";
import { selectTaskMapping, type ProfileKind } from "./types";
import { definiteSendRefusalOf } from "../shared/generationDefiniteSendRefusal";
import { driveEngineA, driveEngineB, installFetchCapture, seedParityCatalog } from "../parity/generationParityTestUtils";
import { spendReferenceKey } from "../shared/contracts/pendingSpendConfirm";
import { upsertModelCatalogMapping, upsertModelCatalogModel, upsertModelCatalogVendor, upsertModelCatalogVendorApiKey } from "./catalogStore";
import type { ArchetypeMode, ArchetypeReferenceSlotKind, ModelArchetype } from "../shared/modelArchetypes/types";
import { setDesktopLocale } from "../desktopLocale";
import { SLOT_ACCEPTS } from "../shared/modelArchetypes/anchorPolicy";

const capture = installFetchCapture();
const seeded = await seedParityCatalog([]);
for (const vendor of seeded.vendors) upsertModelCatalogVendorApiKey(vendor.key, { apiKey: `sk-routes-${vendor.key}` });
afterAll(() => capture.restore());

const url = (kind: string, i: number) => `https://assets.example.com/routes/${kind}-${i}.${kind === "video" ? "mp4" : kind === "audio" ? "mp3" : "png"}`;

/** 调用方交进来的素材（标准输入键），每个槽给它声明的下限件数。 */
function inputsAtFloor(mode: ArchetypeMode): Record<string, unknown> {
  const need = (kind: ArchetypeReferenceSlotKind) => mode.slots.filter((slot) => slot.kind === kind).reduce((sum, slot) => sum + slot.min, 0);
  const list = (kind: string, n: number) => Array.from({ length: n }, (_, i) => url(kind, i + 1));
  const images = need("image_ref");
  const videos = need("video_ref") + need("source_video");
  const audios = need("audio_ref");
  return {
    ...(need("first_frame") ? { firstFrameUrl: url("first", 1) } : {}),
    ...(need("last_frame") ? { lastFrameUrl: url("last", 1) } : {}),
    ...(images ? { referenceImages: list("image", images) } : {}),
    ...(videos ? { referenceVideoUrls: list("video", videos) } : {}),
    ...(audios ? { referenceAudioUrls: list("audio", audios) } : {}),
  };
}

type Cell = { where: string; outcome: string };

function scan(route: SendRoute): { cells: Cell[]; noMapping: number } {
  const cells: Cell[] = [];
  let noMapping = 0;
  for (const row of seeded.models) {
    const archetype = resolveArchetypeForModel({ modelKey: row.modelKey, modelAlias: row.modelAlias, vendorKey: row.vendorKey, meta: row.meta });
    if (!archetype) continue;
    for (const mode of archetype.modes) {
      const taskKind = modeTransportFor(mode, archetype, row.vendorKey) as ProfileKind | undefined;
      if (!taskKind) continue;
      const mapping = selectTaskMapping(seeded.mappings, row.vendorKey, taskKind, row.modelKey, mode.id);
      if (!mapping) noMapping++;
      const where = `${row.vendorKey}/${row.modelKey}/${mode.id}`;
      const extras = { modelKey: row.modelKey, archetype: { id: archetype.id, modeId: mode.id }, ...inputsAtFloor(mode) };
      let outcome = "sent";
      try {
        applyHeadlessParamDefaults(extras, { modelKey: row.modelKey, modelAlias: row.modelAlias, vendorKey: row.vendorKey, modelMeta: row.meta, taskKind, modeId: mode.id }, mapping?.create?.defaultParams, mapping?.create?.body, route);
      } catch (error) {
        outcome = definiteSendRefusalOf(error)?.code ?? `other:${(error as Error).message.slice(0, 60)}`;
      }
      cells.push({ where, outcome });
    }
  }
  return { cells, noMapping };
}

/** 请求体真没有这个方式要的那一族素材的位置：APIMart 上 Suno V5.5 只有文生音乐那条路（续写 / 翻唱的原曲放不进去）。 */
const ROUTE_MISSING = ["apimart/suno-v5.5/cover", "apimart/suno-v5.5/extend"];

describe("性质：每个模型 × 每个方式，给足下限的素材，判定不许说「缺输入」", () => {
  it("按 mapping body 发（看得清）：缺输入 0 格；「这家没有这个方式」只在点名的格子", () => {
    const { cells } = scan(sendRouteFor(""));
    const missing =cells.filter((cell) => cell.outcome === "mode_input_missing").map((cell) => cell.where);
    const routeMissing = cells.filter((cell) => cell.outcome === "mode_route_missing").map((cell) => cell.where).sort();
    expect(missing).toEqual([]);
    expect(routeMissing).toEqual(ROUTE_MISSING);
    // 不是这处判定拒的：参考件数上限（assertReferenceCapacity）。Higgsfield DoP 首尾帧从标准键给首帧 + 尾帧，
    // 被说成「最多收 1 张」——旧有问题，已另报，不在这一刀；名单钉住，变了要看。
    const others = cells.filter((cell) => cell.outcome.startsWith("other:")).map((cell) => cell.where).sort();
    expect(others).toEqual(["higgsfield/higgsfield-ai/dop/standard/firstlast", "higgsfield/higgsfield-ai/dop/turbo/firstlast"]);
    // 全目录：格子数随目录长，不抽样（下限防「扫了个空」）。
    expect(cells.length).toBeGreaterThan(300);
  });

  it("自定义脚本接管（看不清）：同一批格子，确定拒收 0 格", () => {
    const { cells } = scan(sendRouteFor("return 'x'"));
    const refused = cells.filter((cell) => cell.outcome === "mode_input_missing" || cell.outcome === "mode_route_missing").map((cell) => `${cell.where}:${cell.outcome}`);
    expect(refused).toEqual([]);
    expect(cells.length).toBeGreaterThan(300);
  });

  it("反例自检：同一批格子一件素材都不给，看得清时缺输入的格子不为 0（量具不是摆设）", () => {
    let refused = 0;
    for (const row of seeded.models) {
      const archetype = resolveArchetypeForModel({ modelKey: row.modelKey, modelAlias: row.modelAlias, vendorKey: row.vendorKey, meta: row.meta });
      for (const mode of archetype?.modes ?? []) {
        if (!mode.slots.some((slot) => slot.min >= 1)) continue;
        const taskKind = modeTransportFor(mode, archetype!, row.vendorKey) as ProfileKind;
        const mapping = selectTaskMapping(seeded.mappings, row.vendorKey, taskKind, row.modelKey, mode.id);
        if (!mapping?.create?.body) continue;
        try {
          applyHeadlessParamDefaults({ modelKey: row.modelKey, archetype: { id: archetype!.id, modeId: mode.id } }, { modelKey: row.modelKey, modelAlias: row.modelAlias, vendorKey: row.vendorKey, modelMeta: row.meta, taskKind, modeId: mode.id }, mapping.create.defaultParams, mapping.create.body);
        } catch (error) {
          if (definiteSendRefusalOf(error)?.code === "mode_input_missing") refused++;
        }
      }
    }
    expect(refused).toBeGreaterThan(20);
  });
});

// ─────────── 每一类「输入不走标准键」的派发路径：给全 → 发得出去、素材在请求体里；没给 → 写明拒还是放行 ───────────

const IMG = "https://assets.example.com/routes/class-image.png";
const DEFINITE = ["mode_input_missing", "mode_route_missing"];
const bodyText = (record: { request?: { body?: unknown } }) => JSON.stringify(record.request?.body ?? null);

function seedCustomVendor(vendorKey: string) {
  upsertModelCatalogVendor({ key: vendorKey, name: vendorKey, baseUrlHint: "https://relay.example/v1", authType: "bearer", enabled: true });
  upsertModelCatalogVendorApiKey(vendorKey, { apiKey: `sk-${vendorKey}`, enabled: true });
}

/** 自己接的中转、声明式 mapping：请求体的字段名是创作者自己写的（不是标准键），模型按名字认出 seedream 档案、选「编辑」方式。 */
function seedRelayEdit(vendorKey: string, body: Record<string, unknown>) {
  seedCustomVendor(vendorKey);
  upsertModelCatalogModel({ vendorKey, modelKey: "seedream", kind: "image", enabled: true });
  upsertModelCatalogMapping({ vendorKey, modelKey: "seedream", taskKind: "image_edit", name: "relay edit", create: { method: "POST", path: "/images/edit", body } });
}
const relayEdit = (vendorKey: string, withImage: boolean) => driveEngineA(capture, {
  vendorKey, kind: "image_edit", prompt: "保留主体",
  extras: { modelKey: "seedream", nodeId: "parity-node", archetype: { id: "seedream", modeId: "edit" }, ...(withImage ? { referenceImages: [IMG] } : {}) },
});

describe("声明式 mapping（自己接的中转），请求体用非标准字段名", () => {
  it("字段名自定义、模板读标准参数（pics ← reference_images）：给了图 → 照发，图在请求体里", async () => {
    seedRelayEdit("relay-pics", { model: "seedream", prompt: "{{request.prompt}}", pics: "{{request.params.reference_images}}" });
    const record = await relayEdit("relay-pics", true);
    expect(record.failure, JSON.stringify(record.failure)).toBeUndefined();
    expect(bodyText(record)).toContain(IMG);
  });

  it("字段名自定义、模板读单图派生键（source ← image_url）：给了图 → 照发", async () => {
    seedRelayEdit("relay-source", { model: "seedream", prompt: "{{request.prompt}}", source: "{{request.params.image_url}}" });
    const record = await relayEdit("relay-source", true);
    expect(record.failure, JSON.stringify(record.failure)).toBeUndefined();
    expect(bodyText(record)).toContain(IMG);
  });

  it("真的没给图 → 拒（看得清：这份 body 就是要发的，编辑方式缺输入图），零请求", async () => {
    const record = await relayEdit("relay-pics", false);
    expect(capture.calls).toHaveLength(0);
    expect(record.failure?.code).toBe("mode_input_missing");
  });

  it("请求体压根没有放图的位置、图给了 → 拒成「这家没有这个方式」（发出去一定丢图），不说「没给」", async () => {
    seedRelayEdit("relay-noimage", { model: "seedream", prompt: "{{request.prompt}}" });
    const record = await relayEdit("relay-noimage", true);
    expect(capture.calls).toHaveLength(0);
    expect(record.failure?.code).toBe("mode_route_missing");
  });
});

describe("自定义脚本接管（目录里留着不带图的旧 mapping）", () => {
  it("给了图 → 不被发送前核输入拒（判定看不清：旧 body 不是派发那份）", async () => {
    seedCustomVendor("script-cc");
    upsertModelCatalogModel({ vendorKey: "script-cc", modelKey: "seedream", kind: "image", enabled: true, customCall: { modes: { edit: { script: "return 'data:image/png;base64,eA=='" } } } });
    upsertModelCatalogMapping({ vendorKey: "script-cc", modelKey: "seedream", taskKind: "image_edit", name: "legacy", create: { method: "POST", path: "/legacy", body: { prompt: "{{request.prompt}}" } } });
    const record = await relayEdit("script-cc", true);
    expect(DEFINITE, JSON.stringify(record.failure)).not.toContain(record.failure?.code);
  });

  it("真的没给图 → 由老护栏拒（改图没有参考），不是发送前核输入拒：看不清时这处判定不出声", async () => {
    const record = await relayEdit("script-cc", false);
    expect(DEFINITE).not.toContain(record.failure?.code);
    expect(record.failure?.message).toMatch(/参考/);
  });
});

describe("ComfyUI / 自定义工作流（没有档案、没有方式记录）", () => {
  it("给了图 / 没给图 → 判定都不跑（没有方式可判），不出确定拒收", async () => {
    seedCustomVendor("workflow-local");
    upsertModelCatalogModel({ vendorKey: "workflow-local", modelKey: "my-workflow", kind: "image", enabled: true });
    upsertModelCatalogMapping({ vendorKey: "workflow-local", modelKey: "my-workflow", taskKind: "text_to_image", name: "workflow", create: { method: "POST", path: "/prompt", body: { prompt: { "1": { inputs: { text: "{{request.prompt}}", image: "{{request.params.comfy_image_1}}" } } } } } });
    for (const extras of [{ comfy_image_1: IMG }, {}]) {
      const record = await driveEngineA(capture, { vendorKey: "workflow-local", kind: "text_to_image", prompt: "一张图", extras: { modelKey: "my-workflow", nodeId: "parity-node", ...extras } });
      expect(DEFINITE, JSON.stringify(record.failure)).not.toContain(record.failure?.code);
    }
  });
});

/** 内置渠道各取一个「方式有必需输入、输入只是图 / 视频」的模型。 */
function firstRequiredModeOn(vendorKey: string) {
  for (const row of seeded.models.filter((candidate) => candidate.vendorKey === vendorKey)) {
    const archetype = resolveArchetypeForModel({ modelKey: row.modelKey, modelAlias: row.modelAlias, vendorKey, meta: row.meta });
    for (const mode of archetype?.modes ?? []) {
      if (!mode.slots.some((slot) => slot.min >= 1)) continue;
      if (!mode.slots.every((slot) => slot.min === 0 || ["first_frame", "image_ref", "video_ref", "source_video"].includes(slot.kind))) continue;
      const taskKind = modeTransportFor(mode, archetype!, vendorKey) as ProfileKind;
      if (selectTaskMapping(seeded.mappings, vendorKey, taskKind, row.modelKey, mode.id)?.create?.body) return { row, archetype: archetype!, mode, taskKind };
    }
  }
  throw new Error(`${vendorKey}: 没找到有必需输入的方式`);
}

describe("内置渠道 kie / fal / RunningHub / Runway：各一个模型，素材给全", () => {
  it.each(["kie", "fal", "runninghub", "runway"])("%s：画布路照发、素材在请求体里；Run 路（升级前已批的作业派发时也走它）不是确定拒收", async (vendorKey) => {
    const { row, archetype, mode, taskKind } = firstRequiredModeOn(vendorKey);
    const inputs = inputsAtFloor(mode);
    const sentUrl = Object.values(inputs).flat()[0] as string;
    const viaCanvas = await driveEngineA(capture, { vendorKey, kind: taskKind, prompt: "一个镜头", extras: { modelKey: row.modelKey, nodeId: "parity-node", projectId: "parity-project", archetype: { id: archetype.id, modeId: mode.id }, ...inputs } });
    expect(viaCanvas.failure, `${row.modelKey}/${mode.id} ${JSON.stringify(viaCanvas.failure)}`).toBeUndefined();
    expect(bodyText(viaCanvas)).toContain(sentUrl);
    const refs = mode.slots.flatMap((slot) => Array.from({ length: slot.min }, (_, i) => ({
      assetId: url(slot.kind, i + 1), contentHash: `${slot.kind}-${i}`, version: 1,
      kind: (slot.kind === "video_ref" || slot.kind === "source_video" ? "video" : "image") as "image" | "video",
      role: (slot.kind === "first_frame" ? "first_frame" : "reference") as "first_frame" | "reference",
    })));
    const viaRun = await driveEngineB(capture, {
      vendorKey, modelId: row.modelKey, mode: taskKind, modeId: mode.id, prompt: "一个镜头", parameters: {}, references: refs,
      referenceUrls: Object.fromEntries(refs.map((ref) => [spendReferenceKey(ref as never), ref.assetId])),
    });
    expect(DEFINITE, `${row.modelKey}/${mode.id} ${JSON.stringify(viaRun.failure)}`).not.toContain(viaRun.failure?.code);
  });
});

describe("本地文件先上传（nomi-local:// 换成地址之前）", () => {
  it("参考还是本机文件时就判：件数照数，不被说成「没给」（之后读字节 / 上传失败是另一回事）", async () => {
    const { row, archetype, mode, taskKind } = firstRequiredModeOn("kie");
    const local = Object.fromEntries(Object.entries(inputsAtFloor(mode)).map(([key, value]) => [key, Array.isArray(value) ? value.map((_, i) => `nomi-local://project/assets/ref-${i}.png`) : "nomi-local://project/assets/ref-0.png"]));
    const record = await driveEngineA(capture, { vendorKey: "kie", kind: taskKind, prompt: "一个镜头", extras: { modelKey: row.modelKey, nodeId: "parity-node", projectId: "parity-project", archetype: { id: archetype.id, modeId: mode.id }, ...local } });
    expect(DEFINITE, JSON.stringify(record.failure)).not.toContain(record.failure?.code);
  });
});

// ─────────── 性质：拒收原话点了名的方式，照原样只换方式号再发，一定发得出去（点名即可用） ───────────

type RunRef = { assetId: string; contentHash: string; version: number; kind: "image" | "video" | "audio"; role: "first_frame" | "last_frame" | "reference" };
const runRef = (kind: RunRef["kind"], role: RunRef["role"], i: number): RunRef => ({ assetId: url(`${role}-${kind}`, i), contentHash: `fit-${role}-${kind}-${i}`, version: 1, kind, role });
/** 槽 → 调用方交参考的样子（Run 路：素材种类 + 角色；没有角色的参考素材 role=reference）。 */
const refForSlot = (kind: ArchetypeReferenceSlotKind, i: number): RunRef =>
  kind === "first_frame" ? runRef("image", "first_frame", i)
    : kind === "last_frame" ? runRef("image", "last_frame", i)
      : kind === "video_ref" || kind === "source_video" ? runRef("video", "reference", i)
        : kind === "audio_ref" ? runRef("audio", "reference", i)
          : runRef("image", "reference", i);

/** 每个方式扫这几种输入（创作者 / Agent 真会交的几种「不够」）。 */
function inputShapes(mode: ArchetypeMode): Array<[string, RunRef[]]> {
  const floor = mode.slots.flatMap((slot) => Array.from({ length: slot.min }, (_, i) => refForSlot(slot.kind, i + 1)));
  const required = mode.slots.find((slot) => slot.min >= 1);
  const accepted = new Set(mode.slots.flatMap((slot) => [...SLOT_ACCEPTS[slot.kind]]));
  const unrelated = (["audio", "video", "image"] as const).find((asset) => !accepted.has(asset));
  const hasLast = mode.slots.some((slot) => slot.kind === "last_frame");
  const shapes: Array<[string, RunRef[]]> = [];
  if (required) {
    const drop = floor.findIndex((ref) => ref.assetId === refForSlot(required.kind, 1).assetId);
    shapes.push(["少一件必需的", floor.filter((_, index) => index !== drop)]);
  }
  if (unrelated) shapes.push(["只给不相干的", [runRef(unrelated, "reference", 1)]]);
  if (hasLast) {
    shapes.push(["首尾帧只给首帧", [runRef("image", "first_frame", 1)]]);
    shapes.push(["首尾帧只给尾帧", [runRef("image", "last_frame", 1)]]);
  }
  shapes.push(["参考图放在标准参考键上", [runRef("image", "reference", 1)]]);
  return shapes;
}

/** 同一份输入写成调用方的标准输入键（画布 / 无界面调用交给 applyHeadlessParamDefaults 的样子）。 */
function standardKeys(refs: RunRef[]): Record<string, unknown> {
  const pick = (kind: RunRef["kind"], role: RunRef["role"]) => refs.filter((ref) => ref.kind === kind && ref.role === role).map((ref) => ref.assetId);
  const first = pick("image", "first_frame");
  const last = pick("image", "last_frame");
  const images = pick("image", "reference");
  const videos = pick("video", "reference");
  const audios = pick("audio", "reference");
  return {
    ...(first.length ? { firstFrameUrl: first[0] } : {}),
    ...(last.length ? { lastFrameUrl: last[0] } : {}),
    ...(images.length ? { referenceImages: images } : {}),
    ...(videos.length ? { referenceVideoUrls: videos } : {}),
    ...(audios.length ? { referenceAudioUrls: audios } : {}),
  };
}

type ShapeCell = { vendorKey: string; modelKey: string; modelAlias?: string | null; meta: unknown; archetype: ModelArchetype; mode: ArchetypeMode; taskKind: ProfileKind; shape: string; refs: RunRef[] };
/** 全目录：内置每一行 × 档案每个方式（有派发路径的）× 上面几种「不够」的输入。 */
function cells(): ShapeCell[] {
  const out: ShapeCell[] = [];
  for (const row of seeded.models) {
    const archetype = resolveArchetypeForModel({ modelKey: row.modelKey, modelAlias: row.modelAlias, vendorKey: row.vendorKey, meta: row.meta });
    if (!archetype) continue;
    for (const mode of archetype.modes) {
      const taskKind = modeTransportFor(mode, archetype, row.vendorKey) as ProfileKind | undefined;
      if (!taskKind || !selectTaskMapping(seeded.mappings, row.vendorKey, taskKind, row.modelKey, mode.id)?.create?.body) continue;
      for (const [shape, refs] of inputShapes(mode)) out.push({ vendorKey: row.vendorKey, modelKey: row.modelKey, modelAlias: row.modelAlias, meta: row.meta, archetype, mode, taskKind, shape, refs });
    }
  }
  return out;
}

/** 发送前入口（两个发送口都经它）：同一份请求值，方式号用给的这个，模板和选择身份取这个方式自己的。拒了返回错误对象。 */
function sendHeadless(cell: ShapeCell, mode: ArchetypeMode): unknown {
  const taskKind = (modeTransportFor(mode, cell.archetype, cell.vendorKey) ?? cell.taskKind) as ProfileKind;
  const mapping = selectTaskMapping(seeded.mappings, cell.vendorKey, taskKind, cell.modelKey, mode.id);
  lastRefusal.error = undefined;
  try {
    applyHeadlessParamDefaults(
      { modelKey: cell.modelKey, archetype: { id: cell.archetype.id, modeId: mode.id }, ...standardKeys(cell.refs) },
      { modelKey: cell.modelKey, modelAlias: cell.modelAlias, vendorKey: cell.vendorKey, modelMeta: cell.meta as never, taskKind, modeId: mode.id },
      mapping?.create?.defaultParams, mapping?.create?.body,
    );
    return null;
  } catch (error) {
    return error;
  }
}
const sendViaRun = (cell: ShapeCell, mode: ArchetypeMode) => {
  lastRefusal.error = undefined;
  return driveEngineB(capture, {
    vendorKey: cell.vendorKey, modelId: cell.modelKey, mode: modeTransportFor(mode, cell.archetype, cell.vendorKey) ?? cell.taskKind, modeId: mode.id,
    prompt: "一个镜头", parameters: {}, references: cell.refs,
    referenceUrls: Object.fromEntries(cell.refs.map((ref) => [spendReferenceKey(ref as never), ref.assetId])),
  });
};
const where = (cell: ShapeCell) => `${cell.vendorKey}/${cell.modelKey}/${cell.mode.id}/${cell.shape}`;
const CJK = /[\u3000-\u30ff\u3400-\u9fff\uac00-\ud7af\uff00-\uffef]/;

/**
 * 「点名即可用」（设计卡 docs/plan/2026-11-14-mode-input-check.md「出路句」）：拒收原话后半句点名的方式号（从拒收错误的
 * fitsModeId 取，不从句子里抠字），把同一份请求值只换成这个方式号再发，不许再被任何发送前检查拒。算不出这样的方式就不点名。
 * 两个入口各扫一遍：发送前入口本身（applyHeadlessParamDefaults，画布 / 引擎 A 走它），和 Run 路整条发送前准备（Agent / MCP 照着
 * 改了再发走的那条：先按角色放参考，再进同一个入口）——验收线量到的三格是 Run 路按角色放参考那一步拒的，只扫入口本身量不到。
 */
describe("性质：点名即可用——拒收原话点了名的方式，同一份输入只换方式号再发，不被任何发送前检查拒", () => {
  it("发送前入口（applyHeadlessParamDefaults）：全目录 × 五种输入；英文轨全部拒收原话不含中日韩字符", () => {
    const all = cells();
    const named: string[] = [];
    const broken: string[] = [];
    const english: string[] = [];
    for (const cell of all) {
      const first = sendHeadless(cell, cell.mode);
      const refusal = definiteSendRefusalOf(first);
      if (!refusal) continue;
      setDesktopLocale("en");
      try {
        english.push((definiteSendRefusalOf(sendHeadless(cell, cell.mode))?.message) ?? "");
      } finally {
        setDesktopLocale("zh-CN");
      }
      const fitsModeId = (first as { fitsModeId?: string }).fitsModeId;
      if (!fitsModeId) continue;
      named.push(`${where(cell)}→${fitsModeId}`);
      const again = sendHeadless(cell, cell.archetype.modes.find((mode) => mode.id === fitsModeId)!);
      if (again) broken.push(`${where(cell)}→${fitsModeId}: ${String((again as Error).message).slice(0, 140)}`);
    }
    console.info(`[点名即可用·入口] 扫 ${all.length} 格，点名 ${named.length} 格，点名后可发 ${named.length - broken.length} 格；英文原话 ${english.length} 条\n${named.join("\n")}`);
    expect(broken).toEqual([]);
    expect(all.length).toBeGreaterThan(300);
    expect(named.length).toBeGreaterThan(0);
    expect(english.length).toBeGreaterThan(20);
    expect(english.filter((message) => !message || CJK.test(message))).toEqual([]);
  });

  it("Run 路（按角色放参考 → 同一个入口）：全目录 × 五种输入", async () => {
    const all = cells();
    const named: string[] = [];
    const broken: string[] = [];
    runHost.frozen = true;
    try {
      for (const cell of all) {
        const first = await sendViaRun(cell, cell.mode);
        const fitsModeId = lastRefusal.error?.fitsModeId;
        if (!DEFINITE.includes(String(first.failure?.code)) || !fitsModeId) continue;
        named.push(`${where(cell)}→${fitsModeId}`);
        const again = await sendViaRun(cell, cell.archetype.modes.find((mode) => mode.id === fitsModeId)!);
        if (!again.request) broken.push(`${where(cell)}→${fitsModeId}: ${again.failure?.code} ${String(again.failure?.message).slice(0, 140)}`);
      }
    } finally {
      runHost.frozen = false;
      runHost.bootstrap = undefined;
      runHost.registry = undefined;
    }
    console.info(`[点名即可用·Run 路] 扫 ${all.length} 格，点名 ${named.length} 格，点名后可发 ${named.length - broken.length} 格\n${named.join("\n")}`);
    expect(broken).toEqual([]);
    expect(all.length).toBeGreaterThan(300);
    expect(named.length).toBeGreaterThan(0);
  }, 240_000);
});
