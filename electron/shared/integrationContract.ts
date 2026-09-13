/** Shared lifecycle vocabulary for the integration session and its durable
 * certification projection. Both main and renderer DTOs derive from these
 * tuples instead of maintaining parallel string unions. */
export const INTEGRATION_STAGES = [
  "draft",
  "needs_credential",
  "needs_input",
  "discovering",
  "needs_selection",
  // 「方案收下了，自检还没开跑」。2026-09-12 用户拍板：接模型这条路**没有付费验证**，
  // 所以也**没有花费确认**——钱的闸只有一处，在画布每次提交时的报价卡。
  // 这一档因此只剩机器语义（该调 start 了），任何 owner 都能自己走出去；
  // 它取代了旧的 needs_spend_confirmation / awaiting_human_confirmation / human_confirmed 三档，
  // 那三档连同挑战、收据、真人手势章一起删掉（它们的存在理由只有「授权花钱」一条）。
  "ready_to_certify",
  "certifying",
  "committing",
  "completed",
  "partial",
  "failed",
  "cancelled",
] as const;

export type IntegrationStage = typeof INTEGRATION_STAGES[number];

export const INTEGRATION_CREDENTIAL_STATUSES = ["missing", "ready", "needs_resave", "unavailable"] as const;
export type IntegrationCredentialStatus = typeof INTEGRATION_CREDENTIAL_STATUSES[number];

/**
 * 接入会话写前置条件的错误码词表（单一 owner）。
 *
 * 为什么要有它：修复前 `Integration session revision is stale` 这一句英文裸 Error 同时表示
 * 「你没传 expectedRevision」「你传的值过期了」「你凭空猜了一个更大的值」「并发写把它顶掉了」。
 * 实测里 22 次失败调用有 6 次栽在这句话上，而「stale」把模型教向「那我干脆别传了」——恰好最错。
 * 每个码只说一件事，并带上 `currentRevision` 这类可执行细节（该拿什么最新值）。
 */
export const INTEGRATION_ERROR_CODES = [
  /** 会话 id 找不到（可能是拼错，或这台机器上从来没有过它）。 */
  "integration_session_not_found",
  /** 会话属于另一个已签名客户端。 */
  "integration_owner_mismatch",
  /** 根本没传 expectedRevision（或不是整数）——不是过期，是缺字段。 */
  "integration_expected_revision_missing",
  /** 传的 expectedRevision 比服务端旧：重读会话拿最新 revision 再重试。 */
  "integration_revision_stale",
  /** 传的 expectedRevision 比服务端新：这个值是猜的，服务端从没发过它。 */
  "integration_revision_ahead",
  /** 会话当前阶段不接受这个动作（例如认证跑起来之后再 propose）。 */
  "integration_stage_not_allowed",
  /** 这个 action 的必填字段没给全——**一次列全**，不逐个抛（实测 22 次失败里 9 次栽在逐个抛上）。 */
  "integration_required_fields_missing",
  /**
   * 挑的 modelKey 不在这家供应商探到的候选里。**只在探到过候选时才判**——
   * 供应商没有 model-list 端点时（候选为空）本来就只能手写，那时不拦。
   * 为什么要有这条：模型编一个 modelKey 出来，用户画布模型框里就会多一个永远出不了片的模型，
   * 而它看起来和真的一模一样。工具描述里写着「Never invent a modelKey」，
   * 这条就是那句话的运行时判据（不然描述是空话）。
   */
  "integration_model_not_a_candidate",
] as const;

export type IntegrationErrorCode = typeof INTEGRATION_ERROR_CODES[number];

/**
 * 带码 + 可执行细节的接入会话错误。`code` 走 MCP 工具错误契约（结果里 `isError: true` +
 * `structuredContent.nomiOutcome.errorCode`，见 MCP 规范 2025-06-18 server/tools §Error Handling），
 * `details` 里的 `currentRevision` 让 Agent 不必再猜。
 */
export class IntegrationRequestError extends Error {
  readonly code: IntegrationErrorCode;
  readonly details?: Record<string, string | number>;

  constructor(code: IntegrationErrorCode, message: string, details?: Record<string, string | number>) {
    super(message);
    this.name = "IntegrationRequestError";
    this.code = code;
    if (details) this.details = details;
  }
}

/**
 * 唯一的 expectedRevision 判据。三种失败各自成码，成功返回 void。
 * 每个写入口都必须走它 —— 这就是「一句话表示四件事」这一族的共享边界。
 */
export function assertIntegrationRevision(expectedRevision: unknown, currentRevision: number): void {
  if (!Number.isInteger(expectedRevision)) {
    throw new IntegrationRequestError(
      "integration_expected_revision_missing",
      `expectedRevision is required and must be an integer; the session is currently at revision ${currentRevision}`,
      { currentRevision },
    );
  }
  const expected = expectedRevision as number;
  if (expected === currentRevision) return;
  if (expected < currentRevision) {
    throw new IntegrationRequestError(
      "integration_revision_stale",
      `expectedRevision ${expected} is behind the session; re-read the session and retry with expectedRevision ${currentRevision}`,
      { currentRevision, sentRevision: expected },
    );
  }
  throw new IntegrationRequestError(
    "integration_revision_ahead",
    `expectedRevision ${expected} was never issued by Nomi; the session is at revision ${currentRevision}. Do not increment it yourself — read it back`,
    { currentRevision, sentRevision: expected },
  );
}
