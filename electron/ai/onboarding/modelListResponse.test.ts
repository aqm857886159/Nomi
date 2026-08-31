import { describe, expect, it } from "vitest";
import { parseModelListResponse } from "./modelListResponse";

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
});
