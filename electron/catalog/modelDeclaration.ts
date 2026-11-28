import { isJsonRecord } from "../jsonUtils";
import type { NomiModelConfig } from "../shared/agentLane/laneModelConfig";

/**
 * 一行文本模型在 `model.meta` 里的能力声明（设计卡 docs/plan/2026-11-22-model-meta-declaration.md）。
 * Agent 文本请求走哪条协议、会不会推理、能收哪些输入、请求体要固定哪几格，全从这里读——运行时不再按模型名猜。
 * 推理三格（`reasoning` / `thinkingLevelMap` / `compat`）就是 pi 的 Model 上那三格的形状，原样递给 pi。
 */
export type ModelInputModality = "pdf" | "audio" | "video";
/** 白名单：只收这几个键。`enable_thinking` 本质是推理开关，开档位那一刀并进推理声明。 */
export type ModelRequestBodyOverrides = { temperature?: number; enable_thinking?: boolean };
export type ModelDeclaration = {
  /** 缺省 = 这行所在连接的协议（`vendor.providerKind`）。 */
  textProtocol?: NomiModelConfig["kind"];
  reasoning?: boolean;
  /** `null` = 这一档不支持（pi 自己把它从可选档里剔掉）。 */
  thinkingLevelMap?: Record<string, string | null>;
  compat?: Record<string, unknown>;
  /** 文本之外还能原样收的输入；图片另由 `supportsImageInput` 管，两者不重叠。 */
  inputModalities?: ModelInputModality[];
  requestBodyOverrides?: ModelRequestBodyOverrides;
};

/** 这几个键是声明；别处只许经 `readModelDeclaration` 读、经初值函数写。 */
export const MODEL_DECLARATION_KEYS = ["textProtocol", "reasoning", "thinkingLevelMap", "compat", "inputModalities", "requestBodyOverrides"] as const;

const PROTOCOLS = new Set(["openai-compatible", "openai-responses", "anthropic", "google-generative-ai"]);
const MODALITIES = new Set(["pdf", "audio", "video"]);

function levelMap(value: unknown): Record<string, string | null> | undefined {
  if (!isJsonRecord(value)) return undefined;
  return Object.values(value).every((level) => level === null || typeof level === "string") ? value as Record<string, string | null> : undefined;
}

function overrides(value: unknown): ModelRequestBodyOverrides | undefined {
  if (!isJsonRecord(value)) return undefined;
  // 键序固定（温度在前）：请求体是按这个顺序拼的，和名字表时代一字不差。
  const picked: ModelRequestBodyOverrides = {
    ...(typeof value.temperature === "number" && Number.isFinite(value.temperature) ? { temperature: value.temperature } : {}),
    ...(typeof value.enable_thinking === "boolean" ? { enable_thinking: value.enable_thinking } : {}),
  };
  return Object.keys(picked).length ? picked : undefined;
}

/** 唯一读法：只认合法形状，某一格形状不对就当那一格没声明，其余照常。 */
export function readModelDeclaration(meta: unknown): ModelDeclaration {
  if (!isJsonRecord(meta)) return {};
  const { textProtocol, reasoning, compat, inputModalities } = meta;
  const thinkingLevelMap = levelMap(meta.thinkingLevelMap);
  const requestBodyOverrides = overrides(meta.requestBodyOverrides);
  const modalities = Array.isArray(inputModalities) && inputModalities.every((item) => typeof item === "string" && MODALITIES.has(item))
    ? inputModalities as ModelInputModality[] : undefined;
  return {
    ...(typeof textProtocol === "string" && PROTOCOLS.has(textProtocol) ? { textProtocol: textProtocol as ModelDeclaration["textProtocol"] } : {}),
    ...(typeof reasoning === "boolean" ? { reasoning } : {}),
    ...(thinkingLevelMap ? { thinkingLevelMap } : {}),
    ...(isJsonRecord(compat) ? { compat } : {}),
    ...(modalities ? { inputModalities: modalities } : {}),
    ...(requestBodyOverrides ? { requestBodyOverrides } : {}),
  };
}
