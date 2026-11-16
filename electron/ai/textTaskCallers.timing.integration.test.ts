// 文本任务的**计时类**行为，按调用方逐个跑（真 SDK、真 HTTP，只把看门狗的几个数缩到毫秒级——判活的结构不变）。
// 真实数值（90s / 300s / 120s / 10 分钟）由 textTaskCallers.integration.test.ts 的真墙钟用例与 laneProviderGuard 的常量钉住。
//
// 三件事（设计卡 docs/plan/2026-10-21-text-tasks-to-pi-ai.md ★9 第 1 条）：
//   · 真死连接会被掐：连响应头都没有 / 响应头之后一个事件都没有 / 出字中途停住；
//   · 没有停止键的入口（一次性）有整体兜底，有停止键的入口（流式）没有（协调 10-21 定，D2）；
//   · 这些失败到了渲染层：带结构化类别（network），且**不会被文本节点的运行控制器自动重提**——
//     与迁移前一致（迁移前三种超时文案都不含重试关键词，见 docs/evidence/2026-10-21-text-tasks-pi-ai/c0-ai4-renderer-verdicts.txt）。
import { beforeAll, describe, expect, it, vi } from "vitest";
import { reply } from "../../tests/fixtures/textTasks/textUpstream";

vi.mock("electron", async () => (await import("../../tests/fixtures/textTasks/textTaskCallerState")).electronMock());
vi.mock("../ipcSenderGuard", () => ({ assertTrustedSender: () => undefined }));
vi.mock("../events/vendorCallTrace", () => ({ traceVendorCompleted: () => undefined, traceVendorRequested: () => undefined }));
// Transport matrix isolates catalog persistence; unverifiedUsable.test covers real result recording.
vi.mock("../catalog/modelExecutionVerification", () => ({ recordModelExecutionResult: (_input: unknown, result: unknown) => result }));
vi.mock("../catalog/validateCandidateCredential", () => ({ revalidatePendingCredential: async () => undefined }));
vi.mock("../assets/localAssetFile", async () => (await import("../../tests/fixtures/textTasks/textTaskCallerState")).localAssetMock());
vi.mock("../runtime", async () => (await import("../../tests/fixtures/textTasks/textTaskCallerState")).runtimeMock());
vi.mock("../agentLane/laneProviderGuard.mjs", async (importOriginal) => ({
  ...await importOriginal<typeof import("../agentLane/laneProviderGuard.mjs")>(),
  LANE_STREAM_WATCHDOG: Object.freeze({ firstResponseMs: 400, firstTokenMs: 400, idleMs: 300 }),
  MODEL_CALL_CEILING_MS: 900,
}));

import { CALLERS, rendererVerdict, runCaller } from "../../tests/fixtures/textTasks/textTaskCallerHarness";
import { parseVendorErrorFromMessage } from "../../src/workbench/generationCanvas/runner/vendorErrorIpc";

const STALLS = [
  { name: "连响应头都没有（first-response）", script: () => reply.silent(), says: /没有回应|no response/ },
  { name: "响应头之后一个事件都没有（first-token）", script: () => reply.hangAfterHeaders(), says: /思考了|thought for/ },
  { name: "出字中途停住（idle）", script: () => ({ type: "stream" as const, steps: [{ kind: "text" as const, text: "半" }, { kind: "hang" as const }] }), says: /中途停了|stalled/ },
];

// 预热：第一次调用要现装 pi 的协议模块，冷装本身就可能超过缩小后的 400ms 首字节预算（生产预算 90s，与此无关）。
beforeAll(async () => {
  await runCaller(CALLERS[0]!, "openai-compatible", () => reply.text("热身"));
});

describe.each(CALLERS)("$id", (caller) => {
  it.each(STALLS)("真死连接被掐：$name → network，带按相位的人话，渲染层不自动重提", async ({ script, says }) => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const seen = await runCaller(caller, "openai-compatible", script);
    expect(seen.ok).toBe(false);
    expect(seen.error).toMatch(says);
    expect(parseVendorErrorFromMessage(seen.error)).toMatchObject({ category: "network", retryable: true });
    expect(rendererVerdict(seen.error)).toEqual({ retried: false, kind: "network" });
    // 看门狗开火 = 我们这一侧真的取消了那次 HTTP 请求（交给传输层的 signal 已 abort），不是只是不再等它。
    // 不断言「假上游看见连接关了」：那一步在 undici 里异步发生，约 2% 的运行 3 秒内看不到（与本迁移无关，lane 同样如此），
    // 记在 PR 的残留风险里。
    const signals = fetchSpy.mock.calls.map(([input, init]) => init?.signal ?? (input instanceof Request ? input.signal : undefined));
    expect(signals.length).toBe(1);
    expect(signals[0]?.aborted).toBe(true);
    fetchSpy.mockRestore();
  });

  it(caller.door === "one-shot"
    ? "没有停止键：一直慢慢滴字也会在整体兜底到点收尾（network，不自动重提）"
    : "有停止键：同样的滴字不设整体上限，跑完拿到全文", async () => {
    const seen = await runCaller(caller, "openai-compatible", () => reply.drip(14, 100));
    if (caller.door === "one-shot") {
      expect(seen.ok).toBe(false);
      expect(seen.error).toMatch(/分钟还没结束|min without finishing/);
      expect(rendererVerdict(seen.error)).toEqual({ retried: false, kind: "network" });
    } else {
      expect(seen).toMatchObject({ ok: true, error: "" });
      expect(seen.text).toBe(Array.from({ length: 14 }, (_, index) => `段${index}`).join(""));
    }
  });
});
