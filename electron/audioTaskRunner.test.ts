import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("./catalog/profileHttpRequest", async (importOriginal) => ({
  ...await importOriginal<typeof import("./catalog/profileHttpRequest")>(),
  buildProfileHttpRequest: vi.fn(() => ({
    method: "POST",
    url: "https://api.apimart.ai/v1/audio/speech",
    headers: { Authorization: "Bearer k", "Content-Type": "application/json" },
    query: {},
    body: { model: "gpt-4o-mini-tts", input: "hi", voice: "alloy", response_format: "wav", speed: 1 },
    preview: {},
  })),
}));
// 这里只核请求形状与解码；字节进项目走真落盘关口的那一面在 tasks/syncBytesResultLandsInProject.test.ts
// （2026-11-07：这里曾桩掉整个资产库，漏了期望类型的落盘失败在单测里一直是绿的）。这里只钉一件事：
// 配音字节走生成产物的门，且说清「该是音频」。
vi.mock("./assets/projectAssetStore", async (importOriginal) => ({
  ...await importOriginal<typeof import("./assets/projectAssetStore")>(),
  writeGeneratedAsset: vi.fn(async () => ({ id: "asset-1", name: "tts.wav", data: { url: "nomi-local://asset/p/tts.wav" } })),
}));
import { runAudioTask } from "./audioTaskRunner";
import { writeGeneratedAsset } from "./assets/projectAssetStore";
import { buildProfileHttpRequest } from "./catalog/profileHttpRequest";
import { ELEVENLABS_MODELS } from "./catalog/elevenlabs";
import type { Model, Vendor } from "./catalog/types";

const vendor = { key: "apimart", name: "APIMart", enabled: true, baseUrlHint: "https://api.apimart.ai", authType: "bearer", authHeader: "Authorization", createdAt: "", updatedAt: "" } as Vendor;
const ttsModel = { modelKey: "gpt-4o-mini-tts", vendorKey: "apimart", labelZh: "TTS", kind: "audio", enabled: true, createdAt: "", updatedAt: "" } as Model;
const whisperModel = { modelKey: "whisper-1", vendorKey: "apimart", labelZh: "Whisper", kind: "audio", enabled: true, createdAt: "", updatedAt: "" } as Model;

describe("runAudioTask（音频同步执行路径）", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("TTS：二进制响应 → 落成 audio 资产（type=audio + nomi-local url）", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new Uint8Array([1, 2, 3, 4]).buffer, { status: 200 })));
    const result = await runAudioTask({
      vendor, model: ttsModel, apiKey: "k",
      request: { kind: "text_to_audio", prompt: "海风轻拂", extras: { voice: "alloy", speed: 1 } } as never,
      kind: "text_to_audio", taskId: "t1", projectId: "p", nodeId: "n", mapping: null,
    });
    expect(result.status).toBe("succeeded");
    expect(result.assets).toHaveLength(1);
    expect(result.assets[0].type).toBe("audio");
    expect(result.assets[0].url).toContain("nomi-local://");
  });

  it("Whisper：multipart → 同步 JSON 文本（无资产，raw.text 落文本）", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ text: "你好世界", segments: [] }), { status: 200, headers: { "Content-Type": "application/json" } })));
    const result = await runAudioTask({
      vendor, model: whisperModel, apiKey: "k",
      request: { kind: "transcribe", prompt: "", extras: { archetypeInput: { file: "data:audio/wav;base64,AAAA" }, language: "zh" } } as never,
      kind: "transcribe", taskId: "t2", projectId: "p", nodeId: "n", mapping: null,
    });
    expect(result.status).toBe("succeeded");
    expect(result.assets).toHaveLength(0);
    expect((result.raw as { text?: string }).text).toBe("你好世界");
  });

  it("TTS 空音频 → 明确报错（不静默落空资产）", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new ArrayBuffer(0), { status: 200 })));
    await expect(runAudioTask({
      vendor, model: ttsModel, apiKey: "k",
      request: { kind: "text_to_audio", prompt: "hi", extras: {} } as never,
      kind: "text_to_audio", taskId: "t3", projectId: "p", nodeId: "n", mapping: null,
    })).rejects.toThrow(/空音频/);
  });

  it("声明的 binary MIME/extension 覆盖 body 推断（ElevenLabs output_format 在 query）", async () => {
    vi.mocked(buildProfileHttpRequest).mockReturnValueOnce({
      method: "POST",
      url: "https://api.elevenlabs.io/v1/text-to-speech/voice-1",
      headers: { "xi-api-key": "k" },
      query: { output_format: "mp3_44100_128" },
      body: { text: "hi", model_id: "eleven_v3" },
      preview: {},
    });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new Uint8Array([1, 2, 3]).buffer, { status: 200 })));

    await runAudioTask({
      vendor, model: ttsModel, apiKey: "k",
      request: { kind: "text_to_audio", prompt: "hi", extras: {} } as never,
      kind: "text_to_audio", taskId: "t-binary", projectId: "p", nodeId: "n",
      mapping: { create: { method: "POST", path: "/v1/text-to-speech/voice-1", audioResponse: { type: "binary", contentType: "audio/mpeg", extension: "mp3" } } } as never,
    });

    expect(vi.mocked(writeGeneratedAsset)).toHaveBeenCalledWith(
      "p", expect.anything(), "tts-t-binary.mp3", "audio/mpeg", expect.objectContaining({ kind: "generated" }), "audio",
    );
  });

  it("豆包 NDJSON：响应经统一 vendorHttp 出口读体（限 30MB 上限）", async () => {
    const ndjson = [
      JSON.stringify({ code: 0, data: Buffer.from("ID3fake-mp3-bytes").toString("base64") }),
      JSON.stringify({ code: 20000000 }),
    ].join("\n");
    const fetchSpy = vi.fn(async () => new Response(ndjson, { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchSpy);
    const doubaoVendor = { ...vendor, key: "volcengine", baseUrlHint: "https://openspeech.bytedance.com" } as Vendor;
    const result = await runAudioTask({
      vendor: doubaoVendor, model: ttsModel, apiKey: "app-1:secret-key",
      request: { kind: "text_to_audio", prompt: "你好", extras: { voice: "zh_female" } } as never,
      kind: "text_to_audio", taskId: "t-doubao", projectId: "p", nodeId: "n",
      mapping: { create: { method: "POST", path: "/api/v3/tts/unidirectional", audioResponse: "ndjson-base64" } } as never,
    });

    expect(fetchSpy).toHaveBeenCalledWith("https://openspeech.bytedance.com/api/v3/tts/unidirectional", expect.objectContaining({
      method: "POST",
      dispatcher: expect.anything(),
    }));
    expect(result.status).toBe("succeeded");
    expect(result.assets[0].type).toBe("audio");
    expect(result.assets[0].url).toContain("nomi-local://");
  });

  it("豆包 NDJSON：非 2xx 用响应体拼错误详情（保持原 httpError 语义）", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ code: 45000001, message: "quota exhausted" }), {
      status: 429, headers: { "content-type": "application/json" },
    })));
    const doubaoVendor = { ...vendor, key: "volcengine", baseUrlHint: "https://openspeech.bytedance.com" } as Vendor;
    await expect(runAudioTask({
      vendor: doubaoVendor, model: ttsModel, apiKey: "app-1:secret-key",
      request: { kind: "text_to_audio", prompt: "你好", extras: { voice: "zh_female" } } as never,
      kind: "text_to_audio", taskId: "t-doubao-err", projectId: "p", nodeId: "n",
      mapping: { create: { method: "POST", path: "/api/v3/tts/unidirectional", audioResponse: "ndjson-base64" } } as never,
    })).rejects.toThrow(/429/);
  });

  it("声明的 JSON hex 音频按路径解码后落盘（MiniMax speech）", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ data: { audio: "52494646" } }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })));

    const result = await runAudioTask({
      vendor, model: ttsModel, apiKey: "k",
      request: { kind: "text_to_audio", prompt: "hi", extras: {} } as never,
      kind: "text_to_audio", taskId: "t-hex", projectId: "p", nodeId: "n",
      mapping: { create: { method: "POST", path: "/v1/t2a_v2", audioResponse: { type: "json", dataPath: "data.audio", encoding: "hex", contentType: "audio/mpeg", extension: "mp3" } } } as never,
    });

    expect(result.status).toBe("succeeded");
    const [, bytes, fileName, contentType, , expectedKind] = vi.mocked(writeGeneratedAsset).mock.calls.at(-1)!;
    expect({ fileName, contentType, expectedKind }).toEqual({ fileName: "tts-t-hex.mp3", contentType: "audio/mpeg", expectedKind: "audio" });
    expect(Buffer.from(bytes)).toEqual(Buffer.from("52494646", "hex"));
  });

  it("转写 multipart 字段完全由 mapping 声明（ElevenLabs model_id/language_code）", async () => {
    let posted: FormData | null = null;
    vi.stubGlobal("fetch", vi.fn(async (_url, init) => {
      posted = init?.body as FormData;
      return new Response(JSON.stringify({ text: "hello" }), { status: 200, headers: { "Content-Type": "application/json" } });
    }));

    await runAudioTask({
      vendor, model: whisperModel, apiKey: "k",
      request: { kind: "transcribe", prompt: "", extras: { archetypeInput: { file: "data:audio/wav;base64,AAAA" }, language_code: "en" } } as never,
      kind: "transcribe", taskId: "t-eleven-stt", projectId: "p", nodeId: "n",
      mapping: { create: {
        method: "POST",
        path: "/v1/speech-to-text",
        multipart: {
          fields: { model_id: "scribe_v2", language_code: "{{request.params.language_code}}" },
          fileField: "file",
          fileSource: "{{request.params.file}}",
          fileKind: "audio",
        },
        response_mapping: { text: "text" },
      } } as never,
    });

    expect(posted).not.toBeNull();
    const entries = [...posted!.entries()];
    expect(entries.find(([key]) => key === "model_id")?.[1]).toBe("scribe_v2");
    expect(entries.find(([key]) => key === "language_code")?.[1]).toBe("en");
    expect(entries.find(([key]) => key === "file")?.[1]).toBeInstanceOf(File);
    expect(entries.some(([key]) => key === "model")).toBe(false);
  });

  // 2026-10-19：真实种子里 Scribe 的 fileSource 写的是 reference_audio_urls，拆解传的是 file——同一段音频
  // 在 APIMart 能传、换 ElevenLabs 就「缺少待上传媒体」；Scribe 只回逐词时间戳，拆解读不到 segments，对白整列空。
  // 用**真实种子** mapping（不是手写夹具），两种调用方各跑一遍。
  it.each([
    ["拆解（file）", { file: "data:audio/wav;base64,AAAA" }],
    ["音频节点（reference_audio_urls）", { referenceAudioUrls: ["data:audio/wav;base64,AAAA"] }],
  ])("Scribe 真实种子 mapping：%s 都传得上音频，逐词响应出口带 segments", async (_label, extras) => {
    const scribe = ELEVENLABS_MODELS.find((model) => model.modelKey === "scribe_v2")!.mappings[0];
    let posted: FormData | null = null;
    vi.stubGlobal("fetch", vi.fn(async (_url, init) => {
      posted = init?.body as FormData;
      return new Response(JSON.stringify({
        language_code: "zho", text: "你好。Hi.",
        words: [
          { text: "你好。", start: 0, end: 0.5, type: "word", speaker_id: "speaker_0", logprob: 0 },
          { text: " ", start: 0.5, end: 0.5, type: "spacing", speaker_id: "speaker_0", logprob: 0 },
          { text: "Hi.", start: 1.6, end: 1.9, type: "word", speaker_id: "speaker_0", logprob: 0 },
        ],
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }));
    const result = await runAudioTask({
      vendor, model: { ...whisperModel, vendorKey: "elevenlabs", modelKey: "scribe_v2" } as Model, apiKey: "k",
      request: { kind: "transcribe", prompt: "", extras } as never,
      kind: "transcribe", taskId: "t-scribe", projectId: "p", nodeId: "n",
      mapping: { create: scribe.create } as never,
    });
    expect([...posted!.entries()].find(([key]) => key === "file")?.[1]).toBeInstanceOf(File);
    expect((result.raw as { segments?: unknown }).segments).toEqual([
      { start: 0, end: 0.5, text: "你好。" },
      { start: 1.6, end: 1.9, text: "Hi." },
    ]);
  });

  it("Whisper 无音频来源 → 明确提示需先连音频", async () => {
    await expect(runAudioTask({
      vendor, model: whisperModel, apiKey: "k",
      request: { kind: "transcribe", prompt: "", extras: {} } as never,
      kind: "transcribe", taskId: "t4", projectId: "p", nodeId: "n", mapping: null,
    })).rejects.toThrow(/未提供音频/);
  });
});
