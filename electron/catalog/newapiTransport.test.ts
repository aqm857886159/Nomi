import { describe, expect, it } from "vitest";
import { newapiTransportFor } from "./newapiTransport";

describe("newapiTransportFor", () => {
  it("audio → OpenAI 兼容 /v1/audio/speech 同步 TTS（mp3 二进制，无 query）", () => {
    const t = newapiTransportFor("audio");
    expect(t.taskKind).toBe("text_to_audio");
    expect(t.create.method).toBe("POST");
    expect(t.create.path).toBe("/v1/audio/speech");
    const body = t.create.body as Record<string, unknown>;
    expect(body.input).toBe("{{request.prompt}}");
    expect(body.response_format).toBe("mp3"); // seed-tts-2.0 回 audio/mpeg；不能默认 wav 否则存错扩展名
    expect(t.create.audioResponse).toBeUndefined(); // 缺省=裸二进制，非火山原生 ndjson-base64
    expect(t.query).toBeUndefined(); // TTS 同步出音频，无轮询
  });

  it("image / video 分支不受影响", () => {
    expect(newapiTransportFor("image").taskKind).toBe("text_to_image");
    expect(newapiTransportFor("video").taskKind).toBe("text_to_video");
  });
});
