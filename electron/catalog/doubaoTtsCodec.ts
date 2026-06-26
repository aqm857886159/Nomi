// 豆包语音 2.0 unidirectional 的纯编解码逻辑（无 electron/IO 依赖 → 可在纯 Node 单测直接 import，
// 不触发 electron 加载，仿 vendorEndpoint.ts 抽出动机）。audioTaskRunner 的手搓分支调用这里。

export type DoubaoReqParams = {
  text: string;
  speaker: string;
  audio_params: { format: string; sample_rate: number };
  additions?: string;
};

/** 凭证 APP_ID:ACCESS_KEY → [appId, accessKey]。格式不对抛错（不静默发空头被 vendor 401 误导）。 */
export function splitDoubaoCredential(apiKey: string): [string, string] {
  const idx = (apiKey || "").indexOf(":");
  const appId = idx > 0 ? apiKey.slice(0, idx).trim() : "";
  const accessKey = idx > 0 ? apiKey.slice(idx + 1).trim() : "";
  if (!appId || !accessKey) {
    throw new Error("配音生成失败：豆包语音凭证格式应为 APP_ID:ACCESS_KEY（在火山「语音技术」控制台获取后用冒号拼接填入）");
  }
  return [appId, accessKey];
}

/**
 * 组装 req_params。情感经 JSON.stringify 安全转义后落 additions（豆包要求 additions 是序列化字符串，
 * 非对象）——用户情感文本含引号也不会破坏外层 JSON。emotion 留空 → 不带 additions（按音色默认朗读）。
 */
export function buildDoubaoReqParams(input: { text: string; voice: string; emotion?: string }): DoubaoReqParams {
  const params: DoubaoReqParams = {
    text: input.text,
    speaker: input.voice,
    audio_params: { format: "mp3", sample_rate: 24000 },
  };
  const emotion = (input.emotion || "").trim();
  if (emotion) params.additions = JSON.stringify({ context_texts: [emotion] });
  return params;
}

/**
 * 解码 unidirectional 的 NDJSON 响应为音频字节。逐行 JSON.parse：
 *   code===0 且 data 为 base64 → 累加；code===20000000 → 收尾；其余非 0 code → 抛错（带 message）。
 * 空行 / 非 JSON 行跳过。
 */
export function decodeDoubaoNdjsonAudio(ndjson: string): Buffer {
  const chunks: Buffer[] = [];
  for (const line of String(ndjson || "").split("\n")) {
    const t = line.trim();
    if (!t) continue;
    let obj: unknown;
    try { obj = JSON.parse(t); } catch { continue; }
    if (typeof obj !== "object" || obj === null) continue;
    const rec = obj as { code?: unknown; data?: unknown; message?: unknown };
    if (rec.code === 20000000) break;
    if (rec.code === 0) {
      if (typeof rec.data === "string" && rec.data) chunks.push(Buffer.from(rec.data, "base64"));
    } else if (typeof rec.code === "number") {
      const msg = typeof rec.message === "string" && rec.message ? rec.message : "(无详情)";
      throw new Error(`配音生成失败（豆包语音错误 ${rec.code}）：${msg}`);
    }
  }
  return Buffer.concat(chunks);
}
