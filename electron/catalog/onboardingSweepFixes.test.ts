// 接入测试 2026-06-30 扫出的连接级根因的回归锁（见 docs/audit/2026-06-30-onboarding-sweep.md）。
// 两类根因：① dreamina 提交子命令误带 --download_dir（CLI 只 query_result 认）→ 提交即 unknown flag 秒挂；
// ② headless/MCP 路缺 wire 必填参（size/model/voice/duration…）→ vendor 直接拒。②的修法已升级为「档案默认
// 桥接」（applyHeadlessParamDefaults 按 archetypeId+taskKind+vendor 兜底，单一真相源=档案），本测锁住别退化。
import { describe, it, expect } from "vitest";
import { DREAMINA_IMAGE_CURATED_MAPPINGS } from "./dreaminaImages";
import { DREAMINA_CURATED_MAPPINGS } from "./dreaminaVideos";
import { applyWireDefaults, applyHeadlessParamDefaults, taskTemplateParams } from "./taskParams";
import { APIMART_AUDIO_MODELS } from "./apimartAudios";

describe("dreamina CLI：--download_dir 只许 query_result（提交子命令带它=unknown flag 秒挂）", () => {
  const allMappings = [...DREAMINA_IMAGE_CURATED_MAPPINGS, ...DREAMINA_CURATED_MAPPINGS];
  it("所有提交 create op 不再带 appendDownloadDir", () => {
    for (const m of allMappings) {
      expect(m.create.process?.appendDownloadDir, `${m.id} create 不该带 appendDownloadDir`).toBeFalsy();
    }
  });
  it("query op（取结果）仍带 appendDownloadDir", () => {
    const withQuery = allMappings.filter((m) => "query" in m && m.query);
    expect(withQuery.length).toBeGreaterThan(0);
    for (const m of withQuery) {
      const q = (m as { query?: { process?: { appendDownloadDir?: boolean; args: string[] } } }).query;
      expect(q?.process?.appendDownloadDir, `${m.id} query 应保留 appendDownloadDir`).toBe(true);
      expect(q?.process?.args?.[0]).toBe("query_result");
    }
  });
});

describe("headless wire 兜底：缺必填参 vendor 直接拒 → 档案默认桥接兜住（applyHeadlessParamDefaults）", () => {
  it("火山 Seedream 缺 size → 桥接填档案默认 2048x2048（缺 size→HTTP 400）", () => {
    const out = applyHeadlessParamDefaults({}, "volcengine-seedream", "text_to_image", "volcengine", undefined);
    expect(out?.size).toBe("2048x2048");
  });
  it("apimart 配音 headless：线上 model 由 owner 按模式给 gpt-4o-mini-tts（缺 model→HTTP 500），默认表只补 voice", () => {
    const out = applyHeadlessParamDefaults({}, "nomi-audio", "text_to_audio", "apimart", undefined);
    // model 不归默认表（2026-10-16）：发哪个 model 串只问 wireModelIdentity。
    expect(out).not.toHaveProperty("model");
    expect(out?.voice).toBeTruthy();
    const tts = APIMART_AUDIO_MODELS[0]!.mappings.find((mapping) => mapping.taskKind === "text_to_audio")!;
    const params = taskTemplateParams({ kind: "text_to_audio", extras: out }, { vendorKey: "apimart", modelKey: "nomi-audio", modelMeta: { archetypeId: "nomi-audio" }, operation: tts.create });
    expect(params.model).toBe("gpt-4o-mini-tts");
  });
  it("豆包语音 缺 voice → 桥接填档案默认音色（缺 voice→「未选择音色」）", () => {
    const out = applyHeadlessParamDefaults({}, "volcengine-doubao-tts", "text_to_audio", "volcengine-speech", undefined);
    expect(out?.voice).toBeTruthy();
  });
  it("既有值优先（UI 路已填→零影响）", () => {
    const out = applyHeadlessParamDefaults({ size: "1024x1024" }, "volcengine-seedream", "text_to_image", "volcengine", undefined);
    expect(out?.size).toBe("1024x1024");
  });
});

describe("applyWireDefaults：兜底并入 extras 之下（既有值优先，UI 路零影响）", () => {
  it("缺参时填默认；既有值优先；无 defaultParams 原样返回", () => {
    expect(applyWireDefaults({}, { size: "2048x2048" })).toEqual({ size: "2048x2048" });
    expect(applyWireDefaults({ size: "1024x1024" }, { size: "2048x2048" })).toEqual({ size: "1024x1024" });
    expect(applyWireDefaults(undefined, { voice: "v" })).toEqual({ voice: "v" });
    const extras = { a: 1 };
    expect(applyWireDefaults(extras, undefined)).toBe(extras);
  });
});
