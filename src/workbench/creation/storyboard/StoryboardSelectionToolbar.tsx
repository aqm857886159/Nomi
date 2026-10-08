import React, { type JSX } from 'react'
import { useTranslation } from 'react-i18next'
import { IconPlayerPlay, IconPlayerSkipForward, IconRobot, IconTrash, IconX } from '@tabler/icons-react'
import StoryboardBulkParams from './StoryboardBulkParams'
import BulkModelPicker from '../../common/BulkModelPicker'
import { SelectionToolbarFrame } from '../../generationCanvas/components/SelectionToolbarFrame'
import type { StoryboardShotKind } from './storyboardBulkModelScope'
import type { StoryboardBulkParamGroup } from './storyboardBulkParamScope'

/**
 * 分镜页多选浮条。布局/作用域语义对齐画布 `CanvasSelectionToolbar`：纸白圆角浮条、已选计数、
 * 生成与统一模型动作、清除入口；分镜特有的「本次跳过」「删除」只作用于已选镜（移场、锁定在每行 ⋯ 菜单里）。
 *
 * 「交给 Agent」是 v6 合同的三入口之一（§2.7 入口 2/3，另两处：页脚、每行 ⋯ 菜单），三种选择规模、不是重复入口；
 * 三处共用 `data-storyboard-agent-handoff`，走查一次数得出"是不是三个都在"。
 *
 * 「移到场」只在这份分镜**真的有场**时出现：没有场的分镜里它只剩「移到场」与「未分场」两行——
 * 一个点开什么都做不了的下拉（2026-09-11 用户实测反馈）。有场才是它有意义的前提，
 * 所以判据就写在渲染条件上，而不是靠一句提示解释一个空控件。
 * 标题也不再是那条既当标签又当选项的 `<option value="">`：它是 `NomiSelect` 的真占位，选不中。
 *
 * 「模型 + 参数」不是本文件自己的下拉：它与镜头行底栏、画布节点底栏共用 `InlineParameterBar`（见 `StoryboardBulkParams`）。
 * 选中集合里有几种镜种就有几组，作用域写在组前的小标签上（「图片 ×3」），镜种分组由 `storyboardBulkModelScope` 派生，
 * 参数 = 这一组各镜所用模型档案的公共可选集（`storyboardBulkParamScope`）。
 * 「本次跳过」（以前住在行首复选框上）在这里：它作用于已选镜，和锁定一样是一个选中后的动作。
 */
export default function StoryboardSelectionToolbar({
  selectedCount,
  modelGroups,
  onGenerate,
  onApplyModel,
  onApplyParam,
  allSkipped = false,
  onSkip,
  onDelete,
  onClear,
  onAgentHandoff,
}: {
  selectedCount: number
  /** 按选中集合的镜种分好的模型档（`storyboardBulkModelGroups`）；一档一个下拉。 */
  modelGroups: readonly StoryboardBulkParamGroup[]
  onGenerate: () => void
  /** 选中即定死 (kind, modelKey, vendor)——镜种随选项一起回传，下游不用再猜这条属于哪一档。 */
  onApplyModel: (kind: StoryboardShotKind, modelKey: string, vendor?: string) => void
  /** 面板里改了一个公共参数（作用于这一档镜种的已选镜）。 */
  onApplyParam: (kind: StoryboardShotKind, control: Parameters<React.ComponentProps<typeof StoryboardBulkParams>['onParamChange']>[0], raw: string) => void
  /** 已选镜**全部**已是「本次跳过」时，按钮改说「取消跳过」。 */
  allSkipped?: boolean
  /** 「本次跳过」已选镜（与锁定不同：只是这一批不跑，内容原样留着）。 */
  onSkip?: (() => void) | undefined
  onDelete: () => void
  onClear: () => void
  /** Agent 入口：把选中的镜头交给常驻 Agent 处理。 */
  onAgentHandoff?: (() => void) | undefined
}): JSX.Element {
  const { t } = useTranslation()
  return (
    <SelectionToolbarFrame
      className="sticky bottom-2 z-10 mx-auto max-w-full flex-wrap justify-center gap-1.5 overflow-x-visible rounded-3xl"
      ariaLabel={t('storyboardEditor.selection.aria')}
      dataStoryboardSelectionToolbar
      onPointerDown={(event) => event.stopPropagation()}
    >
      <span className="whitespace-nowrap pl-1.5 pr-1 text-body-sm text-nomi-ink-60">
        {t('storyboardEditor.selection.count', { count: selectedCount })}
      </span>
      <button
        type="button"
        onClick={onClear}
        aria-label={t('storyboardEditor.selection.clear')}
        className="grid size-7 shrink-0 -ml-1 place-items-center rounded-full text-nomi-ink-40 hover:bg-nomi-ink-10 hover:text-nomi-ink-80"
      >
        <IconX size={14} stroke={1.8} />
      </button>
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
      {modelGroups.map((group) => {
        const scope = t(`generationCommon.production.modelGroup.${group.kind}`, { count: group.count })
        return (
          <span key={group.kind} className="inline-flex shrink-0 items-center gap-1.5" data-storyboard-model-group={group.kind}>
            <span className="whitespace-nowrap text-micro text-nomi-ink-40">{scope}</span>
            <StoryboardBulkParams
              scope={group.scope}
              kind={group.kind}
              modelOptions={group.options}
              selectedModel={group.selectedModel}
              hideModel
              onModelChange={(value, vendor) => onApplyModel(group.kind, value, vendor)}
              onParamChange={(control, raw) => onApplyParam(group.kind, control, raw)}
            />
            <BulkModelPicker
              modelOptions={group.options}
              ariaLabel={t('generationCommon.parameters.model')}
              leadingLabel={scope}
              placeholder={t('generationCommon.production.unifyModel')}
              size="xs"
              triggerMaxWidth={150}
              onPick={(value, vendor) => onApplyModel(group.kind, value, vendor)}
            />
          </span>
        )
      })}
      {onSkip ? (
        <button
          type="button"
          onClick={onSkip}
          data-storyboard-selection-skip={allSkipped ? 'on' : 'off'}
          className="inline-flex h-7 shrink-0 items-center gap-1 rounded-full border border-nomi-line px-2 text-micro text-nomi-ink-80 hover:border-nomi-accent hover:text-nomi-accent"
        >
          <IconPlayerSkipForward size={13} stroke={1.8} />
          {allSkipped ? t('storyboardEditor.selection.unskip') : t('storyboardEditor.selection.skip')}
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
    </SelectionToolbarFrame>
  )
}
