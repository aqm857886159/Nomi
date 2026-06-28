// 镜级 verify 的状态层 + 编排入口(渲染层单一真相源)。
// 方案:docs/plan/2026-06-28-storyboard-closed-loop-verify.md（Stage 1 实时编排 + Stage 2 半自动封顶）。
//
// 数据流:生成完成 → verifyShotsAndReport(读画布快照→gather→调模型)→ 写本 store →
//   CanvasAssistantPanel 订阅 → 内容偏差卡 → 「让 AI 修」发 agent 消息(走现成付费确认闸,不另建付费 loop)。
// 半自动封顶(Stage 2 §6 用户拍板「半自动·每轮确认」):每点一次「让 AI 修」消耗一轮(consumeRound),
//   预算耗尽(decideNext→exhausted)→ 卡片不再给「让 AI 修」、落「已尽力」态,绝不无限回灌。

import { create } from 'zustand'
import type { ReconcileDeviation } from './reconcile'
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

type ShotVerifyState = {
  status: ShotVerifyStatus
  deviations: ReconcileDeviation[]
  budget: LoopBudgetState
  /** 预算耗尽且仍有偏差 → true,卡片落「已尽力」、不再给「让 AI 修」。 */
  exhausted: boolean
  beginVerify: () => void
  /**
   * 写校验结果。预算生命周期铁律:
   * - 偏差清零(收敛/无问题)→ **重置预算**(本闭环结束,下一闭环满额起步);
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
  exhausted: false,
  beginVerify: () => set({ status: 'verifying' }),
  setDeviations: (deviations) => {
    if (deviations.length === 0) {
      // 收敛:本闭环结束,预算回满供下一条分镜。
      set({ status: 'ready', deviations: [], budget: createLoopBudget(), exhausted: false })
      return
    }
    // 仍有偏差:不动预算;剩余预算耗尽则落「已尽力」。
    set({ status: 'ready', deviations, exhausted: !canStartRound(get().budget) })
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
  clear: () => set({ status: 'idle', deviations: [], budget: createLoopBudget(), exhausted: false }),
}))

/**
 * 生成完成后跑校验并写 store(fire-and-forget,不阻塞「生成完成」toast)。
 * verify 是增益:任何失败都静默吞(setDeviations([])),绝不把生成完成拖红。
 */
export async function verifyShotsAndReport(shotNodeIds: readonly string[]): Promise<void> {
  if (!isShotVerifyEnabled()) return
  const store = useShotVerifyStore.getState()
  // 不在此重置预算:预算只在「收敛(偏差清零)」时回满(见 setDeviations),
  // 这样「点修→重生→再校验」链路里预算只减不回弹,半自动封顶真实生效。
  store.beginVerify()
  try {
    const [{ gatherShotVerifyInputs }, { verifyGeneratedShots }, { makeShotVerifyDeps }, { useGenerationCanvasStore }] =
      await Promise.all([
        import('./gatherShotVerifyInputs'),
        import('./shotVerifyRunner'),
        import('./shotVerifyJudge'),
        import('../store/generationCanvasStore'),
      ])
    const { nodes, edges } = useGenerationCanvasStore.getState()
    const inputs = gatherShotVerifyInputs(shotNodeIds, nodes, edges)
    if (inputs.length === 0) {
      useShotVerifyStore.getState().setDeviations([])
      return
    }
    const deviations = await verifyGeneratedShots(inputs, makeShotVerifyDeps())
    useShotVerifyStore.getState().setDeviations(deviations)
  } catch {
    useShotVerifyStore.getState().setDeviations([])
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
    '能靠改这几镜的提示词修好的就改提示词，再用 run_generation_batch 只重新生成这几镜（会让我确认花费）。',
    '不要动其它已经正常的镜头。',
  ].join('\n')
}
