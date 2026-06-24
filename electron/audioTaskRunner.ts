// 音频任务执行引擎（从 runtime 抽出 —— 规则 12 巨壳门岗；音频自成一单元，与 textTaskRunner 同构）。
//
// 为什么单独成路：图像/视频是 async create→poll；这两个音频端点是 **OpenAI 兼容同步** 调用，
// 形状根本不同，套不进 requestJson（它只解析 JSON、不读二进制、不建 multipart）：
//   TTS      POST /v1/audio/speech         JSON body → **二进制音频字节** → 存盘换 nomi-local audio 资产
//   Whisper  POST /v1/audio/transcriptions multipart  → 同步 JSON { text, segments } → 文本结果（无资产）
// runtime.runTask 识别 wantedKind==='audio' → 转交本模块，不进 admit/poll（响应即结果）。
//
// 回引 runtime 的 buildProfileHttpRequest/importLocalFile（同 textTaskRunner 既定模式：函数体内调用，
// CommonJS 运行期循环引用安全）。请求形状仍由 catalog mapping 的 create op 驱动（vendor 无关）。

import { readNomiLocalAsset } from "./assets/localAssetFile";
import { parseDataUrl } from "./assets/assetBytes";
import { hardenedFetch } from "./hardenedFetch";
import { type AuthType, authHeaders as buildAuthHeaders } from "./ai/requestPipeline";
import { firstString, isJsonRecord, trim, type JsonRecord } from "./jsonUtils";
import { taskTemplateParams } from "./catalog/taskParams";
import { buildDoubaoReqParams, decodeDoubaoNdjsonAudio, splitDoubaoCredential } from "./catalog/doubaoTtsCodec";
import { buildProfileHttpRequest, type TaskRequest, type TaskResult } from "./runtime";
import { importLocalFile } from "./assets/localFileImport";
import type { HttpOperation, Mapping, Model, ProfileKind, Vendor } from "./catalog/types";

const TTS_PATH = "/v1/audio/speech";
const TRANSCRIBE_PATH = "/v1/audio/transcriptions";
const MAX_AUDIO_BYTES = 30 * 1024 * 1024; // Whisper 侧上限 25MB，留余量

// response_format → MIME（落盘扩展名 + <audio> 播放）。wav 默认（未压缩、Chromium 必播）。
const AUDIO_CONTENT_TYPE: Record<string, string> = {
  wav: "audio/wav", mp3: "audio/mpeg", opus: "audio/ogg", aac: "audio/aac", flac: "audio/flac", pcm: "audio/L16",
};

type AudioTaskInput = {
  vendor: Vendor;
  model: Model;
  apiKey: string;
  request: TaskRequest;
  kind: ProfileKind;
  taskId: string;
  projectId: string;
  nodeId: string;
  mapping: Mapping | null;
};

export async function runAudioTask(input: AudioTaskInput): Promise<TaskResult> {
  if (input.kind === "transcribe") return runTranscribe(input);
  return runTextToSpeech(input);
}

// TTS：mapping.create 渲染出 JSON 请求 → fetch 读 arrayBuffer → importLocalFile 落盘 → audio 资产。
async function runTextToSpeech(input: AudioTaskInput): Promise<TaskResult> {
  const { vendor, model, apiKey, request, kind, taskId, projectId } = input;
  const op: HttpOperation = input.mapping?.create ?? {
    method: "POST",
    path: TTS_PATH,
    headers: { Authorization: "Bearer {{user_api_key}}", "Content-Type": "application/json" },
    body: { model: "{{request.params.model}}", input: "{{request.prompt}}", voice: "{{request.params.voice}}", response_format: "wav", speed: "{{request.params.speed}}" },
  };
  // 声明驱动分流（P4）：NDJSON+base64 形状（豆包语音 unidirectional）走专属手搓分支，
  // 其余（缺省/binary，OpenAI 兼容裸音频字节）走下方通用路径。
  if (op.audioResponse === "ndjson-base64") return runDoubaoUnidirectionalTts(input, op);
  const built = buildProfileHttpRequest({ vendor, model, apiKey, request, operation: op });
  let response: Response;
  try {
    response = await fetch(built.url, {
      method: built.method.toUpperCase(),
      headers: built.headers,
      body: typeof built.body === "string" ? built.body : JSON.stringify(built.body),
    });
  } catch (error: unknown) {
    throw new Error(`配音生成失败（${vendor.key} 网络错误）：${(error instanceof Error ? error.message : String(error)).slice(0, 256)}`, { cause: error });
  }
  if (!response.ok) {
    throw new Error(`配音生成失败（${vendor.key} HTTP ${response.status}）：${(await safeText(response)).slice(0, 300) || "(无详情)"}`);
  }
  const arrayBuffer = await response.arrayBuffer();
  if (!arrayBuffer || arrayBuffer.byteLength === 0) throw new Error("配音生成失败：供应商返回空音频");
  const fmt = firstString((isJsonRecord(built.body) ? built.body.response_format : undefined)) || "wav";
  const contentType = AUDIO_CONTENT_TYPE[fmt] || "audio/wav";
  const saved = (await importLocalFile({
    projectId, bytes: arrayBuffer, contentType, fileName: `tts-${taskId}.${fmt}`, kind: "generated",
  })) as { id?: string; name?: string; data?: { url?: string } };
  const url = String(saved.data?.url || "");
  if (!url) throw new Error("配音生成失败：音频落盘异常");
  return {
    id: taskId, kind, status: "succeeded",
    assets: [{ type: "audio", url, thumbnailUrl: null, assetId: saved.id || null, assetName: saved.name || null }],
    raw: { audio_url: url, response_format: fmt },
  };
}

// 豆包语音 2.0 配音（火山原生 unidirectional）。OpenAI 兼容套不进，故手搓（先例：runTranscribe 手搓 multipart）：
//   三头鉴权（凭证存 APP_ID:ACCESS_KEY，此处 split）+ 嵌套 req_params body（additions 情感安全 JSON 转义）
//   → fetch → NDJSON+base64 解码（decodeDoubaoNdjsonAudio）→ 落盘 mp3 资产。
async function runDoubaoUnidirectionalTts(input: AudioTaskInput, op: HttpOperation): Promise<TaskResult> {
  const { vendor, apiKey, request, kind, taskId, projectId } = input;
  const params = taskTemplateParams(request);
  const text = trim(request.prompt) || firstString(params.text);
  if (!text) throw new Error("配音生成失败：没有台词文本");
  const voice = firstString(params.voice);
  if (!voice) throw new Error("配音生成失败：未选择音色");
  const emotion = firstString(params.emotion);
  const [appId, accessKey] = splitDoubaoCredential(apiKey);
  const resourceId = firstString(op.headers?.["X-Api-Resource-Id"]) || "seed-tts-2.0";

  const baseUrl = trim(vendor.baseUrlHint).replace(/\/$/, "");
  const path = op.path || "/api/v3/tts/unidirectional";
  const url = /^https?:/i.test(path) ? path : `${baseUrl}${path}`;

  const reqParams = buildDoubaoReqParams({ text, voice, emotion });
  const body = JSON.stringify({ user: { uid: "nomi" }, req_params: reqParams });

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Api-App-Id": appId,
        "X-Api-Access-Key": accessKey,
        "X-Api-Resource-Id": resourceId,
      },
      body,
    });
  } catch (error: unknown) {
    throw new Error(`配音生成失败（${vendor.key} 网络错误）：${(error instanceof Error ? error.message : String(error)).slice(0, 256)}`, { cause: error });
  }
  if (!response.ok) {
    throw new Error(`配音生成失败（${vendor.key} HTTP ${response.status}）：${(await safeText(response)).slice(0, 300) || "(无详情)"}`);
  }
  const audio = decodeDoubaoNdjsonAudio(await response.text());
  if (audio.byteLength === 0) throw new Error("配音生成失败：供应商返回空音频");
  const ab = audio.buffer.slice(audio.byteOffset, audio.byteOffset + audio.byteLength) as ArrayBuffer;
  const saved = (await importLocalFile({
    projectId, bytes: ab, contentType: "audio/mpeg", fileName: `tts-${taskId}.mp3`, kind: "generated",
  })) as { id?: string; name?: string; data?: { url?: string } };
  const url2 = String(saved.data?.url || "");
  if (!url2) throw new Error("配音生成失败：音频落盘异常");
  return {
    id: taskId, kind, status: "succeeded",
    assets: [{ type: "audio", url: url2, thumbnailUrl: null, assetId: saved.id || null, assetName: saved.name || null }],
    raw: { audio_url: url2, response_format: "mp3" },
  };
}

// Whisper：读参考音频字节 → multipart(file+model+language+response_format) → 同步 JSON → 文本结果。
async function runTranscribe(input: AudioTaskInput): Promise<TaskResult> {
  const { vendor, model, apiKey, request, kind, taskId } = input;
  const params = taskTemplateParams(request);
  const audioUrl = resolveAudioSource(request, params);
  if (!audioUrl) throw new Error("转写失败：未提供音频（请先连接或上传一个音频）");
  const audio = await readAudioBytes(audioUrl);
  const baseUrl = trim(vendor.baseUrlHint).replace(/\/$/, "");
  const opPath = input.mapping?.create?.path || TRANSCRIBE_PATH;
  const url = /^https?:/i.test(opPath) ? opPath : `${baseUrl}${opPath}`;
  const language = firstString(params.language);

  const form = new FormData();
  const ab = audio.bytes.buffer.slice(audio.bytes.byteOffset, audio.bytes.byteOffset + audio.bytes.byteLength) as ArrayBuffer;
  form.append("file", new Blob([ab], { type: audio.contentType }), audio.fileName);
  // 真实模型名来自档案当前模式的 modelEnum（注入 params.model），catalog 基模型(nomi-audio)只是入口。
  form.append("model", firstString(params.model) || model.modelAlias || model.modelKey);
  if (language) form.append("language", language);
  form.append("response_format", "verbose_json");

  // multipart 不能带 Content-Type（fetch 自动加 boundary）；其余鉴权头按 vendor 声明（通用 bearer）。
  const { "Content-Type": _drop, ...auth } = buildAuthHeaders(vendor.authType as AuthType, apiKey, vendor.authHeader ?? undefined);
  let response: Response;
  try {
    response = await fetch(url, { method: "POST", headers: auth, body: form });
  } catch (error: unknown) {
    throw new Error(`转写失败（${vendor.key} 网络错误）：${(error instanceof Error ? error.message : String(error)).slice(0, 256)}`, { cause: error });
  }
  if (!response.ok) {
    throw new Error(`转写失败（${vendor.key} HTTP ${response.status}）：${(await safeText(response)).slice(0, 300) || "(无详情)"}`);
  }
  const json = await safeJson(response);
  const text = firstString(isJsonRecord(json) ? json.text : undefined);
  if (!text) throw new Error("转写失败：供应商未返回文本");
  return { id: taskId, kind, status: "succeeded", assets: [], raw: json };
}

/** 从请求里找参考音频 URL（whisper 的 file 来源）。档案 input(file/reference_audio_urls) + camelCase 兜底。 */
function resolveAudioSource(request: TaskRequest, params: JsonRecord): string {
  const extras = (request.extras || {}) as JsonRecord;
  const arch = isJsonRecord(extras.archetypeInput) ? extras.archetypeInput : {};
  const arrFirst = (value: unknown): string => (Array.isArray(value) ? firstString(value[0]) : "");
  return firstString(
    params.file, arch.file, arrFirst(arch.reference_audio_urls),
    arrFirst(params.reference_audio_urls), arrFirst(extras.referenceAudioUrls), arrFirst(extras.reference_audio_urls),
  );
}

type AudioBytes = { bytes: Buffer; contentType: string; fileName: string };

async function readAudioBytes(url: string): Promise<AudioBytes> {
  const local = readNomiLocalAsset(url);
  if (local) return { bytes: local.bytes, contentType: local.contentType || "audio/mpeg", fileName: local.fileName || "audio.mp3" };
  if (url.startsWith("data:")) {
    const parsed = parseDataUrl(url);
    return { bytes: parsed.bytes, contentType: parsed.contentType || "audio/mpeg", fileName: `audio.${(parsed.contentType.split("/")[1] || "mp3")}` };
  }
  if (!/^https?:\/\//i.test(url)) throw new Error("转写失败：音频地址无法访问");
  const fetched = await hardenedFetch(url, {
    timeoutMs: 60_000, maxBytes: MAX_AUDIO_BYTES,
    allowContentTypes: ["audio/", "video/", "application/octet-stream"],
  });
  return { bytes: fetched.bytes, contentType: fetched.contentType || "audio/mpeg", fileName: "audio.mp3" };
}

async function safeText(response: Response): Promise<string> {
  try { return await response.text(); } catch { return ""; }
}

async function safeJson(response: Response): Promise<unknown> {
  const text = await safeText(response);
  try { return text ? JSON.parse(text) : null; } catch { return text; }
}
