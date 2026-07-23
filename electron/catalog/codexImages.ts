// Codex 本地生图实验接入。
// 这不是 OpenAI Platform API，也不读取 ~/.codex/auth.json；只调用本机已登录的 `codex exec`，
// 通过 `$imagegen` 让 Codex 自己生成图片，再从 ~/.codex/generated_images/<thread_id> 导入 Nomi 素材。
import type { HttpOperation } from "./types";

const PROCESS_METHOD = "PROCESS";
const STATUS: Record<string, string[]> = {
  succeeded: ["success", "completed"],
  failed: ["fail", "failed", "error"],
  running: ["processing", "generating"],
  queued: ["queued", "pending"],
};
const IMAGE_RESPONSE = { task_id: "submit_id", status: "gen_status", image_url: "video_url" };
const PROVIDER_META = { task_id: "submit_id" };

export const CODEX_LOCAL_VENDOR_SEED = {
  key: "codex-local",
  name: "Codex 本地生图（实验）",
  baseUrl: "local://codex",
  authType: "none" as const,
  authHeader: null,
  enabled: false,
} as const;

export const CODEX_IMAGE_MODEL_KEY = "codex-imagegen";
export const CODEX_IMAGE_MODEL_LABEL = "Codex 生图（登录额度）";

const TEXT_TO_IMAGE: HttpOperation = {
  method: PROCESS_METHOD,
  path: "codex:imagegen",
  process: {
    bin: "codex",
    parser: "codex-cli-image",
    args: [],
  },
  response_mapping: IMAGE_RESPONSE,
  provider_meta_mapping: PROVIDER_META,
};

const QUERY_RESULT: HttpOperation = {
  method: PROCESS_METHOD,
  path: "codex:imagegen-query",
  process: {
    bin: "codex",
    parser: "codex-cli-image",
    args: ["query_result", "--submit_id={{providerMeta.task_id}}"],
  },
  response_mapping: IMAGE_RESPONSE,
  provider_meta_mapping: PROVIDER_META,
};

export const CODEX_IMAGE_CURATED_MODELS = [
  { modelKey: CODEX_IMAGE_MODEL_KEY, labelZh: CODEX_IMAGE_MODEL_LABEL, kind: "image" as const, archetypeId: "codex-imagegen" },
];

export const CODEX_IMAGE_CURATED_MAPPINGS = [
  {
    id: "seed-codex-local-imagegen-text_to_image",
    taskKind: "text_to_image" as const,
    modelKey: CODEX_IMAGE_MODEL_KEY,
    name: "Codex 本地生图 · 文生图",
    create: TEXT_TO_IMAGE,
    query: QUERY_RESULT,
    statusMapping: STATUS,
  },
  {
    id: "seed-codex-local-imagegen-image_edit",
    taskKind: "image_edit" as const,
    modelKey: CODEX_IMAGE_MODEL_KEY,
    name: "Codex 本地生图 · 改图",
    create: TEXT_TO_IMAGE,
    query: QUERY_RESULT,
    statusMapping: STATUS,
  },
];
