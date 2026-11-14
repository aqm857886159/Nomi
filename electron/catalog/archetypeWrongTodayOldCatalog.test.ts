/**
 * 老用户守卫（2026-11-15，档案「今天就是错的」五处）：v0.24.1 写盘的真实老目录（model-catalog.json）里，
 * MiniMax H3 两条映射的 body 还引用 `{{request.params.webhook}}`，GPT Image 2.5 改图的 body 还是 `{{request.params.size}}`。
 * 升级（applyBuiltinSeeds）必须把它们换成主线的映射：否则老用户的 H3 照旧把节点上存着的回调地址发出去、
 * GPT 改图照旧把「自动」当 size 发出去——档案改了，老用户的请求却没变。
 * 这里用老存档走升级，再用升级后的映射真造一遍请求体（模板 + 参数翻译，不出网）。
 */
import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { buildHttpRequest, buildTemplateContext } from "../ai/requestPipeline";
import "./apimartImages";
import "./apimartVideos";
import { applyParamMap } from "./paramTranslate";
import { applyBuiltinSeeds } from "./seedBuiltins";
import { selectTaskMapping, type CatalogState } from "./types";

const root = new URL("../../tests/fixtures/old-user-data/curated/v0.24.1-apimart/", import.meta.url);
const original = JSON.parse(fs.readFileSync(new URL("model-catalog.json", root), "utf8")) as CatalogState;

function bodyFor(state: CatalogState, modelKey: string, taskKind: string, params: Record<string, unknown>) {
  const mapping = selectTaskMapping(state.mappings, "apimart", taskKind as never, modelKey);
  if (!mapping) throw new Error(`${modelKey} ${taskKind} mapping missing`);
  const request = { kind: taskKind, prompt: "x", extras: params };
  const context = buildTemplateContext({
    request: request as never,
    params: applyParamMap(mapping.create.paramMap, params),
    model: { modelKey },
    modelKey,
    apiKey: "TEST_SECRET",
  });
  return buildHttpRequest({ baseUrl: "https://api.apimart.ai", authType: "bearer", apiKey: "TEST_SECRET", context, operation: mapping.create }).body as Record<string, unknown>;
}

describe("v0.24.1 老目录升级后：H3 不发 webhook、GPT 改图「自动」不发 size", () => {
  const upgraded = () => applyBuiltinSeeds(structuredClone(original), "2026-11-15").state;

  it("老存档确实是旧形状（夹具前提）", () => {
    const h3 = original.mappings.filter((row) => row.modelKey === "MiniMax-H3");
    expect(h3.map((row) => JSON.stringify(row.create.body).includes("{{request.params.webhook}}"))).toEqual([true, true]);
    const gptEdit = original.mappings.find((row) => row.modelKey === "gpt-image-2.5-flare" && row.taskKind === "image_edit")!;
    expect((gptEdit.create.body as Record<string, unknown>).size).toBe("{{request.params.size}}");
  });

  it.each(["text_to_video", "image_to_video"])("MiniMax H3 %s：老节点存着回调地址，升级后请求体里没有 webhook", (taskKind) => {
    const params = taskKind === "text_to_video"
      ? { webhook: "https://hooks.example/done", resolution: "768P", duration: 5, aspect_ratio: "16:9" }
      : { webhook: "https://hooks.example/done", resolution: "768P", duration: 5, first_frame_image: "https://cdn.example/a.png" };
    expect(bodyFor(original, "MiniMax-H3", taskKind, params)).toHaveProperty("webhook");
    expect(bodyFor(upgraded(), "MiniMax-H3", taskKind, params)).not.toHaveProperty("webhook");
  });

  it("GPT Image 2.5 Flare 改图：老节点存着「auto」，升级前发 size=auto、升级后不发；存着 16:9 照发", () => {
    const refs = { image_urls: ["https://cdn.example/a.png"], resolution: "1K" };
    expect(bodyFor(original, "gpt-image-2.5-flare", "image_edit", { ...refs, size: "auto" }).size).toBe("auto");
    expect(bodyFor(upgraded(), "gpt-image-2.5-flare", "image_edit", { ...refs, size: "auto" })).not.toHaveProperty("size");
    expect(bodyFor(upgraded(), "gpt-image-2.5-flare", "image_edit", { ...refs, size: "16:9" }).size).toBe("16:9");
  });

  it.each(["kling-v3", "veo3.1-fast"])("%s 图生：老映射本来就不发比例，升级后同样不发（不回归）", (modelKey) => {
    const params = { aspect_ratio: "9:16", image_urls: ["https://cdn.example/a.png"], resolution: "720p" };
    expect(bodyFor(original, modelKey, "image_to_video", params)).not.toHaveProperty("aspect_ratio");
    expect(bodyFor(upgraded(), modelKey, "image_to_video", params)).not.toHaveProperty("aspect_ratio");
  });
});
