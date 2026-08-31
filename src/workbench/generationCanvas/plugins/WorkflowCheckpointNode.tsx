import React from 'react'
import { IconCheck, IconCircleCheck, IconLock } from '../../../vendor/tablerIcons'
import { useTranslation } from 'react-i18next'
import type { GenerationCanvasNode } from '../model/generationCanvasTypes'
import type { CanvasPluginNodeRenderProps } from './canvasPluginTypes'

/** The first trusted plugin: a visible, reviewable checkpoint in a reusable workflow. */
export function WorkflowCheckpointNode({ node: rawNode, selected, readOnly, host }: CanvasPluginNodeRenderProps): JSX.Element {
  const { t } = useTranslation()
  const node = rawNode as GenerationCanvasNode
  const state = (node.pluginState?.state || {}) as { checked?: boolean; note?: string }
  const checked = state.checked === true
  const setChecked = () => {
    if (readOnly || !host?.hasPermission('canvas.write')) return
    if (!node.pluginState) return
    host.requestNodePatch({ pluginState: { ...node.pluginState, state: { ...state, checked: !checked } } })
  }
  return (
    <article
      className="flex h-full flex-col gap-3 rounded-nomi border border-nomi-line bg-nomi-paper p-4 shadow-nomi-md"
      data-plugin-type="nomi.workflow/checkpoint"
      data-selected={selected ? 'true' : undefined}
    >
      <header className="flex items-center gap-2 text-body-sm font-semibold text-nomi-ink-80">
        <IconCheck size={18} stroke={1.8} />
        <span className="truncate">{node.title || t('generationCommon.workflowPlugin.checkpointTitle')}</span>
        {readOnly ? <IconLock size={14} className="ml-auto text-nomi-ink-40" aria-label={t('generationCommon.workflowPlugin.readOnly')} /> : null}
      </header>
      <button
        type="button"
        className="flex items-center gap-2 rounded-nomi-sm border border-nomi-line bg-transparent px-3 py-2 text-left text-body-sm text-nomi-ink-80 hover:bg-nomi-ink-05 disabled:cursor-not-allowed disabled:opacity-60"
        disabled={readOnly || !host?.hasPermission('canvas.write')}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => { event.stopPropagation(); setChecked() }}
        aria-pressed={checked}
      >
        <IconCircleCheck size={18} className={checked ? 'text-nomi-accent' : 'text-nomi-ink-40'} />
        {checked ? t('generationCommon.workflowPlugin.checked') : t('generationCommon.workflowPlugin.checkpointAction')}
      </button>
      <p className="m-0 text-caption text-nomi-ink-60">
        {state.note || t('generationCommon.workflowPlugin.checkpointHint')}
      </p>
    </article>
  )
}
