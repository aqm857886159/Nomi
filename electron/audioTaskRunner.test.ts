import { describe, it, expect, vi, afterEach } from "vitest";

// 隔离 runtime（重 electron 依赖）：只桩 audioTaskRunner 用到的两个出口。
vi.mock("./runtime", () => ({
  buildProfileHttpRequest: vi.fn(() => ({
    method: "POST",
    url: "https://api.apimart.ai/v1/audio/speech",
    headers: { Authorization: "Bearer k", "Content-Type": "application/json" },
    query: {},
    body: { model: "gpt-4o-mini-tts", input: "hi", voice: "alloy", response_format: "wav", speed: 1 },
    preview: {},
  })),
  importLocalFile: vi.fn(async () => ({ id: "asset-1", name: "tts.wav", data: { url: "nomi-local://asset/p/tts.wav" } })),
}));

import { runAudioTask } from "./audioTaskRunner";
import type { Model, Vendor } from "./catalog/types";

const vendor = { key: "apimart", name: "APIMart", enabled: true, baseUrlHint: "https://api.apimart.ai", authType: "bearer", authHeader: "Authorization", createdAt: "", updatedAt: "" } as Vendor;
const ttsModel = { modelKey: "gpt-4o-mini-tts", vendorKey: "apimart", labelZh: "TTS", kind: "audio", enabled: true, createdAt: "", updatedAt: "" } as Model;
const whisperModel = { modelKey: "whisper-1", vendorKey: "apimart", labelZh: "Whisper", kind: "audio", enabled: true, createdAt: "", updatedAt: "" } as Model;

describe("runAudioTask（音频同步执行路径）", () => {
  afterEach(() => vi.unstubAllGlobals());

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

  it("Whisper 无音频来源 → 明确提示需先连音频", async () => {
    await expect(runAudioTask({
      vendor, model: whisperModel, apiKey: "k",
      request: { kind: "transcribe", prompt: "", extras: {} } as never,
      kind: "transcribe", taskId: "t4", projectId: "p", nodeId: "n", mapping: null,
    })).rejects.toThrow(/未提供音频/);
  });
});
