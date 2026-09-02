import { describe, it, expect } from "vitest";
import { RUNWAY_OFFICIAL_MODELS } from "./runwayOfficial";
import { modeSlotReach } from "./referenceReachability";
import { MODEL_ARCHETYPES, specializeArchetypeForVendor } from "../../src/config/modelArchetypes";
import {
  RUNWAY_AUDIO_ENDPOINTS,
  RUNWAY_SEED_AUDIO_REFERENCE_MAX,
  RUNWAY_VOICE_PRESETS,
  type RunwayAudioModelKey,
} from "../shared/audioCapabilities/runwayAudioWireFacts";

/**
 * 类级回归锁（2026-09-02 拆 `runway-audio` 平台档案）。
 *
 * 被删掉的缺陷形状：一个**平台档案**罩 4 个完全不同的音频产品，给它们发**同一套 7 个参数**
 * 和**同样两个模式**。照官方 OpenAPI 逐模型对账，没有任何一个模型收得下那 7 个；实测多余控件
 * 连 wire 都到不了（用户调了没效果、也不报错——比发非法值更隐蔽），且一个纯音效模型
 * （`eleven_text_to_sound_v2`）对外宣称自己会配音。下面四条不变量让这个形状回不来。
 */
describe("Runway 音频：一个模型一个档案主人，能力面与 wire 同源", () => {
  const audioRows = RUNWAY_OFFICIAL_MODELS.filter((m) => m.kind === "audio");

  it("每一行都挂在**模型专属**档案上（没有跨产品共享的平台档案）", () => {
    expect(audioRows.length).toBe(4);
    const owners = new Map<string, string[]>();
    for (const row of audioRows) {
      owners.set(row.archetypeId!, [...(owners.get(row.archetypeId!) ?? []), row.modelKey]);
    }
    const shared = [...owners.entries()].filter(([, models]) => models.length > 1);
    expect(shared, `平台档案复活：${shared.map(([id, m]) => `${id}←${m.join("/")}`).join("; ")}`).toEqual([]);
    // 已删的平台档案不得以任何形式回来（含 re-export 壳）。
    expect(MODEL_ARCHETYPES.map((a) => a.id)).not.toContain("runway-audio");
  });

  it("档案声明的模式 = 官方 union 里它真实存在的端点（不许宣称自己没有的能力）", () => {
    for (const row of audioRows) {
      const endpoints = RUNWAY_AUDIO_ENDPOINTS[row.modelKey as RunwayAudioModelKey];
      expect(endpoints, `${row.modelKey} 未登记官方端点归属`).toBeTruthy();
      const archetype = specializeArchetypeForVendor(
        MODEL_ARCHETYPES.find((a) => a.id === row.archetypeId)!,
        "runway",
      );
      const declared = archetype.modes.map((m) => m.id);
      // sfx ⇔ /v1/sound_effect；speech ⇔ /v1/text_to_speech。
      // 旧平台档案对全部 4 个模型都声明了两者，于是三行各有一个模式在 Runway 上无线缆可走。
      if (!endpoints.soundEffect) {
        expect(declared, `${row.modelKey} 不在 /v1/sound_effect 的 oneOf 里，却声明了 sfx 模式`).not.toContain("sfx");
      }
      if (!endpoints.textToSpeech) {
        expect(declared, `${row.modelKey} 不在 /v1/text_to_speech 的 oneOf 里，却声明了 speech 模式`).not.toContain("speech");
      }
      // 反向：官方有的能力必须真的发布出来（这一行在目录里有对应 mapping）。
      const wired = row.mappings.map((m) => (m as { modeId?: string }).modeId);
      for (const mode of declared) {
        expect(wired, `${row.modelKey}/${mode} 声明了却没有 mapping（幻影模式）`).toContain(mode);
      }
    }
  });

  it("UI 给得出的每个参数都真的到得了 wire（没有调了没效果的假控件）", () => {
    for (const row of audioRows) {
      const archetype = specializeArchetypeForVendor(
        MODEL_ARCHETYPES.find((a) => a.id === row.archetypeId)!,
        "runway",
      );
      for (const mapping of row.mappings) {
        const modeId = (mapping as { modeId?: string }).modeId;
        const mode = archetype.modes.find((m) => m.id === modeId);
        expect(mode, `${row.modelKey}/${modeId} 在档案里找不到对应模式`).toBeTruthy();
        const body = JSON.stringify((mapping.create as { body?: unknown }).body ?? {});
        // 这正是旧平台档案的病：eleven_multilingual_v2 摆着 7 个控件，body 里一个都没读。
        const dead = mode!.params.filter((p) => !body.includes(`request.params.${p.key}`)).map((p) => p.key);
        expect(dead, `${row.modelKey}/${modeId} 的控件到不了 wire（调了没效果）：${dead.join(", ")}`).toEqual([]);
      }
    }
  });

  it("参考槽真正可达；必填音色只给官方 49 个预设", () => {
    for (const row of audioRows) {
      const archetype = specializeArchetypeForVendor(
        MODEL_ARCHETYPES.find((a) => a.id === row.archetypeId)!,
        "runway",
      );
      for (const mapping of row.mappings) {
        const modeId = (mapping as { modeId?: string }).modeId;
        const mode = archetype.modes.find((m) => m.id === modeId)!;
        const body = (mapping.create as { body?: unknown }).body;
        if (mode.slots.length) {
          // 键对不上 = 参考音频静默发不出去（UI 显示连上了、请求里一条都没有）。
          const reach = modeSlotReach(mode.slots, body);
          expect(reach, `${row.modelKey}/${modeId} 参考槽不可达`).not.toContain("none");
          // 上限必须来自官方表，不许在档案里另写一个数字。
          for (const slot of mode.slots) {
            if (slot.inputKey === "reference_audio_urls") {
              expect(slot.max).toBe(RUNWAY_SEED_AUDIO_REFERENCE_MAX);
            }
          }
        }
        // voice 在 spec 里对两个 Eleven TTS 变体是**必填**且只接受 RunwayPresetVoice。
        // 旧实现把 presetId 焊死成 "Maya"，用户永远换不了音色。
        const voiceParam = mode.params.find((p) => p.key === "voice_preset_id");
        if (voiceParam) {
          const values = voiceParam.options.map((o) => String(o.value));
          const illegal = values.filter((v) => !RUNWAY_VOICE_PRESETS.includes(v));
          expect(illegal, `${row.modelKey} 提供了官方枚举外的音色：${illegal.join(", ")}`).toEqual([]);
          expect(values.length).toBe(RUNWAY_VOICE_PRESETS.length);
          expect(RUNWAY_VOICE_PRESETS).toContain(String(voiceParam.defaultValue));
          expect(JSON.stringify(body), `${row.modelKey} 的 presetId 仍被焊死在 body 里`).toContain(
            "request.params.voice_preset_id",
          );
        }
      }
    }
  });
});
