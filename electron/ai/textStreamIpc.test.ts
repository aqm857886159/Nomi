// 回归：文本流正常结束后必须解绑挂在 sender 上的 once("destroyed") 监听。
// 旧实现每个流挂一个 once，只在 webContents 销毁时才释放——正常结束的流把监听器和
// 闭包引用的 session/abortController 留在 sender 上累积（MaxListeners 警告一族）。
import { EventEmitter } from "node:events";
import { beforeEach, describe, expect, it, vi } from "vitest";

type Sender = EventEmitter & { id: number; isDestroyed: () => boolean };
type Handler = (event: { sender: Sender }, payload?: unknown) => unknown;
const mocks = vi.hoisted(() => ({
  handlers: new Map<string, Handler>(),
  guard: vi.fn(),
  runTextTaskStream: vi.fn(),
  fromId: vi.fn(),
}));

vi.mock("electron", () => ({
  ipcMain: { handle: (name: string, fn: Handler) => mocks.handlers.set(name, fn) },
  webContents: { fromId: (id: number) => mocks.fromId(id) },
}));
vi.mock("../ipcSenderGuard", () => ({ assertTrustedSender: mocks.guard }));
vi.mock("../textTaskRunner", () => ({ runTextTaskStream: (...args: unknown[]) => mocks.runTextTaskStream(...args) }));

import { registerTextStreamIpc } from "./textStreamIpc";

const sender = (id: number): Sender =>
  Object.assign(new EventEmitter(), { id, isDestroyed: () => false });

async function startStream(owner: Sender): Promise<string> {
  const reply = (await mocks.handlers.get("nomi:tasks:text:stream")!({ sender: owner }, { prompt: "hi" })) as { streamId: string };
  return reply.streamId;
}

describe("textStreamIpc destroyed listener lifecycle", () => {
  beforeEach(() => {
    mocks.handlers.clear();
    mocks.guard.mockReset();
    mocks.runTextTaskStream.mockReset();
    mocks.runTextTaskStream.mockResolvedValue({ status: "succeeded", assets: [] });
    mocks.fromId.mockReturnValue(undefined);
    registerTextStreamIpc();
  });

  it("正常结束的流把 sender 上的 destroyed 监听解绑（不随会话数累积）", async () => {
    const owner = sender(7);
    await startStream(owner);
    await vi.waitFor(() => expect(mocks.runTextTaskStream).toHaveBeenCalledOnce());
    // 流结束（finally 已跑）：sender 上不该残留本流的 destroyed 监听。
    await vi.waitFor(() => expect(owner.listenerCount("destroyed")).toBe(0));
  });

  it("连开 N 个流全部结束后，destroyed 监听数归零（修复前线性累积）", async () => {
    const owner = sender(8);
    for (let i = 0; i < 5; i += 1) await startStream(owner);
    await vi.waitFor(() => expect(mocks.runTextTaskStream).toHaveBeenCalledTimes(5));
    await vi.waitFor(() => expect(owner.listenerCount("destroyed")).toBe(0));
  });

  it("sender 真销毁时仍能中止会话（解绑不改变销毁路径语义）", async () => {
    const owner = sender(9);
    const abortSpy = vi.fn();
    mocks.runTextTaskStream.mockImplementation((_payload: unknown, opts: { abortSignal: AbortSignal }) => {
      opts.abortSignal.addEventListener("abort", abortSpy);
      return new Promise(() => {});
    });
    await startStream(owner);
    await vi.waitFor(() => expect(mocks.runTextTaskStream).toHaveBeenCalledOnce());
    owner.emit("destroyed");
    expect(abortSpy).toHaveBeenCalledOnce();
  });
});
