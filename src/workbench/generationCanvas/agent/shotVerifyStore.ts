import { declareStoreLifetime } from '../../project/storeLifetime'
// 镜级 verify 的状态层 + 编排入口(渲染层单一真相源)。
// 方案:docs/plan/2026-06-28-storyboard-closed-loop-verify.md（Stage 1 实时编排 + Stage 2 半自动封顶）+ 三态诚实审片。
//
// 数据流:生成完成 → verifyShotsAndReport(读画布快照→gather→调模型)→ 写本 store（deviations + unverified）→
//   resident Agent 订阅 → 对账卡（有偏差给「让 AI 修」，未校验照实告知，绝不冒充过检）。
// 半自动封顶(Stage 2 §6 用户拍板「半自动·每轮确认」):每点一次「让 AI 修」消耗一轮(consumeRound),
//   预算耗尽(decideNext→exhausted)→ 卡片不再给「让 AI 修」、落「已尽力」态,绝不无限回灌。

import { create } from 'zustand'
import { isProjectExecutionContextCurrent, type ProjectExecutionContext } from '../../project/projectCanvasReadSurface'
import type { ReconcileDeviation } from './reconcile'
import type { ShotVerifyReport, ShotVerifyShotOutcome, ShotVerifyUnverifiedEntry } from './shotVerifyRunner'
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

function resultState(
  deviations: ReconcileDeviation[],
  unverified: ShotVerifyUnverifiedEntry[],
  budget: LoopBudgetState,
) {
  if (deviations.length === 0) {
    return {
      status: 'ready' as const,
      deviations: [],
      unverified,
      budget: unverified.length === 0 ? createLoopBudget() : budget,
      exhausted: false,
    }
  }
  return { status: 'ready' as const, deviations, unverified, exhausted: !canStartRound(budget) }
}

type ShotVerifyState = {
  status: ShotVerifyStatus
  deviations: ReconcileDeviation[]
  unverified: ShotVerifyUnverifiedEntry[]
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
    deviations: ReconcileDeviation[],
    unverified?: ShotVerifyUnverifiedEntry[],
  ) => boolean
  /**
   * 写校验结果。预算生命周期铁律:
   * - 偏差清零且无未校验(真收敛)→ **重置预算**(本闭环结束,下一闭环满额起步);
   * - 仍有偏差 → **不动预算**(同一闭环延续),按剩余预算算 exhausted。
   * 故「点修→重生→再校验」链路预算只减不回弹,半自动封顶真实生效。
   */
  setDeviations: (deviations: ReconcileDeviation[], unverified?: ShotVerifyUnverifiedEntry[]) => void
  /** 点一次「让 AI 修」:消耗一轮;返回是否还允许(false=已到顶,调用方不应再发修复消息)。 */
  consumeRound: () => boolean
  /** 点修后暂藏卡(AI 干活中):清偏差但**不动预算**(区别于收敛重置)。 */
  markFixing: () => void
  /** 全清(换项目/会话清场):状态/偏差/未校验/预算全重置。 */
  clear: () => void
}

export const useShotVerifyStore = create<ShotVerifyState>()((set, get) => ({
  status: 'idle',
  deviations: [],
  unverified: [],
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
      unverified: [],
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
      unverified: [],
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
  completeVerify: (request, activeProjectId, deviations, unverified = []) => {
    if (!get().isVerifyCurrent(request, activeProjectId)) return false
    set(resultState(deviations, unverified, get().budget))
    return true
  },
  setDeviations: (deviations, unverified = []) => {
    // 收敛:本闭环结束,预算回满供下一条分镜；仍有偏差则预算不动。
    set(resultState(deviations, unverified, get().budget))
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
  markFixing: () => set({ status: 'verifying', deviations: [], unverified: [] }),
  clear: () => set((state) => ({
    status: 'idle',
    deviations: [],
    unverified: [],
    budget: createLoopBudget(),
    projectId: null,
    requestId: state.requestId + 1,
    exhausted: false,
  })),
}))

function emptyReport(): ShotVerifyReport {
  return { deviations: [], shotOutcomes: [], unverified: [] }
}

function unverifiedReportFor(
  shotNodeIds: readonly string[],
  titlesById: ReadonlyMap<string, string>,
  reason: ShotVerifyUnverifiedEntry['reason'],
): ShotVerifyReport {
  const unverified: ShotVerifyUnverifiedEntry[] = shotNodeIds.map((shotNodeId) => ({
    shotNodeId,
    shotTitle: titlesById.get(shotNodeId) || shotNodeId,
    reason,
  }))
  const shotOutcomes: ShotVerifyShotOutcome[] = unverified.map((entry) => ({
    shotNodeId: entry.shotNodeId,
    shotTitle: entry.shotTitle,
    status: 'unverified',
    reason: entry.reason,
  }))
  return { deviations: [], shotOutcomes, unverified }
}

/**
 * 生成完成后跑校验并写 store(不阻塞「生成完成」toast)。
 * 诚实三态：任何失败（无视觉能力 / 缺画面 / 抽帧或请求异常）一律记 unverified 写入 store 并回传，绝不伪装成通过。
 */
export async function verifyShotsAndReport(
  shotNodeIds: readonly string[],
  /** 被审镜头所在的项目（调用方在动作起点签发）：审片只读它的画布、结果只写回它。 */
  project: ProjectExecutionContext,
): Promise<ShotVerifyReport> {
  if (!isShotVerifyEnabled()) return emptyReport()
  // 项目归属来自签发的上下文；后续切项目（含 A→B→A）时上下文失效，request 也被 lifecycle 作废，
  // judge 继续使用旧项目的 ephemeral key，而不会在新项目会话里留下旧镜头的上下文。
  const projectId = project.binding.projectId
  const owns = (request: ShotVerifyRequest): boolean =>
    isProjectExecutionContextCurrent(project) && useShotVerifyStore.getState().isVerifyCurrent(request, projectId)
  const complete = (request: ShotVerifyRequest, report: ShotVerifyReport): void => {
    if (isProjectExecutionContextCurrent(project)) {
      useShotVerifyStore.getState().completeVerify(request, projectId, report.deviations, report.unverified)
    }
  }
  const request = useShotVerifyStore.getState().beginVerify(projectId)
  const titlesById = new Map<string, string>()
  // 不在此重置预算:预算只在「收敛(偏差清零且无未校验)」时回满(见 setDeviations),
  // 这样「点修→重生→再校验」链路里预算只减不回弹,半自动封顶真实生效。
  try {
    const [{ gatherShotVerifyInputs }, { verifyGeneratedShots }, { makeShotVerifyDeps }, { useGenerationCanvasStore }] =
      await Promise.all([
        import('./gatherShotVerifyInputs'),
        import('./shotVerifyRunner'),
        import('./shotVerifyJudge'),
        import('../store/generationCanvasStore'),
      ])
    // dynamic import 期间可能已经切项目/清场。先验所有权再读全局画布快照，避免把新项目
    // 的节点拿去给旧项目请求审片。
    if (!owns(request)) return emptyReport()
    const { nodes, edges } = useGenerationCanvasStore.getState()
    for (const node of nodes) {
      const title = typeof node.title === 'string' ? node.title.trim() : ''
      if (title) titlesById.set(node.id, title)
    }
    const inputs = gatherShotVerifyInputs(shotNodeIds, nodes, edges)
    if (inputs.length === 0) {
      const missing = unverifiedReportFor(shotNodeIds, titlesById, 'missing_frame_source')
      complete(request, missing)
      return missing
    }
    const report = await verifyGeneratedShots(inputs, makeShotVerifyDeps(projectId))
    complete(request, report)
    return report
  } catch {
    // 只有当前项目的最新请求能写 store；旧请求晚失败不得抹掉更新请求已经写入的结果，但调用方仍拿到诚实的 unverified。
    const failed = unverifiedReportFor(shotNodeIds, titlesById, 'judge_failed')
    complete(request, failed)
    return failed
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
    status: 'project', deviations: 'project', unverified: 'project', budget: 'project',
    projectId: 'project', requestId: 'project', exhausted: 'project',
  },
  releaseProject: () => useShotVerifyStore.getState().clear(),
})
