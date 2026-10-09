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
