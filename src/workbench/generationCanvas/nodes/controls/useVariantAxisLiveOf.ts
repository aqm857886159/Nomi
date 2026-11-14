// 模型菜单里别的行（没选中的）的变体轴起不起作用。和 `useChannelCreateBody` 同一套线缆读取，只是按「行」而不是按「当前节点」问。
import React from 'react'
import { modeTransportFor, resolveArchetypeForModel } from '../../../../../electron/shared/modelArchetypes'
import type { ModelOption } from '../../../../config/models'
import { archetypeVariantAxisIsLive } from './channelModeReach'
import { readModeChannelBody, type VendorMappingsReader } from './useChannelCreateBody'

/**
 * 模型菜单里**某一行**的变体轴起不起作用（别的行，不是选中的那一行）：逐家供应商、逐个模式按那条渠道自己的线缆算，
 * 同一把判据 `archetypeVariantAxisIsLive`；任一家任一模式起作用就算起作用（这一家没有该模式的线缆 = 不发言），认不出档案 / 查不到线缆一律算起作用
 * （和模式收窄同口径：不因为查不到就藏用户的功能）。
 */
export function variantAxisLiveForProviders(providers: ReadonlyArray<{ option: ModelOption }>, readMappings: VendorMappingsReader): boolean {
  return providers.some(({ option }) => {
    const archetype = resolveArchetypeForModel({
      modelKey: option.modelKey, modelAlias: option.modelAlias, vendorKey: option.vendor, meta: option.meta,
      ...(option.modelNameSource ? { modelNameSource: option.modelNameSource } : {}),
    })
    if (!archetype) return true
    return archetype.modes.some((mode) => {
      const body = readModeChannelBody(option.vendor ?? '', option.value, (modeTransportFor(mode, archetype, option.vendor) ?? '') as string, mode.id, readMappings)
      // null = 这一家没有这个模式的线缆，它对「变体轴起不起作用」不发言（不是起作用）；undefined = 查不到 → 算起作用。
      if (body === null) return false
      return archetypeVariantAxisIsLive(body)
    })
  })
}

/** 给模型菜单用的「某一行变体轴起不起作用」：identity 随映射表变（菜单据此重算），不随每次渲染变。 */
export function useVariantAxisLiveOf(readMappings: VendorMappingsReader): (model: { providers: ReadonlyArray<{ option: ModelOption }> }) => boolean {
  return React.useCallback((model) => variantAxisLiveForProviders(model.providers, readMappings), [readMappings])
}
