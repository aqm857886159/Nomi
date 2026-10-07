import React from 'react'
import { useTranslation } from 'react-i18next'
import { useGenerationModelOptionsState } from '../adapters/modelOptionsAdapter'
import type { GenerationCanvasNode } from '../model/generationCanvasTypes'
import { loadPromptLibraryItems, usePromptLibrary } from '../../promptLibrary/usePromptLibrary'
import { deriveFromNode, findUpscaleModelOption, type DeriveBlockReason } from './deriveFromNode'
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

  // 「这个能力此刻没有」不是死路（2026-10-06 用户拍板）：项不灰，第二行说缺什么，点了直接去补（改图）。
  // 唯一例外是放大（2026-10-07 用户拍板）：目前没有这个模型，没有时置灰、悬停说原因，不跳转。
  // 目录还在加载时不判（不闪）；加载完仍没有才挂引导 / 置灰。点了派生却发现没有（加载中点的）也走同一条路。
  const missing = React.useMemo(() => {
    if (models.loading) return { upscale: false, imageEdit: false }
    return { upscale: !findUpscaleModelOption(editModelOptions), imageEdit: editModelOptions.length === 0 }
  }, [editModelOptions, models.loading])

  const quickActionGuides = React.useMemo(() => {
    const guides: Partial<Record<QuickActionId, QuickActionGuide>> = {}
    for (const action of QUICK_ACTIONS) {
      if (action.requires === 'image-edit' && missing.imageEdit) guides[action.id] = capabilityGuide('imageEdit', t)
    }
    return guides
  }, [missing, t])

  const quickActionBlocked = React.useMemo(() => {
    const blocked: Partial<Record<QuickActionId, string>> = {}
    const libraryKnown = !library.loading && library.items.length > 0
    for (const action of QUICK_ACTIONS) {
      if (action.requires === 'upscale' && missing.upscale) {
        blocked[action.id] = t(BLOCK_MESSAGE_KEYS['no-upscale-model'])
        continue
      }
      if (libraryKnown && action.effectId && !library.items.some((item) => item.id === action.effectId)) {
        blocked[action.id] = t(BLOCK_MESSAGE_KEYS['missing-effect'])
      }
    }
    return blocked
  }, [library.items, library.loading, missing.upscale, t])

  const onQuickAction = React.useCallback((id: QuickActionId) => {
    void deriveFromNode(
      { sourceNodeId: node.id, actionId: id },
      {
        editModelOptions,
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
    })
  }, [editModelOptions, node.id, reportFeedback, t])

  return { quickActionBlocked, quickActionGuides, onQuickAction }
}
