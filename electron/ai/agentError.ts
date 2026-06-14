/**
 * Honest error surfacing for the agent chat / text-stream paths.
 *
 * Two failure modes were silently swallowed before:
 *   1) An upstream relay returns HTTP 4xx/5xx with a USEFUL business message in
 *      the response body (e.g. dm-fox: "官方算力限制，请等待…"), but the AI SDK's
 *      thrown `APICallError.message` is only the bare status text ("Bad Request").
 *      We were showing that bare text and discarding the body. → describeAgentError
 *      digs the human message out of `responseBody`.
 *   2) A weak agent model (e.g. moonshot-v1 vision) tries to deliver its answer
 *      as a write-tool JSON argument, hits the max_tokens cap mid-argument
 *      (finishReason "length"), and emits neither a valid tool call nor any text.
 *      We were showing "（空响应：AI 没有返回文本）" which tells the user nothing.
 *      → describeEmptyAgentReply explains the cause and steers to a stronger model.
 *
 * Electron-free so it can be unit-tested offline (agentError.test.ts).
 */
import { APICallError } from "ai";

/** Pull a human-readable message out of a parsed response-body envelope. */
function pickBodyMessage(parsed: unknown): string {
  if (typeof parsed === "string") return parsed;
  if (!parsed || typeof parsed !== "object") return "";
  const obj = parsed as Record<string, unknown>;
  if (typeof obj.error === "string") return obj.error;
  if (obj.error && typeof obj.error === "object") {
    const inner = (obj.error as Record<string, unknown>).message;
    if (typeof inner === "string" && inner.trim()) return inner;
  }
  if (typeof obj.message === "string" && obj.message.trim()) return obj.message;
  if (typeof obj.msg === "string" && obj.msg.trim()) return obj.msg;
  return "";
}

/** JSON-or-raw: the human message inside an upstream response body, or a snippet. */
function humanFromBody(body: string): string {
  const trimmed = body.trim();
  if (!trimmed) return "";
  try {
    const message = pickBodyMessage(JSON.parse(trimmed));
    if (message) return message.trim();
  } catch {
    /* not JSON — fall through to raw snippet */
  }
  return trimmed.replace(/\s+/g, " ").slice(0, 300);
}

/**
 * Turn any agent error into a message worth showing the user. For APICallError
 * this means surfacing the upstream response body (where relays put the real
 * reason) instead of the bare HTTP status text.
 */
export function describeAgentError(error: unknown): string {
  if (APICallError.isInstance(error)) {
    const status = typeof error.statusCode === "number" ? `HTTP ${error.statusCode}` : "请求失败";
    const human = (error.responseBody ? humanFromBody(error.responseBody) : "") || (error.message || "").trim();
    return human ? `（${status}）${human}` : status;
  }
  if (error instanceof Error) return error.message;
  return String(error);
}

export type EmptyReplyModelInfo = {
  modelLabel: string;
  agentSuitability?: "good" | "acceptable" | "poor";
  agentNote?: string;
};

/**
 * Explain a turn that finished with NO text — but only when the finishReason is
 * a recognized failure. Returns "" for ambiguous reasons (stop / tool-calls with
 * empty text), so callers keep their generic handling for those.
 */
export function describeEmptyAgentReply(finishReason: string, info: EmptyReplyModelInfo): string {
  const reason = String(finishReason || "").toLowerCase();
  const guide = "建议换用通用对话模型（如 GPT-4o / Claude / Gemini）来跑创作助手——它们做 Agent 工具调用更稳。";
  if (reason === "length") {
    const parts = [`模型「${info.modelLabel}」这一轮达到了输出长度上限，内容被截断，没能完整返回。`];
    if (info.agentNote) parts.push(info.agentNote);
    else if (info.agentSuitability === "poor") parts.push("该模型做 Agent 工具调用本就不可靠。");
    parts.push(guide);
    return parts.join("\n");
  }
  if (reason === "content-filter") {
    return `模型「${info.modelLabel}」因内容安全策略拦截，没有返回结果。换个说法或换模型再试。`;
  }
  return "";
}
