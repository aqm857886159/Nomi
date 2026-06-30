// 接入测试 2026-06-30 扫出的连接级根因的回归锁（见 docs/audit/2026-06-30-onboarding-sweep.md）。
// 两类根因：① dreamina 提交子命令误带 --download_dir（CLI 只 query_result 认）→ 提交即 unknown flag 秒挂；
// ② headless/MCP 路缺 wire 必填参（size/model/voice）→ vendor 直接拒。修法用 mapping.create.defaultParams
// 兜底 + seed 强制对账把它同步进老目录。本测锁住「修了别再退化」。
import { describe, it, expect } from "vitest";
import type { CatalogState } from "./types";
import { applyBuiltinSeeds } from "./seedBuiltins";
import { DREAMINA_IMAGE_CURATED_MAPPINGS } from "./dreaminaImages";
import { DREAMINA_CURATED_MAPPINGS } from "./dreaminaVideos";
import { VOLCENGINE_IMAGE_MODELS } from "./volcengineImages";
import { APIMART_AUDIO_MODELS } from "./apimartAudios";
import { VOLCENGINE_AUDIO_MODELS } from "./volcengineAudios";
import { applyWireDefaults } from "./taskParams";

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

describe("headless wire 兜底：缺必填参 vendor 直接拒 → mapping.create.defaultParams 兜住", () => {
  it("火山 Seedream create 带 size 默认（缺 size→HTTP 400）", () => {
    const create = VOLCENGINE_IMAGE_MODELS[0].mappings[0].create;
    expect(create.defaultParams?.size).toBe("2048x2048");
  });
  it("apimart 配音 create 带 model 默认（缺 model→HTTP 500 model is required）", () => {
    const tts = APIMART_AUDIO_MODELS[0].mappings.find((m) => m.taskKind === "text_to_audio")!;
    expect(tts.create.defaultParams?.model).toBe("gpt-4o-mini-tts");
    expect(tts.create.defaultParams?.voice).toBeTruthy();
  });
  it("豆包语音 create 带 voice 默认（缺 voice→「未选择音色」）", () => {
    const create = VOLCENGINE_AUDIO_MODELS[0].mappings[0].create;
    expect(create.defaultParams?.voice).toBeTruthy();
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

describe("seed 强制对账：老目录里没 defaultParams 的 create 会被代码版同步覆盖（headless 才能拿到）", () => {
  it("已存在但 create 过时的火山 t2i mapping，applyBuiltinSeeds 后带上 defaultParams", () => {
    // 模拟老装机：火山 seedream t2i mapping 存在，但 create 是「没有 defaultParams」的旧版。
    const staleCreate = {
      method: "POST",
      path: "/api/v3/images/generations",
      body: { model: "{{model.modelKey}}", prompt: "{{request.prompt}}", size: "{{request.params.size}}", watermark: false },
      response_mapping: { image_url: "data.0.url" },
    };
    const seeded: CatalogState = applyBuiltinSeeds(
      { version: 3, vendors: [], models: [], mappings: [], apiKeysByVendor: {} },
      "2026-06-30T00:00:00.000Z",
    ).state;
    const target = seeded.mappings.find((m) => m.vendorKey === "volcengine" && m.taskKind === "text_to_image");
    expect(target, "种子应含火山 t2i mapping").toBeTruthy();
    // 把它替换成旧版（无 defaultParams），再对账一次 → 应被强制同步回带 defaultParams 的代码版。
    const stale: CatalogState = { ...seeded, mappings: seeded.mappings.map((m) => (m === target ? { ...m, create: staleCreate } : m)) };
    const reconciled = applyBuiltinSeeds(stale, "2026-06-30T00:00:00.000Z").state;
    const after = reconciled.mappings.find((m) => m.vendorKey === "volcengine" && m.taskKind === "text_to_image");
    expect((after?.create as { defaultParams?: { size?: string } })?.defaultParams?.size).toBe("2048x2048");
  });
});
