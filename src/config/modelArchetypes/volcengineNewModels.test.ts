import { describe, expect, it } from "vitest";
import { getArchetypeById, resolveArchetypeForModel } from "./index";

// ---------------------------------------------------------------------------
// 火山方舟 2026-08-26 新接入的两个模型（Seedream 5.0 pro / Seedance 2.5）的**契约锁**。
// 每条数字都出自官方文档实查（docs.volcengine.com doc 1541523 / 1520757 / 2607688 / 1330310），
// 不是记忆。改这些数字前先回文档对账，别照着直觉调。
// ---------------------------------------------------------------------------

const m = (modelKey: string) => ({ modelKey, vendorKey: "volcengine" });

/** 把 "2048x1152" 这类像素串算成总像素数。 */
function pixels(size: string): number {
  const [w, h] = size.split("x").map(Number);
  return w * h;
}

describe("Seedream 5.0 pro（doubao-seedream-5-0-pro-260628）", () => {
  const KEY = "doubao-seedream-5-0-pro-260628";

  it("按完整 key 严格相等命中自己的档案（不是被 lite 档或 apimart 那份 pro 档抢走）", () => {
    // identifierMatchesPattern 是严格相等匹配：写前缀形（"doubao-seedream-5-0-pro"）命中不了真实 key。
    // 认错档案的后果不是报错，是**参数域用错**——lite 的 4K 档到 pro 上必 400。
    expect(resolveArchetypeForModel(m(KEY))?.id).toBe("volcengine-seedream-5-pro");
  });

  it("文生图 + 改图两模式都在，改图上限 10 张（pro 是 10，lite/4.x 是 14）", () => {
    const arch = getArchetypeById("volcengine-seedream-5-pro")!;
    expect(arch.modes.map((mode) => mode.id)).toEqual(["t2i", "edit"]);
    const edit = arch.modes.find((mode) => mode.id === "edit")!;
    expect(edit.transportTaskKind).toBe("image_edit");
    const slot = edit.slots[0];
    expect(slot.inputKey).toBe("image_urls");
    expect(slot.min).toBe(1);
    expect(slot.max).toBe(10);
  });

  it("每个 size 档都落在官方总像素域 [921600, 4624220] 内", () => {
    const arch = getArchetypeById("volcengine-seedream-5-pro")!;
    for (const mode of arch.modes) {
      const size = mode.params.find((p) => p.key === "size")!;
      expect(size.options.length).toBeGreaterThan(0);
      for (const option of size.options) {
        const total = pixels(String(option.value));
        expect(total, `${mode.id} size=${option.value} 总像素 ${total}`).toBeGreaterThanOrEqual(921600);
        expect(total, `${mode.id} size=${option.value} 总像素 ${total}`).toBeLessThanOrEqual(4624220);
      }
    }
  });

  it("独有 background（透明底），且默认不透明", () => {
    const arch = getArchetypeById("volcengine-seedream-5-pro")!;
    const bg = arch.modes[0].params.find((p) => p.key === "background")!;
    expect(bg.options.map((o) => o.value)).toEqual(["opaque", "transparent"]);
    expect(bg.defaultValue).toBe("opaque");
  });
});

describe("Seedream 5.0 lite / 4.5 / 4.0（共用 volcengine-seedream 档案）", () => {
  it.each([
    "doubao-seedream-5-0-260128",
    "doubao-seedream-4-5-251128",
    "doubao-seedream-4-0-250828",
  ])("%s 命中 volcengine-seedream", (key) => {
    expect(resolveArchetypeForModel(m(key))?.id).toBe("volcengine-seedream");
  });

  it("每个 size 档都落在三个模型的官方像素域**交集** [3686400, 16777216] 内", () => {
    // 5.0 lite / 4.5 = [3686400, 16777216]，4.0 = [921600, 16777216]。共用一份清单 → 取交集。
    const arch = getArchetypeById("volcengine-seedream")!;
    for (const mode of arch.modes) {
      const size = mode.params.find((p) => p.key === "size")!;
      for (const option of size.options) {
        const total = pixels(String(option.value));
        expect(total, `${mode.id} size=${option.value} 总像素 ${total}`).toBeGreaterThanOrEqual(3686400);
        expect(total, `${mode.id} size=${option.value} 总像素 ${total}`).toBeLessThanOrEqual(16777216);
      }
    }
  });

  it("改图上限 14 张", () => {
    const arch = getArchetypeById("volcengine-seedream")!;
    expect(arch.modes.find((mode) => mode.id === "edit")!.slots[0].max).toBe(14);
  });
});

describe("Seedance 2.5（doubao-seedance-2-5-260628）", () => {
  const KEY = "doubao-seedance-2-5-260628";

  it("按完整 key 命中自己的档案（不被 2.0 档或别家的 seedance-2-5 档抢走）", () => {
    expect(resolveArchetypeForModel(m(KEY))?.id).toBe("volcengine-seedance-2-5");
  });

  it("四模式齐备，全模态参考上限 30 图 / 10 视频 / 10 音频", () => {
    const arch = getArchetypeById("volcengine-seedance-2-5")!;
    expect(arch.modes.map((mode) => mode.id)).toEqual(["t2v", "first", "firstlast", "omni"]);
    const omni = arch.modes.find((mode) => mode.id === "omni")!;
    const byKind = Object.fromEntries(omni.slots.map((s) => [s.kind, s.max]));
    expect(byKind).toEqual({ image_ref: 30, video_ref: 10, audio_ref: 10 });
  });

  it("音频可单独输入（2.0 那份的 requiresAnyOf 限制在 2.5 已解除）", () => {
    const arch = getArchetypeById("volcengine-seedance-2-5")!;
    const audio = arch.modes.find((mode) => mode.id === "omni")!.slots.find((s) => s.kind === "audio_ref")!;
    expect(audio.requiresAnyOf).toBeUndefined();
    // 对照组：2.0 必须仍然带着这条限制（官方原文「不支持"文本+音频"、"纯音频"输入」）。
    const v20 = getArchetypeById("volcengine-seedance-2")!;
    const audio20 = v20.modes.find((mode) => mode.id === "omni")!.slots.find((s) => s.kind === "audio_ref")!;
    expect(audio20.requiresAnyOf).toEqual(["image_ref", "video_ref"]);
  });

  it("时长 4–30 秒；分辨率无 4k（4k 是 2.0 独有）", () => {
    const arch = getArchetypeById("volcengine-seedance-2-5")!;
    for (const mode of arch.modes) {
      const duration = mode.params.find((p) => p.key === "duration")!;
      expect(duration.min).toBe(4);
      expect(duration.max).toBe(30);
      const resolution = mode.params.find((p) => p.key === "resolution")!;
      expect(resolution.options.map((o) => o.value)).toEqual(["480p", "720p", "1080p"]);
    }
    // 对照组：2.0 有 4k、上限 15 秒。
    const v20 = getArchetypeById("volcengine-seedance-2")!;
    expect(v20.modes[0].params.find((p) => p.key === "resolution")!.options.map((o) => o.value)).toContain("4k");
    expect(v20.modes[0].params.find((p) => p.key === "duration")!.max).toBe(15);
  });

  it("首帧/首尾帧模式的比例锁死 adaptive（官方硬约束，违反是任务已创建后才异步报错）", () => {
    // doc 2607688：2.5 的首帧/首尾帧/编辑/延长任务 ratio 必须 adaptive，否则 InvalidParameter.TaskTypeConstraint。
    // 那时额度已排队 —— 所以必须在控件层就没得选，而不是发出去挨报错。
    const arch = getArchetypeById("volcengine-seedance-2-5")!;
    for (const modeId of ["first", "firstlast"]) {
      const ratio = arch.modes.find((mode) => mode.id === modeId)!.params.find((p) => p.key === "ratio")!;
      expect(ratio.options.map((o) => o.value), modeId).toEqual(["adaptive"]);
    }
    // 文生视频与全模态参考不受此约束，比例照常可选。
    for (const modeId of ["t2v", "omni"]) {
      const ratio = arch.modes.find((mode) => mode.id === modeId)!.params.find((p) => p.key === "ratio")!;
      expect(ratio.options.length, modeId).toBeGreaterThan(1);
    }
  });

  it("2.0 与 2.5 都不声明 seed / camera_fixed（官方仅 1.5/1.0 系列支持）", () => {
    for (const id of ["volcengine-seedance-2", "volcengine-seedance-2-5"]) {
      const arch = getArchetypeById(id)!;
      for (const mode of arch.modes) {
        const keys = mode.params.map((p) => p.key);
        expect(keys, `${id}/${mode.id}`).not.toContain("seed");
        expect(keys, `${id}/${mode.id}`).not.toContain("camera_fixed");
      }
    }
  });
});
