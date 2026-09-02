import React from 'react'
import { useTranslation } from 'react-i18next'
import { IconAlertTriangle, IconPlus, IconX } from '@tabler/icons-react'
import { NomiSelect } from '../../../../design'
import { AutoGrowTextarea } from '../../../ai/composer/AutoGrowTextarea'
import type { PlanAnchor, PlanShot } from '../../../generationCanvas/agent/storyboardPlan'
import type { ModelOption } from '../../../../config/models'
import { ShotParamsDrawer } from '../ShotParamControls'

/**
 * 镜行展开态（▾）：参考绑定（锚 chips，自旧 ShotCard 迁）→ 台词/转场（时间轴数据，
 * 用户拍板从行内下沉——「真实生成的时候哪有这个东西」）→ 模式与其余参数（ShotParamsDrawer）。
 * 台词绑 `dialogue`；`subtitle` 无独立编辑入口（planner 给了就在行下沿兜底显示，不丢）。
 * 转场只挑类型，帧数属剪辑层参数、表不逼用户懂（R2）。
 */

const TRANSITION_TYPES = ['cut', 'dissolve', 'fade', 'match_cut', 'whip_pan'] as const

type Props = {
  shot: PlanShot
  anchors: PlanAnchor[]
  danglingIds: string[]
  selectedModelOption: ModelOption | null
  onUpdate: (patch: Partial<PlanShot>) => void
  onToggleAnchor: (anchorId: string) => void
  onApplyParamsToAll?: () => void
}

export default function StoryboardShotRowExpand({
  shot,
  anchors,
  danglingIds,
  selectedModelOption,
  onUpdate,
  onToggleAnchor,
  onApplyParamsToAll,
}: Props): JSX.Element {
  const { t } = useTranslation()
  const [pickerOpen, setPickerOpen] = React.useState(false)
  const byId = new Map(anchors.map((anchor) => [anchor.id, anchor]))
  const selected = shot.anchorIds.filter((id) => byId.has(id))
  const unselected = anchors.filter((anchor) => !shot.anchorIds.includes(anchor.id))

  const transitionValue = shot.transition?.type ?? ''
  const onTransitionChange = (value: string): void => {
    if (!value) {
      onUpdate({ transition: undefined })
      return
    }
    onUpdate({ transition: { ...(shot.transition || {}), type: value as (typeof TRANSITION_TYPES)[number] } })
  }

  return (
    <div className="flex flex-col gap-2.5 p-2.5 rounded-nomi-sm bg-nomi-ink-05">
      {/* ── 参考绑定（哪些参考卡进这一镜）：chip 本体不点删，末尾 × 才移除（误删源教训）── */}
      <div className="flex items-center gap-1.5 flex-wrap">
        <span className="text-micro text-nomi-ink-40 mr-0.5">{t('storyboardEditor.reference')}</span>
        {selected.map((id) => {
          const anchor = byId.get(id)!
          return (
            <span
              key={id}
              className="h-6 pl-2.5 pr-1 rounded-full bg-nomi-paper border border-nomi-line text-nomi-ink-80 text-caption inline-flex items-center gap-1"
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
        {unselected.length > 0 ? (
          <button
            type="button"
            onClick={() => setPickerOpen((open) => !open)}
            aria-expanded={pickerOpen}
            className="h-6 px-2.5 rounded-full border border-dashed border-nomi-ink-20 text-nomi-ink-60 text-caption inline-flex items-center gap-1 hover:text-nomi-ink-80"
          >
            <IconPlus size={12} stroke={1.8} />
            {t('storyboardEditor.reference')}
          </button>
        ) : null}
      </div>
      {pickerOpen && unselected.length > 0 ? (
        <div className="flex items-center gap-1.5 flex-wrap">
          {unselected.map((anchor) => (
            <button
              key={anchor.id}
              type="button"
              onClick={() => {
                onToggleAnchor(anchor.id)
                if (unselected.length === 1) setPickerOpen(false)
              }}
              className="h-6 px-2.5 rounded-full border border-nomi-line bg-nomi-paper text-nomi-ink-60 text-caption inline-flex items-center hover:border-nomi-ink-20 hover:text-nomi-ink-80"
            >
              {anchor.name || t('storyboardEditor.unnamed')}
            </button>
          ))}
        </div>
      ) : null}
      {danglingIds.length > 0 ? (
        <div className="text-micro text-workbench-danger flex items-center gap-1">
          <IconAlertTriangle size={12} stroke={1.8} />
          {t('storyboardEditor.danglingWarning')}
        </div>
      ) : null}

      {/* ── 台词 + 转场（时间轴数据；组装/顺播读它，生成 prompt 不含）── */}
      <div className="flex items-start gap-2">
        <span className="shrink-0 pt-1.5 text-micro text-nomi-ink-60">{t('storyboardEditor.row.dialogueLabel')}</span>
        <AutoGrowTextarea
          value={shot.dialogue || ''}
          onChange={(event) => onUpdate({ dialogue: event.target.value || undefined })}
          aria-label={t('storyboardEditor.row.dialogueAria', { index: shot.index })}
          placeholder={t('storyboardEditor.row.dialoguePlaceholder')}
          className="flex-1 px-2 py-1.5 rounded-nomi-sm border border-nomi-line bg-nomi-paper text-body-sm text-nomi-ink-80 leading-normal focus:border-nomi-accent"
        />
        <NomiSelect
          ariaLabel={t('storyboardEditor.row.transitionAria')}
          leadingLabel={t('storyboardEditor.row.transitionLabel')}
          size="xs"
          value={transitionValue}
          options={[
            { value: '', label: t('storyboardEditor.row.transitionNone') },
            ...TRANSITION_TYPES.map((type) => ({ value: type, label: t(`storyboardEditor.row.transition.${type}`) })),
          ]}
          onChange={onTransitionChange}
        />
      </div>

      <ShotParamsDrawer
        modelOption={selectedModelOption}
        modeId={shot.modeId}
        params={shot.params || {}}
        onUpdate={(patch) => onUpdate(patch)}
        {...(onApplyParamsToAll ? { onApplyToAll: onApplyParamsToAll } : {})}
      />
    </div>
  )
}
