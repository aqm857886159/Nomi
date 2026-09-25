// P4 S5 — 画布落地 host（全程挂在工作区，跟着画布）。三件事：
//   ① 画布上有制作节点时，周期拉取每一个**还用得着**的 Run（有节点没结果 / 停在失败）→ landing store
//      （只供「排队中 / 已停」小标、续拍入口与失败卡的返工判断）；
//   ② 进度由节点和任务中心原地显示，不再叠加常驻 toast；
//   ③ 观察占位节点被删（整批 Cmd+Z / 手动删）→ 发 plan.detach-shot-nodes 让 Run 记 detached（撤销事实优先）。
//
// 真相源仍是主进程 Run；host 只是它的只读投影缓存 + 用户删节点的忠实上报。
// 「生成中 / 结果 / 失败」不在此 poll：主进程的画布落地跟着 Run 的每一次变化把它们写进节点自己的运行记录
// （canvasLandingHost.followRunChange → materialize-shots），与普通生成同一份状态、同一套画法。
import React from 'react'

import type { ProductionRun } from '../../../electron/productionRun/productionRunTypes'
import { productionRunApi } from './productionRunApi'
import { useProductionCanvasLandingStore } from './productionCanvasLandingStore'
import { useGenerationCanvasStore } from '../generationCanvas/store/generationCanvasStore'
import type { GenerationCanvasNode } from '../generationCanvas/model/generationCanvasTypes'
import { buildDependencyWaves } from '../generationCanvas/runner/dependencyWaves'
import { confirmAndRunPlan } from '../generationCanvas/components/batchPlanPreview'

const POLL_INTERVAL_MS = 1500

function isTerminal(run: ProductionRun): boolean {
  return run.status === 'completed' || run.status === 'cancelled'
}

/**
 * 需要读 Run 的那些 runId：画布上还**没有结果**、或停在失败态的制作节点所属的 Run。
 * 只有它们会用到这份缓存（排队 / 已停小标、失败卡「重试」走不走返工链）；片子已经落好的节点不需要——
 * 否则一个做过几十次 Agent 生成的项目，每 1.5 秒要把几十份 run.json 读一遍。空 = 不用 poll（省电）。
 */
function badgeRunIdOf(node: GenerationCanvasNode): string | null {
  const meta = node.meta as Record<string, unknown> | undefined
  if (typeof meta?.productionRunId !== 'string' || !meta.productionRunId) return null
  return node.result?.url && node.status !== 'error' ? null : meta.productionRunId
}

function productionRunIdsNeedingBadges(): Set<string> {
  const runIds = new Set<string>()
  for (const node of useGenerationCanvasStore.getState().nodes) {
    const runId = badgeRunIdOf(node)
    if (runId) runIds.add(runId)
  }
  return runIds
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
        }
        w.__nomiProductionLandingStore = useProductionCanvasLandingStore
        w.__nomiCanvasStore = useGenerationCanvasStore
        // F15 走查读依赖门（显示的≡执行的）：生产构建里源码路径不可 import，故把纯函数挂出来供零额度走查读。
        w.__nomiBuildDependencyWaves = buildDependencyWaves
        // F16b 走查驱动**真实确认漏斗**：批量生成的生产入口本尊（confirmAndRunPlan → 解析托管策略/KIE
        // → 合并花钱卡带披露块 → runPlanWithToasts）。挂的是那一个真函数，不是复制品——手写 requestConfirm
        // 参数的走查会绕过策略解析与 i18n 键，任何一处回归都还是绿的（F16b 前那条就栽在这）。
        w.__nomiConfirmAndRunPlan = confirmAndRunPlan
      }
    } catch {
      // localStorage 不可用 → 跳过
    }
  }, [])
  // 画布上有没有用得着这份缓存的制作节点（有才 poll；全落好了就停，不空转）。
  const hasProductionNodes = useGenerationCanvasStore((state) => state.nodes.some((node) => badgeRunIdOf(node) !== null))

  // ① + ②：poll 活跃多镜 Run → store → 节点原地状态。
  React.useEffect(() => {
    if (!projectId || !hasProductionNodes) {
      useProductionCanvasLandingStore.getState().reset()
      return
    }
    let cancelled = false

    // 每一个用得着的 Run 都读（以前只读画布上第一个：有两次 Agent 生成时，第二次的节点永远拿不到自己的 Run）。
    // 已经终结（completed / cancelled）的 Run 不会再变，读到过一次就不再读。
    const tick = async (): Promise<void> => {
      const previous = useProductionCanvasLandingStore.getState().projectId === projectId
        ? useProductionCanvasLandingStore.getState().runs
        : {}
      const next: Record<string, ProductionRun> = {}
      for (const runId of productionRunIdsNeedingBadges()) {
        const cached = previous[runId]
        if (cached && isTerminal(cached)) {
          next[runId] = cached
          continue
        }
        try {
          const run = await productionRunApi.read(projectId, runId)
          if (run) next[runId] = run
        } catch {
          if (cached) next[runId] = cached // 瞬时 IPC 失败 → 保留上一份缓存，下一拍再试
        }
      }
      if (cancelled) return
      useProductionCanvasLandingStore.getState().setRuns(projectId, next)
    }

    void tick()
    const interval = window.setInterval(() => void tick(), POLL_INTERVAL_MS)
    return () => {
      cancelled = true
      window.clearInterval(interval)
    }
  }, [projectId, hasProductionNodes])

  // ③：观察占位节点被删 → 上报 detach。订阅画布节点集合，删掉的属某 Run 的占位就发 plan.detach-shot-nodes。
  React.useEffect(() => {
    if (!projectId) return
    // 记住当前每个 production 占位节点 id → 它所属 runId。
    const trackNodes = (): Map<string, string> => {
      const map = new Map<string, string>()
      for (const node of useGenerationCanvasStore.getState().nodes) {
        const meta = node.meta as Record<string, unknown> | undefined
        if (typeof meta?.productionRunId === 'string' && meta.productionRunId) map.set(node.id, meta.productionRunId)
      }
      return map
    }
    let known = trackNodes()
    return useGenerationCanvasStore.subscribe(() => {
      const next = trackNodes()
      // 上一拍在、这一拍不在 = 被删。按 runId 聚合，逐 Run 发 detach（幂等：Run 侧对已 detached 的无变化）。
      const removedByRun = new Map<string, string[]>()
      for (const [nodeId, runId] of known.entries()) {
        if (!next.has(nodeId)) {
          const list = removedByRun.get(runId) ?? []
          list.push(nodeId)
          removedByRun.set(runId, list)
        }
      }
      known = next
      if (removedByRun.size === 0) return
      for (const [runId, nodeIds] of removedByRun.entries()) {
        void (async () => {
          try {
            const run = await productionRunApi.read(projectId, runId)
            if (!run) return
            // × 之后计划已是真终态（`cancelled`）：落地投影本来就不认它，不需要再补一趟 detach 去「抢在落地前面」。
            // 这个观察者只为**还活着的计划**服务——用户手动删占位 / 整批 ⌘Z，让 Run 记下「这个节点是他自己拿走的」。
            if (run.generationPlan?.state === 'cancelled') return
            await productionRunApi.command(projectId, runId, {
              commandId: `detach-canvas:${runId}:${nodeIds.slice().sort().join(',')}`.slice(0, 200),
              expectedRevision: run.revision,
              type: 'plan.detach-shot-nodes',
              payload: { nodeIds },
              issuedAt: new Date().toISOString(),
            })
          } catch {
            // 上报失败不致命：占位没了，重开项目补齐时以「节点不在」为准也不会复活（materialize 幂等按 op 章）。
          }
        })()
      }
    })
  }, [projectId])

  return null
}
