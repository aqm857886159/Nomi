import React from 'react'
import { useTranslation } from 'react-i18next'
import { IconAlertTriangle, IconGripVertical, IconPlus, IconTrash, IconX } from '@tabler/icons-react'
import { cn } from '../../../utils/cn'
import { NomiSelect } from '../../../design'
import { AutoGrowTextarea } from '../../ai/composer/AutoGrowTextarea'
import type { PlanAnchor, PlanShot } from '../../generationCanvas/agent/storyboardPlan'
import { DURATION_OPTIONS_SEC } from '../../generationCanvas/agent/storyboardPlanEdits'
import type { ModelOption } from '../../../config/models'
import { useDedupedModelSelect } from '../../common/useDedupedModelSelect'
import { ShotParamsInline, ShotParamsDrawer } from './ShotParamControls'

/**
 * 镜卡（白底主轴）。重设计 v4：白卡 + shadow-nomi-sm + 放大镜号,做成视觉主轴(比锚区设定面更有存在感)。
 * 参考 = 从锚多选,**中性纯文字 chip**(不再满屏 accent-soft 蓝);失效引用红 chip + ×就地移除。
 * 时长走 NomiSelect 预设。
 */

type Props = {
  shot: PlanShot
  anchors: PlanAnchor[]
  /** 可选模型清单（父组件按镜头种类传图片/视频清单，完整 ModelOption 供解析档案参数）；空 → 不显模型选择器，落画布按种类用默认模型兜底。 */
  modelOptions?: ModelOption[]
  /** 这镜引用了、但锚已不存在的 id（红标 + 阻断确认）。 */
  danglingIds: string[]
  onUpdate: (patch: Partial<PlanShot>) => void
  onToggleAnchor: (anchorId: string) => void
  onRemove: () => void
  /** 把这镜的模型参数+模式套用到全部镜头（编辑器实现）。 */
  onApplyParamsToAll?: () => void
  promptInvalid?: boolean
  // grip 拖拽重排（state 在编辑器，卡只透传）。
  draggable?: boolean
  isDragOver?: boolean
  onDragStart?: () => void
  onDragOver?: (event: React.DragEvent) => void
  onDrop?: () => void
  onDragEnd?: () => void
}

export default function StoryboardShotCard(props: Props): JSX.Element {
  const { t } = useTranslation()
  const { shot, anchors, modelOptions, danglingIds, onUpdate, onToggleAnchor, onRemove, promptInvalid, onApplyParamsToAll } = props
  const [pickerOpen, setPickerOpen] = React.useState(false)
  // 参数抽屉 open 态提升到镜卡：inline 选择器并进 header 同一行，抽屉 full-width 落在下方（用户反馈「参数换行多」）。
  const [paramsOpen, setParamsOpen] = React.useState(false)
  const byId = new Map(anchors.map((anchor) => [anchor.id, anchor]))
  const selected = shot.anchorIds.filter((id) => byId.has(id))
  const unselected = anchors.filter((anchor) => !shot.anchorIds.includes(anchor.id))

  // 镜头种类：image=静态画面；video=直出视频；image-video=先出首帧图再用 first_frame 生视频。
  // 底层仍保持 shotKind 二值，image-video 用 shotKind=video + keyframe.enabled 表达，避免历史方案变形。
  // 切种类清掉模型/模式/参数——两种类的模型目录不通用，留着会张冠李戴（落画布按种类取默认兜底）；
  // 切回 video 时时长兜底 5s（图片镜头的 durationSec 是 0）。
  const shotKind = shot.shotKind ?? 'video'
  const isImageShot = shotKind === 'image'
  const shotTypeValue = isImageShot ? 'image' : shot.keyframe?.enabled === true ? 'image-video' : 'video'
  const onKindChange = (value: string): void => {
    if (value === shotTypeValue) return
    if (value === 'image') onUpdate({ shotKind: 'image', keyframe: undefined, modelKey: undefined, modeId: undefined, params: undefined })
    else if (value === 'image-video') {
      onUpdate({
        shotKind: 'video',
        durationSec: shot.durationSec > 0 ? shot.durationSec : 5,
        keyframe: { ...(shot.keyframe || {}), enabled: true, prompt: shot.keyframe?.prompt || '' },
        modelKey: undefined,
        modeId: undefined,
        params: undefined,
      })
    } else {
      onUpdate({ shotKind: 'video', keyframe: undefined, durationSec: shot.durationSec > 0 ? shot.durationSec : 5, modelKey: undefined, modeId: undefined, params: undefined })
    }
  }

  const durationOptions = [...new Set([...DURATION_OPTIONS_SEC, shot.durationSec])]
    .filter((sec) => Number.isFinite(sec) && sec > 0)
    .sort((a, b) => a - b)
    .map((sec) => ({ value: String(sec), label: t('storyboardEditor.second', { count: sec }) }))
  // 模型选择器：空值=默认（落画布用默认视频模型兜底）。选了具体模型 → 写 modelKey，清 modeId
  // （由 buildPlannedNodeMeta 按所选模型自动取默认模式，避免把别的模型的 modeId 套错）。
  // 选具体模型 → 写 modelKey、清 modeId/params（由 buildPlannedNodeMeta 按所选模型取默认模式）。
  const onShotModelChange = React.useCallback(
    (value: string) => onUpdate({ modelKey: value || undefined, modeId: undefined, params: undefined }),
    [onUpdate],
  )
  // 去重选择 view-model（与画布节点共用同一逻辑，P1）。
  const modelSelect = useDedupedModelSelect(modelOptions ?? [], shot.modelKey ?? '', onShotModelChange)
  // 模型下拉：「默认模型」空值项 + 去重后的模型（同模型只一条，多家标「N 家」）。
  const modelSelectOptions = modelOptions && modelOptions.length > 0
    ? [{ value: '', label: t('storyboardEditor.defaultModel') }, ...modelSelect.modelOptions]
    : null
  const onModelSelect = (id: string): void => (id ? modelSelect.onModelPick(id) : onShotModelChange(''))
  // 选中模型的完整 option（带 archetype 信息）→ 给 ShotParamControls 解析参数。空值=默认模型（无参数）。
  const selectedModelOption = modelOptions?.find((o) => o.value === shot.modelKey) ?? null

  return (
    <div
      draggable={props.draggable}
      onDragStart={props.onDragStart}
      onDragOver={props.onDragOver}
      onDrop={props.onDrop}
      onDragEnd={props.onDragEnd}
      className={cn(
        'border rounded-nomi p-3 bg-nomi-paper shadow-nomi-sm',
        props.isDragOver ? 'border-nomi-accent' : 'border-nomi-line',
      )}
    >
      {/* header 一行：镜号/时长/模型/供应商/inline 参数全并进同一 flex-wrap 区，删除钉右上（不参与折行）。 */}
      <div className="flex items-start gap-1.5">
        <div className="flex items-center gap-1.5 flex-wrap flex-1 min-w-0">
          <span className="shrink-0 cursor-grab text-nomi-ink-20 active:cursor-grabbing" aria-hidden>
            <IconGripVertical size={15} stroke={1.6} />
          </span>
          <span className="text-title font-semibold text-nomi-ink tabular-nums mr-0.5">{t('storyboardEditor.shotNumber', { index: shot.index })}</span>
          <NomiSelect
            ariaLabel={t('storyboardEditor.shotType')}
            leadingLabel={t('storyboardEditor.type')}
            size="xs"
            value={shotTypeValue}
            options={[
              { value: 'image', label: t('storyboardEditor.image') },
              { value: 'video', label: t('storyboardEditor.video') },
              { value: 'image-video', label: t('storyboardEditor.imageVideo') },
            ]}
            onChange={onKindChange}
          />
          {!isImageShot ? (
            <NomiSelect
              ariaLabel={t('storyboardEditor.duration')}
              leadingLabel={t('storyboardEditor.duration')}
              size="xs"
              value={String(shot.durationSec)}
              options={durationOptions}
              onChange={(value) => onUpdate({ durationSec: Number(value) })}
            />
          ) : null}
          {modelSelectOptions ? (
            <NomiSelect
              ariaLabel={isImageShot ? t('storyboardEditor.imageModel') : t('storyboardEditor.videoModel')}
              leadingLabel={t('storyboardEditor.model')}
              size="xs"
              triggerMaxWidth={150}
              value={shot.modelKey ? modelSelect.modelValue : ''}
              options={modelSelectOptions}
              onChange={onModelSelect}
            />
          ) : null}
          {modelSelect.providerOptions.length > 1 ? (
            <NomiSelect
              ariaLabel={t('storyboardEditor.provider')}
              leadingLabel={t('storyboardEditor.provider')}
              size="xs"
              triggerMaxWidth={110}
              value={modelSelect.providerValue}
              options={modelSelect.providerOptions}
              onChange={modelSelect.onProviderPick}
            />
          ) : null}
          {/* inline 参数（archetype 派生）：常用 select + 「参数」抽屉开关，并进同一行。默认模型/无档案 → 不渲染。 */}
          <ShotParamsInline
            modelOption={selectedModelOption}
            modeId={shot.modeId}
            params={shot.params || {}}
            onUpdate={(patch) => onUpdate(patch)}
            open={paramsOpen}
            onToggleOpen={() => setParamsOpen((o) => !o)}
          />
        </div>
        <button
          type="button"
          aria-label={t('storyboardEditor.deleteShot')}
          onClick={onRemove}
          className="shrink-0 size-7 grid place-items-center rounded-nomi-sm text-nomi-ink-30 hover:bg-nomi-ink-10 hover:text-nomi-ink-60"
        >
          <IconTrash size={14} stroke={1.6} />
        </button>
      </div>

      {/* 参数抽屉：open 时才渲染，full-width 落在 header 下方（模式/其余参数/套用全部）。 */}
      {paramsOpen ? (
        <ShotParamsDrawer
          modelOption={selectedModelOption}
          modeId={shot.modeId}
          params={shot.params || {}}
          onUpdate={(patch) => onUpdate(patch)}
          {...(onApplyParamsToAll ? { onApplyToAll: onApplyParamsToAll } : {})}
        />
      ) : null}

      <div className="flex items-center gap-1.5 flex-wrap mt-2.5">
        <span className="text-micro text-nomi-ink-40 mr-0.5">{t('storyboardEditor.reference')}</span>
        {selected.map((id) => {
          const anchor = byId.get(id)!
          // chip 本体不再点一下就删（误删源）；末尾加明确的 × 才移除引用。
          return (
            <span
              key={id}
              className="h-6 pl-2.5 pr-1 rounded-full bg-nomi-ink-05 text-nomi-ink-80 text-caption inline-flex items-center gap-1"
            >
              {anchor.name || t('storyboardEditor.unnamed')}
              <button
                type="button"
                aria-label={t('storyboardEditor.removeReference', { name: anchor.name || t('storyboardEditor.thisAnchor') })}
                title={t('storyboardEditor.removeReference', { name: anchor.name || t('storyboardEditor.thisAnchor') })}
                onClick={() => onToggleAnchor(id)}
                className="grid place-items-center size-4 rounded-full text-nomi-ink-40 hover:bg-nomi-ink-20 hover:text-nomi-ink-80"
              >
                <IconX size={11} stroke={1.8} aria-hidden />
              </button>
            </span>
          )
        })}
        {danglingIds.map((id) => (
          <button
            key={id}
            type="button"
            onClick={() => onToggleAnchor(id)}
            title={t('storyboardEditor.invalidReferenceHint')}
            className="h-6 px-2 rounded-full bg-workbench-danger-soft text-workbench-danger text-caption inline-flex items-center gap-1"
          >
            <span className="line-through">{t('storyboardEditor.invalidReference')}</span>
            <IconX size={12} stroke={1.8} />
          </button>
        ))}
        {unselected.length > 0 && (
          <button
            type="button"
            onClick={() => setPickerOpen((open) => !open)}
            aria-expanded={pickerOpen}
            className="h-6 px-2.5 rounded-full border border-dashed border-nomi-ink-20 text-nomi-ink-60 text-caption inline-flex items-center gap-1 hover:text-nomi-ink-80"
          >
            <IconPlus size={12} stroke={1.8} />
            {t('storyboardEditor.reference')}
          </button>
        )}
      </div>

      {pickerOpen && unselected.length > 0 && (
        <div className="flex items-center gap-1.5 flex-wrap mt-1.5 pl-7">
          {unselected.map((anchor) => (
            <button
              key={anchor.id}
              type="button"
              onClick={() => {
                onToggleAnchor(anchor.id)
                if (unselected.length === 1) setPickerOpen(false)
              }}
              className="h-6 px-2.5 rounded-full border border-nomi-line text-nomi-ink-60 text-caption inline-flex items-center hover:border-nomi-ink-20 hover:text-nomi-ink-80"
            >
              {anchor.name || t('storyboardEditor.unnamed')}
            </button>
          ))}
        </div>
      )}

      {danglingIds.length > 0 && (
        <div className="text-micro text-workbench-danger mt-1.5 flex items-center gap-1">
          <IconAlertTriangle size={12} stroke={1.8} />
          {t('storyboardEditor.danglingWarning')}
        </div>
      )}

      {shotTypeValue === 'image-video' ? (
        <div className="mt-2.5">
          <div className="mb-1 text-micro text-nomi-ink-40">{t('storyboardEditor.keyframePrompt')}</div>
          <AutoGrowTextarea
            value={shot.keyframe?.prompt || ''}
            onChange={(event) => onUpdate({ keyframe: { ...(shot.keyframe || {}), enabled: true, prompt: event.target.value } })}
            aria-label={t('storyboardEditor.keyframePromptAria', { index: shot.index })}
            placeholder={t('storyboardEditor.keyframePromptPlaceholder')}
            className="px-2 py-2 rounded-nomi-sm border border-nomi-line bg-nomi-paper text-body-sm text-nomi-ink-80 leading-normal focus:border-nomi-accent"
          />
        </div>
      ) : null}

      {shotTypeValue === 'image-video' ? (
        <div className="mt-2.5 mb-1 text-micro text-nomi-ink-40">{t('storyboardEditor.videoPrompt')}</div>
      ) : null}
      <AutoGrowTextarea
        value={shot.prompt}
        onChange={(event) => onUpdate({ prompt: event.target.value })}
        aria-label={t('storyboardEditor.promptAria', { index: shot.index })}
        placeholder={isImageShot ? t('storyboardEditor.imagePromptPlaceholder') : t('storyboardEditor.videoPromptPlaceholder')}
        className={cn(
          'mt-2.5 px-2 py-2 rounded-nomi-sm border bg-nomi-paper',
          'text-body-sm text-nomi-ink-80 leading-normal focus:border-nomi-accent',
          promptInvalid ? 'border-workbench-danger' : 'border-nomi-line',
        )}
      />
    </div>
  )
}
