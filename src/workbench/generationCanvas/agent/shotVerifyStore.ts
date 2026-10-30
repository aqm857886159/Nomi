import { declareStoreLifetime } from '../../project/storeLifetime'
// 镜级 verify 的状态层 + 编排入口(渲染层单一真相源)。
// 方案:docs/plan/2026-06-28-storyboard-closed-loop-verify.md（Stage 1 实时编排 + Stage 2 半自动封顶）。
//
// 数据流:生成完成 → verifyShotsAndReport(读画布快照→gather→调模型)→ 写本 store →
//   resident Agent 订阅 → 内容偏差卡 → 「让 AI 修」发 agent 消息（走现成付费确认闸，不另建付费 loop）。
// 半自动封顶(Stage 2 §6 用户拍板「半自动·每轮确认」):每点一次「让 AI 修」消耗一轮(consumeRound),
//   预算耗尽(decideNext→exhausted)→ 卡片不再给「让 AI 修」、落「已尽力」态,绝不无限回灌。

import { create } from 'zustand'
import { isProjectExecutionContextCurrent, type ProjectExecutionContext } from '../../project/projectCanvasReadSurface'
import type { ReconcileDeviation } from './reconcile'
import type { ShotVerifyReport } from './shotVerifyRunner'
import { resultIdentity } from '../model/nodeResultLifecycle'
import { areRequestedShotsAssessed, unreviewedShot } from '../../../../electron/shared/shotReviewEvidence'
import { createLoopBudget, startRound, canStartRound, type LoopBudgetState } from './storyboardLoopBudget'
// 重依赖(画布 store / judge 接线)在 verifyShotsAndReport 内动态 import:
// 让本 store 模块(状态机 + buildContentFixMessage)保持轻、可裸测,不拖进桌面桥/对话客户端。

const ENABLED_KEY = 'nomi:shot-verify:enabled'

/** verify 默认开;用户可在设置关(plan §4「默认开·可关」)。读 localStorage,缺省 true。 */
export function isShotVerifyEnabled(): boolean {
  try {
    return globalThis.localStorage?.getItem(ENABLED_KEY) !== '0'
  } catch {
    return true
  }
}

export function setShotVerifyEnabled(enabled: boolean): void {
  try {
    globalThis.localStorage?.setItem(ENABLED_KEY, enabled ? '1' : '0')
  } catch {
    /* 无 localStorage(非浏览器环境)→ 忽略 */
  }
}

export type ShotVerifyStatus = 'idle' | 'verifying' | 'ready'

type ShotVerifyRequest = Readonly<{
  projectId: string | null
  requestId: number
}>

function normalizeProjectId(projectId: string | null | undefined): string | null {
  const normalized = typeof projectId === 'string' ? projectId.trim() : ''
  return normalized || null
}

function resultState(deviations: ReconcileDeviation[], budget: LoopBudgetState, converged: boolean) {
  if (converged && deviations.length === 0) {
    return { status: 'ready' as const, deviations: [], budget: createLoopBudget(), exhausted: false }
  }
  return { status: 'ready' as const, deviations, exhausted: !canStartRound(budget) }
}

type ShotVerifyState = {
  status: ShotVerifyStatus
  deviations: ReconcileDeviation[]
  budget: LoopBudgetState
  /** 当前结果归属的项目；null 只用于尚未进入项目的启动/测试环境。 */
  projectId: string | null
  /** 每次开始/清场都递增；异步回执只有命中最新 requestId 才能写 store。 */
  requestId: number
  /** 预算耗尽且仍有偏差 → true,卡片落「已尽力」、不再给「让 AI 修」。 */
  exhausted: boolean
  /** 项目生命周期接缝：项目变化即清场并作废所有在途校验；同项目重复绑定不扰动预算。 */
  activateProject: (projectId: string | null | undefined) => void
  beginVerify: (projectId: string | null | undefined) => ShotVerifyRequest
  isVerifyCurrent: (request: ShotVerifyRequest, activeProjectId: string | null | undefined) => boolean
  completeVerify: (
    request: ShotVerifyRequest,
    activeProjectId: string | null | undefined,
    report: ShotVerifyReport,
    requestedShotIds: readonly string[],
  ) => boolean
  /**
   * 写校验结果。预算生命周期铁律:
   * - 只有 completeVerify 的完整评估证据证明收敛才重置预算；直接写空偏差不算。
   * - 仍有偏差 → **不动预算**(同一闭环延续),按剩余预算算 exhausted。
   * 故「点修→重生→再校验」链路预算只减不回弹,半自动封顶真实生效。
   */
  setDeviations: (deviations: ReconcileDeviation[]) => void
  /** 点一次「让 AI 修」:消耗一轮;返回是否还允许(false=已到顶,调用方不应再发修复消息)。 */
  consumeRound: () => boolean
  /** 点修后暂藏卡(AI 干活中):清偏差但**不动预算**(区别于收敛重置)。 */
  markFixing: () => void
  /** 全清(换项目/会话清场):状态/偏差/预算全重置。 */
  clear: () => void
}

export const useShotVerifyStore = create<ShotVerifyState>()((set, get) => ({
  status: 'idle',
  deviations: [],
  budget: createLoopBudget(),
  projectId: null,
  requestId: 0,
  exhausted: false,
  activateProject: (projectId) => {
    const nextProjectId = normalizeProjectId(projectId)
    if (get().projectId === nextProjectId) return
    set((state) => ({
      status: 'idle',
      deviations: [],
      budget: createLoopBudget(),
      projectId: nextProjectId,
      requestId: state.requestId + 1,
      exhausted: false,
    }))
  },
  beginVerify: (projectId) => {
    const nextProjectId = normalizeProjectId(projectId)
    const current = get()
    const request = { projectId: nextProjectId, requestId: current.requestId + 1 }
    set({
      status: 'verifying',
      deviations: [],
      projectId: nextProjectId,
      requestId: request.requestId,
      exhausted: false,
      ...(current.projectId !== nextProjectId
        ? { budget: createLoopBudget() }
        : {}),
    })
    return request
  },
  isVerifyCurrent: (request, activeProjectId) => {
    const state = get()
    return state.requestId === request.requestId
      && state.projectId === request.projectId
      && normalizeProjectId(activeProjectId) === request.projectId
  },
  completeVerify: (request, activeProjectId, report, requestedShotIds) => {
    if (!get().isVerifyCurrent(request, activeProjectId)) return false
    const converged = areRequestedShotsAssessed(requestedShotIds, report.assessments)
      && report.assessments.every(item => item.unassessedDimensions.length === 0)
    set(resultState(report.deviations, get().budget, converged))
    return true
  },
  setDeviations: (deviations) => {
    // 直接写偏差没有审片覆盖证据，不能重置预算。
    set(resultState(deviations, get().budget, false))
  },
  consumeRound: () => {
    const { budget } = get()
    if (!canStartRound(budget)) {
      set({ exhausted: true })
      return false
    }
    set({ budget: startRound(budget) })
    return true
  },
  markFixing: () => set({ status: 'verifying', deviations: [] }),
  clear: () => set((state) => ({
    status: 'idle',
    deviations: [],
    budget: createLoopBudget(),
    projectId: null,
    requestId: state.requestId + 1,
    exhausted: false,
  })),
}))

/**
 * 生成完成后跑校验并写 store(fire-and-forget,不阻塞「生成完成」toast)。
 * 失败保留未审证据，不把生成成功拖红，也不把空结果当收敛。
 */
export async function verifyShotsAndReport(
  shotNodeIds: readonly string[],
  project: ProjectExecutionContext,
): Promise<ShotVerifyReport> {
  const requested = [...new Set(shotNodeIds)]
  const unavailable = (reason: string): ShotVerifyReport => ({ deviations: [], assessments: requested.map(id => unreviewedShot(id, reason)) })
  if (!isShotVerifyEnabled()) return unavailable('review-disabled')
  const projectId = project.binding.projectId
  const owns = (request: ShotVerifyRequest): boolean =>
    isProjectExecutionContextCurrent(project) && useShotVerifyStore.getState().isVerifyCurrent(request, projectId)
  const complete = (request: ShotVerifyRequest, report: ShotVerifyReport): void => {
    if (owns(request)) useShotVerifyStore.getState().completeVerify(request, projectId, report, requested)
  }
  const request = useShotVerifyStore.getState().beginVerify(projectId)
  try {
    const [{ gatherShotVerifyInputs }, { verifyGeneratedShots }, { makeShotVerifyDeps }, { useGenerationCanvasStore }] = await Promise.all([
      import('./gatherShotVerifyInputs'), import('./shotVerifyRunner'), import('./shotVerifyJudge'), import('../store/generationCanvasStore'),
    ])
    if (!owns(request)) return unavailable('stale-request')
    const { nodes, edges } = useGenerationCanvasStore.getState()
    const inputs = gatherShotVerifyInputs(requested, nodes, edges)
    if (inputs.length === 0) {
      const report = unavailable('node-or-result-unavailable')
      complete(request, report)
      return report
    }
    const signature = (input: (typeof inputs)[number], snapshotNodes: typeof nodes): string => {
      const node = snapshotNodes.find(candidate => candidate.id === input.shotNodeId)
      const result = node?.result
      return JSON.stringify([input, result ? resultIdentity(result) : null, result?.url, result?.type, result?.versionNo,
        node?.runs?.[0]?.id, node?.runs?.[0]?.taskId])
    }
    const captured = new Map(inputs.map(input => [input.shotNodeId, signature(input, nodes)]))
    const report = await verifyGeneratedShots(inputs, makeShotVerifyDeps(projectId))
    if (!isProjectExecutionContextCurrent(project)) return unavailable('stale-project')
    const current = useGenerationCanvasStore.getState()
    const currentInputs = new Map(gatherShotVerifyInputs(requested, current.nodes, current.edges).map(input => [input.shotNodeId, input]))
    const changed = new Set(requested.filter(id => {
      const input = currentInputs.get(id)
      return captured.has(id) && (!input || signature(input, current.nodes) !== captured.get(id))
    }))
    report.assessments = report.assessments.map(item => changed.has(item.shotNodeId) ? unreviewedShot(item.shotNodeId, 'review-input-changed') : item)
    report.deviations = report.deviations.filter(item => !item.shotNodeId || !changed.has(item.shotNodeId))
    const present = new Set(report.assessments.map(item => item.shotNodeId))
    report.assessments.push(...requested.filter(id => !present.has(id)).map(id => unreviewedShot(id, 'node-or-result-unavailable')))
    complete(request, report)
    return report
  } catch {
    const report = unavailable('review-unavailable')
    complete(request, report)
    return report
  }
}

/** 把内容偏差组装成给 agent 的「修一下」消息(描述哪几镜哪轴不对 + 让它改 prompt/重生,走现成确认闸)。 */
export function buildContentFixMessage(deviations: readonly ReconcileDeviation[]): string {
  const lines = deviations
    .filter((d) => d.kind === 'content')
    .map((d) => `· ${d.where}（${d.field}）：${typeof d.reason === 'string' ? d.reason : ''}`.trim())
  return [
    '刚生成的这几镜，画面校验发现和设定/描述对不上：',
    ...lines,
    '',
    '请读画布，针对这几镜：先判断是提示词没写清还是分镜本身要调；',
    '能靠改这几镜的提示词修好的就改提示词，再提交一个只包含这几镜的新付费生成提案（会让我确认花费）。',
    '不要动其它已经正常的镜头。',
  ].join('\n')
}

/**
 * C1 寿命声明：审片结果与在途 judge 全是当前项目的事实——它自己甚至存着 `projectId`
 * 与一个自增的 `requestId`，就是为了让迟到的回执认不出旧项目。
 * 释放走它**自己的** `clear()`（它要递增 requestId，不是简单置空）。
 */
export const shotVerifyStoreLifetime = declareStoreLifetime({
  store: 'useShotVerifyStore',
  fields: {
    status: 'project', deviations: 'project', budget: 'project',
    projectId: 'project', requestId: 'project', exhausted: 'project',
  },
  releaseProject: () => useShotVerifyStore.getState().clear(),
})
