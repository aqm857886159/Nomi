/**
 * 本地转写（离线）—— 内置供应商种子 + curated 模型/mapping。
 *
 * 它是 `transcribe` taskKind 的**第三个 provider**，与 APIMart Whisper / ElevenLabs Scribe 走
 * 同一条路、同一个解析器（`audioTaskRunner.runTranscribe`）、出同一形状的 `verbose_json`。
 * **没有第二个「转写」概念**（P1）——区别只在 create op 上多一条 `localEngine` 声明，
 * runner 据此分流到本机 sidecar 而不是发 HTTP，正如 `process` 声明把即梦分流到 spawn。
 *
 * `baseUrl` 用 `local://speech` 这种非 http 约定（同 `local://text` / `local://codex`）：
 * 刻意**不参与 host 别名**，也没有任何远端可连——真正的端口是每次任务临时起的回环端口。
 *
 * `enabled: true` 而不是「用户先去设置里连一下」：没有 key、没有端口、没有账号，
 * 连的动作是空的，只会多一道让人困惑的门（D1）。首次真正用它时才下载引擎与权重。
 *
 * `free: true`：本地跑不花钱。这一条直接决定拆解那张报价卡上写不写这一笔——
 * 选了本地还问用户要钱是最糟的那种不诚实。
 */
import type { HttpOperation, ProfileKind } from "./types";
import type { VendorSeed } from "./builtinVendorSeeds";
import { LOCAL_SPEECH_DEFAULT_TIER, LOCAL_SPEECH_TIERS } from "../shared/localSpeech/localSpeechAssets";

/** 稳定契约：UI、设置与后端种子共用同一个 key，避免并行定义漂移。 */
export const LOCAL_SPEECH_VENDOR_KEY = "local-speech";
/** 稳定契约：这一行模型的 key。进用户设置与节点，改名等于换模型身份。 */
export const LOCAL_SPEECH_MODEL_KEY = "whisper-cpp-local";

export const LOCAL_SPEECH_VENDOR_SEED: VendorSeed = {
  key: LOCAL_SPEECH_VENDOR_KEY,
  name: "本地转写（离线）",
  baseUrl: "local://speech",
  authType: "none",
  authHeader: null,
  enabled: true,
};

/**
 * create op。`localEngine` 是**声明**，不是开关：runner 见到它就知道
 * 「这条 mapping 由本机 sidecar 执行，参数 `local_tier` 指哪一档权重」。
 * 没有 `path` / `headers` / `body`——本地引擎不发 HTTP 出站，写了也只会让人以为它会。
 */
const LOCAL_TRANSCRIBE_CREATE: HttpOperation = {
  method: "POST",
  path: "local://speech/inference",
  localEngine: { kind: "whisper-cpp", tierParam: "local_tier" },
};

export const LOCAL_SPEECH_CURATED_MODELS = [
  {
    modelKey: LOCAL_SPEECH_MODEL_KEY,
    labelZh: "本地转写（离线）",
    kind: "audio" as const,
    archetypeId: "nomi-local-speech",
    free: true as const,
  },
];

export const LOCAL_SPEECH_CURATED_MAPPINGS = [
  {
    id: "seed-local-speech-transcribe",
    taskKind: "transcribe" as ProfileKind,
    modelKey: LOCAL_SPEECH_MODEL_KEY,
    name: "本地转写 · 离线",
    create: LOCAL_TRANSCRIBE_CREATE,
  },
];

/** 档位 id 的白名单——请求里给了别的值就回落默认档，不拿用户输入去拼文件路径。 */
export function resolveLocalSpeechTierId(requested: unknown): string {
  const value = typeof requested === "string" ? requested.trim() : "";
  return LOCAL_SPEECH_TIERS.some((tier) => tier.id === value) ? value : LOCAL_SPEECH_DEFAULT_TIER;
}

export const LOCAL_SPEECH_OPERATIONS = { transcribe: LOCAL_TRANSCRIBE_CREATE } as const;
