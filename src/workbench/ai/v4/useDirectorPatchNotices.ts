// 3D-BOX：stage_shot 补丁覆盖了用户手调时，Agent 面板在那一笔工具行下面**确定性地**说一句
// 「这次改动覆盖了你在镜头 2 的手调，可撤销」（真实测试 ④：DeepSeek 一句没提，不能只靠模型复述）。
//
// 数据只读两处既有的事实，不另存：
//   · 转录里的收据授权 host-note（toolCallId ↔ 提议 id，与面板「撤销」钮同一份，见 laneReceiptUndo）；
//   · 导演节点计划 meta 上 applyDirectorWrite 记的 patchNotes（提议 id → 被覆盖的手调）。
// 撤销那一笔 = 计划 meta 整份放回 → 记录消失 → 这句不再出现。开关关时没有 stage_shot 补丁，恒为原样。
import React from 'react'
import { useTranslation } from 'react-i18next'
import type { LanePart } from '../../../../electron/shared/agentLane/laneContracts'
import { LANE_RECEIPT_AUTHORITY_NOTE, parseLaneReceiptAuthority } from '../../../../electron/shared/agentLane/laneReceiptAuthority'
import { useGenerationCanvasStore } from '../../generationCanvas/store/generationCanvasStore'
import { findDirectorPatchNote, type DirectorPatchNoteTarget } from '../../generationCanvas/nodes/director/model/directorPatchNotes'
import type { V4FlowItem } from './agentPanelV4Types'

type Translate = (key: string, options?: Record<string, unknown>) => string

/** 被覆盖的对象 → 一句人话（纯函数，测试直接调）。 */
export function directorPatchNoticeText(targets: readonly DirectorPatchNoteTarget[], t: Translate): string {
  const names = targets.map((target) => (target.kind === 'shot' ? t('director.agent.focusShot', { index: target.index }) : target.name))
  return t('director.view.patchOverrode', { targets: names.join(t('director.view.focusListSeparator')) })
}

/** toolCallId → 那一笔覆盖了什么（只认收据授权 host-note 指名的那一条）。 */
export function directorPatchNoticesFor(parts: readonly LanePart[], nodes: Parameters<typeof findDirectorPatchNote>[0], t: Translate): ReadonlyMap<string, string> {
  const notices = new Map<string, string>()
  for (const part of parts) {
    if (part.kind !== 'host-note' || part.noteType !== LANE_RECEIPT_AUTHORITY_NOTE) continue
    let note: ReturnType<typeof parseLaneReceiptAuthority>
    try { note = parseLaneReceiptAuthority(part.data) } catch { continue }
    if (!note.toolCallId) continue
    const targets = findDirectorPatchNote(nodes, note.receiptProposalId)
    if (targets) notices.set(note.toolCallId, directorPatchNoticeText(targets, t))
  }
  return notices
}

function withNotice(item: V4FlowItem, notices: ReadonlyMap<string, string>): V4FlowItem {
  if (item.kind === 'tool') {
    const notice = item.receipt.toolCallId ? notices.get(item.receipt.toolCallId) : undefined
    return notice ? { ...item, receipt: { ...item.receipt, notice } } : item
  }
  if (item.kind === 'tool-group') {
    const receipts = item.receipts.map((receipt) => {
      const notice = receipt.toolCallId ? notices.get(receipt.toolCallId) : undefined
      return notice ? { ...receipt, notice } : receipt
    })
    return receipts.some((receipt, index) => receipt !== item.receipts[index]) ? { ...item, receipts } : item
  }
  if (item.kind === 'process' && item.details) {
    const details = item.details.map((detail) => ({ ...detail, item: withNotice(detail.item, notices) }))
    return details.some((detail, index) => detail.item !== item.details![index].item) ? { ...item, details } : item
  }
  return item
}

export function useDirectorPatchNotices(flow: readonly V4FlowItem[], parts: readonly LanePart[]): readonly V4FlowItem[] {
  const { t } = useTranslation()
  const nodes = useGenerationCanvasStore((state) => state.nodes)
  return React.useMemo(() => {
    const notices = directorPatchNoticesFor(parts, nodes, t as unknown as Translate)
    return notices.size ? flow.map((item) => withNotice(item, notices)) : flow
  }, [flow, nodes, parts, t])
}

/** 一行流水（过程 / 工具组 / 单条收据）里带着的那几句提示，收起的过程行也照样露在外面。 */
export function flowItemNotices(item: V4FlowItem): string[] {
  if (item.kind === 'tool') return item.receipt.notice ? [item.receipt.notice] : []
  if (item.kind === 'tool-group') return item.receipts.flatMap((receipt) => (receipt.notice ? [receipt.notice] : []))
  if (item.kind === 'process') return (item.details ?? []).flatMap((detail) => flowItemNotices(detail.item))
  return []
}
