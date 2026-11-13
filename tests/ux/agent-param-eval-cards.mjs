// 参数题库跑器的「答卡」：回合中途弹出来的卡，像真人一样处理，直到回合走完。
//
// 题库只量「参数写没写对、重试几次」，不出片、不删东西，所以：
//   · 提问卡    → 点第一颗选项（没有选项就打一句「你定就好」）。每张都答，量得到「答完之后还往下做吗」；
//   · 报价卡    → 取消（× 再「拒绝」）。**绝不点确认**——点了就是真花钱；
//   · 删除 / 撤销审批卡 → 按本题显式声明；未声明拒绝并标记；
//   · 应用级设置模态（模型调 start_model_setup 弹的） → 点关闭；
//   · 画布的花钱确认框 / 分镜批量预览 → 取消。
// 答过什么记进 `cardsAnswered`，judge 的「停在付费确认卡」靠它。
//
// 已知重复：`agent-askback-real-model.walk.mjs` 里有一份同样的循环。合并它要重跑付费走查，留作后续，
// 这里不动那条走查。
import path from 'node:path'
import { stationTimeout } from './_station-budget.mjs'
import { COMPOSER, COMPOSER_INPUT } from './agent-runtime-walk-support.mjs'

/** 轮询间隔：每圈都重新观察卡 / 回合状态，这不是「操作完成」的信号。 */
const POLL_MS = 1000

/** 只接受题库对删除/撤销的声明，花钱和未知工具永远不自动批准。 */
export function approvalDecision(task, toolName) {
  const declared = task?.approvals?.[toolName]
  const allowed = ['delete_from_canvas', 'undo'].includes(toolName)
  return { decision: allowed && declared === 'approve' ? 'approve' : 'decline',
    declared: allowed && ['approve', 'decline'].includes(declared) }
}

export function createCardDriver({ win, panel, outputDir }) {
  const card = (kind) => win.locator(`${panel} [data-v4-block="intervention"][data-kind="${kind}"]`)
  const questionCard = card('question')
  const spendCard = card('spend')
  const approvalCard = win.locator(`${panel} [data-v4-block="intervention"][data-kind="approval-irreversible"], ${panel} [data-v4-block="intervention"][data-kind="approval-reversible"]`).first()
  const running = win.locator(`${panel} ${COMPOSER}[data-mode="running"]`)
  const tap = { timeout: stationTimeout({ operations: 1 }) }
  let blockedShotTaken = false

  /** 先观察输入框点不点得到（遮罩盖着时 DOM 上仍「可编辑」）；点不到才按 Esc。返回按了几次，-1 = 解不开。 */
  async function ensureComposerUsable() {
    const input = win.locator(`${panel} ${COMPOSER_INPUT}`)
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const usable = await input.click({ trial: true, timeout: 3_000 }).then(() => true).catch(() => false)
      if (usable) return attempt
      if (!blockedShotTaken) { blockedShotTaken = true; await win.screenshot({ path: path.join(outputDir, 'panel-blocked.png') }).catch(() => {}) }
      await win.keyboard.press('Escape')
      await win.waitForTimeout(800)
    }
    return -1
  }

  async function closeSettingsPanelIfOpen() {
    const overlay = win.locator('[data-settings-overlay]').first()
    if (!await overlay.isVisible().catch(() => false)) return false
    await win.locator('[data-settings-close]').first().click(tap).catch(() => {})
    await overlay.waitFor({ state: 'hidden', timeout: stationTimeout({ operations: 1 }) }).catch(() => {})
    return true
  }

  /** 点遮罩 = 取消；绝不碰 data-production-action="confirm"。 */
  async function declineSpendDialogIfOpen() {
    const dialog = win.locator('[data-spend-confirm-dialog]').first()
    if (!await dialog.isVisible().catch(() => false)) return false
    await win.locator('div:has(> [data-spend-confirm-dialog])').first().click({ position: { x: 5, y: 5 }, ...tap }).catch(() => {})
    await dialog.waitFor({ state: 'hidden', timeout: stationTimeout({ operations: 1 }) }).catch(() => {})
    return true
  }

  async function rejectIntervention(slot) {
    const confirmReject = slot.locator('[data-v4-control="confirm-reject"]')
    if (!await confirmReject.isVisible().catch(() => false)) await slot.locator('[data-v4-control="slot-dismiss"]').click(tap).catch(() => {})
    if (await confirmReject.isVisible().catch(() => false)) await confirmReject.click(tap).catch(() => {})
  }

  /**
   * 发出去之后一直答卡，直到这一回合的 composer 回到 idle。返回 { cardsAnswered, timedOut }。
   * 超时只是安全上限，不是完成条件；撞上了如实记 timedOut，这一题的轨迹照常读。
   */
  async function driveTurn(label, { task, pendingTool = () => undefined } = {}) {
    const cardsAnswered = []
    await running.waitFor({ state: 'visible', timeout: stationTimeout({ operations: 2 }) }).catch(() => {})
    const deadline = Date.now() + stationTimeout({ turns: 3 })
    while (Date.now() < deadline) {
      if (await closeSettingsPanelIfOpen()) { cardsAnswered.push('settings:closed'); await win.waitForTimeout(POLL_MS); continue }
      if (await declineSpendDialogIfOpen()) { cardsAnswered.push('spend-dialog:declined'); await win.waitForTimeout(POLL_MS); continue }
      if (await questionCard.count() > 0) {
        const chip = questionCard.locator('[data-ask-question][data-active="true"] [data-v4-control="question-option"]').first()
        const proceed = questionCard.locator('[data-v4-control="ask-continue"]').first()
        const chipCount = await chip.count()
        if (await proceed.isEnabled().catch(() => false)) {
          await proceed.click(tap).then(() => cardsAnswered.push('question:continue')).catch(() => {})
        } else if (chipCount > 0 && await chip.isEnabled().catch(() => false)) {
          await chip.click(tap).then(() => cardsAnswered.push('question:chip')).catch(() => {})
        } else {
          const own = questionCard.locator('[data-ask-question][data-active="true"] [data-v4-control="question-answer"]').first()
          await own.fill('你定就好，按最稳妥的来').catch(() => {})
          await own.press('Enter').then(() => cardsAnswered.push('question:typed')).catch(() => {})
        }
        await win.waitForTimeout(POLL_MS)
        continue
      }
      if (await spendCard.count() > 0) {
        await win.screenshot({ path: path.join(outputDir, `${label}-spend-card.png`) }).catch(() => {})
        await rejectIntervention(spendCard)
        cardsAnswered.push('spend:declined')
        await win.waitForTimeout(POLL_MS)
        continue
      }
      if (await approvalCard.count() > 0) {
        const tool = pendingTool() ?? 'unknown'
        const policy = approvalDecision(task, tool)
        if (policy.decision === 'approve') await approvalCard.locator('[data-v4-control="confirm"]').click(tap)
        else await rejectIntervention(approvalCard)
        cardsAnswered.push(`approval:${tool}:${policy.decision}:${policy.declared ? 'declared' : 'unspecified'}`)
        await win.waitForTimeout(POLL_MS)
        continue
      }
      const dialogCancel = win.locator('[data-confirm-dialog-cancel="true"]').first()
      const batchCancel = win.locator('[data-batch-plan-overlay] button').filter({ hasText: /取消|Cancel/ }).first()
      if (await dialogCancel.isVisible().catch(() => false)) {
        await dialogCancel.click(tap).then(() => cardsAnswered.push('editor-confirm:cancelled')).catch(() => {})
        await win.waitForTimeout(POLL_MS)
        continue
      }
      if (await batchCancel.isVisible().catch(() => false)) {
        await batchCancel.click(tap).then(() => cardsAnswered.push('batch-preview:cancelled')).catch(() => {})
        await win.waitForTimeout(POLL_MS)
        continue
      }
      if (!await running.isVisible().catch(() => false)) return { cardsAnswered, timedOut: false }
      await win.waitForTimeout(POLL_MS)
    }
    return { cardsAnswered, timedOut: true }
  }

  return { ensureComposerUsable, driveTurn }
}
