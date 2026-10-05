import React, { type JSX } from 'react'
import { useTranslation } from 'react-i18next'
import type { ModelOption } from '../../../../config/models'
import type { ModelParameterControl } from '../../../../config/modelCatalogMeta'
import { findModelOptionByIdentifier } from '../../../../config/modelOptionResolvers'
import { useVendorPreferenceOrder } from '../../../common/useVendorPreference'
import InlineParameterBar from '../../../generationCanvas/nodes/InlineParameterBar'
import { composerHeadlineSummary } from '../../../generationCanvas/nodes/composerHeadlineSummary'
import { resolveArchetypeForOption } from '../../../generationCanvas/nodes/nodeModelArchetype'
import type { DynamicModelControl } from '../../../generationCanvas/nodes/controls/parameterControlModel'
import { translateModelDisplayText } from '../../../../i18n/modelDisplayText'
import {
  storyboardComposerChange,
  storyboardComposerControls,
  storyboardComposerMeta,
  type ComposerChange,
  type ComposerTarget,
} from './storyboardComposerModel'

/**
 * 分镜行（镜头 / 参考卡）的参数区 = **画布节点底栏同一个组件**（`InlineParameterBar`，summary 摆法）：
 * 一颗模型按钮 + 一颗参数汇总按钮，点开是平铺面板（清晰度分段 / 带图形的比例格 / 时长滑条 / 开关），
 * 生成方式在面板顶上一组。2026-10-05 用户：「选择参数要复用画布那个地方的方式」。
 *
 * 分镜自己只多两样东西，都走同一块面板，不另造控件：
 *   · 汇总按钮的文字多报一个「生成方式」——分镜一屏十几行，扫一眼要知道哪镜是首帧、哪镜是全能参考；
 *   · 图片镜的「停留时长」（进时间轴停几秒）不是模型参数，作为面板里的一组选项出现（`extraControls`）。
 */

type Props = {
  target: ComposerTarget
  kind: 'image' | 'video'
  modelOptions: readonly ModelOption[]
  /** 叠在画布 meta 上的分镜值（镜头的 `duration` 住 `durationSec`）。 */
  metaOverrides?: Readonly<Record<string, unknown>>
  /** 面板里多一组分镜自己的选项（图片镜的停留时长）。 */
  extraControls?: readonly DynamicModelControl[]
  onModelChange: (modelKey: string, vendor?: string) => void
  onModeChange: (modeId: string) => void
  onChange: (change: ComposerChange) => void
  onExtraChange?: (key: string, value: string) => void
}

export default function StoryboardComposerParams({
  target, kind, modelOptions, metaOverrides, extraControls = [], onModelChange, onModeChange, onChange, onExtraChange,
}: Props): JSX.Element {
  const { t } = useTranslation()
  const orderedVendorKeys = useVendorPreferenceOrder()
  const option = findModelOptionByIdentifier(modelOptions, target.modelKey, target.modelVendor, orderedVendorKeys)
  const meta = React.useMemo(
    () => ({ ...storyboardComposerMeta(target, kind), ...(metaOverrides ?? {}) }),
    [target, kind, metaOverrides],
  )
  const modelControls = React.useMemo(() => storyboardComposerControls(option, meta, kind), [option, meta, kind])
  const controls: DynamicModelControl[] = React.useMemo(
    () => (option ? [...modelControls, ...extraControls] : []),
    [option, modelControls, extraControls],
  )
  const extraKeys = React.useMemo(() => new Set(extraControls.map((control) => control.key)), [extraControls])

  const archetype = resolveArchetypeForOption(option)
  const modeChoices = archetype && archetype.modes.length > 1
    ? archetype.modes.map((mode) => ({ id: mode.id, label: translateModelDisplayText(mode.vendorTerm) }))
    : []
  const modeId = (meta.archetype as { modeId?: string } | undefined)?.modeId ?? ''
  const modeLabel = modeChoices.find((choice) => choice.id === modeId)?.label
  const headline = composerHeadlineSummary({
    isImageLike: kind === 'image',
    isVideoLike: kind === 'video',
    controls: modelControls,
    meta,
    formatSeconds: (value) => t('generationCommon.composerBarV1.seconds', { value }),
    autoLabel: t('generationCommon.parameters.auto'),
  })
  const summary = [modeLabel, headline].filter(Boolean).join(' · ') || undefined

  const route = (control: Pick<ModelParameterControl, 'key' | 'type' | 'options'>, value: string): void => {
    if (extraKeys.has(control.key)) { onExtraChange?.(control.key, value); return }
    onChange(storyboardComposerChange(control, value, modelControls))
  }

  return (
    <span className="flex min-w-0 items-center" data-storyboard-composer-params={kind}>
      <InlineParameterBar
        modelOptions={modelOptions}
        modelCatalogStatus={{ message: kind === 'image' ? t('storyboardEditor.anchor.noImageModel') : t('storyboardEditor.strategy.noVideoModelTitle') }}
        renderedControls={controls}
        selectedModelOption={option}
        archetype={archetype}
        meta={meta}
        onModelChange={onModelChange}
        onCatalogControlChange={(control, value) => route({ key: control.key, type: undefined as never, options: [] }, value)}
        onParameterControlChange={(control, value) => route(control, value)}
        summaryOverride={summary}
        summaryWidth={{ hug: 210 }}
        leadingModelOption={{ label: t('storyboardEditor.defaultModel') }}
        {...(modeChoices.length ? { modeChoices, activeModeId: modeId, onModeSelect: onModeChange } : {})}
      />
    </span>
  )
}
