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
import { VendorRequestError, encodeVendorErrorMessage } from "../shared/vendorFailure";

/**
 * Turn any text-task error into the message that crosses IPC.
 *
 * 文本流 IPC（textStreamIpc 的 catch）唯一的漏斗。厂商失败在抛出那一刻就已经是 VendorRequestError
 * （文本任务的失败映射只一处：runtimeVendorError.modelCallFailure，读的是传输层记下的事实），
 * 这里只负责带 `NOMI_VENDOR_ERR_B64::` 标记编码后穿 IPC——渲染层 classifyGenerationError 走「源头保留的事实」分支。
 * 不是厂商失败的（没配文本模型 / 图片读不出 / 服务商在 SSE 里给的原话）返回原句。
 *
 * 2026-10-21 文本任务迁 pi-ai：过去这里还要拆 ai@4 的 RetryError 壳、认 APICallError（aiSdkVendorError），随 ai@4 一起删。
 * 展示串不变：标记段在渲染层由 stripVendorErrorMarker 剥掉，用户看到的仍是「（HTTP 400）官方算力限制……」。
 */
export function describeAgentError(error: unknown): string {
  if (error instanceof VendorRequestError) return encodeVendorErrorMessage(error);
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
  if (reason === "length") {
    const parts = [`模型「${info.modelLabel}」这一轮达到了输出长度上限，内容被截断，没能完整返回。`];
    if (info.agentNote) parts.push(info.agentNote);
    else if (info.agentSuitability === "poor") parts.push("该模型做 Agent 工具调用本就不可靠。");
    // 截断是确定性的——原样重试必再撞。给真动作：缩短这轮任务，或换单轮输出上限更大的模型。
    parts.push("原样重试会再次截断。请缩短这一轮的任务量（如剧本分段拆镜头、减少镜头数），或换用单轮输出上限更大的模型（如 GPT-4o / Claude / Gemini）。");
    return parts.join("\n");
  }
  if (reason === "content-filter") {
    return `模型「${info.modelLabel}」因内容安全策略拦截，没有返回结果。换个说法或换模型再试。`;
  }
  return "";
}
