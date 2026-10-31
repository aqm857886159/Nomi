/**
 * [INPUT]: 依赖 ai/vendorModelConnection 的 nomiModelConfigFor / isProviderKindPinned，ai/modelCallBridge 的 callModelOnce，ai/modelCallFetch 的 modelCallTransport，logging/logger 的 logInfo
 * [OUTPUT]: 对外提供 probeTextProtocol、textProtocolProbeEligible、textProtocolProbeFits、TEXT_PROTOCOL_PROBE_TIMEOUT_MS、TEXT_PROTOCOL_PROBE_STEP_MS
 * [POS]: providerAdapter 认证流程里文本协议的判定者；service.verifyDraft 在免费自检通过后调它，结论经 AdapterModeResult.wireProtocol 落进模型 meta，再由 vendorModelConnection 读回
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { callModelOnce } from "../ai/modelCallBridge";
import { modelCallTransport } from "../ai/modelCallFetch";
import { isProviderKindPinned, nomiModelConfigFor } from "../ai/vendorModelConnection";
import { normalizeProviderKind } from "../catalog/catalogStore";
import type { Model, Vendor } from "../catalog/types";
import { logInfo } from "../logging/logger";
import type { ProviderAdapterDraft, TextWireProtocol } from "./types";

/** 一次探测的上限。到点按 Chat 记，不判认证失败——最坏结果与改动前一致。 */
export const TEXT_PROTOCOL_PROBE_TIMEOUT_MS = 20_000;
/** service 外层等待：比探测自己的上限多 5 秒，只为兜住取消，不让探测超时变成认证失败。 */
export const TEXT_PROTOCOL_PROBE_STEP_MS = TEXT_PROTOCOL_PROBE_TIMEOUT_MS + 5_000;
/** 留给后面模型做免费自检的时间。自检不出网（凭据一条连接只探一次），一分钟绰绰有余。 */
const SELF_CHECK_RESERVE_MS = 60_000;

/**
 * ⚠⚠ 探测不许吃掉认证批次的时限（serviceLifecycle 的 5 分钟）：20 个文本模型 × 20 秒 = 400 秒，
 * 会把后面本来能过的模型拖成「到点失败」。剩余时间不够一次探测加预留就不探、记 Chat——与改动前一致。
 */
export function textProtocolProbeFits(deadlineAt: string | undefined, now: string): boolean {
  if (!deadlineAt) return true;
  return Date.parse(deadlineAt) - Date.parse(now) >= TEXT_PROTOCOL_PROBE_STEP_MS + SELF_CHECK_RESERVE_MS;
}

/**
 * 只探「OpenAI 家文本模型 + 用户没亲手选协议」。anthropic 有自己的协议；亲手选过的照用户的走；
 * ⚠ 图片 / 视频 / 音频一律不探：2026-09-11「认证不花用户的钱」只对文本这一次最小请求放开（用户 2026-10-27 拍板）。
 */
export function textProtocolProbeEligible(
  vendor: Vendor,
  model: Model,
  mode: ProviderAdapterDraft["models"][number]["modes"][number],
): boolean {
  return model.kind === "text"
    && mode.taskKind === "chat"
    && normalizeProviderKind(vendor.providerKind) === "openai-compatible"
    && !isProviderKindPinned(vendor);
}

/**
 * 对这个模型发一次最小的 `/responses`（「hi」，输出上限 16 token，不重试），由 pi 的 Responses 解析器当裁判：
 * 它读到终态事件（completed / incomplete）→ 这条地址上这个模型支持 Responses；其余一切（404、400、
 * 回了 Chat 形状的包、超时、断连）→ Chat。
 *
 * 为什么按模型探、不按地址探：聚合平台（new-api / OpenRouter / one-api）对所有模型都暴露 /responses，
 * 支不支持取决于背后渠道——同一地址下 A 模型通、B 模型回 400 是常态。
 * 为什么不认错误文案：用户接的平台千差万别，但协议只有三种；文案是平台的，协议是公共的。
 * ⚠ 永不抛：判定失败就是 Chat，绝不让探测把一次本来能过的认证判失败。
 */
export async function probeTextProtocol(input: {
  vendor: Vendor;
  model: Model;
  apiKey: string;
  signal?: AbortSignal;
}): Promise<TextWireProtocol> {
  const started = Date.now();
  let verdict: TextWireProtocol = "openai-compatible";
  let reason = "";
  try {
    const config = { ...nomiModelConfigFor(input.vendor, input.model, input.apiKey), kind: "openai-responses" as const };
    const timeout = AbortSignal.timeout(TEXT_PROTOCOL_PROBE_TIMEOUT_MS);
    const transport = modelCallTransport({ modelId: config.modelId, knownSecrets: [input.apiKey] });
    const { message } = await callModelOnce({
      model: config,
      fetch: transport.fetch,
      content: "hi",
      maxTokens: 16,
      maxRetries: 0,
      signal: input.signal ? AbortSignal.any([input.signal, timeout]) : timeout,
    });
    // 推理模型 16 token 可能全花在思考上 → stopReason "length"。协议照样通，算 Responses。
    if (message.stopReason !== "error" && message.stopReason !== "aborted") verdict = "openai-responses";
    else reason = transport.redact(message.errorMessage ?? message.stopReason);
  } catch (error) {
    reason = error instanceof Error ? error.name : "thrown";
  }
  logInfo("onboarding", "text-protocol-probe", {
    vendor: input.vendor.key,
    model: input.model.modelKey,
    verdict,
    ms: Date.now() - started,
    ...(reason ? { reason: reason.slice(0, 200) } : {}),
  });
  return verdict;
}
