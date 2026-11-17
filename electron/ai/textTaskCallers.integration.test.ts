// 文本任务的**每一个调用方**，走真栈、真 HTTP（本机假上游，零额度、不出网）。
//
// 为什么按调用方逐个跑：全部文本任务都收口到 `executeTextTask` 一扇门，但进门的姿势不同——
// 流式的经 `nomi:tasks:text:stream`（带取消、逐段回调），一次性的经 `nomi:tasks:run`（没有取消、错误经 runTaskIpcGuard 编码），
// 拆解显式不重试并带 3 帧图，浏览器提取带图和温度。同一种上游回法，在不同姿势下用户看到的东西可以不一样；
// 漏掉一个姿势，就是迁完还残留一种旧行为（设计卡 docs/plan/2026-10-21-text-tasks-to-pi-ai.md「一、调用方普查」）。
//
// 断言的是用户看得到的东西：拿到的正文 / 渲染层收到的那句错误 / 上游被请求了几次 / 停止后 HTTP 是不是真断了，
// 以及那句错误在渲染层会不会被「自动重提」（generationRetryPolicy）、被分成哪一类（classifyError）。
// 后两条是协调 10-21 的硬要求：迁移前后必须一样，文案改动不许悄悄改掉重试行为。
//
// 计时类用例（想得久 / 真死连接）用真墙钟跑主进程的真实闸，单条要几十秒：默认不跑，`NOMI_TEXT_REALTIME=1` 时跑。
import { existsSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { reply } from "../../tests/fixtures/textTasks/textUpstream";
import { parseVendorErrorFromMessage } from "../../src/workbench/generationCanvas/runner/vendorErrorIpc";
import { textTaskFailureText } from "../../src/workbench/api/taskApi";
import { desktopT } from "../i18n";

vi.mock("electron", async () => (await import("../../tests/fixtures/textTasks/textTaskCallerState")).electronMock());
vi.mock("../ipcSenderGuard", () => ({ assertTrustedSender: () => undefined }));
vi.mock("../events/vendorCallTrace", () => ({ traceVendorCompleted: () => undefined, traceVendorRequested: () => undefined }));
// Transport matrix isolates catalog persistence; unverifiedUsable.test covers real result recording.
vi.mock("../assets/localAssetFile", async () => (await import("../../tests/fixtures/textTasks/textTaskCallerState")).localAssetMock());
vi.mock("../runtime", async () => (await import("../../tests/fixtures/textTasks/textTaskCallerState")).runtimeMock());

import { CALLERS, RENDERER_ENTRY_GAP_EXCEPTIONS, STREAM_CALLERS, rendererVerdict, runCaller } from "../../tests/fixtures/textTasks/textTaskCallerHarness";

// 本矩阵从执行器 / IPC handler 往下测，看不见入口之上的准入（2026-10-21 改写选区被令牌闸挡、矩阵全绿的教训）。
// 每个调用方必须写明真入口测试或缺口；渲染层发起的只能有真入口测试（登记的例外除外）。新增调用方不填 → 这里红。
describe("真入口登记", () => {
  it.each(CALLERS)("$id：写明从真入口经准入走到 HTTP 的测试，或缺口", (caller) => {
    if (caller.entry.test) expect(existsSync(caller.entry.test), caller.entry.test).toBe(true);
    else expect(caller.entry.gap?.trim(), "没有真入口测试就必须写缺口").toBeTruthy();
    if (caller.entry.from === "renderer" && !caller.entry.test) expect(RENDERER_ENTRY_GAP_EXCEPTIONS).toContain(caller.id);
  });
  it("例外表里每一条都还是真缺口（补上测试就从例外表删掉）", () => {
    for (const id of RENDERER_ENTRY_GAP_EXCEPTIONS) expect(CALLERS.find((caller) => caller.id === id)?.entry.test).toBeUndefined();
  });
});

describe.each(CALLERS)("$id", (caller) => {
  it("正常回话：拿到正文（流式入口逐段收到同一段字）", async () => {
    const seen = await runCaller(caller, "openai-compatible", () => reply.text("慢慢展开纸条。"));
    expect(seen).toMatchObject({ ok: true, text: "慢慢展开纸条。", requests: 1 });
    if (caller.door === "stream") expect(seen.deltas).toBe("慢慢展开纸条。");
  });

  it("空回包（200、stop、没有正文）：不报错，正文为空，交给入口自己的「空结果」文案", async () => {
    const seen = await runCaller(caller, "openai-compatible", () => reply.empty());
    expect(seen).toMatchObject({ ok: true, text: "", requests: 1 });
  });

  it("429：缺省重试 2 次（拆解 0 次），最后的错误带结构化类别 quota，渲染层不自动重提", async () => {
    const seen = await runCaller(caller, "openai-compatible", () => reply.http(429, { error: { message: "Too many requests, slow down" } }));
    expect(seen.ok).toBe(false);
    expect(seen.requests).toBe(caller.extras?.maxRetries === 0 ? 1 : 3);
    expect(seen.error).toContain("HTTP 429");
    expect(seen.error).toContain("Too many requests, slow down");
    expect(rendererVerdict(seen.error)).toEqual({ retried: false, kind: "quota" });
  });

  it("503：同样的重试次数，类别 server", async () => {
    const seen = await runCaller(caller, "openai-compatible", () => reply.http(503, { error: { message: "upstream overloaded" } }));
    expect(seen.ok).toBe(false);
    expect(seen.requests).toBe(caller.extras?.maxRetries === 0 ? 1 : 3);
    expect(seen.error).toContain("HTTP 503");
    expect(rendererVerdict(seen.error)).toEqual({ retried: false, kind: "server" });
  });

  it("401：不重试，类别 auth，带上游原话", async () => {
    const seen = await runCaller(caller, "openai-compatible", () => reply.http(401, { error: { message: "invalid api key" } }));
    expect(seen).toMatchObject({ ok: false, requests: 1 });
    expect(seen.error).toContain("invalid api key");
    expect(rendererVerdict(seen.error)).toEqual({ retried: false, kind: "auth" });
  });

  it("包装过的回包（HTTP 200、SSE 里是 error）：失败，说出上游原话", async () => {
    const seen = await runCaller(caller, "openai-compatible", () => reply.sseError("relay upstream failed: channel busy"));
    expect(seen.ok).toBe(false);
    expect(seen.error).toContain("relay upstream failed: channel busy");
  });

  it("出字中途断连：失败，不把半截字当成功；带结构化 network 与现有「中途断了」人话，不是裸 terminated（独立验收 N1）", async () => {
    const seen = await runCaller(caller, "openai-compatible", () => reply.cutAfterText("半截"));
    expect(seen.ok).toBe(false);
    expect(parseVendorErrorFromMessage(seen.error)).toMatchObject({ category: "network" });
    // 一次性门的错误由 Electron 再包一层「Error invoking remote method …」，人话照样在里面。
    expect(textTaskFailureText(new Error(seen.error))).toContain(desktopT("textTask.streamCut"));
    expect(textTaskFailureText(new Error(seen.error)).toLowerCase()).not.toContain("terminated");
    expect(rendererVerdict(seen.error).retried).toBe(false);
  });

  it("流结束却没有 finish_reason（D3，协调 10-21 定：算失败）", async () => {
    const seen = await runCaller(caller, "openai-compatible", () => reply.noFinishReason("看着像完整的一句。"));
    expect(seen.ok).toBe(false);
    expect(seen.error).not.toBe("");
  });
});

describe.each(STREAM_CALLERS)("$id · 停止", (caller) => {
  it("出字中点停止：真掐 HTTP，不发 done 也不发 error", async () => {
    const seen = await runCaller(caller, "openai-compatible", () => reply.drip(200, 20), { stopAfterFirstDelta: true });
    expect(seen.cancelled).toBe(true);
    expect(seen.requestAborted).toBe(true);
    expect(seen.deltas.length).toBeGreaterThan(0);
  });
});

// 硬约束（协调 10-21 定，★2）：nomi:tasks:text:* 的 IPC 契约一字不变——#1264 的写作区改写不改一行就走新核心，靠的就是它。
describe("nomi:tasks:text:* IPC 契约", () => {
  const caller = STREAM_CALLERS[0]!;
  it("成功：只有 delta{delta} 与一条 done{result}，result 是 succeeded + OpenAI choices 形状", async () => {
    const seen = await runCaller(caller, "openai-compatible", () => reply.text("一句话。"));
    const types = seen.ipcEvents!.map((event) => event.type);
    expect(new Set(types)).toEqual(new Set(["delta", "done"]));
    expect(types.at(-1)).toBe("done");
    for (const event of seen.ipcEvents!.filter((item) => item.type === "delta")) expect(Object.keys(event).sort()).toEqual(["delta", "type"]);
    const done = seen.ipcEvents!.find((event) => event.type === "done")!;
    expect(Object.keys(done).sort()).toEqual(["result", "type"]);
    expect(done.result).toMatchObject({ status: "succeeded", assets: [], kind: caller.kind,
      raw: { choices: [{ message: { role: "assistant", content: "一句话。" } }] } });
  });

  it("失败：只有一条 error{message}，message 是字符串", async () => {
    const seen = await runCaller(caller, "openai-compatible", () => reply.http(500, { error: { message: "boom" } }));
    expect(seen.ipcEvents).toHaveLength(1);
    expect(Object.keys(seen.ipcEvents![0]!).sort()).toEqual(["message", "type"]);
    expect(seen.ipcEvents![0]).toMatchObject({ type: "error", message: expect.any(String) });
  });

  it("停止：不发 done、不发 error（渲染层自己按取消收尾）", async () => {
    const seen = await runCaller(caller, "openai-compatible", () => reply.drip(200, 20), { stopAfterFirstDelta: true });
    expect(seen.ipcEvents!.every((event) => event.type === "delta")).toBe(true);
  });
});

const realtime = process.env.NOMI_TEXT_REALTIME === "1";
describe.runIf(realtime)("真墙钟（NOMI_TEXT_REALTIME=1）", () => {
  it.concurrent.each(CALLERS)("$id · 思考型模型：先想 35 秒（每 5 秒一段 reasoning）再出字——不被当死连接掐掉", async (caller) => {
    const seen = await runCaller(caller, "openai-compatible", () => reply.thinkThenText(7, 5_000, "想好了。"));
    expect(seen.error).toBe("");
    expect(seen).toMatchObject({ ok: true, text: "想好了。" });
  }, 90_000);
});
