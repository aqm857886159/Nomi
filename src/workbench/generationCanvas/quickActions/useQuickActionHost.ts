import React from 'react'
import { useTranslation } from 'react-i18next'
import { useGenerationModelOptionsState } from '../adapters/modelOptionsAdapter'
import type { GenerationCanvasNode } from '../model/generationCanvasTypes'
import { loadPromptLibraryItems, usePromptLibrary } from '../../promptLibrary/usePromptLibrary'
import { deriveFromNode, findUpscaleModelOption, type DeriveBlockReason } from './deriveFromNode'
import { QUICK_ACTIONS, type QuickActionId } from './quickActionCatalog'

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
}): { quickActionBlocked: Partial<Record<QuickActionId, string>>; onQuickAction: (id: QuickActionId) => void } {
  const { t } = useTranslation()
  const models = useGenerationModelOptionsState('image', 'image_edit')
  const library = usePromptLibrary(true)
  const editModelOptions = models.options

  const quickActionBlocked = React.useMemo(() => {
    const blocked: Partial<Record<QuickActionId, string>> = {}
    // 目录 / 效果库还在加载时不拦：先灰掉再亮起来比「点不了又不知道为什么」好，但更好的是不闪。
    const modelsKnown = !models.loading
    const libraryKnown = !library.loading && library.items.length > 0
    for (const action of QUICK_ACTIONS) {
      if (modelsKnown && action.requires === 'upscale' && !findUpscaleModelOption(editModelOptions)) {
        blocked[action.id] = t(BLOCK_MESSAGE_KEYS['no-upscale-model'])
      } else if (modelsKnown && action.requires === 'image-edit' && editModelOptions.length === 0) {
        blocked[action.id] = t(BLOCK_MESSAGE_KEYS['no-image-model'])
      } else if (libraryKnown && action.effectId && !library.items.some((item) => item.id === action.effectId)) {
        blocked[action.id] = t(BLOCK_MESSAGE_KEYS['missing-effect'])
      }
    }
    return blocked
  }, [editModelOptions, library.items, library.loading, models.loading, t])

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
      if (outcome.status === 'blocked') reportFeedback(t(BLOCK_MESSAGE_KEYS[outcome.reason]))
    })
  }, [editModelOptions, node.id, reportFeedback, t])

  return { quickActionBlocked, onQuickAction }
}
