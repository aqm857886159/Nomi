import {
  presentConnectionStatus,
  presentModelStatus,
  type ConnectionStatusPresentation,
  type ModelStatusPresentation,
  type ModelStatusState,
} from '../../../electron/shared/modelStatusPresentation'
import type { ChipModel } from './ModelChipGroups'

type StatusRow = Pick<ChipModel, 'availability' | 'formatInProgress'>

/**
 * 设置页上一行模型 / 一条连接显示成什么——只转交展示投影，不在这里另判（D-1117-delete-verification）。
 *
 * 这里以前自己把「能不能用」和「验证过没有」揉成六档，再由列表行、详情卡各挑一份词——
 * 同一条连接在列表写绿「未验证」、详情写红「连不上」（2026-11-17 第一轮验收）。现在词和点色只有一个出处。
 */
export function modelHomeStatus(model: StatusRow): ModelStatusPresentation {
  return presentModelStatus({ availability: model.availability, formatInProgress: model.formatInProgress })
}

/** 一条连接：列表行和连接详情卡头同取这里。`keyMissing` 只有调用方确知「这家要 key 而没有」时才给。 */
export function connectionHomeStatus(connection: {
  keyMissing?: boolean
  models: readonly StatusRow[]
}): ConnectionStatusPresentation {
  return presentConnectionStatus({
    keyMissing: connection.keyMissing,
    models: connection.models.map((model) => ({ availability: model.availability, formatInProgress: model.formatInProgress })),
  })
}

/** 页头「N 个可使用 · M 个待设置」用：逐档计数，口径与每行同一个投影。 */
export function countModelHomeStates(models: readonly StatusRow[]): Record<ModelStatusState, number> {
  const counts: Record<ModelStatusState, number> = { ready: 0, configuring: 0, needsSetup: 0, disabled: 0, notConnected: 0 }
  for (const model of models) counts[modelHomeStatus(model).state] += 1
  return counts
}
