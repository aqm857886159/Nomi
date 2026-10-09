import { describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ read: vi.fn(), stream: vi.fn(), local: vi.fn() }));
vi.mock("./antigravityTask", () => ({ runAntigravityTask: mocks.local }));
vi.mock("../assets/localAssetFile", () => ({ readNomiLocalAsset: mocks.read }));
vi.mock("./vendorLanguageModel", () => ({ buildLanguageModelForVendor: () => ({}) }));
vi.mock("ai", () => ({ streamText: mocks.stream }));
import { streamTextTask } from "./streamTextTask";
import type { Model, Vendor } from "../catalog/types";

describe("text task local image input", () => {
  it("routes the official CLI through local text/vision execution, never the HTTP model builder", async () => {
    mocks.stream.mockClear(); mocks.local.mockResolvedValue({ text: "crane", usage: { total_tokens: 12 } });
    const signal = new AbortController().signal; const onDelta = vi.fn();
    const result = await streamTextTask({ vendor: {key:"antigravity-cli"} as Vendor,
      model: {modelKey:"gemini-3.7-flash-low"} as Model, apiKey:"", prompt:"Describe", imageUrl:"nomi-local://asset/image" },
    { abortSignal: signal, onDelta });
    expect(mocks.local).toHaveBeenCalledWith({prompt:"Describe",model:"gemini-3.7-flash-low",imageUrls:["nomi-local://asset/image"],signal,onDelta});
    expect(result.raw).toMatchObject({choices:[{message:{role:"assistant",content:"crane"}}]});
    expect(mocks.stream).not.toHaveBeenCalled();
  });
  it("passes local image bytes to the SDK rather than treating nomi-local as base64", async () => {
    const bytes = Buffer.from([137, 80, 78, 71]);
    mocks.read.mockReturnValue({ bytes, contentType: "image/png" });
    mocks.stream.mockReturnValue({ textStream: (async function* () { yield "red crane"; })(),
      finishReason: Promise.resolve("stop"), reasoning: Promise.resolve(undefined) });
    await streamTextTask({ vendor: {} as Vendor, model: {} as Model, apiKey: "test", prompt: "Describe",
      imageUrl: "nomi-local://asset/project/assets/crane.png" });
    expect(mocks.stream.mock.calls.at(-1)?.[0].messages[0].content[1])
      .toMatchObject({ type: "image", image: bytes, mimeType: "image/png" });
  });
  it("rejects a missing local attachment before starting a request", async () => {
    mocks.read.mockReturnValue(null); mocks.stream.mockClear();
    await expect(streamTextTask({ vendor: {} as Vendor, model: {} as Model, apiKey: "test", prompt: "Describe",
      imageUrl: "nomi-local://asset/project/missing.png" })).rejects.toThrow("Local image");
    expect(mocks.stream).not.toHaveBeenCalled();
  });
});

describe("provider request that never leaves the process", () => {
  // ai@4：fetch 本身抛（网闸拦 / DNS / 断网）时 textStream 静默结束、finishReason 永不 settle，错误只走 onError。
  it("surfaces the onError error instead of hanging on a finishReason that never settles", async () => {
    mocks.stream.mockImplementation((options: { onError: (event: { error: unknown }) => void }) => {
      options.onError({ error: new Error("Test network blocked: blocked.example.com") });
      return { textStream: (async function* () { /* 静默结束 */ })(), finishReason: new Promise(() => undefined), reasoning: new Promise(() => undefined) };
    });
    await expect(streamTextTask({ vendor: {} as Vendor, model: {} as Model, apiKey: "test", prompt: "hi" }))
      .rejects.toThrow("Test network blocked");
  }, 5000);
});

describe("every way a stream ends settles the await", () => {
  const never = () => new Promise<never>(() => undefined);
  const base = { vendor: {} as Vendor, model: {} as Model, apiKey: "test", prompt: "hi" };
  const withTimeout = <T,>(promise: Promise<T>, ms: number) => Promise.race([promise, new Promise<"HUNG">((resolve) => setTimeout(() => resolve("HUNG"), ms))]);

  // 复审 BLOCKER：停止时 SDK 的 finishReason 可能永不 settle，旧实现 abort 之后仍无条件 await 它，主进程任务永久悬挂。
  it("stop before the first token: returns promptly as an AbortError (neither success nor error), even if the SDK never settles anything", async () => {
    mocks.stream.mockImplementation(() => ({ textStream: (async function* () { await never(); yield ""; })(), finishReason: never(), reasoning: never() }));
    const controller = new AbortController();
    const running = streamTextTask(base, { abortSignal: controller.signal }).then(() => "RESOLVED", (error: Error) => error.name);
    setTimeout(() => controller.abort(), 20);
    expect(await withTimeout(running, 1500)).toBe("AbortError");
  }, 5000);

  it("stop after the text ended but metadata never settles: still an AbortError, promptly", async () => {
    mocks.stream.mockImplementation(() => ({ textStream: (async function* () { yield "半截"; })(), finishReason: never(), reasoning: never() }));
    const controller = new AbortController();
    controller.abort();
    expect(await withTimeout(streamTextTask(base, { abortSignal: controller.signal }).then(() => "RESOLVED", (error: Error) => error.name), 1500)).toBe("AbortError");
  }, 5000);

  it("a clean finish whose metadata never settles still returns the text (metadata is best-effort)", async () => {
    mocks.stream.mockImplementation(() => ({ textStream: (async function* () { yield "完整文本"; })(), finishReason: never(), reasoning: never() }));
    const result = await withTimeout(streamTextTask(base), 4000);
    expect(result).toMatchObject({ text: "完整文本" });
  }, 6000);
});
