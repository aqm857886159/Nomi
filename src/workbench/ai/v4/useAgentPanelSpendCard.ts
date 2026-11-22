// Agent 面板付费卡的接线（D2 第③步，SpendCardQ1 板）：宿主推过来的那一次出价 ↔ 画布节点此刻的样子 ↔ 介入槽。
//
// ── 卡上没有第二份数据 ──
//
// 旧卡有自己的一本账（localStorage 卡账本、卡上的写口、确认前逐镜改候选、本地重算报价），节点与卡两边各存一份，
// 两边拉锯。这一版卡上的每一个字都从节点现读——只订这几镜自己的节点，不随整个画布重渲——按下「生成」就是把这几镜
// 照节点当前的样子交给画布（主进程记交接，渲染层走画布单节点提交那一条路：`production.hand-over-shots`）。想改就点指向
// 元素去节点里改；卡上一个可改的东西都没有（设计系统 §1.0）。旧卡账本的 `nomi:spend-draft:*` 键这里一个都不读。
//
// ── 这里只做三件事 ──
//
//   ① 读：出价（对话投影推过来）+ 每一镜节点此刻的事实（模型名、比例、时长、清晰度、价、分镜号、本机预检）→ 纯投影
//      `projectSpendCard`；读不到出价时是一张会说话的缺卡（`missingInterventionCard`），不是「没有」；
//   ② 主按钮那一下：生成 / 再试一次（交给画布）、去改 / 去看（定位到节点）；
//   ③ 「取消」/「先不发了」：任何时候立刻送到宿主，不排在卡上别的动作后面（正在发出时它就是「停下剩下的」）。
import React from 'react'
import { useTranslation } from 'react-i18next'
import { useShallow } from 'zustand/react/shallow'
import { productionRunApi, type ProductionActionResult } from '../../production/productionRunApi'
import { handOverPrecheck } from '../../production/handOverPrecheck'
import { toast, useToastStore } from '../../../ui/toast'
import { logRendererWarn } from '../../../desktop/rendererLog'
import type { GenerationHandOverFailure, PendingSpendActionIdentity, PendingSpendConfirm, PendingSpendRead } from '../../../desktop/productionRunBridgeTypes'
import type { GenerationCanvasState } from '../../generationCanvas/store/canvasStoreTypes'
import { useGenerationCanvasStore } from '../../generationCanvas/store/generationCanvasStore'
import { selectCanvasNodeById } from '../../generationCanvas/store/canvasNodeGenerationIndex'
import { useNodeExternalHighlightStore } from '../../generationCanvas/store/nodeExternalHighlightStore'
import { estimateNodePrice } from '../../generationCanvas/spend/planCostEstimate'
import { nodeSelectedModelAddress } from '../../generationCanvas/nodes/controls/parameterControlModel'
import { useWorkbenchStore } from '../../workbenchStore'
import { formatStoryboardShotLabel, storyboardLabelSource } from '../../generation/list/storyboardLabels'
import { useNodeModelOption } from '../../generation/list/generationListModelLabels'
import { resolveStoryboardShotLabel } from '../../../../electron/shared/canvas/storyboardShotLabel'
import { nodePointerSummaryFacts } from '../pointer/nodePointerFace'
import { revealNodeFromChat } from '../pointer/revealNodeFromChat'
import { projectSpendCard, spendCardStoppedMessage, type SpendCardModel, type SpendCardShotFacts } from './agentPanelSpendCard'
import { spendActionFailureCopy, type SpendActionOutcome } from './spendCardFailure'
import { missingCardReasonOfUnreadable, missingInterventionCard } from './missingInterventionCard'
import type { InterventionData } from './agentPanelV4Types'
import type { SpendCardBodyProps } from './AgentPanelV4SpendCardBody'

/**
 * 推过来的那份读结果 → 此刻卡上那一笔。`off`（本会话按配置没装这条面 / 还在起 / 已停）**不是失败**：
 * 这种相下没有任何一面能 announce「有一笔在等你」，所以没有卡可画，也没有错可报。
 * `unreadable` 不在这里：它是一张会说话的卡（见 `slot`），不是「没有」。
 */
export function pendingSpendOfRead(read: PendingSpendRead | undefined): PendingSpendConfirm | undefined {
  if (read?.surface === 'ready') return read.rows[0]
  return read?.surface === 'unreadable' ? read.card : undefined
}

export type AgentPanelSpendCard = Readonly<{
  /** 此刻卡上那一笔（介入槽的优先序、收起后小球的待确认计数都读它）。 */
  pending: PendingSpendConfirm | undefined
  slot: InterventionData | undefined
  /** 确认条体（共同参数 + 说明行）+ 交给对话那一组的行数据；缺卡 / 没有卡时缺席。 */
  body: SpendCardBodyProps | undefined
  /** 主按钮那一下（卡上那颗按钮的字也是投影定的）。 */
  primary: () => void
  /** 「取消」/「先不发了」：任何时候立刻送到宿主。 */
  discard: () => void
}>

/** 卡上这一镜已经交出去了（在交 / 交到了 / 节点上自己拿走了）：卡自己关掉时它在画布上闪一下。 */
const HANDED_OFFERS: ReadonlySet<PendingSpendConfirm['shots'][number]['offer']> = new Set(['handing_over', 'sent', 'taken_by_canvas'])

const cardIdentity = (card: PendingSpendConfirm): PendingSpendActionIdentity => ({
  ...(card.presentationId ? { presentationId: card.presentationId } : {}),
  ...(card.presentationEpoch !== undefined ? { presentationEpoch: card.presentationEpoch } : {}),
  planVersion: card.planVersion,
})

type PrecheckMemo = { nodes: unknown; edges: unknown; ids: string; value: string }

/**
 * 还没决定的那几镜此刻本机判得出发不出去的那些（`handOverPrecheck`，和交接那一步同一个判据），压成一个字符串给订阅比对：
 * 结论不变就不重渲。画布两张表没换（只改了选区之类）就不重算。
 */
function precheckSignature(state: Pick<GenerationCanvasState, 'nodes' | 'edges'>, ids: string, memo: { current: PrecheckMemo | null }): string {
  const cached = memo.current
  if (cached && cached.nodes === state.nodes && cached.edges === state.edges && cached.ids === ids) return cached.value
  const failures = handOverPrecheck(ids.split('\n'), state)
  const value = failures.size ? JSON.stringify([...failures]) : ''
  memo.current = { nodes: state.nodes, edges: state.edges, ids, value }
  return value
}

/**
 * @param read 这个项目此刻的待决出价——**对话投影推过来的那一份**（`LaneWorkspaceProjection.spend`）。
 *   这个钩子不拉、不轮询：Run 账本一变，主进程就推一份新的过来（`electron/agentLane/laneDesktopSpend.ts`）。
 */
export function useAgentPanelSpendCard(read: PendingSpendRead | undefined): AgentPanelSpendCard {
  const { t, i18n } = useTranslation()
  const pending = pendingSpendOfRead(read)
  const readFailure = read?.surface === 'unreadable' ? missingCardReasonOfUnreadable(read.reason) : undefined

  // ── 读节点：只订这几镜自己的节点 ──
  const shots = pending?.shots
  const nodeIds = React.useMemo(() => (shots ?? []).map((shot) => shot.nodeId ?? ''), [shots])
  const nodes = useGenerationCanvasStore(useShallow((state) => nodeIds.map((id) => selectCanvasNodeById(state, id))))
  const projectId = pending?.projectId
  const canvasReady = useGenerationCanvasStore((state) => Boolean(projectId) && state.isReady && state.projectId === projectId)
  const undecidedIds = React.useMemo(() => (shots ?? []).filter((shot) => shot.offer === 'undecided' && shot.nodeId).map((shot) => shot.nodeId!).join('\n'), [shots])
  const precheckMemo = React.useRef<PrecheckMemo | null>(null)
  const precheckKey = useGenerationCanvasStore((state) => (canvasReady && undecidedIds ? precheckSignature(state, undecidedIds, precheckMemo) : ''))
  const blocked = React.useMemo(() => new Map<string, GenerationHandOverFailure>(precheckKey ? JSON.parse(precheckKey) as Array<[string, GenerationHandOverFailure]> : []), [precheckKey])
  const designs = useWorkbenchStore((state) => state.storyboardDesignsByDocumentId)
  const optionOf = useNodeModelOption()

  const facts = React.useMemo<readonly SpendCardShotFacts[]>(() => (shots ?? []).map((shot, index) => {
    const node = nodes[index]
    const label = node ? resolveStoryboardShotLabel(node, storyboardLabelSource(designs)) : null
    const option = optionOf(node)
    const summary = nodePointerSummaryFacts(node, option?.label ?? '')
    const address = node ? nodeSelectedModelAddress(node.meta || {}) : null
    const precheck = shot.offer === 'undecided' && shot.nodeId ? blocked.get(shot.nodeId) : undefined
    return {
      // 画布还没载入完 / 不是这个项目的画布：不知道就不说已删除（按「在」算，交接那一步会再判一遍）。
      present: canvasReady ? Boolean(node) : true,
      shotRef: label ? formatStoryboardShotLabel(t, label) : t('generationCommon.agentRuntime.shotTitle', { index: shot.index }),
      model: summary.model,
      aspect: summary.aspect,
      durationSec: summary.durationSec,
      resolution: summary.resolution,
      selected: address?.modelKey ? { providerId: address.vendorKey, modelId: address.modelKey } : null,
      price: node ? estimateNodePrice(node, option) : { known: false },
      ...(precheck ? { blocked: precheck } : {}),
    }
  }), [shots, nodes, canvasReady, designs, optionOf, blocked, t])

  // ── 卡上这一下的状态（只有「在路上」与「正在停」两样，其余全读宿主与节点）──
  const [busy, setBusy] = React.useState(false)
  const busyRef = React.useRef(false)
  // 卡上一下动作在路上时点了「取消」的那一次出价：那一下随后的失败不再弹提示，结局由取消那一句说。
  const stoppedDuringAction = React.useRef<string | null>(null)
  const [stoppingFor, setStoppingFor] = React.useState<string | null>(null)
  const sendingNow = Boolean(shots?.some((shot) => shot.offer === 'handing_over'))
  React.useEffect(() => { if (!sendingNow && stoppingFor) setStoppingFor(null) }, [sendingNow, stoppingFor])

  // 读不到的卡（缺卡那一张：读口装配抛了 / 投影抛了）没有卡体、没有主按钮可交：投影只给读得到的那一张算。
  const readable = pending && !readFailure && !pending.error ? pending : undefined
  const model = React.useMemo<SpendCardModel | undefined>(() => (readable
    ? projectSpendCard(readable, facts, {
      busy,
      stopping: stoppingFor === readable.operationId && sendingNow,
    }, t, { locale: i18n.language })
    : undefined), [readable, facts, busy, stoppingFor, sendingNow, t, i18n.language])

  // 「完成时各亮一下」（SpendCardQ1 板 card.done）：卡自己关掉（每一镜都定了）那一刻，交出去的那几镜在画布上一起闪一下。
  // 用户点「取消」关掉的不闪（那是停下，不是完成）；卡换成了另一笔也不闪。只认这个会话里亲眼看着关掉的那一次，重开不补闪。
  // 交出去的那几镜 = 最后一份卡上「在交 / 交到了 / 节点上拿走了」的，加上这张卡上亲手按下去、宿主没说不行的那几镜：
  // 宿主交得快时，「在交」那一份投影可能根本没推到这边（卡从「等你确认」直接没了），只看投影就一下都不闪。
  const lastPendingRef = React.useRef<PendingSpendConfirm | null>(null)
  const pressedRef = React.useRef<{ operationId: string; shotIds: Set<string> } | null>(null)
  const discardedRef = React.useRef<string | null>(null)
  React.useEffect(() => {
    if (pending) {
      if (lastPendingRef.current?.operationId !== pending.operationId) pressedRef.current = null
      lastPendingRef.current = pending
      return
    }
    const last = lastPendingRef.current
    const pressed = pressedRef.current?.operationId === last?.operationId ? pressedRef.current?.shotIds : undefined
    lastPendingRef.current = null
    pressedRef.current = null
    if (!last || discardedRef.current === last.operationId) return
    const nodeIds = last.shots.flatMap((shot) => (shot.nodeId && (HANDED_OFFERS.has(shot.offer) || pressed?.has(shot.shotId)) ? [shot.nodeId] : []))
    if (nodeIds.length > 0) useNodeExternalHighlightStore.getState().flashNodes(nodeIds)
  }, [pending])

  const pendingRef = React.useRef(pending)
  pendingRef.current = pending
  const modelRef = React.useRef(model)
  modelRef.current = model
  // 卡上此刻摆着的那几镜节点（按下那一刻拿来和画布比：卡上看到的 = 交出去的）。
  const shownNodes = React.useRef(nodes)
  shownNodes.current = nodes

  const slot = React.useMemo<InterventionData | undefined>(() => {
    // 读不到的时候**先**出那张会说话的卡：此刻我们并不知道有没有待确认的一笔，而「不知道」正是必须说出口的那一种。
    if (readFailure) {
      return missingInterventionCard({ reason: readFailure, announcer: 'spend-confirm', detail: `pending spend unreadable: ${read?.surface === 'unreadable' ? read.reason : 'unknown'}` }, t)
    }
    if (!pending) return undefined
    // 主进程投影这一次出价时抛了（它把那一笔带着原因推过来，卡的身份照旧是那一次出价）：说读不到，不是「没有」。
    if (pending.error) {
      return missingInterventionCard({ reason: missingCardReasonOfUnreadable('projection-failed'), announcer: 'spend-confirm', detail: `pending spend projection failed: ${pending.error.code}` }, t)
    }
    return model?.slot ?? missingInterventionCard({ reason: 'unknown-kind', announcer: 'spend-confirm', detail: `pending spend projected no card: ${pending.operationId}` }, t)
  }, [readFailure, read, pending, model, t])

  /**
   * 卡上一下动作（交给画布 / 不生成 / 恢复）。**宿主说不行就必须让用户看见**：按了没反应是最贵的一种沉默。
   * 用户看到的永远是 i18n 的那一句（R15），宿主原话只进日志；说哪一句由事实决定（`spendActionFailureCopy`）。
   */
  const act = React.useCallback((target: PendingSpendConfirm, run: () => Promise<ProductionActionResult>): void => {
    if (busyRef.current) return
    busyRef.current = true
    setBusy(true)
    const failed = (reason: unknown, outcome: SpendActionOutcome | undefined): void => {
      logRendererWarn('spend-confirm-refused', { code: outcome?.message ?? outcome?.code, failure: outcome?.failure, reason: outcome?.reason }, reason)
      if (stoppedDuringAction.current === target.operationId) return
      toast(t(spendActionFailureCopy(outcome), { field: outcome?.field ?? '' }), 'error')
    }
    void run()
      .then((result) => { if (!result.ok) failed(result, result) })
      .catch((error: unknown) => failed(error, undefined))
      // 不补刷：动作改的是 Run 账本，账本一变主进程就推一份新的卡过来。
      .finally(() => {
        if (stoppedDuringAction.current === target.operationId) stoppedDuringAction.current = null
        busyRef.current = false
        setBusy(false)
      })
  }, [t])

  /** 按下那一刻，卡上画着的那几镜节点和画布上此刻的是不是同一份（模型 / 参数 / 提示词 / 种类）。不是就不交：卡刚变了，看一眼再按。 */
  const shownIsCurrent = (target: PendingSpendConfirm, shotIds: readonly string[]): boolean => {
    const state = useGenerationCanvasStore.getState()
    return target.shots.every((shot, index) => {
      if (!shotIds.includes(shot.shotId) || !shot.nodeId) return true
      const shown = shownNodes.current[index]
      const now = selectCanvasNodeById(state, shot.nodeId)
      if (!shown || !now) return shown === now
      return shown.meta === now.meta && shown.prompt === now.prompt && shown.kind === now.kind
    })
  }

  const primary = React.useCallback((): void => {
    const target = pendingRef.current
    const card = modelRef.current
    if (!target || !card || busyRef.current) return
    const action = card.primary
    if (action.kind === 'none') return
    if (action.kind === 'locate') {
      if (action.nodeId) void revealNodeFromChat({ nodeId: action.nodeId, label: action.label })
      return
    }
    if (action.shotIds.length === 0) return
    if (!shownIsCurrent(target, action.shotIds)) {
      toast(t('agentPanelV4.spendActionCardChanged'), 'error')
      return
    }
    const pressed = pressedRef.current?.operationId === target.operationId ? pressedRef.current.shotIds : new Set<string>()
    action.shotIds.forEach((shotId) => pressed.add(shotId))
    pressedRef.current = { operationId: target.operationId, shotIds: pressed }
    // 宿主说不行 / 没送到（一镜都没交出去）：这几镜不算按下去了，卡之后为别的原因关掉也不闪它们。
    const unpress = (): void => {
      if (pressedRef.current?.operationId === target.operationId) action.shotIds.forEach((shotId) => pressedRef.current?.shotIds.delete(shotId))
    }
    act(target, () => productionRunApi.handOverSpend({
      projectId: target.projectId, operationId: target.operationId, quoteId: target.quoteId,
      shotIds: action.shotIds, ...cardIdentity(target),
    }).then((result) => {
      if (!result.ok) unpress()
      return result
    }, (error: unknown) => {
      unpress()
      throw error
    }))
  }, [act, t])

  /**
   * 「取消」/「先不发了」= 收回这一次出价，节点与参数都留着。**任何时候都直接送到宿主**（不排在卡上别的动作后面）：
   * 正在发出时就是停下剩下的（已经交出去的照常生成），别的一下在路上时那一下的结局由这一句说。
   */
  const discard = React.useCallback((): void => {
    const target = pendingRef.current
    if (!target) return
    discardedRef.current = target.operationId
    if (target.shots.some((shot) => shot.offer === 'handing_over')) setStoppingFor(target.operationId)
    const ownsBusy = !busyRef.current
    if (ownsBusy) {
      busyRef.current = true
      setBusy(true)
    } else {
      stoppedDuringAction.current = target.operationId
    }
    void productionRunApi.discardSpend(target.projectId, target.operationId, target.quoteId, cardIdentity(target))
      .then((result) => {
        if (result.ok) {
          // 宿主数着交出去几段、没发几段：卡这时已经关了，这一句是唯一说这件事的地方，留 8 秒。
          if (result.batchStopped) {
            useToastStore.getState().push({ message: spendCardStoppedMessage(target.shots, result.batchStopped, t), type: 'info', ttl: 8000, reason: 'spend-batch-stopped' })
          }
          return
        }
        // 卡已经被别处关了（交完了 / 宿主收回了）：没有要收回的，不弹。
        if (result.message === 'no pending generation to discard') return
        logRendererWarn('spend-confirm-refused', { code: result.message ?? result.code, reason: result.reason })
        toast(t(spendActionFailureCopy(result), { field: result.field ?? '' }), 'error')
      })
      .catch((error: unknown) => logRendererWarn('spend-confirm-refused', { code: 'discard-ipc' }, error))
      .finally(() => {
        if (!ownsBusy) return
        busyRef.current = false
        setBusy(false)
      })
  }, [t])

  const exclusion = React.useCallback((shotId: string, restore: boolean): void => {
    const target = pendingRef.current
    if (!target) return
    act(target, () => (restore ? productionRunApi.restoreSpendShot : productionRunApi.removeSpendShot)(target.projectId, target.operationId, target.quoteId, shotId, cardIdentity(target)))
  }, [act])

  const operationId = pending?.operationId
  const body = React.useMemo<SpendCardBodyProps | undefined>(() => (model && operationId
    ? {
      operationId,
      pointers: model.pointers,
      ...(model.summary ? { summary: model.summary } : {}),
      notices: model.notices,
      busy,
      onExclude: (shotId: string) => exclusion(shotId, false),
      onRestore: (shotId: string) => exclusion(shotId, true),
    }
    : undefined), [model, operationId, busy, exclusion])

  return { pending, slot, body, primary, discard }
}
