// Agent 面板付费确认卡的**接线**：宿主投影 ↔ 介入槽 ↔ 卡体那张生成框。
//
// ── 三个数据面，一份意图 ──
//
//   · **宿主投影**（`productionRunApi.pendingSpend`）——「有一笔生成在等你点头」+ **正式报价**。
//   · **覆写账本**（`spendCardDraft`）——用户在卡上改了什么。只活在卡里，画布一个字都不动。
//   · **durable 候选**——Run 里的 `generationPlan.candidate`。它才是供应商真正会收到的那份载荷。
//
// 2026-09-11（P1.1b）之前，卡体直接绑着画布上那个草稿节点：卡上改一个字画布当场就变，
// 而落地链又会按候选把节点重画回去——两个方向同时开着，用户看到的是「改了又弹回去」，
// 价格也因此只能等确认那一刻才更新。现在改动落在**卡自己的账本**上：
//
//   ① 画布节点在按下「生成」之前不动（用户没答应花钱，画布就不该被改）；
//   ② 「候选 → 节点」始终单向，拉锯没有了；
//   ③ 价格可以用**同一条算式**当场本地重算（`spendCardEstimate`），不必等一个来回。
//
// 按下主按钮那一刻才把账本发出去：逐镜 `generation.revise` → 主进程重新封印 → **正式报价**。
// 正式报价与本地估算理应逐分相同（同算式同价目）；真不同时以主进程为准、卡上原地把数字换掉，
// **不弹第二张卡、不打断**（2026-09-11 用户拍板）。
import React from 'react'
import { useTranslation } from 'react-i18next'
import { getActiveWorkbenchProjectId } from '../../project/workbenchProjectSession'
import { getDesktopBridge } from '../../../desktop/bridge'
import { productionRunApi } from '../../production/productionRunApi'
import { toast } from '../../../ui/toast'
import { useGenerationCanvasStore } from '../../generationCanvas/store/generationCanvasStore'
import { getGenerationNodeCatalogKind } from '../../generationCanvas/model/generationNodeKinds'
import { preloadModelOptions, MODEL_REFRESH_EVENT } from '../../../config/modelCatalogCache'
import type { ModelOption, NodeKind } from '../../../config/models'
import type { NodeWriteAccess } from '../../generationCanvas/nodes/nodeWriteAccess'
import type { GenerationCanvasNode } from '../../generationCanvas/model/generationCanvasTypes'
import type { PendingSpendConfirm } from '../../../desktop/productionRunBridgeTypes'
import { projectSpendCard, spendCardPage } from './agentPanelSpendCard'
import {
  applyPatchToNode,
  draftAfterNodeEdit,
  draftIsEmpty,
  effectivePatchForShot,
  revisionsForConfirm,
  EMPTY_SPEND_DRAFT,
  type SpendDraft,
  type SpendScope,
} from './spendCardDraft'
import { priceDisagreements, pricingResolverFromModelOptions, repricePendingSpend, type SpendPriceDisagreement } from './spendCardEstimate'
import type { InterventionData } from './agentPanelV4Types'
import { missingCardReasonOfReadFailure, missingInterventionCard, type MissingCardReason } from './missingInterventionCard'

/** 和任务中心同一个节拍：付费卡是同一批 Run 事实的另一个读者，不另立一套刷新频率。 */
const POLL_INTERVAL_MS = 1500

export function hasPendingSpendCapability(): boolean {
  return typeof getDesktopBridge()?.productionRuns?.pendingSpend === 'function'
}

export function isOptionalSpendSurfaceUnavailable(error: unknown): boolean {
  const code = error && typeof error === 'object' && 'code' in error ? String((error as { code?: unknown }).code ?? '') : ''
  return code === 'spend_confirm_surface_unavailable' || missingCardReasonOfReadFailure(error) === 'spend-surface-unavailable'
}

export type AgentPanelSpendConfirm = Readonly<{
  pending: PendingSpendConfirm | undefined
  /** 当前这一页的**草稿节点**（宿主投影 ⊕ 覆写）。它不在画布 store 里，改它不动画布。 */
  node: GenerationCanvasNode | undefined
  /** 卡体的写入面。`NodeGenerationComposer` 经它写，写到的是账本不是画布。 */
  writeAccess: NodeWriteAccess
  slot: InterventionData | undefined
  page: number
  scope: SpendScope
  busy: boolean
  /** 本地估算 ↔ 正式报价对不上的那些镜（正常为空）。以正式报价为准，卡上已原地更新。 */
  disagreements: readonly SpendPriceDisagreement[]
  setPage: (index: number) => void
  setScope: (scope: SpendScope) => void
  confirm: () => void
  discard: () => void
}>

export function useAgentPanelSpendConfirm(): AgentPanelSpendConfirm {
  const { t } = useTranslation()
  const [pending, setPending] = React.useState<PendingSpendConfirm | undefined>(undefined)
  const [draft, setDraft] = React.useState<SpendDraft>(EMPTY_SPEND_DRAFT)
  const [page, setPage] = React.useState(0)
  const [scope, setScope] = React.useState<SpendScope>('each')
  const [busy, setBusy] = React.useState(false)
  const [disagreements, setDisagreements] = React.useState<readonly SpendPriceDisagreement[]>([])
  const [modelOptions, setModelOptions] = React.useState<readonly ModelOption[]>([])
  // 「读不到」是一种**结果**，不是一种空。它一路留到槽里，渲成一张会说话的卡。
  const [readFailure, setReadFailure] = React.useState<MissingCardReason | undefined>(undefined)
  const nodes = useGenerationCanvasStore((state) => state.nodes)
  // 「Nomi 选的」说的是**最初那一份**：用户在卡上换过模型之后这句话就不再为真。
  // 所以记的是这一笔第一次被看到时的模型身份，不是当前这一份（当前那份一改就跟着变，永远为真）。
  const originalModelIds = React.useRef<{ operationId: string; modelIds: readonly string[] } | null>(null)

  const refresh = React.useCallback(async (): Promise<PendingSpendConfirm | undefined> => {
    const projectId = getActiveWorkbenchProjectId()
    if (!projectId) {
      setPending(undefined)
      return undefined
    }
    if (!hasPendingSpendCapability()) { setPending(undefined); setReadFailure(undefined); return undefined }
    try {
      const rows = await productionRunApi.pendingSpend(projectId)
      const next = rows[0]
      setReadFailure(undefined)
      setPending(next)
      if (next && originalModelIds.current?.operationId !== next.operationId) {
        originalModelIds.current = { operationId: next.operationId, modelIds: next.shots.map((shot) => shot.modelId) }
        // 换了一笔 = 换了一份账本。旧覆写跟着走只会把上一笔的模型贴到这一笔上。
        setDraft(EMPTY_SPEND_DRAFT)
        setDisagreements([])
      }
      if (!next) {
        originalModelIds.current = null
        setDraft(EMPTY_SPEND_DRAFT)
      }
      return next
    } catch (error) {
      // 2026-09-12：这里原来是「通道还没起来 / 项目正在切——这不是错误态，只是『现在没有
      // 要确认的东西』」，然后 `setPending(undefined)`。那句话把两件事说成了一件——
      // **读不到 ≠ 没有**。主进程现在只在「真的没有」时回空数组，抛出来的一律是失败；
      // 失败就必须让用户看见，否则模型说「请在确认卡上点头」而面板一片空白。
      setPending(undefined)
      if (isOptionalSpendSurfaceUnavailable(error)) {
        setReadFailure(undefined)
        return undefined
      }
      setReadFailure(missingCardReasonOfReadFailure(error))
      return undefined
    }
  }, [])

  React.useEffect(() => {
    void refresh()
    const timer = window.setInterval(() => { void refresh() }, POLL_INTERVAL_MS)
    return () => window.clearInterval(timer)
  }, [refresh])

  const index = pending ? spendCardPage(pending, page) : 0
  const shot = pending?.shots[index]
  const storeNode = shot?.nodeId ? nodes.find((candidate) => candidate.id === shot.nodeId) : undefined

  // 本地报价要的价目：就是模型下拉里那些行自带的 `pricing`（和主进程读的是同一份目录）。
  // 按这一笔涉及的节点 kind 预取；目录刷新时重取，好让「刚在设置里改完价目」当场生效。
  const kindKey = React.useMemo(() => {
    const kinds = new Set<NodeKind>()
    for (const entry of pending?.shots ?? []) {
      const node = entry.nodeId ? nodes.find((candidate) => candidate.id === entry.nodeId) : undefined
      if (node) kinds.add(getGenerationNodeCatalogKind(node.kind))
    }
    return [...kinds].sort().join(',')
  }, [pending, nodes])

  React.useEffect(() => {
    let cancelled = false
    const load = async (): Promise<void> => {
      const kinds = kindKey ? (kindKey.split(',') as NodeKind[]) : []
      if (kinds.length === 0) { if (!cancelled) setModelOptions([]); return }
      const loaded = await Promise.all(kinds.map(async (kind) => {
        try { return await preloadModelOptions(kind) } catch { return [] as ModelOption[] }
      }))
      if (!cancelled) setModelOptions(loaded.flat())
    }
    void load()
    const onRefresh = (): void => void load()
    if (typeof window !== 'undefined') window.addEventListener(MODEL_REFRESH_EVENT, onRefresh)
    return () => {
      cancelled = true
      if (typeof window !== 'undefined') window.removeEventListener(MODEL_REFRESH_EVENT, onRefresh)
    }
  }, [kindKey])

  const resolvePricing = React.useMemo(
    () => (modelOptions.length > 0 ? pricingResolverFromModelOptions(modelOptions) : undefined),
    [modelOptions],
  )

  // 卡上此刻这一份（本地重算过的）。投影层只认识这一种输入——「本地算的」和「宿主送来的」
  // 在它眼里没有区别，不需要第二条渲染分支。
  const repriced = React.useMemo(
    () => (pending ? repricePendingSpend(pending, draft, resolvePricing) : undefined),
    [pending, draft, resolvePricing],
  )

  // 卡体绑的那份草稿节点：宿主投影 ⊕ **正在编辑的那一层**（见 spendCardDraft 顶部注释）。
  const draftNode = React.useMemo(() => {
    if (!storeNode || !shot) return undefined
    return applyPatchToNode(storeNode, effectivePatchForShot(draft, shot.shotId, scope))
  }, [storeNode, shot, draft, scope])

  // 写入面：卡体所有改动都落这里。`latestNode` 必须回**草稿**那一份——增量 patch 要在最新值上
  // 合并，回 store 那份会把用户刚改的字段悄悄擦掉（lost-update）。
  const editContext = React.useRef<{ node: GenerationCanvasNode | undefined; shotId: string | undefined; scope: SpendScope }>({
    node: undefined, shotId: undefined, scope: 'each',
  })
  editContext.current = { node: draftNode, shotId: shot?.shotId, scope }
  const pendingRef = React.useRef<PendingSpendConfirm | undefined>(undefined)
  pendingRef.current = pending

  const writeAccess = React.useMemo<NodeWriteAccess>(() => Object.freeze({
    updateNode: (_nodeId: string, patch: Partial<GenerationCanvasNode>) => {
      const context = editContext.current
      const base = context.node
      const target = pendingRef.current?.shots.find((entry) => entry.shotId === context.shotId)
      if (!base || !target) return
      setDraft((previous) => draftAfterNodeEdit(previous, target, { ...base, ...patch }, context.scope))
    },
    latestNode: () => editContext.current.node,
  }), [])

  const slot = React.useMemo(() => {
    // 读不到的时候**先**出那张会说话的卡：此刻我们并不知道有没有待确认的一笔，
    // 而「不知道」正是必须说出口的那一种（`missingInterventionCard.ts`）。
    if (readFailure) {
      return missingInterventionCard({ reason: readFailure, announcer: 'spend-confirm', detail: 'productionRunApi.pendingSpend rejected' }, t)
    }
    if (!repriced) return undefined
    const remembered = originalModelIds.current
    return projectSpendCard(repriced, { page: index, scope }, t, {
      ...(remembered?.operationId === repriced.operationId ? { agentPickedModelIds: remembered.modelIds } : {}),
    })
  }, [readFailure, repriced, index, scope, t])

  /**
   * 卡上四个动作共用的一次执行。**宿主说不行就必须让用户看见**：
   *
   * 这一层此前是 `.catch(() => undefined)` —— 主进程返回的 `{ok:false, message}` 和抛出来的异常一起
   * 被吞掉，于是用户按下「生成 ¥0.50」之后界面一动不动：卡还在、钱没花、一个字的解释都没有。
   * 而宿主那头明明有话说（「模型未加入白名单」「供应商还没配好」……）。按了没反应是最贵的一种沉默：
   * 用户只能再按一次，或者以为 Nomi 坏了。
   */
  const act = React.useCallback((run: (target: PendingSpendConfirm) => Promise<{ ok?: boolean; message?: string } | unknown>) => {
    const target = pending
    if (!target || busy) return
    setBusy(true)
    // 用户看到的永远是这一句（i18n，R15），**不是宿主那句原话**：主进程的 message 混着内部术语和英文
    // （`Provider X lacks required recovery capabilities: configured_provider`），直接印出去就是把
    // 内部状态倒给用户。原话进控制台供排查，用户这边只留「没成 · 没开始生成 · 没花钱」这三件他能用的事。
    const failed = (reason: unknown): void => {
      // eslint-disable-next-line no-console
      console.warn('[spend-confirm] host refused', reason)
      toast(t('agentPanelV4.spendActionFailed'), 'error')
    }
    void run(target)
      .then((result) => {
        const outcome = result as { ok?: boolean; message?: string } | undefined
        if (outcome && outcome.ok === false) failed(outcome.message ?? outcome)
      })
      .catch((error: unknown) => failed(error))
      .finally(() => {
        setBusy(false)
        void refresh()
      })
  }, [pending, busy, refresh, t])

  return {
    pending: repriced,
    node: draftNode,
    writeAccess,
    slot,
    page: index,
    scope,
    busy,
    disagreements,
    setPage,
    setScope,
    /**
     * 「逐镜」= 只生成当前这一页那一镜（宿主会先把别的镜取消勾选再封印）；「全部」= 整批。
     *
     * 顺序是硬的：**先把账本落进候选，再封印**。反了就会封上一份用户已经改掉的合同。
     * 落完先读一次宿主的**正式报价**：与本地估算不一致时以它为准、卡上原地换数（不弹第二张卡），
     * 然后照常往下走——用户按的那一下不该被一个四舍五入拦住。
     */
    confirm: () => act(async (target) => {
      const currentShot = target.shots[index]
      const single = scope === 'each' && target.shots.length > 1 && currentShot
      const shotIds = single && currentShot ? [currentShot.shotId] : undefined
      if (!draftIsEmpty(draft)) {
        for (const revision of revisionsForConfirm(target.shots, draft, shotIds)) {
          await productionRunApi.reviseSpend({
            projectId: target.projectId,
            operationId: target.operationId,
            ...(target.shots.length > 1 ? { shotId: revision.shotId } : {}),
            patch: { ...revision.patch },
          })
        }
        const authoritative = await refresh()
        const local = repricePendingSpend(target, draft, resolvePricing)
        if (authoritative && authoritative.operationId === target.operationId) {
          const gaps = priceDisagreements(local, authoritative)
          setDisagreements(gaps)
          // 主进程已经把改动落进候选了：账本清空，卡上从此显示的就是宿主那一份（正式报价）。
          setDraft(EMPTY_SPEND_DRAFT)
        }
      }
      return productionRunApi.confirmSpend(target.projectId, target.operationId, shotIds)
    }),
    /**
     * × = **丢弃这份草稿**，两件事一起做：取消 durable 计划 + 撤掉它已经落到画布上的占位节点。
     *
     * 少做后一件就是把「我不要了」做成一半：Run 里没有它了，画布上却还留着一排没人认领的空节点，
     * 而用户按那颗 × 时看着的正是它们。撤节点走的是画布自己的删除动作（同一条撤销栈），
     * 不新建第二条删除路径。
     */
    discard: () => act(async (target) => {
      const result = await productionRunApi.discardSpend(target.projectId, target.operationId)
      if (result.ok) {
        const canvas = useGenerationCanvasStore.getState()
        for (const entry of target.shots) {
          if (entry.nodeId) canvas.deleteNode(entry.nodeId)
        }
        setDraft(EMPTY_SPEND_DRAFT)
      }
      return result
    }),
  }
}
