/**
 * 花费确认这一跳的对外投影（MCP `nomi_integration action=confirm` 的返回形状）。
 * 纯函数，与会话状态机无关，所以住在这里而不是继续喂那个巨壳（R9/R12）。
 */
import type { IntegrationSession } from "./integrationSession";
import type { IntegrationStage } from "../shared/integrationContract";

export type IntegrationConfirmationChallenge = {
  sessionId: string;
  challengeId: string;
  expiresAt: string;
  contractHash: string;
  maximumCost: number;
  currency: string;
  stage: IntegrationStage;
  expectedRevision: number;
  serverTime: string;
  expiresInSeconds: number;
  nextAction: string;
};

/**
 * 花费确认的对外投影。除了挑战本身，额外给三样模型真正用得上的东西：
 *   · `stage` / `nextAction`：这一跳之后到底该谁动（实测里两个回合都在这里选错）
 *   · `serverTime` + `expiresInSeconds`：相对量。只给绝对 UTC 等于让 LLM 做它最不擅长的
 *     时间比较——实测里 agent 拿自己「今天是 09-11」的认知比出「已过期」并停下，其实还有 5 分钟。
 *   · `expectedRevision`：下一跳该传的值，省掉一次重读。
 */
export function integrationConfirmationProjection(
  session: IntegrationSession,
  input: {
    challengeId: string;
    expiresAt: string;
    contractHash: string;
    maximumCost: number;
    currency: string;
    now: string;
  },
): IntegrationConfirmationChallenge {
  const remaining = Number.isFinite(Date.parse(input.expiresAt))
    ? Math.max(0, Math.round((Date.parse(input.expiresAt) - Date.parse(input.now)) / 1000))
    : 0;
  return {
    sessionId: session.id,
    challengeId: input.challengeId,
    expiresAt: input.expiresAt,
    contractHash: input.contractHash,
    maximumCost: input.maximumCost,
    currency: input.currency,
    stage: session.stage,
    expectedRevision: session.revision,
    serverTime: input.now,
    expiresInSeconds: remaining,
    nextAction:
      session.stage === "human_confirmed"
        ? "call nomi_integration action=start with this sessionId and expectedRevision"
        : "wait for the person to approve in Nomi, then poll nomi_read target=integration; do NOT call confirm again",
  };
}
