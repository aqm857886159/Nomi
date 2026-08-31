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
// importLocalFile 已抽到独立资产模块（runtime 巨壳减负）——在这桩，避免触真 writeAsset 落盘。
vi.mock("./assets/localFileImport", () => ({
  importLocalFile: vi.fn(async () => ({ id: "asset-1", name: "tts.wav", data: { url: "nomi-local://asset/p/tts.wav" } })),
}));

import { runAudioTask } from "./audioTaskRunner";
import { importLocalFile } from "./assets/localFileImport";
import { buildProfileHttpRequest } from "./catalog/profileHttpRequest";
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

    expect(vi.mocked(importLocalFile)).toHaveBeenCalledWith(expect.objectContaining({
      contentType: "audio/mpeg",
      fileName: "tts-t-binary.mp3",
    }));
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
    const saved = vi.mocked(importLocalFile).mock.calls.at(-1)?.[0];
    expect(saved).toMatchObject({ contentType: "audio/mpeg", fileName: "tts-t-hex.mp3" });
    expect(Buffer.from((saved as { bytes: ArrayBuffer }).bytes)).toEqual(Buffer.from("52494646", "hex"));
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

  it("Whisper 无音频来源 → 明确提示需先连音频", async () => {
    await expect(runAudioTask({
      vendor, model: whisperModel, apiKey: "k",
      request: { kind: "transcribe", prompt: "", extras: {} } as never,
      kind: "transcribe", taskId: "t4", projectId: "p", nodeId: "n", mapping: null,
    })).rejects.toThrow(/未提供音频/);
  });
});
