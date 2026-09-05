import React from 'react'
import { useTranslation } from 'react-i18next'
import { IconLock, IconPlayerPlay, IconRobot, IconTrash, IconX } from '@tabler/icons-react'
import type { ModelOption } from '../../../config/models'
import { SelectionToolbarFrame } from '../../generationCanvas/components/SelectionToolbarFrame'

/**
 * 分镜页多选浮条。布局/作用域语义对齐画布 `CanvasSelectionToolbar`：纸白圆角浮条、已选计数、
 * 生成与统一模型动作、清除入口；分镜特有的移场/锁定/删除仍只作用于已选镜。
 *
 * v6 新增「交给 Agent」（§2.7 入口 2/3）——三个入口对应三种选择规模（全部 / 多选 / 单行），
 * 不是同一功能的重复入口。三处共用 `data-storyboard-agent-handoff`，走查一次数得出"是不是三个都在"。
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
  onAgentHandoff,
  onLock,
}: {
  selectedCount: number
  modelOptions: readonly ModelOption[]
  sceneOptions: readonly { id: string; title: string }[]
  onGenerate: () => void
  onMoveToScene: (sceneId: string) => void
  onApplyModel: (modelKey: string) => void
  onDelete: () => void
  onClear: () => void
  /** 「交给 Agent」：把选中的这几镜交给常驻 Agent 改（改动就地预览 + 确认卡）。 */
  onAgentHandoff?: (() => void) | undefined
  /** 批量锁定选中镜（锁 = 不进批量、不被重跑；与「本次跳过」是两回事）。 */
  onLock?: (() => void) | undefined
}): JSX.Element {
  const { t } = useTranslation()
  const [modelKey, setModelKey] = React.useState('')
  return (
    <SelectionToolbarFrame
      className="sticky bottom-2 z-10 mx-auto max-w-full"
      ariaLabel={t('storyboardEditor.selection.aria')}
      dataStoryboardSelectionToolbar
      onPointerDown={(event) => event.stopPropagation()}
    >
      <span className="whitespace-nowrap pl-1.5 pr-1 text-body-sm text-nomi-ink-60">
        {t('storyboardEditor.selection.count', { count: selectedCount })}
      </span>
      <button
        type="button"
        onClick={onGenerate}
        className="inline-flex h-7 shrink-0 items-center gap-1 rounded-full border border-nomi-ink px-2 text-micro text-nomi-ink hover:bg-nomi-ink-05"
      >
        <IconPlayerPlay size={13} stroke={1.8} />
        {t('storyboardEditor.selection.generate')}
      </button>
      {onAgentHandoff ? (
        <button
          type="button"
          onClick={onAgentHandoff}
          data-storyboard-agent-handoff="selection"
          className="inline-flex h-7 shrink-0 items-center gap-1 rounded-full border border-nomi-line px-2 text-micro text-nomi-ink-80 hover:border-nomi-accent hover:text-nomi-accent"
        >
          <IconRobot size={13} stroke={1.8} />
          {t('storyboardEditor.agentHandoff.selection')}
        </button>
      ) : null}
      <select
        value=""
        onChange={(event) => onMoveToScene(event.target.value)}
        aria-label={t('storyboardEditor.selection.moveToScene')}
        className="h-7 shrink-0 rounded-full border border-nomi-line bg-nomi-paper px-2 text-micro text-nomi-ink-80"
      >
        <option value="">{t('storyboardEditor.selection.moveToScene')}</option>
        <option value="__none__">{t('storyboardEditor.selection.allScenes')}</option>
        {sceneOptions.map((scene) => (
          <option key={scene.id} value={scene.id}>
            {scene.title}
          </option>
        ))}
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
          {modelOptions.map((model) => (
            <option key={model.value} value={model.value}>
              {model.label}
            </option>
          ))}
        </select>
      ) : null}
      {onLock ? (
        <button
          type="button"
          onClick={onLock}
          className="inline-flex h-7 shrink-0 items-center gap-1 rounded-full border border-nomi-line px-2 text-micro text-nomi-ink-80 hover:border-nomi-accent hover:text-nomi-accent"
        >
          <IconLock size={13} stroke={1.8} />
          {t('storyboardEditor.selection.lock')}
        </button>
      ) : null}
      <button
        type="button"
        onClick={onDelete}
        className="inline-flex h-7 shrink-0 items-center gap-1 rounded-full border border-workbench-danger px-2 text-micro text-workbench-danger hover:bg-workbench-danger-soft"
      >
        <IconTrash size={13} stroke={1.8} />
        {t('storyboardEditor.selection.delete')}
      </button>
      <button
        type="button"
        onClick={onClear}
        aria-label={t('storyboardEditor.selection.clear')}
        className="grid size-7 shrink-0 place-items-center rounded-full text-nomi-ink-40 hover:bg-nomi-ink-10 hover:text-nomi-ink-80"
      >
        <IconX size={14} stroke={1.8} />
      </button>
    </SelectionToolbarFrame>
  )
}
