import React from 'react'
import { useTranslation } from 'react-i18next'

import { resolveAutoGenerationModel } from '../../../config/autoGenerationModel'
import type { ModelOption } from '../../../config/models'
import { useVendorPreferenceOrder } from '../../common/useVendorPreference'
import type { GenerationCanvasNode } from '../model/generationCanvasTypes'
import { getGenerationModelDefaults, subscribeGenerationModelDefaults } from '../model/generationModelDefaults'
import { isModelRecentlyAiling } from '../runner/modelHealthMemory'
import { useGenerationCanvasStore } from '../store/generationCanvasStore'
import { applyPickedNodeModel } from './buildNodeModelChangePatch'
import { deriveGenerationDefaultMediaKind } from './defaultNodeModelSelection'
import type { useNodeWriteAccess } from './nodeWriteAccess'

type NodeWriteAccess = ReturnType<typeof useNodeWriteAccess>

export type LeadingAutoModelOption = {
  label: string
  description: string
  dividerAfter: true
  boardAnchor: 'node.picker-auto-option'
  neverTruncate: true
}

/**
 * 画布节点生成框左下「自动 · 实际模型名」胶囊与下拉首项派生及切换写入（AutoModel node.model-chip-auto / node.picker-auto-option）。
 * 底层直接调唯一真源 `resolveAutoGenerationModel`，与 `useNodeModelAutoSelect` 完全同源。
 */
export function useNodeAutoModelPicker({
  node,
  meta,
  modelOptions,
  isImageLike,
  isVideoLike,
  latestNode,
  updateNode,
}: {
  node: GenerationCanvasNode
  meta: Record<string, unknown>
  modelOptions: readonly ModelOption[]
  isImageLike: boolean
  isVideoLike: boolean
  latestNode: NodeWriteAccess['latestNode']
  updateNode: NodeWriteAccess['updateNode']
}): {
  isAutoModel: boolean
  leadingAutoOption: LeadingAutoModelOption | undefined
  handleModelChange: (value: string, vendor?: string) => void
} {
  const { t, i18n } = useTranslation()
  const orderedVendorKeys = useVendorPreferenceOrder()
  const savedDefaults = React.useSyncExternalStore(
    subscribeGenerationModelDefaults,
    getGenerationModelDefaults,
    getGenerationModelDefaults,
  )

  const mediaKind = deriveGenerationDefaultMediaKind({ isImageLike, isVideoLike })
  const autoModelResolved = React.useMemo(
    () =>
      mediaKind
        ? resolveAutoGenerationModel({
            mediaKind,
            options: modelOptions,
            orderedVendorKeys,
            isAiling: isModelRecentlyAiling,
          })
        : null,
    // eslint-disable-next-line react-hooks/exhaustive-deps -- i18n.language 驱动自动模型显示名重算
    [mediaKind, modelOptions, orderedVendorKeys, i18n.language],
  )

  const handleModelChange = (value: string, vendor?: string): void => {
    const { nodes, edges } = useGenerationCanvasStore.getState()
    const currentNode = latestNode(node.id) || node
    if (!value && autoModelResolved) {
      applyPickedNodeModel(
        {
          node: currentNode,
          nodes,
          edges,
          modelOptions,
          value: autoModelResolved.option.value,
          vendor: autoModelResolved.vendorKey,
          modelAuto: true,
        },
        updateNode,
      )
      return
    }
    applyPickedNodeModel({ node: currentNode, nodes, edges, modelOptions, value, vendor, modelAuto: false }, updateNode)
  }

  const isAutoModel = Boolean(mediaKind && meta.modelAuto === true && autoModelResolved)
  const leadingAutoOption: LeadingAutoModelOption | undefined =
    mediaKind && autoModelResolved
      ? {
          label: t('generationCommon.parameters.autoWithModel', { model: autoModelResolved.displayName }),
          description: savedDefaults[mediaKind]
            ? t('generationCommon.parameters.autoStrongest')
            : t('generationCommon.parameters.autoFollowsDefaultStrongest'),
          dividerAfter: true,
          boardAnchor: 'node.picker-auto-option',
          neverTruncate: true,
        }
      : undefined

  return { isAutoModel, leadingAutoOption, handleModelChange }
}
