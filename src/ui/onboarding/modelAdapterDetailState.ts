import type { ModelAvailability } from '../../../electron/shared/modelAvailability'
import {
  presentModelStatus,
  type ModelStatusPresentation,
  type ModelStatusTone,
} from '../../../electron/shared/modelStatusPresentation'

/**
 * 「这个模型还缺请求格式」——只读可用性主人的结论（缺声明字段 / 打开了也发不出），不在渲染层另判。
 * 模型详情的开关锁、状态区的「去补哪一样」都从这一处来。形状不认（没有结论）按缺格式算，宁可锁着。
 */
export function formatMissing(availability: ModelAvailability | null | undefined): boolean {
  if (!availability) return true
  return !availability.usable
    && (availability.reason === 'capability_incomplete' || availability.reason === 'model_unpublished')
}

type ModelAdapterDetailInput = {
  availability: ModelAvailability | null | undefined
  /** 这个模型的格式任务正在跑：抽屉手里有在跑的任务，或主进程算好的 formatInProgress。 */
  formatInProgress: boolean
  /** 本机能投影出它的输入方式（只用来挑「先补输入」还是「先补请求」，不决定能不能用）。 */
  capabilityKnown: boolean
  hasTask: boolean
  canAutoAdapt: boolean
  canUseScript: boolean
}

export type ModelAdapterDetailState = {
  tone: ModelStatusTone
  /**
   * adapting / needs* 是「接下来做什么」，status 是没有可做的事、只说现状。
   * 标题永远是五个状态词之一（`status`），和列表那一行同一个投影；这里不再有「未验证 / 已验证 / 没试跑」。
   */
  state: 'adapting' | 'needsCapability' | 'needsTransport' | 'status'
  status: ModelStatusPresentation
  primaryAction: 'none' | 'openTask' | 'editCapability' | 'autoConfigure' | 'writeScript'
  secondaryAction: 'none' | 'autoConfigure'
}

export function resolveModelAdapterDetailState(input: ModelAdapterDetailInput): ModelAdapterDetailState {
  const status = presentModelStatus({ availability: input.availability, formatInProgress: input.formatInProgress })

  if (input.formatInProgress) {
    return {
      tone: 'active',
      state: 'adapting',
      status,
      primaryAction: input.hasTask ? 'openTask' : 'none',
      secondaryAction: 'none',
    }
  }

  if (formatMissing(input.availability)) {
    // A request implementation cannot compensate for missing model modes and input slots.
    const reason = input.availability && !input.availability.usable ? input.availability.reason : undefined
    if (reason === 'capability_incomplete' || !input.capabilityKnown) {
      return {
        tone: 'warning',
        state: 'needsCapability',
        status,
        primaryAction: 'editCapability',
        secondaryAction: input.canAutoAdapt ? 'autoConfigure' : 'none',
      }
    }
    // 跑过格式任务却还缺请求格式：先带人看那次任务的真实原因（「查看问题」），不盲目再跑一遍。
    // 任务条不再挂失败卡（D-1117-delete-verification），这里是结束了的任务唯一的入口。
    if (input.hasTask) {
      return { tone: 'warning', state: 'needsTransport', status, primaryAction: 'openTask', secondaryAction: 'none' }
    }
    const primaryAction = input.canUseScript
      ? 'writeScript'
      : input.canAutoAdapt
        ? 'autoConfigure'
        : 'none'
    return {
      tone: 'warning',
      state: 'needsTransport',
      status,
      primaryAction,
      secondaryAction: input.canAutoAdapt && primaryAction !== 'autoConfigure' ? 'autoConfigure' : 'none',
    }
  }

  return { tone: status.tone, state: 'status', status, primaryAction: 'none', secondaryAction: 'none' }
}
