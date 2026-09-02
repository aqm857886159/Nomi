import React from 'react'
import { useTranslation } from 'react-i18next'
import { IconPlayerPlay, IconTrash, IconX } from '@tabler/icons-react'
import type { ModelOption } from '../../../config/models'

/**
 * 分镜页多选浮条。布局/作用域语义对齐画布 `CanvasSelectionToolbar`：圆角浮条、已选计数、
 * 生成与统一模型动作、清除入口；分镜特有的移场/删除仍只作用于已选镜。
 */
export default function StoryboardSelectionToolbar({
  selectedCount,
  modelOptions,
  sceneOptions,
  onGenerate,
  onMoveToScene,
  onApplyModel,
  onDelete,
  onClear,
}: {
  selectedCount: number
  modelOptions: readonly ModelOption[]
  sceneOptions: readonly { id: string; title: string }[]
  onGenerate: () => void
  onMoveToScene: (sceneId: string) => void
  onApplyModel: (modelKey: string) => void
  onDelete: () => void
  onClear: () => void
}): JSX.Element {
  const { t } = useTranslation()
  const [modelKey, setModelKey] = React.useState('')
  return (
    <div
      className="sticky bottom-2 z-10 mx-auto inline-flex max-w-full items-center gap-2 overflow-x-auto rounded-full border border-nomi-line bg-nomi-paper/[0.96] px-2.5 py-1.5 shadow-nomi-md"
      aria-label={t('storyboardEditor.selection.aria')}
      data-storyboard-selection-toolbar="true"
      onPointerDown={(event) => event.stopPropagation()}
    >
      <span className="whitespace-nowrap pl-1.5 pr-1 text-body-sm text-nomi-ink-60">{t('storyboardEditor.selection.count', { count: selectedCount })}</span>
      <button type="button" onClick={onGenerate} className="inline-flex h-7 shrink-0 items-center gap-1 rounded-full border border-nomi-line px-2 text-micro text-nomi-ink-80 hover:border-nomi-accent hover:text-nomi-accent">
        <IconPlayerPlay size={13} stroke={1.8} />
        {t('storyboardEditor.selection.generate')}
      </button>
      <select
        value=""
        onChange={(event) => onMoveToScene(event.target.value)}
        aria-label={t('storyboardEditor.selection.moveToScene')}
        className="h-7 shrink-0 rounded-full border border-nomi-line bg-nomi-paper px-2 text-micro text-nomi-ink-80"
      >
        <option value="">{t('storyboardEditor.selection.moveToScene')}</option>
        <option value="__none__">{t('storyboardEditor.selection.allScenes')}</option>
        {sceneOptions.map((scene) => <option key={scene.id} value={scene.id}>{scene.title}</option>)}
      </select>
      {modelOptions.length > 0 ? (
        <select
          value={modelKey}
          onChange={(event) => {
            setModelKey(event.target.value)
            if (event.target.value) onApplyModel(event.target.value)
          }}
          aria-label={t('storyboardEditor.selection.applyModel')}
          className="h-7 max-w-44 shrink-0 rounded-full border border-nomi-line bg-nomi-paper px-2 text-micro text-nomi-ink-80"
        >
          <option value="">{t('storyboardEditor.selection.applyModel')}</option>
          {modelOptions.map((model) => <option key={model.value} value={model.value}>{model.label}</option>)}
        </select>
      ) : null}
      <button type="button" onClick={onDelete} className="inline-flex h-7 shrink-0 items-center gap-1 rounded-full border border-workbench-danger px-2 text-micro text-workbench-danger hover:bg-workbench-danger-soft">
        <IconTrash size={13} stroke={1.8} />
        {t('storyboardEditor.selection.delete')}
      </button>
      <button type="button" onClick={onClear} aria-label={t('storyboardEditor.selection.clear')} className="grid size-7 shrink-0 place-items-center rounded-full text-nomi-ink-40 hover:bg-nomi-ink-10 hover:text-nomi-ink-80">
        <IconX size={14} stroke={1.8} />
      </button>
    </div>
  )
}

