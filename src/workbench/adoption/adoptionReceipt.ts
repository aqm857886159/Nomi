import i18n from '../../i18n'
import { toast } from '../../ui/toast'
import { showUndoToast } from '../../utils/showUndoToast'
import { useWorkbenchStore } from '../workbenchStore'
import type { AdoptionOutcome } from './adoptionTypes'

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
        message: options.successMessage || i18n.t('timelineEditor.addedToEnd'),
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
