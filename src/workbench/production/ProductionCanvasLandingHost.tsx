// P4 S5 — 画布落地 host（全程挂在工作区，跟着画布）。三件事：
//   ① 当画布上存在多镜占位节点时，周期拉取该项目最活跃的多镜 Run 全量 → landing store（供占位派生三态）；
//   ② 进度通知「已完成 3/7」用**稳定 id 原位更新**（不堆 toast，§3.4）；
//   ③ 观察占位节点被删（整批 Cmd+Z / 手动删）→ 发 plan.detach-shot-nodes 让 Run 记 detached（撤销事实优先）。
//
// 真相源仍是主进程 Run；host 只是它的只读投影缓存 + 用户删节点的忠实上报。逐镜 result 回填由主进程 push
// （见 appIntegration.pushShotResultToRenderer → attach-shot-result），不在此 poll。
import React from 'react'
import { useTranslation } from 'react-i18next'

import type { ProductionRun, ProductionRunSummary } from '../../../electron/productionRun/productionRunTypes'
import { productionRunApi } from './productionRunApi'
import { useProductionCanvasLandingStore } from './productionCanvasLandingStore'
import { deriveBatchProgress } from './shotPlaceholderState'
import { useGenerationCanvasStore } from '../generationCanvas/store/generationCanvasStore'
import { buildDependencyWaves } from '../generationCanvas/runner/dependencyWaves'
import { confirmAndRunPlan } from '../generationCanvas/components/batchPlanPreview'
import { useToastStore } from '../../ui/toast'

const POLL_INTERVAL_MS = 1500

function isActiveSummary(summary: ProductionRunSummary): boolean {
  return summary.status !== 'completed' && summary.status !== 'cancelled'
}

/** 画布上属某多镜 Run 的占位节点 id 集合（meta.productionRunId）。空 = 不用 poll（省电）。 */
function productionRunIdsOnCanvas(): Set<string> {
  const runIds = new Set<string>()
  for (const node of useGenerationCanvasStore.getState().nodes) {
    const meta = node.meta as Record<string, unknown> | undefined
    if (typeof meta?.productionRunId === 'string' && meta.productionRunId) runIds.add(meta.productionRunId)
  }
  return runIds
}

export function ProductionCanvasLandingHost({ projectId }: { projectId: string | null }): null {
  const { t } = useTranslation()
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
  // 画布上有没有多镜占位节点（有才 poll）。订阅 nodes 长度/meta 变化即可（低频）。
  const hasProductionNodes = useGenerationCanvasStore((state) =>
    state.nodes.some((node) => {
      const meta = node.meta as Record<string, unknown> | undefined
      return typeof meta?.productionRunId === 'string' && Boolean(meta.productionRunId)
    }),
  )

  // ① + ②：poll 活跃多镜 Run → store + 进度通知（稳定 id）。
  React.useEffect(() => {
    if (!projectId || !hasProductionNodes) {
      useProductionCanvasLandingStore.getState().reset()
      return
    }
    let cancelled = false
    const progressToastId = `production-batch-progress:${projectId}`
    let lastProgressKey = ''

    const readActiveRun = async (): Promise<ProductionRun | null> => {
      // 画布上出现的 Run 优先（正在盯的批次）；否则退回列表里最活跃的一个。
      const onCanvas = productionRunIdsOnCanvas()
      if (onCanvas.size > 0) {
        // 取画布上第一个 run（同项目通常只有一个在飞批次，§3.3 并行排队）。
        const [runId] = [...onCanvas]
        return productionRunApi.read(projectId, runId)
      }
      const summaries = await productionRunApi.list(projectId)
      const summary = summaries.find(isActiveSummary) ?? summaries[0]
      return summary ? productionRunApi.read(projectId, summary.runId) : null
    }

    const tick = async (): Promise<void> => {
      let run: ProductionRun | null
      try {
        run = await readActiveRun()
      } catch {
        return // 瞬时 IPC 失败 → 保留上一份缓存，下一拍再试
      }
      if (cancelled) return
      useProductionCanvasLandingStore.getState().setRun(projectId, run)

      // 进度通知：只在有多镜批次、且尚未全完成时显示；稳定 id 原位更新，不堆 toast。
      const progress = deriveBatchProgress(run)
      if (progress && progress.total > 0 && progress.completed < progress.total) {
        const key = `${progress.completed}/${progress.total}`
        if (key !== lastProgressKey) {
          lastProgressKey = key
          useToastStore.getState().push({
            id: progressToastId,
            message: t('generationCommon.production.canvasLanding.progressToast', { completed: progress.completed, total: progress.total }),
            type: 'info',
            ttl: false, // 常驻到全部完成才撤（原位更新，不自动消失）
            dismissible: false,
          })
        }
      } else if (progress && progress.completed >= progress.total && progress.total > 0) {
        // 全部完成 → 撤掉常驻进度条（完成的成就感交给节点本身逐个填充的画面）。
        useToastStore.getState().remove(progressToastId)
        lastProgressKey = ''
      }
    }

    void tick()
    const interval = window.setInterval(() => void tick(), POLL_INTERVAL_MS)
    return () => {
      cancelled = true
      window.clearInterval(interval)
      useToastStore.getState().remove(progressToastId)
    }
  }, [projectId, hasProductionNodes, t])

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
