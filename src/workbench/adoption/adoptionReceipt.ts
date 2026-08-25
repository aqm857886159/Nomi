import i18n from '../../i18n'
import { toast } from '../../ui/toast'
import { showUndoToast } from '../../utils/showUndoToast'
import { useWorkbenchStore } from '../workbenchStore'
import { proposalIsLanded } from './adoptionProposalRegistry'
import type { AdoptProposal, AdoptionOutcome } from './adoptionTypes'

/**
 * 回执层：把采纳结果翻译成**用户看得懂的一句话 + 一个可逆动作**。
 *
 * 设计约束（R2 / D1）：形态不变。回执仍是既有的 toast 词汇，不新造面板、不加确认弹窗。
 * Proposal 这层对用户是**隐形的**——它只在此前会静默出错的三种情况下才现身：
 *  · 重复点 → 「已在时间轴上」（而不是默默多一份）
 *  · 产物换版 → 「这个镜头已重新生成过」（而不是默默落旧版）
 *  · 补偿失败 → 「没能加进去，时间轴保持原样」（而不是留半落的轴）
 */

export type AdoptionReceiptOptions = {
  /** 成功时是否展开时间轴让结果立刻可见。节点点击/拼片=是；轴内拖放=已经在看着轴了。 */
  revealTimeline?: boolean
  /** 成功文案 key 覆写（批量用「已排 N 个镜头」）。 */
  successMessage?: string
}

/**
 * 成功文案**从落点语义派生**，不写死一句。
 *
 * 此前无论怎么落轴都报「已加入时间轴末尾」：用户明明把片段拖到了第 120 帧，
 * 回执却告诉他东西在末尾——这不是措辞问题，是回执在说假话。
 * 派生的真相源是提案上的 `placementKind`（落点在哪算出来的，文案就在哪定），
 * 所以任何新落点方式只要如实登记，回执自动跟上，不需要每个调用方各传一次文案。
 */
function successMessageFor(proposal: AdoptProposal): string {
  return proposal.placementKind === 'frame'
    ? i18n.t('timelineEditor.addedAtPosition')
    : i18n.t('timelineEditor.addedToEnd')
}

export function reportAdoptionOutcome(
  outcome: AdoptionOutcome,
  options: AdoptionReceiptOptions = {},
): void {
  switch (outcome.status) {
    case 'applied': {
      if (options.revealTimeline !== false) {
        useWorkbenchStore.getState().setTimelinePanelCollapsed(false)
      }
      if (outcome.replayed) {
        // 幂等重放：轴没变，所以**不给撤销**——那会撤掉上一次的成果，是误导。
        toast(i18n.t('timelineEditor.adoption.alreadyOnTimeline'), 'info')
        return
      }
      showUndoToast({
        message: options.successMessage || successMessageFor(outcome.proposal),
        // 撤销**绑定到这一次采纳**，不是无条件弹一层撤销栈。
        //
        // 回执 toast 会在屏上留 8 秒，这期间用户完全可能已经用别的方式撤掉了这次采纳
        // （时间轴自己的撤销按钮、Cmd+Z、或者另一条还没消失的回执）。此时这次采纳的成果
        // 早已不在轴上，再弹一层栈撤掉的是**用户没要求撤的上一笔编辑**——他会眼睁睁看着
        // 一个没碰过的片段消失，且没有任何东西告诉他刚才发生了什么。
        //
        // 判据复用 `proposalIsLanded`（与幂等重放同一个概念，不另造一套）：
        // 成果原样都在、且轴自采纳后一动没动，才说明「现在撤」撤的就是这一笔。
        // 这和上面重放分支不给撤销是同一条道理——撤掉别人的成果就是误导。
        isUndoable: () => proposalIsLanded(outcome.proposal, useWorkbenchStore.getState().timeline),
        // 光在点击那一刻拦还不够：一个**点了没反应**的按钮仍然摆在那儿，
        // 用户会以为撤销坏了。轴一旦不再 landed 就把这张回执收掉，
        // 让失效的动作**从眼前消失**，而不是留个哑巴按钮。
        watchUndoable: (recheck) => useWorkbenchStore.subscribe((state) => state.timeline, recheck),
        onUndo: () => useWorkbenchStore.getState().undoTimeline(),
      })
      return
    }
    case 'stale':
      toast(i18n.t('timelineEditor.adoption.stale'), 'info')
      return
    case 'needs_attention':
      toast(i18n.t('timelineEditor.adoption.versionChanged'), 'warning')
      return
    case 'failed':
      toast(i18n.t('timelineEditor.adoption.failedRecovered'), 'error')
      return
    case 'needs_recovery':
      toast(i18n.t('timelineEditor.adoption.needsRecovery'), 'error')
      return
    case 'nothing_to_adopt':
      toast(i18n.t('generationCommon.node.generateFirst'), 'info')
      return
  }
}
