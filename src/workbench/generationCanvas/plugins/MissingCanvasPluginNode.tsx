import React from 'react'
import { IconPlugConnectedX, IconRefresh } from '../../../vendor/tablerIcons'
import { useTranslation } from 'react-i18next'
import type { GenerationCanvasNode } from '../model/generationCanvasTypes'
import type { CanvasPluginNodeRenderProps } from './canvasPluginTypes'

export function MissingCanvasPluginNode({ node: rawNode }: CanvasPluginNodeRenderProps): JSX.Element {
  const { t } = useTranslation()
  const node = rawNode as GenerationCanvasNode
  const pluginId = node.pluginState?.pluginId || 'unknown'
  const typeId = node.pluginState?.typeId || node.typeId || 'unknown'
  return (
    <article className="flex h-full flex-col justify-between gap-3 rounded-nomi border border-dashed border-nomi-line bg-nomi-ink-05 p-4 text-nomi-ink-60" data-plugin-missing="true">
      <div className="flex items-center gap-2 text-body-sm font-semibold text-nomi-ink-80">
        <IconPlugConnectedX size={18} stroke={1.8} />
        <span>{t('generationCommon.workflowPlugin.missingTitle')}</span>
      </div>
      <p className="m-0 text-caption">{t('generationCommon.workflowPlugin.missingHint')}</p>
      <code className="break-all text-micro text-nomi-ink-40">{pluginId} · {typeId}</code>
      <span className="inline-flex items-center gap-1 text-caption text-nomi-ink-60"><IconRefresh size={14} />{t('generationCommon.workflowPlugin.restoreHint')}</span>
    </article>
  )
}
