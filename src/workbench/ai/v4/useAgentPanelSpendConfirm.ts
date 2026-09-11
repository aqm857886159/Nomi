// Agent 面板付费确认卡的**接线**：宿主投影 ↔ 介入槽 ↔ 画布上那份草稿节点。
//
// ── 三个数据面，一份意图 ──
//
//   · **宿主投影**（`productionRunApi.pendingSpend`）——「有一笔生成在等你点头」+ 报价。价格只有这一个产地。
//   · **画布节点**——那份草稿已经落成的占位节点。卡体里那张生成框绑的就是它（同一个 store、同一份 meta），
//     所以「卡上改一个字」和「画布上改一个字」是同一件事，不是两份意图。
//   · **durable 候选**——Run 里的 `generationPlan.candidate`。它才是供应商真正会收到的那份载荷。
//
// 用户在卡上改完，节点先变（他立刻看得见），随后这里把改动同步进 durable 候选（`generation.revise`），
// 下一次投影把重算的价格送回来。**价格永远落后于那一下点击一个来回**——这是有意的：
// 印出来的数必须是宿主算过的，不是渲染层猜的。
import React from 'react'
import { useTranslation } from 'react-i18next'
import { getActiveWorkbenchProjectId } from '../../project/workbenchProjectSession'
import { productionRunApi } from '../../production/productionRunApi'
import { useGenerationCanvasStore } from '../../generationCanvas/store/generationCanvasStore'
import type { GenerationCanvasNode } from '../../generationCanvas/model/generationCanvasTypes'
import type { PendingSpendConfirm, PendingSpendShot } from '../../../desktop/productionRunBridgeTypes'
import { projectSpendCard, spendCardPage } from './agentPanelSpendCard'
import type { InterventionData } from './agentPanelV4Types'

/** 和任务中心同一个节拍：付费卡是同一批 Run 事实的另一个读者，不另立一套刷新频率。 */
const POLL_INTERVAL_MS = 1500

export type AgentPanelSpendConfirm = Readonly<{
  pending: PendingSpendConfirm | undefined
  /** 当前这一页对应的画布节点。没有 = 那一镜还没落到画布上（卡体退回只读摘要）。 */
  node: GenerationCanvasNode | undefined
  slot: InterventionData | undefined
  page: number
  scope: 'each' | 'all'
  busy: boolean
  setPage: (index: number) => void
  setScope: (scope: 'each' | 'all') => void
  confirm: () => void
  discard: () => void
}>

function candidateParameterKeys(shot: PendingSpendShot): readonly string[] {
  return Object.keys(shot.parameters)
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

/**
 * 节点现在的样子 → 候选补丁。**只送候选已经认识的那些键**：
 * 参数面到底有哪些键是模型档案说了算的（`archetypeMeta`），在这里再判一次就是第二份词表。
 * 候选自己带的键 + 模型身份 + 提示词，正好是「供应商会收到的那份载荷」里用户能在卡上改的全部。
 */
export function candidatePatchFromNode(
  node: GenerationCanvasNode,
  shot: PendingSpendShot,
): Record<string, unknown> | undefined {
  const meta = (node.meta ?? {}) as Record<string, unknown>
  const patch: Record<string, unknown> = {}
  const prompt = typeof node.prompt === 'string' ? node.prompt : ''
  if (prompt !== shot.prompt) patch.prompt = prompt
  const modelId = text(meta.modelKey)
  if (modelId && modelId !== shot.modelId) patch.modelId = modelId
  const providerId = text(meta.modelVendor) || text(meta.vendor)
  if (providerId && providerId !== shot.providerId) patch.providerId = providerId
  const archetype = meta.archetype && typeof meta.archetype === 'object' && !Array.isArray(meta.archetype)
    ? (meta.archetype as Record<string, unknown>)
    : {}
  const modeId = text(archetype.modeId)
  if (modeId && modeId !== (shot.modeId ?? '')) patch.modeId = modeId
  const parameters: Record<string, unknown> = {}
  let parametersChanged = false
  for (const key of candidateParameterKeys(shot)) {
    const next = meta[key]
    parameters[key] = next === undefined ? shot.parameters[key] : next
    if (next !== undefined && next !== shot.parameters[key]) parametersChanged = true
  }
  if (parametersChanged) patch.parameters = parameters
  return Object.keys(patch).length > 0 ? patch : undefined
}

export function useAgentPanelSpendConfirm(): AgentPanelSpendConfirm {
  const { t } = useTranslation()
  const [pending, setPending] = React.useState<PendingSpendConfirm | undefined>(undefined)
  const [page, setPage] = React.useState(0)
  const [scope, setScope] = React.useState<'each' | 'all'>('each')
  const [busy, setBusy] = React.useState(false)
  const nodes = useGenerationCanvasStore((state) => state.nodes)
  // 「Nomi 选的」说的是**最初那一份**：用户在卡上换过模型之后这句话就不再为真。
  // 所以记的是这一笔第一次被看到时的模型身份，不是当前这一份（当前那份一改就跟着变，永远为真）。
  const originalModelIds = React.useRef<{ operationId: string; modelIds: readonly string[] } | null>(null)

  const refresh = React.useCallback(async () => {
    const projectId = getActiveWorkbenchProjectId()
    if (!projectId) {
      setPending(undefined)
      return
    }
    try {
      const rows = await productionRunApi.pendingSpend(projectId)
      const next = rows[0]
      setPending(next)
      if (next && originalModelIds.current?.operationId !== next.operationId) {
        originalModelIds.current = { operationId: next.operationId, modelIds: next.shots.map((shot) => shot.modelId) }
      }
      if (!next) originalModelIds.current = null
    } catch {
      // 通道还没起来 / 项目正在切——这不是错误态，只是「现在没有要确认的东西」。
      setPending(undefined)
    }
  }, [])

  React.useEffect(() => {
    void refresh()
    const timer = window.setInterval(() => { void refresh() }, POLL_INTERVAL_MS)
    return () => window.clearInterval(timer)
  }, [refresh])

  const index = pending ? spendCardPage(pending, page) : 0
  const shot = pending?.shots[index]
  const node = shot?.nodeId ? nodes.find((candidate) => candidate.id === shot.nodeId) : undefined

  // 卡上改完 → **在按下那一刻**同步进 durable 候选，不是边改边同步。
  //
  // 为什么不做持续同步（2026-09-11 实测得出的判断）：画布节点是候选的**投影**，落地链在候选每
  // 前进一版时都会按候选重画它一次。持续同步会让「节点写候选」和「候选写节点」两个方向同时开着，
  // 于是每改一个参数就是一场拉锯——实测里它把计划连推三版，最后停在参数面板的默认值上，
  // 用户看到的是「改了又弹回去」。两个方向同时开着的双向同步没有稳定点，这不是调参数能修的。
  //
  // 一次性写在确认那一刻，收据仍然等于实际执行：`generation.revise` 先落改动、回到 draft，
  // `confirmPendingSpend` 再封印 —— 封的就是卡上此刻这一份。
  // 代价是价格不随每一次改动实时刷新（见 docs/plan/2026-09-11 的「已知缺口」）。
  const slot = React.useMemo(() => {
    if (!pending) return undefined
    const remembered = originalModelIds.current
    return projectSpendCard(pending, { page: index, scope }, t, {
      ...(remembered?.operationId === pending.operationId ? { agentPickedModelIds: remembered.modelIds } : {}),
    })
  }, [pending, index, scope, t])

  const act = React.useCallback((run: (target: PendingSpendConfirm) => Promise<unknown>) => {
    const target = pending
    if (!target || busy) return
    setBusy(true)
    void run(target).catch(() => undefined).finally(() => {
      setBusy(false)
      void refresh()
    })
  }, [pending, busy, refresh])

  return {
    pending,
    node,
    slot,
    page: index,
    scope,
    busy,
    setPage,
    setScope,
    // 「逐镜」= 只生成当前这一页那一镜（宿主会先把别的镜取消勾选再封印）；「全部」= 整批。
    confirm: () => act(async (target) => {
      const currentShot = target.shots[index]
      const patch = node && currentShot ? candidatePatchFromNode(node, currentShot) : undefined
      if (patch && currentShot) {
        // 先落改动（撤旧授权、回 draft），再封印。顺序反了就会封上一份用户已经改掉的合同。
        await productionRunApi.reviseSpend({
          projectId: target.projectId,
          operationId: target.operationId,
          ...(target.shots.length > 1 ? { shotId: currentShot.shotId } : {}),
          patch,
        })
      }
      return productionRunApi.confirmSpend(
        target.projectId,
        target.operationId,
        scope === 'each' && target.shots.length > 1 && currentShot ? [currentShot.shotId] : undefined,
      )
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
      }
      return result
    }),
  }
}
