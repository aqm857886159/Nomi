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
import type { ArchetypeMode, ArchetypeReferenceSlotKind } from "../shared/modelArchetypes/types";

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
    const { cells, noMapping } = scan(sendRouteFor(""));
    const missing = cells.filter((cell) => cell.outcome === "mode_input_missing").map((cell) => cell.where);
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
