// 「停止」真的掐断主进程文本流，并且不会再发出成功的 done。
//
// 真路径：真 textStreamIpc（stream / cancel 两个 IPC 通道）→ 真 streamTextTask → 假供应商（AI SDK 的 streamText 换成一个
// 会一直吐字、并且像真 SDK 一样在 abortSignal 触发后静默收尾返回残文本的假流）。断言：
//   · 传给供应商的 abortSignal 真的被置为 aborted；
//   · 事件通道里收到过 delta，但没有 done（半截文字不能当成功送出去）；
//   · 停止之前正常结束的流仍然照常发 done（不误伤）。
import { EventEmitter } from "node:events";
import { beforeEach, describe, expect, it, vi } from "vitest";

type Sender = EventEmitter & { id: number; isDestroyed: () => boolean };
type Handler = (event: { sender: Sender }, payload?: unknown) => unknown;
const mocks = vi.hoisted(() => ({
  handlers: new Map<string, Handler>(),
  sent: [] as Array<{ type?: string; delta?: string }>,
  providerSignal: undefined as AbortSignal | undefined,
  mode: "endless" as "endless" | "finite",
}));

vi.mock("electron", () => ({
  ipcMain: { handle: (name: string, fn: Handler) => mocks.handlers.set(name, fn) },
  webContents: {
    fromId: () => ({ isDestroyed: () => false, send: (_channel: string, payload: { event: { type?: string; delta?: string } }) => mocks.sent.push(payload.event) }),
  },
}));
vi.mock("../ipcSenderGuard", () => ({ assertTrustedSender: () => undefined }));
vi.mock("../assets/localAssetFile", () => ({ readNomiLocalAsset: () => null }));
vi.mock("./vendorLanguageModel", () => ({ buildLanguageModelForVendor: () => ({}) }));
vi.mock("./antigravityTask", () => ({ runAntigravityTask: vi.fn() }));
vi.mock("ai", () => ({
  streamText: (options: { abortSignal: AbortSignal }) => {
    mocks.providerSignal = options.abortSignal;
    async function* chunks() {
      for (let index = 0; index < 1000; index += 1) {
        if (options.abortSignal.aborted) return; // 真 SDK：abort 后 textStream 静默结束
        yield `字${index}`;
        if (mocks.mode === "finite" && index === 2) return;
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
    }
    return { textStream: chunks(), finishReason: Promise.resolve("stop"), reasoning: Promise.resolve(undefined) };
  },
}));
// 供应商 / 模型 / 密钥的解析与本测试无关：runner 直接把假的 vendor / model 交给真 streamTextTask。
vi.mock("../textTaskRunner", async () => {
  const { streamTextTask } = await import("./streamTextTask");
  return {
    runTextTaskStream: (_payload: unknown, opts: { onDelta?: (delta: string) => void; abortSignal?: AbortSignal }) =>
      streamTextTask({ vendor: {} as never, model: {} as never, apiKey: "k", prompt: "写点什么" }, opts),
  };
});

import { registerTextStreamIpc } from "./textStreamIpc";

const owner = Object.assign(new EventEmitter(), { id: 1, isDestroyed: () => false }) as Sender;

async function start(): Promise<string> {
  const reply = (await mocks.handlers.get("nomi:tasks:text:stream")!({ sender: owner }, { prompt: "hi" })) as { streamId: string };
  return reply.streamId;
}

describe("文本流取消（主进程）", () => {
  beforeEach(() => {
    mocks.handlers.clear();
    mocks.sent.length = 0;
    mocks.providerSignal = undefined;
    mocks.mode = "endless";
    registerTextStreamIpc();
  });

  it("点停止：供应商那一侧的 abortSignal 真的触发，事件里有过 delta 但没有 done", async () => {
    const streamId = await start();
    await vi.waitFor(() => expect(mocks.sent.some((event) => event.type === "delta")).toBe(true));
    const reply = await mocks.handlers.get("nomi:tasks:text:cancel")!({ sender: owner }, { streamId });
    expect(reply).toEqual({ ok: true });
    await vi.waitFor(() => expect(mocks.providerSignal?.aborted).toBe(true));
    // 给被掐断的流一点时间收尾，再确认它没有补发成功事件。
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(mocks.sent.filter((event) => event.type === "done")).toEqual([]);
    expect(mocks.sent.filter((event) => event.type === "error")).toEqual([]);
  });

  it("没点停止的流照常发 done（不误伤）", async () => {
    mocks.mode = "finite";
    await start();
    await vi.waitFor(() => expect(mocks.sent.some((event) => event.type === "done")).toBe(true));
    expect(mocks.providerSignal?.aborted).toBe(false);
  });
});
