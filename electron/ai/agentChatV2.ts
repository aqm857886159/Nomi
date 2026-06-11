import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { tool, type CoreMessage, type CoreUserMessage, type LanguageModelV1 } from "ai";
import { z } from "zod";
import { capAgentHistory, createLinkedAbortController } from "./agentChatHarness";
import { runAgentLoop } from "./agentLoop";
import { consumeAgentStreamWithTimeout } from "./agentStreamConsumer";
import { buildAiSdkModel } from "./buildAiSdkModel";
import { sanitizeForBroadCompat } from "./promptSanitize";
import {
  canvasNodeKindSchema,
  plannedEdgeSchema,
  plannedNodeSchema,
  type CanvasToolName,
} from "./canvasTools";
import {
  documentTools,
  type DocumentToolName,
} from "./documentTools";
import { endpoint } from "../vendorEndpoint";
import { readNestedRecord, trim, type JsonRecord } from "../jsonUtils";
import { getSkillsRoots, readText } from "../runtimePaths";
import { decryptApiKeyRecord } from "../catalog/secrets";
import { extractVendorExtraHeaders, normalizeProviderKind, readCatalog } from "../catalog/catalogStore";
import type { Model, Vendor } from "../catalog/types";
import { readNomiLocalAsset } from "../assets/localAssetFile";
import { extractTextFromLocalAsset } from "../files/extractText";
import { buildAgentUserContent, modelSupportsImageInput, modelSupportsPdfInput, type AgentUserAttachment } from "./agentUserContent";

type SkillRecord = {
  name: string;
  directoryName: string;
  filePath: string;
  body: string;
};

function parseSkillName(markdown: string, directoryName: string): string {
  const match = markdown.match(/^---\s*\n([\s\S]*?)\n---/);
  const frontmatter = match?.[1] || "";
  const nameMatch = frontmatter.match(/^name:\s*["']?(.+?)["']?\s*$/m);
  return String(nameMatch?.[1] || directoryName).trim();
}

function normalizeSkillLookupKey(value: unknown): string {
  return String(value || "")
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/[._\s/]+/g, "-")
    .replace(/[^a-zA-Z0-9-]/g, "")
    .replace(/-+/g, "-")
    .toLowerCase();
}

function readSkillRecords(): SkillRecord[] {
  const records: SkillRecord[] = [];
  for (const root of getSkillsRoots()) {
    if (!fs.existsSync(root)) continue;
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const filePath = path.join(root, entry.name, "SKILL.md");
      if (!fs.existsSync(filePath)) continue;
      const body = readText(filePath).trim();
      if (!body) continue;
      records.push({
        name: parseSkillName(body, entry.name),
        directoryName: entry.name,
        filePath,
        body,
      });
    }
  }
  return records;
}

function readRequestedSkill(payload: JsonRecord): { key: string; name: string } {
  const chatContext = payload.chatContext;
  const skill = readNestedRecord(chatContext, ["skill"]);
  return {
    key: trim(readNestedRecord(skill, ["key"])),
    name: trim(readNestedRecord(skill, ["name"])),
  };
}

function findSkillRecord(skillKey: string, skillName: string): SkillRecord | null {
  const records = readSkillRecords();
  if (!records.length) return null;
  const normalizedKey = normalizeSkillLookupKey(skillKey);
  const normalizedName = normalizeSkillLookupKey(skillName);

  const exact = records.find((skill) => skill.name === skillKey);
  if (exact) return exact;

  const prefix = records
    .filter((skill) => skillKey.startsWith(`${skill.name}.`))
    .sort((a, b) => b.name.length - a.name.length)[0];
  if (prefix) return prefix;

  return records.find((skill) => (
    normalizeSkillLookupKey(skill.name) === normalizedKey
    || normalizeSkillLookupKey(skill.directoryName) === normalizedKey
    || (normalizedName && normalizeSkillLookupKey(skill.name) === normalizedName)
    || (normalizedName && normalizeSkillLookupKey(skill.directoryName) === normalizedName)
  )) || null;
}

/**
 * Universal language directive injected into every agent chat (v1 + v2),
 * regardless of which area or skill triggered it. Single source of truth so we
 * never have to repeat "reply in the user's language" in each prompt builder.
 */
const AGENT_LANGUAGE_DIRECTIVE = [
  "语言规则（最高优先级，覆盖一切其他指令）：",
  "始终用与用户相同的自然语言回复——用户用中文你就用中文，用英文就用英文，用日文就用日文。",
  "永远不要因为本系统提示或某个 skill 是用中文/英文写的，就固定用那种语言；以用户最近一条消息的语言为准。",
].join("\n");

function buildSkillSystemPrompt(payload: JsonRecord): string {
  const requested = readRequestedSkill(payload);
  if (!requested.key && !requested.name) return "";
  const skill = findSkillRecord(requested.key, requested.name);
  if (!skill) {
    return [
      "Nomi 桌面 Agent skill 提示：",
      `请求的 skill 未在本地 skills 目录找到：${requested.key || requested.name}`,
      "继续按用户请求和当前上下文完成任务；不要声称已经加载不存在的 skill。",
    ].join("\n");
  }
  return [
    "Nomi 桌面 Agent 已加载本地 skill。以下内容是本次回复必须参考的领域方法论和输出约束。",
    "注意：本桌面运行时只把 skill 作为本地知识注入；skill 中提到的外部 CLI、HTTP 或文件工具不会自动执行，除非当前对话/界面明确提供了对应能力。",
    `skillKey: ${requested.key || skill.name}`,
    `skillName: ${requested.name || skill.name}`,
    `skillFile: ${path.relative(process.cwd(), skill.filePath)}`,
    "",
    skill.body,
  ].join("\n");
}

// vision/preview/audio 等常不可靠发 tool_use → 无偏好时降权（仍作回退），让通用对话模型优先做 Agent 主控（2026-06-07 真机走查 P0）。
const AUTO_TEXT_MODEL_DEPRIORITIZE = /vision|preview|audio|tts|whisper|embed|rerank|ocr|search|thinking/i;
function autoTextModelPenalty(model: Model): number {
  return AUTO_TEXT_MODEL_DEPRIORITIZE.test(`${model.modelKey} ${model.modelAlias ?? ""}`) ? 1 : 0;
}

function imageInputRank(model: Model): number {
  return modelSupportsImageInput(model.modelKey, model.modelAlias, model.meta) ? 1 : 0;
}

function chooseTextModel(prefModelKey?: string, preferImageInput = false): { vendor: Vendor; model: Model; apiKey: string } {
  const state = readCatalog();
  const texts = state.models.filter((item) => item.kind === "text" && item.enabled);
  // 有偏好：用户选的排第一（其余作回退）。
  // 无偏好且本轮带图：优先支持图片输入的 text 模型（gpt-4o/claude/gemini 既能看图又擅长 tool_use）。
  // 无偏好无图：不盲选第一个，按「是否像通用对话模型」稳定排序，vision/preview 降到末尾。
  const ordered = prefModelKey
    ? [...texts].sort((a, b) => (a.modelKey === prefModelKey ? -1 : 0) - (b.modelKey === prefModelKey ? -1 : 0))
    : preferImageInput
      ? [...texts].sort((a, b) => imageInputRank(b) - imageInputRank(a))
      : [...texts].sort((a, b) => autoTextModelPenalty(a) - autoTextModelPenalty(b));
  for (const model of ordered) {
    const vendor = state.vendors.find((item) => item.key === model.vendorKey && item.enabled);
    const apiKey = decryptApiKeyRecord(state.apiKeysByVendor[model.vendorKey]);
    if (vendor && (vendor.authType === "none" || apiKey)) return { vendor, model, apiKey };
  }
  throw new Error("No local text model is configured. Open model settings and add an API key.");
}

/**
 * Single vendor→LanguageModel construction path. runAgentChatV2 (and any future
 * caller) goes through here so provider-kind, baseURL shaping, and custom headers
 * stay consistent (Rule 1: no parallel versions). anthropic uses the vendor's
 * baseUrlHint verbatim (or the SDK default when blank); openai-compatible appends /v1.
 */
function buildLanguageModelForVendor(vendor: Vendor, model: Model, apiKey: string): LanguageModelV1 {
  const providerKind = normalizeProviderKind(vendor.providerKind);
  const baseURL = providerKind === "anthropic"
    ? (vendor.baseUrlHint || "").trim()
    : endpoint(vendor, "/v1");
  const headers = extractVendorExtraHeaders(vendor);
  return buildAiSdkModel({
    kind: providerKind,
    baseURL,
    apiKey,
    modelId: model.modelAlias || model.modelKey,
    ...(headers ? { headers } : {}),
  });
}

// ---------------------------------------------------------------------------
// runAgentChatV2 — Phase B: tool-calling + real streaming
// ---------------------------------------------------------------------------
//
// v2 wires the canvas tools through `streamText` and surfaces token deltas +
// tool-call lifecycle to the renderer via an injected `emit` callback. The IPC layer (electron/
// main.ts) is responsible for forwarding those events on a per-session
// channel and for resolving the `awaitToolConfirmation` promise once the
// user confirms or rejects the proposed tool call.
// ---------------------------------------------------------------------------

// A tool call may target either the generation-canvas tool group or the
// creation-document tool group; the engine picks the group by skillKey.
export type AgentToolName = CanvasToolName | DocumentToolName;

export type AgentChatV2Event =
  | { type: "content-delta"; delta: string }
  | { type: "tool-call"; toolCallId: string; toolName: AgentToolName; args: unknown }
  | { type: "tool-result"; toolCallId: string; toolName: AgentToolName; result: unknown }
  | { type: "tool-error"; toolCallId: string; toolName: AgentToolName; message: string }
  | { type: "step-finish"; finishReason: string }
  | { type: "finish"; finishReason: string; usage?: unknown }
  | { type: "error"; message: string };

export type AgentToolConfirmation =
  | { ok: true; result: unknown }
  | { ok: false; message: string };

export type AgentChatV2Hooks = {
  emit: (event: AgentChatV2Event) => void;
  /**
   * Called when the LLM emits a tool call. The host (renderer over IPC) must
   * resolve with either `{ ok: true, result }` to feed the result back to
   * the model and continue the loop, or `{ ok: false, message }` to short
   * circuit the tool with an error result.
   */
  awaitToolConfirmation: (call: {
    toolCallId: string;
    toolName: AgentToolName;
    args: unknown;
  }) => Promise<AgentToolConfirmation>;
  abortSignal?: AbortSignal; // external cancel (user "Stop") → stream abort
};

// Wraps a tool descriptor so every invocation routes through the
// human-in-the-loop confirmation channel: emit `tool-call`, await the user's
// decision, then emit `tool-result` / `tool-error` and feed a structured
// result back to the model. Shared by both the canvas and document tool groups.
function makeAgentTool<TParams extends z.ZodTypeAny>(
  hooks: AgentChatV2Hooks,
  toolName: AgentToolName,
  description: string,
  parameters: TParams,
) {
  return tool({
    description,
    parameters,
    execute: async (args: unknown, opts: { toolCallId: string }) => {
      hooks.emit({ type: "tool-call", toolCallId: opts.toolCallId, toolName, args });
      const confirmation = await hooks.awaitToolConfirmation({
        toolCallId: opts.toolCallId,
        toolName,
        args,
      });
      if (!confirmation.ok) {
        hooks.emit({
          type: "tool-error",
          toolCallId: opts.toolCallId,
          toolName,
          message: confirmation.message,
        });
        // Surface as a structured tool result so the LLM can gracefully stop.
        return { ok: false as const, error: confirmation.message };
      }
      hooks.emit({
        type: "tool-result",
        toolCallId: opts.toolCallId,
        toolName,
        result: confirmation.result,
      });
      return { ok: true as const, result: confirmation.result };
    },
  });
}

function buildCanvasToolsForV2(hooks: AgentChatV2Hooks) {
  const makeTool = <TParams extends z.ZodTypeAny>(
    toolName: CanvasToolName,
    description: string,
    parameters: TParams,
  ) => makeAgentTool(hooks, toolName, description, parameters);

  return {
    read_canvas_state: makeTool(
      "read_canvas_state",
      "Read the current generation canvas (nodes + edges).",
      z.object({}),
    ),
    create_canvas_nodes: makeTool(
      "create_canvas_nodes",
      "Propose a batch of new canvas nodes for user confirmation.",
      z.object({
        summary: z.string(),
        nodes: z.array(plannedNodeSchema).min(1).max(24),
      }),
    ),
    connect_canvas_edges: makeTool(
      "connect_canvas_edges",
      "Connect nodes with reference edges (source feeds target).",
      z.object({
        edges: z.array(plannedEdgeSchema).min(1).max(48),
      }),
    ),
    set_node_prompt: makeTool(
      "set_node_prompt",
      "Rewrite the prompt of an existing node.",
      z.object({
        nodeId: z.string().min(1),
        prompt: z.string().min(1),
      }),
    ),
    delete_canvas_nodes: makeTool(
      "delete_canvas_nodes",
      "Delete one or more existing canvas nodes (destructive).",
      z.object({
        nodeIds: z.array(z.string().min(1)).min(1).max(24),
        // Keep a hint slot so the model can surface its rationale to the user
        // before destructive confirmation.
        reason: z.string().optional(),
      }),
    ),
    // Silence unused-import warning for canvasNodeKindSchema by re-exporting
    // it through the tool registry shape (it's enforced via plannedNodeSchema).
    _kindSchema: canvasNodeKindSchema,
  } as const;
}

// Creation-area document tools. We reuse the zod schemas + descriptions from
// `documentTools` (the source of truth) but wrap each in the v2 confirmation
// channel via `makeAgentTool`. read_* tools auto-confirm on the renderer; the
// write tools (insert/replace/append) surface a confirmation card.
function buildDocumentToolsForV2(hooks: AgentChatV2Hooks) {
  const make = (name: DocumentToolName) =>
    makeAgentTool(
      hooks,
      name,
      documentTools[name].description ?? name,
      documentTools[name].parameters as z.ZodTypeAny,
    );

  return {
    read_full_text: make("read_full_text"),
    read_selection: make("read_selection"),
    insert_at_cursor: make("insert_at_cursor"),
    replace_selection: make("replace_selection"),
    append_to_end: make("append_to_end"),
  } as const;
}

// Tool-group selector: creation-area skills (workbench.creation.*) get the
// document tools; everything else (generation / storyboard / default) gets the
// canvas tools. One engine, parameterized tool group.
function buildToolsForSkill(skillKey: string | undefined, hooks: AgentChatV2Hooks) {
  if (typeof skillKey === "string" && skillKey.startsWith("workbench.creation.")) {
    return buildDocumentToolsForV2(hooks);
  }
  const { _kindSchema, ...canvasTools } = buildCanvasToolsForV2(hooks);
  void _kindSchema;
  return canvasTools;
}

export type RunAgentChatV2Payload = {
  prompt: string;
  displayPrompt?: string;
  systemPrompt?: string;
  skill?: unknown;
  skillKey?: string;
  skillName?: string;
  chatContext?: unknown;
  mode?: string;
  temperature?: number;
  agentModelKey?: string; // 助手模型偏好（用户选的）：优先用，否则回退第一个可用 text 模型
  agentVendorKey?: string;
  /** 待发附件：图片走原生多模态（image part）；文件 S4 抽文本。 */
  attachments?: AgentUserAttachment[];
  /**
   * Shared conversation memory key. Both workbench panels use
   * `nomi:workbench:<projectId|local>` so the agent remembers across turns and
   * across the creation / generation areas. Omitted = no memory (one-shot).
   */
  sessionKey?: string;
  /** Drop any stored history for this sessionKey before running ("新对话"). */
  resetSession?: boolean;
};

// In-memory conversation history, keyed by sessionKey. Lives only for the app
// session (cleared on quit). Capped per key (capAgentHistory) so prompts can't
// grow unbounded. History/maxSteps/repair helpers live in ./ai/agentChatHarness.
const agentChatV2History = new Map<string, CoreMessage[]>();

/** Drop stored history for a session (or all sessions when no key given). */
export function clearAgentChatV2History(sessionKey?: string): void {
  if (sessionKey && sessionKey.trim()) {
    agentChatV2History.delete(sessionKey.trim());
  } else {
    agentChatV2History.clear();
  }
}

function readAgentAttachments(payload: RunAgentChatV2Payload): AgentUserAttachment[] {
  const raw = (payload as { attachments?: unknown }).attachments;
  if (!Array.isArray(raw)) return [];
  const out: AgentUserAttachment[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    const url = typeof rec.url === "string" ? rec.url : "";
    if (!url) continue;
    out.push({
      url,
      contentType: typeof rec.contentType === "string" ? rec.contentType : "application/octet-stream",
      fileName: typeof rec.fileName === "string" ? rec.fileName : "asset",
      kind: rec.kind === "image" ? "image" : "file",
    });
  }
  return out;
}

export async function runAgentChatV2(
  payload: RunAgentChatV2Payload,
  hooks: AgentChatV2Hooks,
): Promise<{ id: string; text: string; finishReason: string; usage?: unknown }> {
  const attachments = readAgentAttachments(payload);
  // 带图片或 PDF 时，优先选支持多模态输入的 text 模型（vision 模型也基本支持 PDF file part）。
  const wantsRichInput = attachments.some(
    (item) => item.kind === "image" || item.contentType.toLowerCase().includes("pdf") || item.fileName.toLowerCase().endsWith(".pdf"),
  );
  const { vendor, model, apiKey } = chooseTextModel(trim(payload.agentModelKey), wantsRichInput);
  const systemPrompt = trim(payload.systemPrompt as unknown as JsonRecord["systemPrompt"]);
  const skillSystemPrompt = buildSkillSystemPrompt(payload as unknown as JsonRecord);
  // 收口 sanitize（P0-6）：送进 LLM 的 user/system 文本 ASCII 可移植化（防 Moonshot 等 tokenizer 异常）。
  const userPrompt = sanitizeForBroadCompat(trim(payload.prompt) || trim(payload.displayPrompt));

  const systemParts = [AGENT_LANGUAGE_DIRECTIVE, systemPrompt, skillSystemPrompt].filter((part) => part && part.length > 0);
  const system = systemParts.length > 0 ? sanitizeForBroadCompat(systemParts.join("\n\n")) : undefined;

  const languageModel = buildLanguageModelForVendor(vendor, model, apiKey);

  // Pick the tool group by skill: creation-area skills get document tools,
  // everything else gets canvas tools. The canonical skill key lives in
  // chatContext.skill.key; fall back to the top-level payload.skillKey.
  const resolvedSkillKey =
    readRequestedSkill(payload as unknown as JsonRecord).key || trim(payload.skillKey);
  const tools = buildToolsForSkill(resolvedSkillKey, hooks);

  // Replay stored history for this session so the agent remembers prior turns
  // (within a panel and across the creation / generation areas, which share a
  // sessionKey). "新对话" sends resetSession to wipe it first.
  const sessionKey = trim(payload.sessionKey);
  if (sessionKey && payload.resetSession) agentChatV2History.delete(sessionKey);
  const priorMessages = sessionKey ? agentChatV2History.get(sessionKey) ?? [] : [];
  // 图片附件 → 原生多模态 image part（按模型能力门控，不支持则降级为文字 + 清晰提示）。
  const userContent = await buildAgentUserContent({
    prompt: userPrompt,
    attachments,
    supportsImageInput: modelSupportsImageInput(model.modelKey, model.modelAlias, model.meta),
    supportsPdfInput: modelSupportsPdfInput(model.modelKey, model.modelAlias, model.meta),
    resolveBytes: (url) => {
      const asset = readNomiLocalAsset(url);
      return asset ? asset.bytes : null;
    },
    extractText: (att) => extractTextFromLocalAsset(att.url, att.contentType, att.fileName),
  });
  const userMessage: CoreMessage = { role: "user", content: userContent as CoreUserMessage["content"] };
  const messages: CoreMessage[] = [...priorMessages, userMessage];

  const abortController = createLinkedAbortController(hooks.abortSignal);
  // 统一循环内核（S0）：maxSteps(skill)/retry/repair/prompt 缓存全在 agentLoop 一处。
  const result = runAgentLoop(
    {
      model: languageModel,
      ...(system ? { system } : {}),
      messages,
      tools,
      isAnthropic: normalizeProviderKind(vendor.providerKind) === "anthropic",
      temperature: typeof payload.temperature === "number" ? payload.temperature : 0.7,
      skillKey: resolvedSkillKey,
      abortSignal: abortController.signal,
    },
    { onError: (message) => hooks.emit({ type: "error", message }) },
    { mode: "stream" },
  );

  const { finalText, finalFinish, finalUsage, ok } = await consumeAgentStreamWithTimeout(result, abortController, hooks, { firstChunkTimeoutMs: 90_000, label: `${vendor?.key}/${model?.modelKey}/${resolvedSkillKey}` });

  // 历史只存简短 displayPrompt（不存含整张快照的完整 prompt，否则每轮各存一份旧快照、token 膨胀）。
  if (ok && sessionKey) {
    const generated = (await result.response).messages as CoreMessage[];
    agentChatV2History.set(sessionKey, capAgentHistory([...priorMessages, { role: "user", content: sanitizeForBroadCompat(trim(payload.displayPrompt)) || userPrompt }, ...generated]));
  }

  return { id: `agent-${crypto.randomUUID()}`, text: finalText, finishReason: finalFinish, usage: finalUsage };
}
