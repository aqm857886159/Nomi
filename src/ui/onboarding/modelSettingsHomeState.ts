import type { Mapping } from '../../../electron/catalog/types'
import type { ChipModel } from './ModelChipGroups'
import { projectModelCapability } from './modelCapabilityProjection'

export type ModelHomeStatus = 'working' | 'verified' | 'ready' | 'needsSetup' | 'failed' | 'disabled'
export type ModelHomeConnectionState = 'working' | 'verified' | 'attention' | 'disabled'

/**
 * 一行模型在设置页上的状态。
 *
 * 2026-09-12 真实验收 P0-10 的根因就在这里：这个函数从来**没问过**「它现在能不能用」——
 * 只看适配器跑没跑、能力投影认不认得、`enabled` 开没开。于是 MCP 接进来的两个 DeepSeek 文本模型
 * （启用着、钥匙也在，但认证没走完 → 发布资格不成立）在这一页被算成「2 个可使用」，
 * 而首页横幅说「尚未连接模型」、助手下拉说「目录里没有可用的」——同一时刻三个地方两个答案。
 *
 * 现在「能不能用」只认主进程那一个答案（`model.availability`）；本函数剩下的职责是把
 * **不可用的原因**翻译成这一页的四档：正在跑 / 要你去弄 / 被你关掉了 / 可用。
 */
export function resolveModelHomeStatus(model: ChipModel, mappings: readonly Mapping[]): ModelHomeStatus {
  if (model.adapterState === 'testing') return 'working'
  if (model.adapterState === 'failed') return 'failed'
  if (model.customCallDraft) return 'needsSetup'

  const capability = projectModelCapability({ model, mappings })
  const capabilityKnown = model.kind === 'text' || capability.inputContract === 'known'
  const transportAvailable = model.kind === 'text' || capability.customCall.enabled || capability.transport.mappings.length > 0
  if (!capabilityKnown || !transportAvailable) return 'needsSetup'
  const availability = model.availability
  // 形状缺失（旧缓存/实验室夹具没喂）时退回 `enabled`——不可用绝不会被悄悄读成可用。
  if (!availability) return model.enabled ? (model.adapterState === 'verified' ? 'verified' : 'ready') : 'disabled'
  if (availability.usable) return model.adapterState === 'verified' ? 'verified' : 'ready'
  // 「你自己关掉的」和「还差点什么」要分开：前者一键就能开回来，后者得去做点事。
  return availability.reason === 'model_disabled' || availability.reason === 'vendor_disabled'
    ? 'disabled'
    : 'needsSetup'
}

export function summarizeModelHomeConnection(
  models: readonly ChipModel[],
  mappings: readonly Mapping[],
): {
  state: ModelHomeConnectionState
  ready: number
  working: number
  needsSetup: number
  disabled: number
} {
  const statuses = models.map((model) => resolveModelHomeStatus(model, mappings))
  const ready = statuses.filter((status) => status === 'ready' || status === 'verified').length
  const working = statuses.filter((status) => status === 'working').length
  const needsSetup = statuses.filter((status) => status === 'needsSetup' || status === 'failed').length
  const disabled = statuses.filter((status) => status === 'disabled').length
  const state: ModelHomeConnectionState = needsSetup > 0
    ? 'attention'
    : working > 0
      ? 'working'
      : ready > 0
        ? 'verified'
        : 'disabled'
  return { state, ready, working, needsSetup, disabled }
}

export function modelsVisibleOnHome({
  models,
  mappings,
  search,
  connectionName,
}: {
  models: readonly ChipModel[]
  mappings: readonly Mapping[]
  search: string
  connectionName: string
}): ChipModel[] {
  const normalized = search.trim().toLocaleLowerCase()
  if (normalized) {
    if (connectionName.toLocaleLowerCase().includes(normalized)) return [...models]
    return models.filter((model) => (
      `${model.labelZh} ${model.modelKey}`.toLocaleLowerCase().includes(normalized)
    ))
  }
  return models.filter((model) => {
    const status = resolveModelHomeStatus(model, mappings)
    return status === 'working' || status === 'needsSetup' || status === 'failed'
  })
}
