import React from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '../../../../utils/cn'
import { NomiSelect } from '../../../../design'
import type { ModelOption } from '../../../../config/models'
import { useDedupedModelSelect } from '../../../common/useDedupedModelSelect'
import { translateModelDisplayText } from '../../../../i18n/modelDisplayText'
import type { ArchetypeMode, ModelArchetype } from '../../../../config/modelArchetypes/types'
import type { PlanShot } from '../../../generationCanvas/agent/storyboardPlan'
import { effectiveShotDurationSec } from '../../../generationCanvas/agent/storyboardPlan'
import { DURATION_OPTIONS_SEC, shotTypeOf } from '../../../generationCanvas/agent/storyboardPlanEdits'
import { composerBarLayout, composerBarParams, composerModeOptions } from './composerBarModel'
import { COMPOSER_GRID_GAP, composerGridTemplate } from './composerGridLayout'
import useComposerGridPlan from './useComposerGridPlan'
import useComposerGridMetrics from './useComposerGridMetrics'

/**
 * 提示词框下方的**底栏**（合同 v6 §2.3）——「和画布里的图片节点一样」那句话的落点。
 *
 * v5 把模型/模式/画幅/时长摊在**行上沿**，和"这镜做完没有"抢同一条视觉带宽；一屏十几行就成了
 * 一条控件河。v6 把它们整体搬进提示词块内部：批量观察继续靠表格骨架（行、场分组、画面格、状态色），
 * 精细调参数的控件全部收在这一条里，用户已经在画布上学会了这套手感，不用在表格里重学一遍。
 *
 * 三条硬规则：
 *   ① **控件集合 = 模型能力的投影**（`composerBarParams` 从档案 derive），不出置灰死控件；
 *   ② **画幅胶囊只在这一行覆盖了整片默认时出现**（§2.4.1）——没覆盖的行底栏里根本没有这枚，
 *      于是"胶囊出现"本身就成了信息；
 *   ③ 已生成/已锁定的行，「生成」按钮位置换成一枚状态标签，不额外加行；
 *   ④ **七列的列宽跨行取最大值、断点全表共用**（`composerGridLayout` + `ComposerGridScope`）——
 *      装不下就整表一起换成两行，绝不靠压缩轨道把胶囊截断或叠起来（2026-09-06 返工的正是这条）。
 */

type Props = {
  shot: PlanShot
  archetype: ModelArchetype | null
  mode: ArchetypeMode | null
  modelOptions?: ModelOption[] | undefined
  /** 这一行**生效**的画幅；`aspectOverridden=false` 时不渲染画幅胶囊（规则②）。 */
  aspect: string
  aspectOverridden: boolean
  aspectOptions: readonly string[]
  onChangeAspect: (aspect: string | null) => void
  onUpdate: (patch: Partial<PlanShot>) => void
  /** 行内「生成 / 重试」；缺省 = 不渲染主按钮（如已生成态）。 */
  onGenerate?: (() => void) | undefined
  /** 已生成/已锁定时替代主按钮的那枚状态标签文案。 */
  statusTag?: string | null
}

export default function ShotComposerBar({
  shot,
  archetype,
  mode,
  modelOptions,
  aspect,
  aspectOverridden,
  aspectOptions,
  onChangeAspect,
  onUpdate,
  onGenerate,
  statusTag,
}: Props): JSX.Element {
  const { t } = useTranslation()
  const isImageShot = shotTypeOf(shot) === 'image'

  const onShotModelChange = React.useCallback(
    (value: string) => onUpdate({ modelKey: value || undefined, modeId: undefined, params: undefined }),
    [onUpdate],
  )
  const modelSelect = useDedupedModelSelect(modelOptions ?? [], shot.modelKey ?? '', onShotModelChange)
  const modelSelectOptions = modelOptions && modelOptions.length > 0
    ? [{ value: '', label: t('storyboardEditor.defaultModel') }, ...modelSelect.modelOptions]
    : null

  const modeOptions = composerModeOptions(archetype)
  const barParams = composerBarParams(mode)
  const qualityParams = barParams.filter((control) => control.type !== 'boolean')
  const mediaParams = barParams.filter((control) => control.type === 'boolean')
  const gridSlots = composerBarLayout()

  // 时长：视频镜=生成时长；图片镜=停留时长（进时间轴/顺播时这张图停几秒）。
  const effectiveDuration = effectiveShotDurationSec(shot)
  const durationOptions = [...new Set([...DURATION_OPTIONS_SEC, ...(isImageShot ? [3] : []), effectiveDuration])]
    .filter((sec) => Number.isFinite(sec) && sec > 0)
    .sort((a, b) => a - b)
    .map((sec) => ({ value: String(sec), label: t('storyboardEditor.second', { count: sec }) }))

  // 画幅可选项 = 项目预设 ∪ 该模型档案声明的档 ∪ 当前值（档案声明了 adaptive 这类专有档时别丢）。
  const aspectSelectOptions = [...new Set([
    ...aspectOptions,
    ...(mode?.params.find((control) => control.key === 'aspect_ratio')?.options ?? []).map((option) => String(option.value)),
    ...(aspect ? [aspect] : []),
  ])].map((value) => ({ value, label: value }))

  // 每格的自然宽度在内层 `w-max` 节点上量——外层格子被轨道定宽后，量它只会量到轨道宽，
  // 于是"内容多宽"这个输入永远回不来（那正是上一版被压成 0px 还以为量到了的原因）。
  const { barRef, slotRef, natural, available } = useComposerGridMetrics(gridSlots.length)
  const plan = useComposerGridPlan(natural, available)
  const cellStyle = (index: number): React.CSSProperties => {
    const cell = plan?.placement[index]
    if (!cell) return {}
    return { gridRow: cell.row, gridColumn: `${cell.column} / span ${cell.span}` }
  }

  return (
    <div
      ref={barRef}
      className="grid items-center border-t border-nomi-line-soft px-2 py-1.5"
      style={{
        gap: `${COMPOSER_GRID_GAP}px`,
        gridTemplateColumns: plan ? composerGridTemplate(plan) : 'repeat(7, max-content)',
      }}
      data-storyboard-composer-bar="true"
      data-storyboard-composer-wrapped={plan?.wrapped ? 'true' : 'false'}
    >
      <div data-storyboard-grid-slot={gridSlots[0]} style={cellStyle(0)}>
      <div ref={slotRef(0)} className="flex w-max items-center gap-1">
      {modelSelectOptions ? (
        <NomiSelect
          ariaLabel={isImageShot ? t('storyboardEditor.imageModel') : t('storyboardEditor.videoModel')}
          leadingLabel={t('storyboardEditor.model')}
          size="xs"
          triggerMaxWidth={150}
          value={shot.modelKey ? modelSelect.modelValue : ''}
          options={modelSelectOptions}
          onChange={(id) => (id ? modelSelect.onModelPick(id) : onShotModelChange(''))}
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
      </div>
      </div>
      <div data-storyboard-grid-slot={gridSlots[1]} style={cellStyle(1)}>
      <div ref={slotRef(1)} className="flex w-max items-center gap-1">
      {modeOptions.length > 0 ? (
        <NomiSelect
          ariaLabel={t('storyboardEditor.shotParams.mode')}
          leadingLabel={t('storyboardEditor.shotParams.mode')}
          size="xs"
          triggerMaxWidth={120}
          value={mode?.id ?? ''}
          options={modeOptions.map((option) => ({ value: option.value, label: translateModelDisplayText(option.label) }))}
          onChange={(value) => onUpdate({ modeId: value || undefined, params: undefined })}
        />
      ) : null}
      </div>
      </div>

      {/* 画幅：**只有覆盖了整片默认的行才有这枚胶囊**（§2.4.1 规则 3）。
          蓝色 + 「· 覆盖」标记，让它在一列继承行里一眼可辨；选「跟随整片默认」即收回覆盖、胶囊消失。 */}
      <div data-storyboard-grid-slot={gridSlots[2]} style={cellStyle(2)}>
      <div ref={slotRef(2)} className="flex w-max items-center gap-1">
      {aspectOverridden ? (
        <span className="inline-flex items-center gap-1" data-storyboard-aspect-override={aspect}>
          <NomiSelect
            ariaLabel={t('storyboardEditor.row.aspectAria')}
            leadingLabel={t('storyboardEditor.aspect')}
            size="xs"
            value={aspect}
            options={[{ value: '', label: t('storyboardEditor.aspectScope.followDefault') }, ...aspectSelectOptions]}
            onChange={(value) => onChangeAspect(value || null)}
          />
          <span className="text-micro text-nomi-accent">{t('storyboardEditor.aspectScope.overrideMark')}</span>
        </span>
      ) : <span className="block h-6 w-16" aria-hidden="true" />}
      </div>
      </div>

      <div data-storyboard-grid-slot={gridSlots[3]} style={cellStyle(3)}>
      <div ref={slotRef(3)} className="flex w-max items-center gap-1">
      <NomiSelect
        ariaLabel={isImageShot ? t('storyboardEditor.row.stayHint') : t('storyboardEditor.duration')}
        leadingLabel={isImageShot ? t('storyboardEditor.row.stayPill') : t('storyboardEditor.duration')}
        size="xs"
        value={String(effectiveDuration)}
        options={durationOptions}
        onChange={(value) => onUpdate({ durationSec: Number(value) })}
      />
      </div>
      </div>

      <div data-storyboard-grid-slot={gridSlots[4]} style={cellStyle(4)}>
      <div ref={slotRef(4)} className="flex w-max items-center gap-1">
      {qualityParams.map((control) => {
        const current = shot.params?.[control.key]
        if (control.type === 'boolean') {
          const active = current === undefined ? control.defaultValue === true : current === true
          return (
            <button
              key={control.key}
              type="button"
              onClick={() => onUpdate({ params: { ...(shot.params ?? {}), [control.key]: !active } })}
              className={cn(
                'h-6 shrink-0 rounded-pill px-2 text-micro',
                active ? 'bg-nomi-accent-soft text-nomi-accent' : 'border border-nomi-line text-nomi-ink-60 hover:text-nomi-ink-80',
              )}
            >
              {translateModelDisplayText(control.label)}
            </button>
          )
        }
        return (
          <NomiSelect
            key={control.key}
            ariaLabel={translateModelDisplayText(control.label)}
            leadingLabel={translateModelDisplayText(control.label)}
            size="xs"
            triggerMaxWidth={110}
            value={current === undefined ? String(control.defaultValue ?? '') : String(current)}
            options={control.options.map((option) => ({ value: String(option.value), label: translateModelDisplayText(option.label) }))}
            onChange={(value) => onUpdate({ params: { ...(shot.params ?? {}), [control.key]: value } })}
          />
        )
      })}
      </div>
      </div>

      <div data-storyboard-grid-slot={gridSlots[5]} style={cellStyle(5)}>
      <div ref={slotRef(5)} className="flex w-max items-center gap-1">
      {mediaParams.map((control) => {
        const active = shot.params?.[control.key] === undefined ? control.defaultValue === true : shot.params?.[control.key] === true
        return (
          <button key={control.key} type="button" onClick={() => onUpdate({ params: { ...(shot.params ?? {}), [control.key]: !active } })} className={cn('h-6 shrink-0 rounded-pill px-2 text-micro', active ? 'bg-nomi-accent-soft text-nomi-accent' : 'border border-nomi-line text-nomi-ink-60 hover:text-nomi-ink-80')}>
            {translateModelDisplayText(control.label)}
          </button>
        )
      })}
      </div>
      </div>
      <div className="justify-self-end" data-storyboard-grid-slot={gridSlots[6]} style={cellStyle(6)}>
      <div ref={slotRef(6)} className="flex w-max items-center gap-1">
        {statusTag ? (
          <span className="rounded-pill bg-nomi-ink-05 px-2 py-0.5 text-micro text-nomi-ink-60">{statusTag}</span>
        ) : onGenerate ? (
          <button
            type="button"
            onClick={onGenerate}
            className="h-6 rounded-nomi-sm bg-nomi-ink px-2.5 text-micro font-medium text-nomi-paper hover:opacity-90 active:opacity-80"
            aria-label={t('storyboardEditor.frame.generateAria', { index: shot.index })}
          >
            {t('storyboardEditor.frame.generate')}
          </button>
        ) : null}
      </div>
      </div>
    </div>
  )
}
