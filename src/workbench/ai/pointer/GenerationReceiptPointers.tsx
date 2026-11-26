// 对话流里 `generate` 那一条生成记录下面的那一组镜头（2026-11-15 付费确认拆开，设计卡 docs/plan/2026-11-15-spend-ask-split.md）。
//
// 一次生成只有一组，从头到尾挂在同一个位置：
//   · 出价还开着（输入框上方那一条确认在问）：这一批镜头一行一个，行数据是确认条那份投影（`useSpendOfferRows`），
//     哪一镜有话要说写在它自己那一行第二行；行尾悬停 / 聚焦露「不生成 ×」，去掉了的淡下去、常驻「恢复」；
//   · 出价关了：那几镜里交出去的那几段（`receiptShotNodeIds`），下面一句「✓ 已发出 N 段」（那几段节点都出了结果就是「✓ 已生成 N 段」——
//     刚交出去就说「已生成」是替还没发生的事下结论）。
// 两种时候是同一个列表组件、同一个位置：展开过的（超过 4 行折起的「还有 N 个镜头」）不因为出价关了又收回去。
// 每一行都是指向元素：实时读节点（生成中 / 结果 / 失败都是节点自己的样子），点了定位、悬停点亮节点、窄窗口收起对话。
// 哪几镜、各指哪个节点、那一句说什么，算法在 generationReceiptFacts.ts（纯函数）。
import React, { type JSX } from 'react'
import { useTranslation } from 'react-i18next'
import { useProductionCanvasLandingStore } from '../../production/productionCanvasLandingStore'
import { useGenerationCanvasStore } from '../../generationCanvas/store/generationCanvasStore'
import { selectCanvasNodeById } from '../../generationCanvas/store/canvasNodeGenerationIndex'
import type { GenerationCanvasState } from '../../generationCanvas/store/canvasStoreTypes'
import { ThumbCornerX } from '../../assets/ThumbCornerX'
import { IconCheck } from '../v4/AgentPanelV4Icons'
import type { SpendCardPointer } from '../v4/agentPanelSpendCard'
import { spendOfferSubject, useSpendOfferRows, type SpendOfferRows } from '../v4/spendCardOfferRows'
import { NodePointerGroup, type NodePointerRowAccessory } from './NodePointerGroup'
import type { NodePointerSubject } from './nodePointerModel'
import { receiptLine, receiptShotNodeIds, type ReceiptLine } from './generationReceiptFacts'

const RECEIPT_COPY = {
  video: { sent: 'agentPanelV4.spendCard.receiptSentVideo', generated: 'agentPanelV4.spendCard.receiptGeneratedVideo' },
  image: { sent: 'agentPanelV4.spendCard.receiptSentImage', generated: 'agentPanelV4.spendCard.receiptGeneratedImage' },
} as const

/** 那几镜节点此刻的「段 / 张」与「都出结果了没有」，压成一个字给订阅比对：节点每推一帧进度，结论不变就不重渲。 */
function receiptLineKey(state: Pick<GenerationCanvasState, 'nodes' | 'edges'>, nodeIds: readonly string[]): string {
  const line = receiptLine(nodeIds.map((id) => selectCanvasNodeById(state, id)))
  return `${line.unit}:${line.phase}`
}

/**
 * 行尾那颗小钮本身（摆在哪、什么时候露出来、淡不淡归组指向管，`NodePointerRowAccessory`）。
 * 「不生成」是一颗小 ×，样子和读屏名是输入框里参考图那一颗（共用 ThumbCornerX），这里不另写；「恢复」是一颗常驻的小文字钮。
 */
function ExclusionToggle({ pointer, offer }: { pointer: SpendCardPointer; offer: SpendOfferRows }): JSX.Element {
  const { t } = useTranslation()
  if (pointer.exclusion === 'restore') {
    const name = t('agentPanelV4.spendCard.restoreName', { shot: pointer.shotRef })
    return (
      <button
        type="button"
        aria-label={name}
        title={name}
        disabled={offer.busy}
        onClick={() => offer.onRestore(pointer.shotId)}
        data-spend-exclusion="restore"
        className="inline-flex h-6 items-center rounded-nomi-sm px-1.5 text-caption text-nomi-ink-80 hover:bg-nomi-ink-05 hover:text-nomi-ink disabled:opacity-40"
      >
        {t('agentPanelV4.spendCard.restore')}
      </button>
    )
  }
  const name = t('agentPanelV4.spendCard.excludeName', { shot: pointer.shotRef })
  return <ThumbCornerX aria-label={name} title={name} disabled={offer.busy} onClick={() => offer.onExclude(pointer.shotId)} data-spend-exclusion="exclude" />
}

/** 这一行挂什么：可去掉的挂「不生成 ×」（悬停 / 聚焦才露）；去掉了的淡下去、常驻「恢复」；别的（已在交、已删除……）不挂。 */
function exclusionAccessory(pointer: SpendCardPointer | undefined, offer: SpendOfferRows): NodePointerRowAccessory | null {
  if (!pointer?.exclusion) return null
  const restore = pointer.exclusion === 'restore'
  return { action: <ExclusionToggle pointer={pointer} offer={offer} />, pinned: restore, dimmed: restore }
}

export function GenerationReceiptPointers({ operationId }: { operationId?: string }): JSX.Element | null {
  const { t } = useTranslation()
  const offer = useSpendOfferRows(operationId)
  const id = operationId ?? offer?.operationId ?? ''
  // 订一个字符串：落地投影每推一次新 Run 都会换对象，这几镜指着的节点没变就不重渲。
  const key = useProductionCanvasLandingStore((store) => (offer ? '' : receiptShotNodeIds(store.runs, id).join('\n')))
  const nodeIds = React.useMemo(() => (key ? key.split('\n') : []), [key])
  const lineKey = useGenerationCanvasStore((state) => receiptLineKey(state, nodeIds))
  const subjects = React.useMemo<NodePointerSubject[]>(
    () => (offer ? offer.pointers.map(spendOfferSubject) : nodeIds.map((nodeId) => ({ nodeId }))),
    [offer, nodeIds],
  )
  if (subjects.length === 0) return null
  const [unit, phase] = lineKey.split(':') as [ReceiptLine['unit'], ReceiptLine['phase']]
  return (
    <div className="flex flex-col gap-1.5 px-2" data-v4-block="generation-receipt-pointers" data-operation-id={id} data-offer-open={offer ? 'true' : undefined}>
      <NodePointerGroup
        subjects={subjects}
        density="row"
        rowDetail="status"
        // 出价还开着时确认条在问「要不要」：行里不再重复「等你确认」。
        suppressAwaitingConfirmation={Boolean(offer)}
        {...(offer ? { rowAccessory: (_subject: NodePointerSubject, index: number) => exclusionAccessory(offer.pointers[index], offer) } : {})}
      />
      {offer ? null : (
        <span className="flex items-center gap-1.5 text-caption text-nomi-ink-60" data-v4-block="generation-receipt-line" data-receipt-phase={phase}>
          <IconCheck size={14} aria-hidden="true" className="shrink-0" />
          {t(RECEIPT_COPY[unit][phase], { count: subjects.length })}
        </span>
      )}
    </div>
  )
}

/**
 * 那一笔出价对话里找不到它那一条生成记录（例如从别的对话起的、历史还没读到那一条）：那一组画在对话最后，
 * 不让一批要花钱的镜头只剩确认条上的两颗按钮、看不到是哪几镜。
 */
export function SpendOfferRowsWithoutRecord({ recorded }: { recorded: ReadonlySet<string> }): JSX.Element | null {
  const offer = useSpendOfferRows()
  if (!offer || recorded.has(offer.operationId)) return null
  return <GenerationReceiptPointers operationId={offer.operationId} />
}
