import { describe, expect, it } from "vitest";
import { anthropicBaseUrl } from "./buildAiSdkModel";

// 2026-08-28 用户实测:接上 Claude 后 onboarding 连接检查能过,但画布 Agent 每次 HTTP 404。
//
// 根因是**同一个存储值的两套相反约定**:
//   · onboarding 探测(onboardingIpc.probeOneProtocol)剥掉尾随 /v1,自己拼 `${root}/v1/messages`
//     → 落库的 baseUrl 是 host root(`https://api.anthropic.com`)
//   · 运行时把这个 root 原样交给 `@ai-sdk/anthropic` 的 createAnthropic,而它的 baseURL **必须自带版本段**
//     (默认值就是 `https://api.anthropic.com/v1`),只在其后接 `/messages`
// → 运行时 POST 到 `{root}/messages`,Anthropic 返回 404 Not Found。
//
// 这条把归一钉死:无论库里存的是 root 还是带 /v1,运行时拿到的 base 都必须以版本段结尾。
describe("anthropicBaseUrl — 运行时 base 必须带版本段", () => {
  it("host root 补上 /v1(存量库里就是这个形态)", () => {
    expect(anthropicBaseUrl("https://api.anthropic.com")).toBe("https://api.anthropic.com/v1");
  });

  it("已带 /v1 的不重复拼(否则变成 /v1/v1/messages)", () => {
    expect(anthropicBaseUrl("https://api.anthropic.com/v1")).toBe("https://api.anthropic.com/v1");
  });

  it("尾随斜杠先归一,再判版本段", () => {
    expect(anthropicBaseUrl("https://api.anthropic.com/")).toBe("https://api.anthropic.com/v1");
    expect(anthropicBaseUrl("https://api.anthropic.com/v1/")).toBe("https://api.anthropic.com/v1");
    expect(anthropicBaseUrl("  https://api.anthropic.com  ")).toBe("https://api.anthropic.com/v1");
  });

  it("自建网关/中转的路径前缀原样保留,只补版本段", () => {
    expect(anthropicBaseUrl("https://gw.example.com/anthropic")).toBe("https://gw.example.com/anthropic/v1");
    expect(anthropicBaseUrl("https://gw.example.com/anthropic/v1")).toBe("https://gw.example.com/anthropic/v1");
  });

  // 别的版本段(未来 /v2)也算「已带版本」,不能再往后拼 /v1。
  it("非 v1 的版本段同样视作已带版本", () => {
    expect(anthropicBaseUrl("https://api.anthropic.com/v2")).toBe("https://api.anthropic.com/v2");
  });

  // 最终落到 SDK 的请求路径必须是 {base}/messages —— 这才是 404 的判据。
  it("拼出的最终端点是 /v1/messages,不是 /messages", () => {
    expect(`${anthropicBaseUrl("https://api.anthropic.com")}/messages`).toBe(
      "https://api.anthropic.com/v1/messages",
    );
  });
});
