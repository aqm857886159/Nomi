import React from 'react'
import { useTranslation } from 'react-i18next'
import { IconLock, IconPlayerPlay, IconRobot, IconTrash, IconX } from '@tabler/icons-react'
import BulkModelPicker from '../../common/BulkModelPicker'
import { SelectionToolbarFrame } from '../../generationCanvas/components/SelectionToolbarFrame'
import type { StoryboardBulkModelGroup, StoryboardShotKind } from './storyboardBulkModelScope'

/**
 * 分镜页多选浮条。布局/作用域语义对齐画布 `CanvasSelectionToolbar`：纸白圆角浮条、已选计数、
 * 生成与统一模型动作、清除入口；分镜特有的移场/锁定/删除仍只作用于已选镜。
 *
 * v6 新增「交给 Agent」（§2.7 入口 2/3）——三个入口对应三种选择规模（全部 / 多选 / 单行），
 * 不是同一功能的重复入口。三处共用 `data-storyboard-agent-handoff`，走查一次数得出"是不是三个都在"。
 *
 * 「统一模型」不是本文件自己的下拉：它与画布框选工具条、分镜「全部镜头」批量条共用
 * `BulkModelPicker`（厂商明确、自带去重与健康度排序）。选中集合里有几种镜种就有几个下拉，
 * 作用域写在 `leadingLabel` 上（「图片 ×3」），镜种分组由 `storyboardBulkModelScope` 派生。
 */
export default function StoryboardSelectionToolbar({
  selectedCount,
  modelGroups,
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
  /** 按选中集合的镜种分好的模型档（`storyboardBulkModelGroups`）；一档一个下拉。 */
  modelGroups: readonly StoryboardBulkModelGroup[]
  sceneOptions: readonly { id: string; title: string }[]
  onGenerate: () => void
  onMoveToScene: (sceneId: string) => void
  /** 选中即定死 (kind, modelKey, vendor)——镜种随选项一起回传，下游不用再猜这条属于哪一档。 */
  onApplyModel: (kind: StoryboardShotKind, modelKey: string, vendor?: string) => void
  onDelete: () => void
  onClear: () => void
  /** 「交给 Agent」：把选中的这几镜交给常驻 Agent 改（改动就地预览 + 确认卡）。 */
  onAgentHandoff?: (() => void) | undefined
  /** 批量锁定选中镜（锁 = 不进批量、不被重跑；与「本次跳过」是两回事）。 */
  onLock?: (() => void) | undefined
}): JSX.Element {
  const { t } = useTranslation()
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
      {modelGroups.map((group) => {
        const scope = t(`generationCommon.production.modelGroup.${group.kind}`, { count: group.count })
        return (
          <span key={group.kind} className="shrink-0" data-storyboard-model-group={group.kind}>
            <BulkModelPicker
              modelOptions={group.options}
              onPick={(value, vendor) => onApplyModel(group.kind, value, vendor)}
              ariaLabel={t('storyboardEditor.selection.applyModelScoped', { scope })}
              leadingLabel={scope}
              placeholder={t('storyboardEditor.selection.applyModel')}
              size="sm"
              triggerMaxWidth={140}
            />
          </span>
        )
      })}
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
