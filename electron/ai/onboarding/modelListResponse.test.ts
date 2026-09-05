import { describe, expect, it } from "vitest";
import { parseModelListPage, parseModelListResponse } from "./modelListResponse";

describe("parseModelListResponse", () => {
  // 这条是根因回归：new-api/one-api 的 SPA 对未知路径回 200 + index.html。
  // 若把它当「命中但空」，多候选探测就会提前收工，永远试不到真正的 /v1/models。
  it("SPA 首页 HTML 不是模型列表（必须返回 null 让调用方继续试下一个候选）", () => {
    const html = '<!doctype html>\n<html lang="en"><head><title>Dawnload</title></head><body></body></html>';
    expect(parseModelListResponse(html)).toBeNull();
  });

  it("非 JSON 的纯文本错误页也返回 null", () => {
    expect(parseModelListResponse("502 Bad Gateway")).toBeNull();
    expect(parseModelListResponse("")).toBeNull();
  });

  it("JSON 但不是模型列表形状（如错误体）返回 null", () => {
    expect(parseModelListResponse('{"error":{"message":"Invalid token"}}')).toBeNull();
  });

  it("OpenAI 标准 { data: [{ id }] } 解析出 id", () => {
    const body = '{"object":"list","data":[{"id":"doubao-seedance-2-0-260128"},{"id":"gpt-4o-mini"}]}';
    expect(parseModelListResponse(body)).toEqual(["doubao-seedance-2-0-260128", "gpt-4o-mini"]);
  });

  it("保留 OpenRouter 架构元数据供 MCP 接入直接推导能力", () => {
    const page = parseModelListPage(JSON.stringify({ data: [{
      id: "openrouter/image",
      architecture: { input_modalities: ["text", "image"], output_modalities: ["image"], supported_parameters: ["temperature"] },
    }] }));
    expect(page).toMatchObject({ models: ["openrouter/image"], descriptors: [{ id: "openrouter/image", architecture: { inputModalities: ["text", "image"], outputModalities: ["image"], supportedParameters: ["temperature"] } }] });
  });

  it("顶层数组 / 裸字符串元素也认（少数网关形状）", () => {
    expect(parseModelListResponse('["kling-v2","sora-2"]')).toEqual(["kling-v2", "sora-2"]);
    expect(parseModelListResponse('{"data":["kling-v2"]}')).toEqual(["kling-v2"]);
  });

  it("合法但空的列表返回 []（≠ null：这是真的没模型，不是解析失败）", () => {
    expect(parseModelListResponse('{"object":"list","data":[]}')).toEqual([]);
  });

  it("丢掉空 id、去掉首尾空格", () => {
    expect(parseModelListResponse('{"data":[{"id":" a "},{"id":""},{"nope":1}]}')).toEqual(["a"]);
  });

  it("preserves the native Replicate owner/name identifier, without a hostname condition", () => {
    expect(parseModelListResponse(JSON.stringify({
      results: [{ owner: "black-forest-labs", name: "flux-schnell" }, { owner: "another", name: "flux-schnell" }],
      next: null,
      previous: null,
    }))).toEqual(["black-forest-labs/flux-schnell", "another/flux-schnell"]);
  });

  it.each([
    { items: [{ id: {} }] }, { items: [{ id: 42 }] }, { items: [{ id: true }] },
    { items: [{ name: "display name" }] }, { items: [null, " "] },
  ])(
    "does not turn malformed nonempty lists into empty success or coerced IDs: $items", ({ items }) => {
      expect(parseModelListResponse(JSON.stringify({ data: items }))).toBeNull();
    },
  );

  it("deduplicates IDs without changing case, slashes or punctuation", () => {
    expect(parseModelListResponse(JSON.stringify({ data: ["Owner/Model:v2", "owner/model:v2", "Owner/Model:v2"] })))
      .toEqual(["Owner/Model:v2", "owner/model:v2"]);
  });

  it.each([
    { code: 401, data: [] },
    { status: "error", data: [{ id: "not-a-success" }] },
    { success: false, data: [] },
    { error: { code: "invalid_api_key", message: "Invalid key" }, data: [] },
  ])("does not parse an HTTP-200 error envelope as a list: %j", (body) => {
    expect(parseModelListResponse(JSON.stringify(body))).toBeNull();
  });
});
