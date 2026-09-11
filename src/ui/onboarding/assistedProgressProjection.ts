/**
 * 外部 Agent 正在接模型时，模型页要显示的那五步。
 *
 * 活儿在另一个窗口里干，用户回到 Nomi 只想知道两件事：**到哪一步了**、**要不要我做点什么**。
 * 所以这里只做一件事：把 `integrationContract.ts` 的 12 个真实 stage 投影成 5 段用户语言，
 * **不新造状态机**——真相源仍然是主进程那份会话，本模块是纯函数读者。
 *
 * 设计定稿：docs/design/2026-09-11-ai-assisted-onboarding-entry.md §Progress
 */
import type { IntegrationStage } from '../../../electron/shared/integrationContract'

export const ASSISTED_PROGRESS_STEPS = ['session', 'credential', 'proposal', 'certifying', 'listed'] as const
export type AssistedProgressStep = typeof ASSISTED_PROGRESS_STEPS[number]

/** 每一步认领哪些真实 stage。灰色小字里把 stage 名原样显示出来，排错时对得上日志。 */
export const ASSISTED_PROGRESS_STAGES: Record<AssistedProgressStep, readonly IntegrationStage[]> = {
  session: ['draft'],
  credential: ['needs_credential'],
  proposal: ['needs_input', 'discovering', 'needs_selection'],
  // 花费确认那一关 main 在 2026-09-10 拆成三个真状态（该 Agent 调 confirm 了 / 挑战已签发等真人点 /
  // 人点完了该调 start）。**用户那一侧它们仍是同一步**：都还停在「试跑一次验证」上，
  // 三行分开画只会把「Agent 该做什么」这套内部口径泄露给他。要他点的那一下由现役付费确认卡当场弹，
  // 不靠这五步里的一行去催——所以这一步认领它们仨，灰字里把真实 stage 名原样列出来对日志。
  certifying: ['needs_spend_confirmation', 'awaiting_human_confirmation', 'human_confirmed', 'certifying'],
  listed: ['committing', 'completed'],
}

export type AssistedProgressOutcome = 'running' | 'completed' | 'failed' | 'cancelled'
export type AssistedProgressRowState = 'done' | 'active' | 'pending'

export type AssistedProgressView = {
  outcome: AssistedProgressOutcome
  /** 失败/取消时停在哪一步（用来说「卡在第几步」），完成时 = 最后一步。 */
  currentStep: AssistedProgressStep
  rows: ReadonlyArray<{ step: AssistedProgressStep; state: AssistedProgressRowState; stages: readonly IntegrationStage[] }>
}

/** `partial` 也算没接进来：模型没进列表，用户不该看到一颗绿勾。 */
const FAILED_STAGES: readonly IntegrationStage[] = ['failed', 'partial']

function stepOf(stage: IntegrationStage): AssistedProgressStep | null {
  for (const step of ASSISTED_PROGRESS_STEPS) {
    if (ASSISTED_PROGRESS_STAGES[step].includes(stage)) return step
  }
  return null
}

/**
 * `stage` 来自 `integrationSessionGet` 的投影。终态（failed / partial / cancelled）没有自己的
 * 步号，所以要带上**它出事之前停在哪一步**——调用方从上一次拿到的活 stage 记下来。
 * 记不到就退回第一步：宁可说「刚开头就没成」，也不假装它走到过后面。
 */
export function projectAssistedProgress(input: {
  stage: IntegrationStage
  lastLiveStage?: IntegrationStage | null
}): AssistedProgressView {
  const cancelled = input.stage === 'cancelled'
  const failed = FAILED_STAGES.includes(input.stage)
  const terminalBad = cancelled || failed
  const liveStage = terminalBad ? (input.lastLiveStage ?? 'draft') : input.stage
  const currentStep = stepOf(liveStage) ?? 'session'
  const currentIndex = ASSISTED_PROGRESS_STEPS.indexOf(currentStep)
  const completed = input.stage === 'completed'
  return {
    outcome: cancelled ? 'cancelled' : failed ? 'failed' : completed ? 'completed' : 'running',
    currentStep,
    rows: ASSISTED_PROGRESS_STEPS.map((step, index) => ({
      step,
      stages: ASSISTED_PROGRESS_STAGES[step],
      state: completed || index < currentIndex ? 'done' : index === currentIndex ? 'active' : 'pending',
    })),
  }
}
