import React, { type JSX } from 'react'
import { useTranslation } from 'react-i18next'
import type { ModelOption } from '../../../config/models'
import type { ModelParameterControl } from '../../../config/modelCatalogMeta'
import InlineParameterBar from '../../generationCanvas/nodes/InlineParameterBar'
import { composerHeadlineSummary } from '../../generationCanvas/nodes/composerHeadlineSummary'
import type { DynamicModelControl } from '../../generationCanvas/nodes/controls/parameterControlModel'
import { aspectRatioControlKey, aspectRatioControlsOf } from '../../../../electron/shared/aspectRatioValue'
import { isParameterControl } from '../../generationCanvas/nodes/controls/parameterControlModel'
import type { BulkParamScope } from './storyboardBulkParamScope'

/**
 * 批量 / 多选作用域上的「模型 + 参数」：**就是画布节点底栏那个 `InlineParameterBar`**，和镜头行底栏同一个形态——
 * 一颗模型按钮 + 一颗参数汇总按钮，点开是平铺面板。区别只在数据：控件是 `deriveBulkParamScope` 求出的公共集，
 * 取值不一致的键显示「混合」（面板里一个都不选中），没进公共集的项在面板底下一句话说清是谁没有。
 *
 * 为什么不是「全部镜头」条上再加几个下拉：参数一多（清晰度、音频、尾帧……）就是把画布那套重新摆一遍——
 * 用户已经会用的是那块面板，复用它，浮条上不多占一寸。
 */

type Props = {
  scope: BulkParamScope
  kind: 'image' | 'video'
  modelOptions: readonly ModelOption[]
  /** 所选镜都用同一个模型时的那一项；不同 = null（模型按钮显示占位）。 */
  selectedModel: ModelOption | null
  onModelChange: (modelKey: string, vendor?: string) => void
  /**
   * 不在面板里出比例：「全部镜头」条上比例是**项目级**的「整片默认画幅」，条上另有一枚它自己的下拉；
   * 这里再出一份「比例」就是同一个值两个家，而且两者语义不同（一个改每镜覆盖、一个改整片默认）。
   */
  omitAspect?: boolean
  /** 面板里改了一个公共控件：键 + 控件声明的值（字符串，调用方按类型解析）。 */
  onParamChange: (control: Pick<ModelParameterControl, 'key' | 'type' | 'options'>, raw: string) => void
}

export default function StoryboardBulkParams({ scope: fullScope, kind, modelOptions, selectedModel, omitAspect = false, onModelChange, onParamChange }: Props): JSX.Element {
  const { t } = useTranslation()
  const scope = React.useMemo((): BulkParamScope => {
    if (!omitAspect) return fullScope
    const aspectKey = aspectRatioControlKey(aspectRatioControlsOf(fullScope.controls.filter(isParameterControl)))
    if (!aspectKey) return fullScope
    return {
      ...fullScope,
      controls: fullScope.controls.filter((control) => control.key !== aspectKey),
      mixedKeys: fullScope.mixedKeys.filter((key) => key !== aspectKey),
      excluded: fullScope.excluded.filter((entry) => entry.key !== aspectKey),
    }
  }, [fullScope, omitAspect])
  const meta = React.useMemo(() => {
    const next: Record<string, unknown> = { ...scope.uniformValues }
    // 「混合」= 这个键有，但所选镜取值不一样：空串让面板里一项都不亮（缺席会退回默认值，那是在说假话）。
    for (const key of scope.mixedKeys) next[key] = ''
    return next
  }, [scope])
  const controls = scope.controls as readonly DynamicModelControl[]
  const headline = composerHeadlineSummary({
    isImageLike: kind === 'image',
    isVideoLike: kind === 'video',
    controls: [...controls],
    meta,
    formatSeconds: (value) => t('generationCommon.composerBarV1.seconds', { value }),
    autoLabel: t('generationCommon.parameters.auto'),
  })
  const mixedLabels = scope.mixedKeys.map((key) => scope.controls.find((control) => control.key === key)?.label).filter(Boolean)
  const summary = controls.length === 0
    ? t('storyboardEditor.bulk.paramsNone')
    : [headline, mixedLabels.length ? `${mixedLabels.join(' ')} ${t('storyboardEditor.bulk.mixed')}` : ''].filter(Boolean).join(' · ')

  // 没进公共集的项：**一句话**说谁不在、为什么（名字摊在句子里，逐项原因挂 title）。多一行行列清单是把说明做成了正文。
  const footer = scope.excluded.length > 0 || scope.unresolved > 0 ? (
    <div className="flex flex-col gap-0.5" data-storyboard-bulk-excluded="true">
      {scope.unresolved > 0 ? <span>{t('storyboardEditor.bulk.excludedUnresolved', { count: scope.unresolved })}</span> : null}
      {scope.excluded.length > 0 ? (
        <span
          title={scope.excluded.map((entry) => (entry.reason === 'not-all-models'
            ? t('storyboardEditor.bulk.excludedMissing', { name: entry.label, models: entry.models.join(t('storyboardEditor.anchorPolicy.nameSeparator')) })
            : t('storyboardEditor.bulk.excludedNoOverlap', { name: entry.label }))).join('\n')}
        >
          {t('storyboardEditor.bulk.excludedLine', { names: scope.excluded.map((entry) => entry.label).join(t('storyboardEditor.anchorPolicy.nameSeparator')) })}
        </span>
      ) : null}
    </div>
  ) : null

  return (
    <span className="flex min-w-0 items-center" data-storyboard-bulk-params={kind}>
      <InlineParameterBar
        modelOptions={modelOptions}
        modelCatalogStatus={{ message: kind === 'image' ? t('storyboardEditor.anchor.noImageModel') : t('storyboardEditor.strategy.noVideoModelTitle') }}
        renderedControls={[...controls]}
        selectedModelOption={selectedModel}
        archetype={null}
        meta={meta}
        onModelChange={onModelChange}
        onCatalogControlChange={() => undefined}
        onParameterControlChange={(control, value) => onParamChange(control, value)}
        summaryOverride={summary}
        summaryWidth={{ hug: 210 }}
        {...(footer ? { panelFooter: footer } : {})}
      />
    </span>
  )
}
