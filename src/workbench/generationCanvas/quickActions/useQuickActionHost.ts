import React from 'react'
import { useTranslation } from 'react-i18next'
import { useGenerationModelOptionsState } from '../adapters/modelOptionsAdapter'
import type { GenerationCanvasNode } from '../model/generationCanvasTypes'
import { loadPromptLibraryItems, usePromptLibrary } from '../../promptLibrary/usePromptLibrary'
import { KNOWN_VENDORS } from '../../../config/knownVendors'
import { peekVendorDisplayName } from '../../../config/modelCatalogCache'
import { mappingsEvidenceLoaded, useVendorMappingsReader } from '../nodes/controls/useChannelCreateBody'
import { allLayerSplitBlockedByCustomScript, deriveFromNode, findLayerSplitModelOption, findUpscaleModelOption, layerSplitVendorKeys, type DeriveBlockReason } from './deriveFromNode'
import { QUICK_ACTIONS, type QuickActionId } from './quickActionCatalog'
import { capabilityGuide, type QuickActionGuide } from './capabilityGuide'

/**
 * 图片浮条「预设场景 ▾ / 改图 ▾」的宿主逻辑：哪些项点不了、为什么，以及点了之后走 `deriveFromNode`。
 *
 * 点一项 = 建好一个连着源图、填好提示词的空闲节点，**不生成**（花钱留给用户在新节点上点 ↑）。
 * 这个文件不 import 任何付费 / 批准 / 派发入口。
 */

const BLOCK_MESSAGE_KEYS = {
  'no-image-model': 'generationCommon.quickActions.blocked.noImageModel',
  'no-upscale-model': 'generationCommon.quickActions.blocked.noUpscaleModel',
  'no-layer-split-model': 'generationCommon.quickActions.blocked.noLayerSplitModel',
  'layer-split-custom-script': 'generationCommon.quickActions.blocked.layerSplitCustomScript',
  'missing-effect': 'generationCommon.quickActions.blocked.missingEffect',
  'source-not-referenceable': 'generationCommon.quickActions.derive.sourceNotReferenceable',
  'connect-failed': 'generationCommon.quickActions.blocked.connectFailed',
  'source-missing': 'generationCommon.quickActions.blocked.connectFailed',
} as const satisfies Record<DeriveBlockReason, string>

export function useQuickActionHost({
  node,
  reportFeedback,
}: {
  node: GenerationCanvasNode
  reportFeedback: (message: string) => void
}): {
  quickActionBlocked: Partial<Record<QuickActionId, string>>
  quickActionGuides: Partial<Record<QuickActionId, QuickActionGuide>>
  onQuickAction: (id: QuickActionId) => void
} {
  const { t } = useTranslation()
  const models = useGenerationModelOptionsState('image', 'image_edit')
  const library = usePromptLibrary(true)
  const editModelOptions = models.options
  const readMappings = useVendorMappingsReader()

  // 「这个能力此刻没有」不是死路（2026-10-06 用户拍板）：项不灰，第二行说缺什么，点了直接去补（改图、图层分离）。
  // 唯一例外是放大（2026-10-07 用户拍板）：目前没有这个模型，没有时置灰、悬停说原因，不跳转。
  // 目录 / 渠道 mapping 还在加载时不判（不闪）；加载完仍没有才挂引导 / 置灰。点了派生却发现没有（加载中点的）也走同一条路。
  const missing = React.useMemo(() => {
    if (models.loading) return { upscale: false, imageEdit: false, layerSplit: false, layerSplitCustomScript: false }
    const mappingsReady = mappingsEvidenceLoaded(readMappings)
    const layerSplitCustomScript = mappingsReady && allLayerSplitBlockedByCustomScript(editModelOptions, readMappings)
    return {
      upscale: !findUpscaleModelOption(editModelOptions),
      imageEdit: editModelOptions.length === 0,
      layerSplit: mappingsReady && !layerSplitCustomScript && !findLayerSplitModelOption(editModelOptions, readMappings),
      layerSplitCustomScript,
    }
  }, [editModelOptions, models.loading, readMappings])

  // 图层分离去补哪一家：有接入卡的已知供应商里、渠道线缆真能拆的，减去已经接上的（接上了还没有，说「去接它」就是错话）。
  const layerSplitGuide = React.useMemo(() => {
    const connected = new Set(editModelOptions.map((option) => option.vendor))
    const vendors = layerSplitVendorKeys(readMappings, KNOWN_VENDORS.map((vendor) => vendor.vendorKey))
      .filter((vendorKey) => !connected.has(vendorKey))
      .map((vendorKey) => ({ vendorKey, vendorName: peekVendorDisplayName(vendorKey) ?? vendorKey }))
    return capabilityGuide('layerSplit', t, vendors)
  }, [editModelOptions, readMappings, t])

  const quickActionGuides = React.useMemo(() => {
    const guides: Partial<Record<QuickActionId, QuickActionGuide>> = {}
    for (const action of QUICK_ACTIONS) {
      if (action.requires === 'image-edit' && missing.imageEdit) guides[action.id] = capabilityGuide('imageEdit', t)
      if (action.requires === 'layer-split' && missing.layerSplit) guides[action.id] = layerSplitGuide
    }
    return guides
  }, [layerSplitGuide, missing, t])

  const quickActionBlocked = React.useMemo(() => {
    const blocked: Partial<Record<QuickActionId, string>> = {}
    const libraryKnown = !library.loading && library.items.length > 0
    for (const action of QUICK_ACTIONS) {
      if (action.requires === 'upscale' && missing.upscale) {
        blocked[action.id] = t(BLOCK_MESSAGE_KEYS['no-upscale-model'])
        continue
      }
      if (action.requires === 'layer-split' && missing.layerSplitCustomScript) {
        blocked[action.id] = t(BLOCK_MESSAGE_KEYS['layer-split-custom-script'])
        continue
      }
      if (libraryKnown && action.effectId && !library.items.some((item) => item.id === action.effectId)) {
        blocked[action.id] = t(BLOCK_MESSAGE_KEYS['missing-effect'])
      }
    }
    return blocked
  }, [library.items, library.loading, missing.layerSplitCustomScript, missing.upscale, t])

  const onQuickAction = React.useCallback((id: QuickActionId) => {
    void deriveFromNode(
      { sourceNodeId: node.id, actionId: id },
      {
        editModelOptions,
        readMappings,
        resolveEffectPrompt: async (effectId) => {
          try {
            return (await loadPromptLibraryItems()).find((item) => item.id === effectId)?.prompt ?? null
          } catch {
            return null
          }
        },
      },
    ).then((outcome) => {
      if (outcome.status !== 'blocked') return
      reportFeedback(t(BLOCK_MESSAGE_KEYS[outcome.reason]))
      // 目录加载中点的、派生时才发现缺能力：同样把去补的路打开，不停在一句话上。
      if (outcome.reason === 'no-image-model') capabilityGuide('imageEdit', t).onSelect()
      if (outcome.reason === 'no-layer-split-model') layerSplitGuide.onSelect()
    })
  }, [editModelOptions, layerSplitGuide, node.id, readMappings, reportFeedback, t])

  return { quickActionBlocked, quickActionGuides, onQuickAction }
}
