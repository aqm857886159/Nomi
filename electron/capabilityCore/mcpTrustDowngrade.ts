// 能力核 · MCP 「以后 ¥X 内别再逐镜问」的客户端确认（nomi_run_control action=set_trust → budget_only）。
//
// 2026-09-10 21:00 用户拍板：外部 MCP 客户端不该被逼回 Nomi 界面点确认——否则他为什么在外面用 MCP。
// 所以这次降档也弹在**调用方客户端**里：摊开逐镜价目与合计，答「是」当场拿主进程铸的收据，
// 收据随 `production.control` 回到 Run 命令边界验+一次性消费（productionRunApprovalReceipt.ts）。
//
// Nomi 只坚持一条：**每笔付费放行都要对应一次真人答过的确认**。降到 budget_only 之后逐镜确认门
// 不再生成，剩余镜头直接提交给供应商——那就是一次付费放行，所以它要收据。其余档位（key_confirm /
// confirm_all）是收紧，不走这条路，原样 invoke。
//
// 确认面复用 `requestGenerationConfirmation`（mcpGateConfirmation.ts）：同一条 challenge → 恰好一个
// 确认面、同 challengeId 并发去重、客户端问不了时落 Nomi 卡兜底。不新建第二个确认流（P1）。
//
// 文案就地写、不走 desktopT：与 mcpCredentialElicitation.ts 同因——electron/i18n.ts 会 value-import
// `electron`，裸 Node 的 MCP launcher 导入闭包里不允许。
import type { GenerationGateChallengeProjection, GenerationGateConfirmation } from './mcpGateConfirmation'
import type { ResultLocale } from './mcpToolResults'

export type TrustDowngradeDependencies = {
  invokeForRequest: (method: string, params: Record<string, unknown>) => Promise<unknown>
  requestGenerationConfirmation: (challenge: GenerationGateChallengeProjection, signal?: AbortSignal) => Promise<GenerationGateConfirmation>
  reply: (id: unknown, result: unknown) => void
  buildToolResultPayload: (toolName: string, args: Record<string, unknown>, result: unknown) => Record<string, unknown>
  locale: () => ResultLocale
}

const COPY = {
  unpriced: (locale: ResultLocale) => locale === 'en'
    ? 'Not applied: Nomi cannot state an exact ceiling for this run yet, so it will not ask you to approve one. Seal the shot plan first (every shot needs a known price).'
    : '未生效：这个制作还算不出确切的上限，Nomi 不会拿一个说不清的数字问你批准。请先把镜头计划封存（每一镜都要有已知价格）。',
  denied: (locale: ResultLocale) => locale === 'en'
    ? 'Not applied: you did not approve running the remaining shots without a per-shot question.'
    : '未生效：你没有批准「以后在这个上限内不再逐镜问」。',
  noSurface: (locale: ResultLocale) => locale === 'en'
    ? 'Not applied: neither your AI client nor an open Nomi window could ask you to confirm this spending change.'
    : '未生效：你的 AI 客户端和 Nomi 窗口都没能向你征求这次花费授权的确认。',
}

function errorReply(deps: TrustDowngradeDependencies, id: unknown, text: string): void {
  deps.reply(id, { content: [{ type: 'text', text }], isError: true })
}

/**
 * 处理一次 `nomi_run_control`。返回 true = 本模块已经回过话，调用方别再 invoke。
 * 只截 `set_trust → budget_only`；其余动作/档位返回 false，走原样派发。
 */
export async function handleTrustDowngrade(
  input: { id: unknown; toolName: string; args: Record<string, unknown>; built: Record<string, unknown>; routedMethod: string; requestSignal?: AbortSignal },
  deps: TrustDowngradeDependencies,
): Promise<boolean> {
  if (input.toolName !== 'nomi_run_control' || input.args.action !== 'set_trust' || input.args.trustLevel !== 'budget_only') return false
  const projectId = typeof input.built.projectId === 'string' ? input.built.projectId : ''
  const runId = typeof input.built.runId === 'string' ? input.built.runId : ''
  let challenge: GenerationGateChallengeProjection
  try {
    challenge = await deps.invokeForRequest('production.trust-challenge', { projectId, runId }) as GenerationGateChallengeProjection
  } catch (error) {
    // 算不出正数上限 → 不弹、直接拒绝（永不 ¥0）。其余错误照常上抛，别把真故障洗成「没批准」。
    if ((error as { code?: unknown })?.code === 'human_approval_required') {
      errorReply(deps, input.id, COPY.unpriced(deps.locale()))
      return true
    }
    throw error
  }
  const confirmation = await deps.requestGenerationConfirmation(challenge, input.requestSignal)
  if (!confirmation.confirmed) {
    errorReply(deps, input.id, confirmation.surface === 'none' ? COPY.noSurface(deps.locale()) : COPY.denied(deps.locale()))
    return true
  }
  const result = await deps.invokeForRequest(input.routedMethod, {
    ...input.built,
    ...(confirmation.receiptId ? { receiptId: confirmation.receiptId } : {}),
    ...(confirmation.receiptToken ? { receiptToken: confirmation.receiptToken } : {}),
  })
  deps.reply(input.id, deps.buildToolResultPayload(input.toolName, input.args, result))
  return true
}
