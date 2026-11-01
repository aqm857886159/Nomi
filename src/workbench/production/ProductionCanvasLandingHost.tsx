import { useGenerationQueueStore } from '../generationCanvas/runner/generationQueueStore'
import { confirmAndRunNode } from '../generationCanvas/runner/generationRunController'
// P4 S5 — 画布落地 host（全程挂在工作区，跟着画布）。三件事：
//   ① 画布上有制作节点时，把这些节点所属的每一份 Run 放进 landing store（「排队中 / 已停」小标、续拍入口、失败卡的返工判断，
//      以及对话流里付费卡的收据「✓ 已发出 / 已生成 N 段」）；只重读还会变的那几份（`landingRunsToRefresh`，算法在 store 模块）；
//      对话投影推来的待决出价一变（卡出来 / 卡上一镜走了一步 / 卡关了），那几份当场重读，不等下一拍（`changedOfferRuns`）；
//   ② 进度由节点和任务中心原地显示，不再叠加常驻 toast；
//   ③ 观察占位节点被删（整批 Cmd+Z / 手动删）→ 发 plan.detach-shot-nodes 让 Run 记 detached（撤销事实优先）。
//
// 真相源仍是主进程 Run；host 只是它的只读投影缓存 + 用户删节点的忠实上报。
// 「生成中 / 结果 / 失败」不在此 poll：主进程的画布落地跟着 Run 的每一次变化把它们写进节点自己的运行记录
// （canvasLandingHost.followRunChange → materialize-shots），与普通生成同一份状态、同一套画法。
import React from 'react'

import type { ProductionRun } from '../../../electron/productionRun/productionRunTypes'
import { laneClient } from '../ai/lane/laneClient'
import { productionRunIdOf } from './productionShotOwnership'
import { productionRunApi } from './productionRunApi'
import { changedOfferRuns, landingRunsToRefresh, pendingOfferSignatures, useProductionCanvasLandingStore } from './productionCanvasLandingStore'
import { useGenerationCanvasStore } from '../generationCanvas/store/generationCanvasStore'
import type { GenerationCanvasNode } from '../generationCanvas/model/generationCanvasTypes'
import { buildDependencyWaves } from '../generationCanvas/runner/dependencyWaves'
import { confirmAndRunPlan } from '../generationCanvas/components/batchPlanPreview'
import { setCanvasBatchConcurrencyForE2E } from '../generationCanvas/components/canvasProductionScope'
import { routeProductionCanvasSignal, subscribeProductionCanvasSignals } from './productionCanvasSignals'
import { reportDetachedShotNodes } from './reportDetachedShotNodes'
import { reportReattachedShotNodes } from './reportReattachedShotNodes'
import { surfaceDetachReportFailure } from './detachReportFeedback'
import { logRendererWarn } from '../../desktop/rendererLog'

const POLL_INTERVAL_MS = 1500

/** 节点还要制作小标（还没有结果、或停在失败）时它所属的 Run；片子已经落好的节点 → null。 */
function badgeRunIdOf(node: GenerationCanvasNode): string | null {
  const runId = productionRunIdOf(node)
  if (!runId) return null
  return node.result?.url && node.status !== 'error' ? null : runId
}

function canvasRunIds(pick: (node: GenerationCanvasNode) => string | null): Set<string> {
  const runIds = new Set<string>()
  for (const node of useGenerationCanvasStore.getState().nodes) {
    const runId = pick(node)
    if (runId) runIds.add(runId)
  }
  return runIds
}

/** 两份缓存是不是同一份（同一组 Run、每份都是同一个对象）：没变就不推，订 `runs` 的组件不白白重渲。 */
function sameRuns(a: Readonly<Record<string, ProductionRun>>, b: Readonly<Record<string, ProductionRun>>): boolean {
  const keys = Object.keys(a)
  return keys.length === Object.keys(b).length && keys.every((key) => a[key] === b[key])
}

export function ProductionCanvasLandingHost({ projectId }: { projectId: string | null }): null {
  // E2E 专用桥（同 CameraMoveCaptureHost/TaskCenterButton 既有写法）：仅当 localStorage['__nomiE2E']==='1' 时把
  // landing store + 画布 store 挂到 window，供零额度走查直接注入构造好的 Run（各态并存的批次）验三态占位、
  // 读画布落地结果、触发撤销，无需跑真后端。本 host 跟着画布常驻（不像 CameraMoveCaptureHost 仅按需挂），是稳的宿主。
  React.useEffect(() => {
    try {
      if (typeof window !== 'undefined' && window.localStorage?.getItem('__nomiE2E') === '1') {
        const w = window as unknown as {
          __nomiProductionLandingStore?: unknown
          __nomiCanvasStore?: unknown
          __nomiBuildDependencyWaves?: unknown
          __nomiConfirmAndRunPlan?: unknown
          __nomiSetBatchConcurrency?: unknown
          __nomiGenerationQueueStore?: unknown
          __nomiConfirmAndRunNode?: unknown
        }
        w.__nomiProductionLandingStore = useProductionCanvasLandingStore
        w.__nomiCanvasStore = useGenerationCanvasStore
        w.__nomiGenerationQueueStore = useGenerationQueueStore
        w.__nomiConfirmAndRunNode = confirmAndRunNode
        // F15 走查读依赖门（显示的≡执行的）：生产构建里源码路径不可 import，故把纯函数挂出来供零额度走查读。
        w.__nomiBuildDependencyWaves = buildDependencyWaves
        // F16b 走查驱动**真实确认漏斗**：批量生成的生产入口本尊（confirmAndRunPlan → 解析托管策略/KIE
        // → 合并花钱卡带披露块 → runPlanWithToasts）。挂的是那一个真函数，不是复制品——手写 requestConfirm
        // 参数的走查会绕过策略解析与 i18n 键，任何一处回归都还是绿的（F16b 前那条就栽在这）。
        w.__nomiConfirmAndRunPlan = confirmAndRunPlan
        // 走查造「排队中」：并发压到 1（产品界面没有并发选项，批量并发只由调度器默认值定）。
        w.__nomiSetBatchConcurrency = setCanvasBatchConcurrencyForE2E
      }
    } catch {
      // localStorage 不可用 → 跳过
    }
  }, [])
  // 画布上有没有制作节点（有才挂 poll；每一拍只重读还会变的那几份，都不会变了就一笔 IPC 都不发）。
  const hasProductionNodes = useGenerationCanvasStore((state) => state.nodes.some((node) => productionRunIdOf(node) !== null))

  // ① + ②：poll 活跃多镜 Run → store → 节点原地状态。
  React.useEffect(() => {
    if (!projectId || !hasProductionNodes) {
      useProductionCanvasLandingStore.getState().reset()
      return
    }
    let cancelled = false
    // 读过、主进程说没有的那几份（节点上的 productionRunId 指着一份不在的 Run）：不要小标就不再每一拍问一遍。
    const absent = new Set<string>()
    // 对话投影说出价变了的那几份：下一次读一定读它们（不看「还会不会变」——主进程刚说了它变了）。
    const forced = new Set<string>()

    // 画布上每一份 Run 都在（以前只读画布上第一个：有两次 Agent 生成时，第二次的节点永远拿不到自己的 Run）；
    // 只重读还会变的那几份（`landingRunsToRefresh`）+ 出价刚变了的那几份。
    const readOnce = async (): Promise<void> => {
      const store = useProductionCanvasLandingStore.getState()
      const previous = store.projectId === projectId ? store.runs : {}
      const onCanvas = canvasRunIds(productionRunIdOf)
      const refresh = new Set(landingRunsToRefresh(onCanvas, canvasRunIds(badgeRunIdOf), previous, absent))
      for (const runId of forced) if (onCanvas.has(runId)) refresh.add(runId)
      forced.clear()
      const next: Record<string, ProductionRun> = {}
      for (const runId of onCanvas) {
        const cached = previous[runId]
        if (!refresh.has(runId)) {
          if (cached) next[runId] = cached
          continue
        }
        try {
          const run = await productionRunApi.read(projectId, runId)
          if (run) {
            next[runId] = run
            absent.delete(runId)
          } else absent.add(runId)
        } catch {
          if (cached) next[runId] = cached // 瞬时 IPC 失败 → 保留上一份缓存，下一拍再试
        }
      }
      if (cancelled) return
      if (store.projectId === projectId && sameRuns(previous, next)) return
      useProductionCanvasLandingStore.getState().setRuns(projectId, next)
    }
    // 同一时刻只有一次读在路上（慢盘上一次读超过一拍时，下一拍不叠上去）；读的途中又要读 → 读完再来一遍。
    let reading = false
    let again = false
    const tick = async (): Promise<void> => {
      if (reading) {
        again = true
        return
      }
      reading = true
      try {
        do {
          again = false
          await readOnce()
        } while (again && !cancelled)
      } finally {
        reading = false
      }
    }

    let offers = pendingOfferSignatures(laneClient.workspace().spend, projectId)
    const unsubscribe = laneClient.subscribe((workspace) => {
      const next = pendingOfferSignatures(workspace.spend, projectId)
      const changed = changedOfferRuns(offers, next)
      offers = next
      if (changed.length === 0) return
      changed.forEach((runId) => forced.add(runId))
      void tick()
    })

    void tick()
    const interval = window.setInterval(() => void tick(), POLL_INTERVAL_MS)
    return () => {
      cancelled = true
      unsubscribe()
      window.clearInterval(interval)
    }
  }, [projectId, hasProductionNodes])

// ③：接收画布写边界的显式删除/恢复信号 → 让 Run 记 detached 或 reattached。
  React.useEffect(() => {
    if (!projectId) return
    return subscribeProductionCanvasSignals((signal) => routeProductionCanvasSignal(signal, projectId, (matched) => {
      const byRun = new Map<string, GenerationCanvasNode[]>()
      for (const node of matched.nodes) {
        const meta = node.meta as Record<string, unknown> | undefined
        const runId = typeof meta?.productionRunId === 'string' ? meta.productionRunId.trim() : ''
        if (!runId) continue
        const nodes = byRun.get(runId) ?? []
        nodes.push(node)
        byRun.set(runId, nodes)
      }
      for (const [runId, nodes] of byRun) {
        const operation = matched.kind === 'detach'
          ? reportDetachedShotNodes(matched.projectId, runId, nodes.map((node) => node.id), productionRunApi)
          : reportReattachedShotNodes(matched.projectId, runId, nodes, productionRunApi)
        void operation.catch((error: unknown) => surfaceDetachReportFailure(matched.projectId, runId, nodes.length, error))
      }
    }, (signal, hostProjectId) => logRendererWarn('production-canvas-signal-project-mismatch', {
      signalProjectId: signal.projectId,
      hostProjectId,
      nodeCount: signal.nodes.length,
    })))
  }, [projectId])

  return null
}
