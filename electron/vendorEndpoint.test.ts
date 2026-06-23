import { describe, expect, it } from "vitest";
// 从纯模块导入，避免 import 整个 runtime 触发 electron 加载（CI 纯 Node 会失败）
import { endpoint } from "./vendorEndpoint";

const vendor = (baseUrlHint: string) => ({ key: "test", baseUrlHint });

describe("endpoint URL 拼接", () => {
  it("base 以 /v1 结尾 + 后缀以 /v1 开头 → 合并，不拼成双 /v1（Moonshot '没找到对象' 根因）", () => {
    expect(endpoint(vendor("https://api.moonshot.cn/v1"), "/v1/chat/completions")).toBe("https://api.moonshot.cn/v1/chat/completions");
    expect(endpoint(vendor("https://api.deepseek.com/v1/"), "/v1/images/generations")).toBe("https://api.deepseek.com/v1/images/generations");
  });

  it("base 以 /api/v3 结尾（火山方舟）→ 去掉 suffix 冗余 /v1，命中真实端点（Issue #19 的 404 根因）", () => {
    expect(endpoint(vendor("https://ark.cn-beijing.volces.com/api/v3"), "/v1/images/generations")).toBe(
      "https://ark.cn-beijing.volces.com/api/v3/images/generations",
    );
    expect(endpoint(vendor("https://ark.cn-beijing.volces.com/api/v3/"), "/v1/videos/generations")).toBe(
      "https://ark.cn-beijing.volces.com/api/v3/videos/generations",
    );
  });

  it("base 不带 /v1 → 正常拼接", () => {
    expect(endpoint(vendor("https://api.moonshot.cn"), "/v1/chat/completions")).toBe("https://api.moonshot.cn/v1/chat/completions");
  });

  it("base 已是完整端点 → 原样返回", () => {
    expect(endpoint(vendor("https://api.x.com/v1/chat/completions"), "/v1/chat/completions")).toBe("https://api.x.com/v1/chat/completions");
  });

  it("尾部多余斜杠被规整", () => {
    expect(endpoint(vendor("https://api.x.com/v1///"), "/v1/videos/generations")).toBe("https://api.x.com/v1/videos/generations");
  });

  it("缺 Base URL → 抛错", () => {
    expect(() => endpoint(vendor(""), "/v1/chat/completions")).toThrow(/Base URL missing/);
  });
});
