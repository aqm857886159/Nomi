import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { tool, type CoreMessage, type CoreUserMessage } from "ai";
import { z } from "zod";
import { capAgentHistory, createLinkedAbortController } from "./agentChatHarness";
import {
  clearAgentSession,
  hasPersistedAgentSession,
  loadAgentSession,
  saveAgentSession,
} from "./agentSessionStore";
import { runAgentLoop } from "./agentLoop";
import { traceContextCapped } from "../events/agentChatTrace";
import { consumeAgentStreamWithTimeout } from "./agentStreamConsumer";
import { buildLanguageModelForVendor } from "./vendorLanguageModel";
import { getModelProfile } from "./modelProfiles";
import { describeEmptyAgentReply } from "./agentError";
import { sanitizeForBroadCompat } from "./promptSanitize";
import {
  canvasNodeKindSchema,
  plannedEdgeSchema,
  plannedNodeSchema,
  storyboardPlanParamsSchema,
  type CanvasToolName,
} from "./canvasTools";
import {
  documentTools,
  type DocumentToolName,
} from "./documentTools";
import { readNestedRecord, trim, type JsonRecord } from "../jsonUtils";
import { getSkillsRoots, readText } from "../runtimePaths";
import { decryptApiKeyRecord } from "../catalog/secrets";
import { normalizeProviderKind, readCatalog } from "../catalog/catalogStore";
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
 * Nomi 助手核心身份（单一真相源，P4 通用第一）。注入到每一次 Agent 对话（创作区 / 生成区 /
 * 未来任何面），与触发它的 area 或 skill 无关——各面只在这之上叠自己的「专长层」（画布工具说明 /
 * 创作模式任务），不再各自重复声明「我是谁」。改身份只改这一处。
 *
 * 三层结构：① 这里 = 共享身份 + 产品/流程认知 + 输出铁律 + 语言规则；
 * ② payload.systemPrompt = 当前面的专长（如画布工具集）；③ skillSystemPrompt = 当前 skill 方法论。
 */
const NOMI_AGENT_IDENTITY = [
  "你是 Nomi 的 AI 创作伙伴。",
  "",
  "Nomi 是一个本地优先的 AI 视频创作工作台。用户在这里把一个想法做成视频，路径是：创作区写文案/故事/剧本 →（拆镜头）→ 生成画布把每个镜头排成节点、选模型配参数 → 时间轴拼接预览 → 导出 MP4。你始终清楚用户正处在这条链的哪一环，给的帮助要能把他推进到下一环。",
  "用户是创作者，要的是能直接用的成品，不是方法论。",
  "",
  "输出铁律：",
  "- 具体、可执行、可视化：给画面、给细节、给能直接落地的内容；不要空泛建议和正确的废话。",
  "- 密度优先、少即是多：克制利落，不堆套话、不复述用户的话、不写「希望对你有帮助」这类填充。",
  "- 模型与能力一律用它的真名（vendor 原词，如 Seedance、全能参考），不要替用户翻译成自创词，以免把能力说窄。",
  "- 不泄露内部推理链路，直接给结论和成品。",
  "- 主动但不越权：该调工具就调，但所有写入/生成都要等用户在卡片上确认后才生效。",
  "",
  "语言规则（最高优先级，覆盖一切其他指令）：",
  "始终用与用户相同的自然语言回复——用户用中文你就用中文，用英文就用英文，用日文就用日文；写进文稿和节点 prompt 的内容同样跟随用户语言。",
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

// vendor→LanguageModel 构造已抽到 ./vendorLanguageModel（单一真相,与文本任务引擎共用）。

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
    propose_storyboard_plan: makeTool(
      "propose_storyboard_plan",
      "Produce a structured storyboard plan (cross-shot anchors + shots) for the user to review/edit in the creation area before anything lands on the canvas. Does not touch the canvas and costs nothing. Emit exactly one call.",
      storyboardPlanParamsSchema,
    ),
    create_canvas_nodes: makeTool(
      "create_canvas_nodes",
      "Propose a batch of new canvas nodes AND their reference edges in this one call (never split edges into a separate connect_canvas_edges call).",
      z.object({
        summary: z.string(),
        nodes: z.array(plannedNodeSchema).min(1).max(24),
        edges: z.array(plannedEdgeSchema).max(48).optional(),
      }),
    ),
    connect_canvas_edges: makeTool(
      "connect_canvas_edges",
      "Connect EXISTING nodes with reference edges (follow-up edits only; new plans carry edges inside create_canvas_nodes).",
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
    // S6b:受理语义——批准前零网络调用,批准即受理并启动,回执不含生成结果。
    run_generation_batch: makeTool(
      "run_generation_batch",
      "Start real generation for existing canvas nodes (costs credits; user must confirm). Returns an acceptance receipt.",
      z.object({
        nodeIds: z.array(z.string().min(1)).min(1).max(24),
      }),
    ),
    arrange_storyboard_to_timeline: makeTool(
      "arrange_storyboard_to_timeline",
      "Arrange the storyboard's generated shot videos onto the timeline media track in script order (ordering decided by stored shot numbers, not by you). Ungenerated shots fall back to their keyframe image; clips are appended to the end. Omit nodeIds for the whole storyboard.",
      z.object({
        nodeIds: z.array(z.string().min(1)).max(48).optional(),
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

/** S1b 诚实探针:LLM 是否还记得这个会话(气泡在而记忆空 → UI 必须画「新会话」分隔线)。 */
export function hasAgentChatV2History(sessionKey: string): boolean {
  const key = String(sessionKey || "").trim();
  if (!key) return false;
  if ((agentChatV2History.get(key)?.length ?? 0) > 0) return true;
  // 选项②:内存 Map 冷启动为空时,磁盘有持久工作缓存 → 重启后仍算"记得"(首个请求会回灌)。
  return hasPersistedAgentSession(key);
}

/** Drop stored history for a session (or all sessions when no key given). */
export function clearAgentChatV2History(sessionKey?: string): void {
  if (sessionKey && sessionKey.trim()) {
    agentChatV2History.delete(sessionKey.trim());
    clearAgentSession(sessionKey.trim()); // 选项②:清会话连磁盘工作缓存一起删
  } else {
    agentChatV2History.clear();
  }
}

/**
 * 把界面气泡({role,content})规范化成模型工作缓存的轮次(纯函数,便于单测)。
 * 规则:user/assistant 文本轮保留;**tool 气泡(操作回执)折成一句 assistant 旁注**——让续聊的模型
 * 知道自己上次做过什么(建了哪些节点/连了哪些边),不再整条丢弃以致重复建或指代不存在的 clientId。
 * 合并连续同角色、首条须 user、末条须 assistant(满足 Anthropic 严格交替,下一句 user 接得上)。
 */
export function bubblesToSeedTurns(bubbles: ReadonlyArray<{ role?: string; content?: string }>): CoreMessage[] {
  const turns: CoreMessage[] = [];
  for (const bubble of bubbles) {
    const rawRole = bubble?.role;
    // tool 也并入 assistant 侧(它是 AI 这一方的操作),保持严格交替。
    const role = rawRole === "user" ? "user" : rawRole === "assistant" || rawRole === "tool" ? "assistant" : null;
    if (!role) continue;
    let content = sanitizeForBroadCompat(typeof bubble?.content === "string" ? bubble.content.trim() : "");
    if (!content) continue;
    if (rawRole === "tool") content = `（已执行操作：${content.split("\n")[0].slice(0, 100)}）`;
    const last = turns[turns.length - 1];
    if (last && last.role === role && typeof last.content === "string") {
      last.content = `${last.content}\n\n${content}`;
    } else {
      turns.push({ role, content });
    }
  }
  while (turns.length && turns[0].role === "assistant") turns.shift();
  while (turns.length && turns[turns.length - 1].role === "user") turns.pop();
  return turns;
}

/**
 * 会话历史(2026-06-14):翻回旧对话时,从该线程的界面气泡重建模型工作缓存,让模型「记起」这段、
 * 能无缝接着聊。空 → 等价 clear。规范化见 bubblesToSeedTurns。
 */
export function seedAgentChatV2History(
  sessionKey: string,
  bubbles: ReadonlyArray<{ role?: string; content?: string }>,
): void {
  const key = String(sessionKey || "").trim();
  if (!key) return;
  const turns = bubblesToSeedTurns(bubbles);
  if (turns.length === 0) {
    agentChatV2History.delete(key);
    clearAgentSession(key);
    return;
  }
  const capped = capAgentHistory(turns);
  agentChatV2History.set(key, capped);
  saveAgentSession(key, capped);
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

  const systemParts = [NOMI_AGENT_IDENTITY, systemPrompt, skillSystemPrompt].filter((part) => part && part.length > 0);
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
  if (sessionKey && payload.resetSession) {
    agentChatV2History.delete(sessionKey);
    clearAgentSession(sessionKey); // 选项②:「新对话」连磁盘工作缓存一起清
  }
  // 选项②冷启动回灌:内存 Map 没有但磁盘有 → 读回工作缓存,实现重启逐字续聊。
  if (sessionKey && !payload.resetSession && !agentChatV2History.has(sessionKey)) {
    const persisted = loadAgentSession(sessionKey);
    if (persisted && persisted.length) agentChatV2History.set(sessionKey, persisted);
  }
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

  // 空响应说人话（根因2）：finishReason=length + 空文本 = 典型「弱模型把内容塞进写工具 JSON
  // 被 max_tokens 截断」的失败签名（如 moonshot-v1 vision）。抛出带原因 + 换模型引导的错误，
  // 替代 UI 侧无信息量的「空响应：AI 没有返回文本」。canvas「纯工具成功轮」是 stop/tool-calls，不受影响。
  if (ok && !finalText.trim()) {
    const profile = getModelProfile(model.modelAlias || model.modelKey);
    const diagnostic = describeEmptyAgentReply(finalFinish, {
      modelLabel: model.labelZh || model.modelAlias || model.modelKey,
      ...(profile.agentSuitability ? { agentSuitability: profile.agentSuitability } : {}),
      ...(profile.agentNote ? { agentNote: profile.agentNote } : {}),
    });
    if (diagnostic) throw new Error(diagnostic);
  }

  // 历史只存简短 displayPrompt（不存含整张快照的完整 prompt，否则每轮各存一份旧快照、token 膨胀）。
  if (ok && sessionKey) {
    const generated = (await result.response).messages as CoreMessage[];
    const full: CoreMessage[] = [...priorMessages, { role: "user", content: sanitizeForBroadCompat(trim(payload.displayPrompt)) || userPrompt }, ...generated];
    const capped = capAgentHistory(full);
    // 截断真的发生 → 记 context.capped(C1 触发器观测;对话内"已不再记得最早 N 轮"提示的数据源)。
    if (capped.length < full.length) traceContextCapped(sessionKey, full.length - capped.length, capped.length);
    agentChatV2History.set(sessionKey, capped);
    saveAgentSession(sessionKey, capped); // 选项②:同步把工作缓存落盘,供下次重启回灌
  }

  return { id: `agent-${crypto.randomUUID()}`, text: finalText, finishReason: finalFinish, usage: finalUsage };
}
