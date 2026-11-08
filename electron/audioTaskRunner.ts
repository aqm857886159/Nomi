// 音频任务执行引擎（从 runtime 抽出 —— 规则 12 巨壳门岗；音频自成一单元，与 textTaskRunner 同构）。
//
// 为什么单独成路：图像/视频是 async create→poll；这两个音频端点是 **OpenAI 兼容同步** 调用，
// 形状根本不同，分别走 vendorHttp 的 requestBinary / requestMultipart 包装：
//   TTS      POST /v1/audio/speech         JSON body → **二进制音频字节** → 存盘换 nomi-local audio 资产
//   Whisper  POST /v1/audio/transcriptions multipart  → 同步 JSON { text, segments } → 文本结果（无资产）
// runtime.runTask 识别 wantedKind==='audio' → 转交本模块，不进 admit/poll（响应即结果）。
//
// 请求形状由 catalog mapping 的 create op 驱动（vendor 无关）。配音字节是生成产物，只走生成产物的门
// writeGeneratedAsset（必须说清「该是音频」，落盘关口按字节核）；不走用户导入文件的 importLocalFile——
// 那扇门不收生成产物（2026-11-07：走它漏了期望类型，扣了钱存不进项目）。

import { readNomiLocalAsset } from "./assets/localAssetFile";
import { parseDataUrl } from "./assets/assetBytes";
import { hardenedFetch } from "./hardenedFetch";
import { isRedirectRefusal } from "./networkErrorDetails";
import { firstString, isJsonRecord, trim, type JsonRecord } from "./jsonUtils";
import { taskTemplateParams } from "./catalog/taskParams";
import { buildDoubaoReqParams, decodeDoubaoNdjsonAudio, splitDoubaoCredential } from "./catalog/doubaoTtsCodec";
import type { TaskRequest, TaskResult } from "./runtime";
import { writeGeneratedAsset } from "./assets/projectAssetStore";
import { desktopT } from "./i18n";
import { executeMultipartOperation } from "./catalog/multipartOperation";
import { buildProfileHttpRequest, templateContext } from "./catalog/profileHttpRequest";
import { firstMappedString } from "./tasks/responseParsing";
import type { HttpOperation, Mapping, Model, ProfileKind, Vendor } from "./catalog/types";
import { executeSynchronousAudioOperation } from "./audio/synchronousAudioResponse";
import { withTimedSegments } from "./catalog/transcriptSegments";
import { requestBinary, requestMultipart, VendorRequestError } from "./vendor/vendorHttp";

const TTS_PATH = "/v1/audio/speech";
const TRANSCRIBE_PATH = "/v1/audio/transcriptions";
const MAX_AUDIO_BYTES = 30 * 1024 * 1024; // Whisper 侧上限 25MB，留余量

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

// TTS：mapping.create 渲染出 JSON 请求 → 读回音频字节 → 按生成产物（期望音频）落盘 → audio 资产。
async function runTextToSpeech(input: AudioTaskInput): Promise<TaskResult> {
  const { vendor, model, apiKey, request, kind, taskId } = input;
  const op: HttpOperation = input.mapping?.create ?? {
    method: "POST",
    path: TTS_PATH,
    headers: { Authorization: "Bearer {{user_api_key}}", "Content-Type": "application/json" },
    body: { model: "{{request.params.model}}", input: "{{request.prompt}}", voice: "{{request.params.voice}}", response_format: "wav", speed: "{{request.params.speed}}" },
  };
  // 声明驱动分流（P4）：NDJSON+base64 形状（豆包语音 unidirectional）走专属手搓分支，
  // 其余（缺省/binary，OpenAI 兼容裸音频字节）走下方通用路径。
  if (op.audioResponse === "ndjson-base64") return runDoubaoUnidirectionalTts(input, op);
  const decoded = await executeSynchronousAudioOperation({ vendor, model, apiKey, request, operation: op });
  const saved = await saveGeneratedAudio(input, decoded.bytes, `tts-${taskId}.${decoded.extension}`, decoded.contentType);
  const url = String(saved.data?.url || "");
  if (!url) throw new Error(desktopT("dubbing.diskWriteFailed"));
  return {
    id: taskId, kind, status: "succeeded",
    assets: [{ type: "audio", url, thumbnailUrl: null, assetId: saved.id || null, assetName: saved.name || null }],
    raw: { audio_url: url, response_format: decoded.extension, byte_length: decoded.bytes.byteLength },
  };
}

// 豆包语音 2.0 配音（火山原生 unidirectional）。OpenAI 兼容套不进，故手搓（先例：runTranscribe 手搓 multipart）：
//   三头鉴权（凭证存 APP_ID:ACCESS_KEY，此处 split）+ 嵌套 req_params body（additions 情感安全 JSON 转义）
//   → fetch → NDJSON+base64 解码（decodeDoubaoNdjsonAudio）→ 落盘 mp3 资产。
async function runDoubaoUnidirectionalTts(input: AudioTaskInput, op: HttpOperation): Promise<TaskResult> {
  const { vendor, model, apiKey, request, kind, taskId } = input;
  const params = taskTemplateParams(request, { vendorKey: vendor.key, modelKey: model.modelKey, modelAlias: model.modelAlias, modelMeta: model.meta, operation: op });
  const text = trim(request.prompt) || firstString(params.text);
  if (!text) throw new Error(desktopT("dubbing.noText"));
  const voice = firstString(params.voice);
  if (!voice) throw new Error(desktopT("dubbing.noVoice"));
  const emotion = firstString(params.emotion);
  const [appId, accessKey] = splitDoubaoCredential(apiKey);
  const resourceId = firstString(op.headers?.["X-Api-Resource-Id"]) || "seed-tts-2.0";

  const baseUrl = trim(vendor.baseUrlHint).replace(/\/$/, "");
  const path = op.path || "/api/v3/tts/unidirectional";
  const url = /^https?:/i.test(path) ? path : `${baseUrl}${path}`;

  const reqParams = buildDoubaoReqParams({ text, voice, emotion });
  const body = JSON.stringify({ user: { uid: "nomi" }, req_params: reqParams });

  let audioBytes: Buffer;
  try {
    // 豆包的 NDJSON 只是响应编解码差异，付费 POST 仍必须经过 vendorHttp 的统一出口：
    // 新连接、响应上限、重定向规则和写出证据都由 requestBinary 负责。
    audioBytes = (await requestBinary(
      vendor,
      apiKey,
      "POST",
      url,
      {
        "Content-Type": "application/json",
        "X-Api-App-Id": appId,
        "X-Api-Access-Key": accessKey,
        "X-Api-Resource-Id": resourceId,
      },
      {},
      body,
      undefined,
      { maxResponseBytes: MAX_AUDIO_BYTES },
    )).bytes;
  } catch (error: unknown) {
    if (isRedirectRefusal(error)) throw Object.assign(new Error(desktopT("network.credentialRedirect")), { cause: error });
    if (error instanceof VendorRequestError && error.structured.httpStatus) {
      throw Object.assign(new Error(desktopT("dubbing.httpError", {
        vendor: vendor.key,
        status: error.structured.httpStatus,
        detail: error.structured.upstreamMsg || desktopT("common.noDetail"),
      })), { cause: error });
    }
    throw new Error(desktopT("dubbing.networkError", { vendor: vendor.key, detail: (error instanceof Error ? error.message : String(error)).slice(0, 256) }));
  }
  const audio = decodeDoubaoNdjsonAudio(audioBytes.toString("utf8"));
  if (audio.byteLength === 0) throw new Error(desktopT("dubbing.emptyAudio"));
  const saved = await saveGeneratedAudio(input, audio, `tts-${taskId}.mp3`, "audio/mpeg");
  const url2 = String(saved.data?.url || "");
  if (!url2) throw new Error(desktopT("dubbing.diskWriteFailed"));
  return {
    id: taskId, kind, status: "succeeded",
    assets: [{ type: "audio", url: url2, thumbnailUrl: null, assetId: saved.id || null, assetName: saved.name || null }],
    raw: { audio_url: url2, response_format: "mp3" },
  };
}

type SavedAudio = { id?: string; name?: string; data?: { url?: string } };

/** 配音 / 音乐 / 音效的字节进项目只有这一处：生成产物、期望音频（runtime 已在发请求前保证有项目号）。 */
async function saveGeneratedAudio(input: AudioTaskInput, bytes: Uint8Array, fileName: string, contentType: string): Promise<SavedAudio> {
  return await writeGeneratedAsset(input.projectId, bytes, fileName, contentType, {
    kind: "generated", source: "provider", ownerNodeId: input.nodeId || null,
  }, "audio") as SavedAudio;
}

// Whisper：读参考音频字节 → multipart(file+model+language+response_format) → 同步 JSON → 文本结果。
async function runTranscribe(input: AudioTaskInput): Promise<TaskResult> {
  const { vendor, model, apiKey, request, kind, taskId } = input;
  const params = taskTemplateParams(request, { vendorKey: vendor.key, modelKey: model.modelKey, modelAlias: model.modelAlias, modelMeta: model.meta, operation: input.mapping?.create });
  const audioUrl = resolveAudioSource(request, params);
  if (!audioUrl) throw new Error(desktopT("transcribe.noAudio"));

  // 声明驱动分流（P4，与上面 TTS 按 `audioResponse` 分流、runtime 按 `process` 分流同一手法）：
  // create op 声明了 `localEngine` = 这条 mapping 由本机 sidecar 执行，不发 HTTP。
  // 出来的 raw 与云端 verbose_json 同形状，所以下面那段结果处理（以及拆解侧读 raw.segments）
  // 对两条路一视同仁——**不新造第二个「转写结果」概念**（P1）。
  const localEngine = input.mapping?.create?.localEngine;
  if (localEngine) {
    const { runLocalSpeechTranscription } = await import("./localSpeech/localSpeechTaskBridge");
    const raw = await runLocalSpeechTranscription({
      audioUrl,
      requestedTier: params[localEngine.tierParam],
      progressKey: trim(request.extras?.nodeId),
    });
    return { id: taskId, kind, status: "succeeded", assets: [], raw: raw as unknown as JsonRecord };
  }

  const audio = await readAudioBytes(audioUrl);
  const language = firstString(params.language);
  const op: HttpOperation = input.mapping?.create ?? {
    method: "POST",
    path: TRANSCRIBE_PATH,
    headers: { Authorization: "Bearer {{user_api_key}}" },
  };
  // 上传哪段音频只有一个答案：上面 `resolveAudioSource` 读出来的那条（它认 file / reference_audio_urls / camelCase 各种写法）。
  // mapping 自己的 `fileSource` 模板只写了**一种**参数名——ElevenLabs Scribe 写的是 reference_audio_urls，
  // 拆解传的是 file，于是同一段音频在一家能传上去、换一家就「缺少待上传媒体」（2026-10-19）。
  // 字段（model_id / language_code…）仍完全由 mapping 声明；被覆盖的只有「传哪个文件」这一处。
  const declared = op.multipart;
  const multipart = declared ? { ...declared, fileSource: audioUrl, imageSource: undefined } : {
    fields: {
      model: firstString(params.model),
      language,
      response_format: "verbose_json",
    },
    fileField: "file",
    fileSource: audioUrl,
    fileKind: "audio" as const,
    multiple: false,
    filename: "audio",
  };
  const built = buildProfileHttpRequest({ vendor, model, apiKey, request, operation: op });
  const context = templateContext(request, model, apiKey, {}, op);
  const executed = await executeMultipartOperation({
    multipart,
    context,
    resolveFile: async () => audio,
    send: async (form) => {
      const headers = Object.fromEntries(Object.entries(built.headers).filter(([key]) => key.toLowerCase() !== "content-type"));
      try {
        return await requestMultipart(vendor, apiKey, built.url, headers, built.query, form);
      } catch (error: unknown) {
        if (isRedirectRefusal(error)) throw Object.assign(new Error(desktopT("network.credentialRedirect")), { cause: error });
        if (error instanceof VendorRequestError && error.structured.httpStatus) {
          // Preserve the established user-facing error shape for this branch.
          // The caught vendor error remains an internal detail by contract.
          // eslint-disable-next-line preserve-caught-error -- keep the existing transcribe error surface
          throw new Error(desktopT("transcribe.httpError", {
            vendor: vendor.key,
            status: error.structured.httpStatus,
            detail: error.structured.upstreamMsg || desktopT("common.noDetail"),
          }));
        }
        throw new Error(desktopT("transcribe.networkError", { vendor: vendor.key, detail: (error instanceof Error ? error.message : String(error)).slice(0, 256) }));
      }
    },
  });
  // 出口统一成带 segments 的同一形状：只回逐词时间戳的家（ElevenLabs Scribe）在这里收成句段，
  // 读的人（拆解分镜头、音频节点导 SRT）只认 segments 一种（见 catalog/transcriptSegments.ts）。
  const json = withTimedSegments(executed.response);
  const text = firstMappedString(json, (op.response_mapping || null) as JsonRecord | null, "text")
    || firstString(isJsonRecord(json) ? json.text : undefined);
  if (!text) throw new Error(desktopT("transcribe.noText"));
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
  if (!/^https?:\/\//i.test(url)) throw new Error(desktopT("transcribe.unreachable"));
  const fetched = await hardenedFetch(url, {
    timeoutMs: 60_000, maxBytes: MAX_AUDIO_BYTES,
    allowContentTypes: ["audio/", "video/", "application/octet-stream"],
  });
  return { bytes: fetched.bytes, contentType: fetched.contentType || "audio/mpeg", fileName: "audio.mp3" };
}
