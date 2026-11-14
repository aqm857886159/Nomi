import React, { type JSX } from 'react'
import { useTranslation } from 'react-i18next'
import type { ModelOption } from '../../../../config/models'
import type { ModelParameterControl } from '../../../../config/modelCatalogMeta'
import { findModelOptionByIdentifier } from '../../../../config/modelOptionResolvers'
import { useVendorPreferenceOrder } from '../../../common/useVendorPreference'
import InlineParameterBar, { type ComposerFooterSlots } from '../../../generationCanvas/nodes/InlineParameterBar'
import { modelOptionIdentity } from '../../../common/useDedupedModelSelect'
import { resolveStoryboardImageDefault, resolveStoryboardVideoDefault } from '../../../generationCanvas/agent/availableModels'
import { buildModeMenu } from '../../../generationCanvas/nodes/controls/modeMenuModel'
import { modeMenuOptions } from '../../../generationCanvas/nodes/controls/modeMenuOptions'
import { useStoryboardRowDensity } from './storyboardRowDensity'
import { composerHeadlineParts } from '../../../generationCanvas/nodes/composerHeadlineSummary'
import { resolveArchetypeForOption } from '../../../generationCanvas/nodes/nodeModelArchetype'
import type { DynamicModelControl } from '../../../generationCanvas/nodes/controls/parameterControlModel'
import { translateModelDisplayText } from '../../../../i18n/modelDisplayText'
import {
  storyboardComposerChange,
  storyboardComposerControls,
  storyboardComposerMeta,
  composerEntryIndex,
  type ComposerChange,
  type ComposerTarget,
} from './storyboardComposerModel'

/**
 * 分镜行（镜头 / 参考卡）的整条底栏 = **画布节点底栏同一个组件**（`InlineParameterBar` 带 `footer`）：
 * 模型｜方式｜参数｜（有的话）高级设置 …… 走。2026-10-05 用户：「选择参数要复用画布那个地方的方式」；
 * 2026-11-14 用户：「画布以及画布的列表形式 以及 分镜那里……应该是一套设计 都复用」。
 *
 * 分镜自己只多一样东西，走同一块面板，不另造控件：图片镜的「停留时长」（进时间轴停几秒）不是模型参数，
 * 作为面板里的一组选项出现（`extraControls`）。和画布的差别只剩宿主给的宽度、分镜不能选变体（没有存变体的字段）。
 * 方式格和画布同一条规则（2026-11-14 验收条件 3）：视频有、图片没有。
 */

type DefaultModelRef = { modelKey?: string; modelVendor?: string }

/**
 * 一镜不存模型时，落画布会用哪个模型——和落地同一个解析（`resolveStoryboard*Default`：设置里保存的默认优先，
 * 缺席走兜底阶梯），这里只读它的结果给「默认模型」那一行画图标、写说明，不另写一套规则。
 *
 * 一张分镜表几十行同时问：同一份目录（modelOptions 引用不变）同一种类只解析一次。
 */
const pending = new WeakMap<readonly ModelOption[], Map<'image' | 'video', Promise<DefaultModelRef>>>()

function resolveOnce(kind: 'image' | 'video', modelOptions: readonly ModelOption[]): Promise<DefaultModelRef> {
  let byKind = pending.get(modelOptions)
  if (!byKind) { byKind = new Map(); pending.set(modelOptions, byKind) }
  let promise = byKind.get(kind)
  if (!promise) {
    promise = (kind === 'image' ? resolveStoryboardImageDefault() : resolveStoryboardVideoDefault()).catch(() => ({}))
    byKind.set(kind, promise)
  }
  return promise
}

function useStoryboardDefaultModel(
  kind: 'image' | 'video',
  modelOptions: readonly ModelOption[],
  orderedVendorKeys: readonly string[],
): ModelOption | null {
  const [ref, setRef] = React.useState<DefaultModelRef>({})
  React.useEffect(() => {
    let live = true
    void resolveOnce(kind, modelOptions).then((next) => { if (live) setRef(next) })
    return () => { live = false }
  }, [kind, modelOptions])
  return ref.modelKey ? findModelOptionByIdentifier(modelOptions, ref.modelKey, ref.modelVendor, orderedVendorKeys) : null
}

type Props = {
  target: ComposerTarget
  kind: 'image' | 'video'
  modelGroupLabels?: Record<'image' | 'video', string> | undefined
  modelOptions: readonly ModelOption[]
  /** 叠在画布 meta 上的分镜值（镜头的 `duration` 住 `durationSec`）。 */
  metaOverrides?: Readonly<Record<string, unknown>>
  /** 面板里多一组分镜自己的选项（图片镜的停留时长）。 */
  extraControls?: readonly DynamicModelControl[]
  onModelChange: (modelKey: string, vendor?: string) => void
  onModeChange: (modeId: string) => void
  onChange: (change: ComposerChange) => void
  onExtraChange?: (key: string, value: string) => void
  /** 底栏右半边（走钮 / 状态标签）和宿主锚点；见 InlineParameterBar 的 `footer`。 */
  footer: ComposerFooterSlots
}

export default function StoryboardComposerParams({
  target, kind, modelGroupLabels, modelOptions, metaOverrides, extraControls = [], onModelChange, onModeChange, onChange, onExtraChange, footer,
}: Props): JSX.Element {
  const { t } = useTranslation()
  const orderedVendorKeys = useVendorPreferenceOrder()
  const option = findModelOptionByIdentifier(modelOptions, target.modelKey, target.modelVendor, orderedVendorKeys)
  const meta = React.useMemo(
    () => ({ ...storyboardComposerMeta(target, composerEntryIndex(option)), ...(metaOverrides ?? {}) }),
    [target, option, metaOverrides],
  )
  const modelControls = React.useMemo(() => storyboardComposerControls(option, meta, kind), [option, meta, kind])
  const controls: DynamicModelControl[] = React.useMemo(
    () => (option ? [...modelControls, ...extraControls] : []),
    [option, modelControls, extraControls],
  )
  const extraKeys = React.useMemo(() => new Set(extraControls.map((control) => control.key)), [extraControls])

  const archetype = resolveArchetypeForOption(option)
  const storedModeId = (meta.archetype as { modeId?: string } | undefined)?.modeId ?? ''
  // 没存方式的镜头照「这一镜实际会用的方式」显示（和发送同一个解析：存的 → 档案默认 → 第一种），
  // 不显示「选择」——以前分镜只在摘要前缀存了的方式名，没存就不写；换成方式格后空值会露出 NomiSelect 的「选择」。
  const modeId = storedModeId
    || (archetype?.modes.find((mode) => mode.id === archetype.defaultModeId) ?? archetype?.modes[0])?.id
    || ''
  // 方式格：和画布节点同一条规则、同一个菜单（buildModeMenu：视频有这一格，图片没有——画布图片按放没放图现算，
  // 分镜图片镜由自动引用 / 「+」钮切图生图）。分镜还没放输入，方式是方案写明的、每一行都能选，所以不按输入置灰。
  const modeOptions = React.useMemo(() => {
    if (!archetype || archetype.modes.length < 2) return []
    const visible = archetype.modes.map((mode) => ({ id: mode.id, vendorTerm: translateModelDisplayText(mode.vendorTerm) }))
    const menu = buildModeMenu({ nodeKind: kind === 'video' ? 'video' : 'other', archetype, visible, inputs: [], resolvedModeId: modeId || archetype.modes[0]!.id })
    return menu ? modeMenuOptions(t, menu.rows.map((row) => ({ ...row, disabled: false }))) : []
  }, [archetype, kind, modeId, t])
  // 摘要按整值给（和画布节点同一个 composerHeadlineParts），窄了由底栏从后往前整值地减，不截半截。
  const headlineParts = composerHeadlineParts({
    isImageLike: kind === 'image',
    isVideoLike: kind === 'video',
    controls: modelControls,
    meta,
    formatSeconds: (value) => t('generationCommon.composerBarV1.seconds', { value }),
    autoLabel: t('generationCommon.parameters.auto'),
  })

  const route = (control: Pick<ModelParameterControl, 'key' | 'type' | 'options'>, value: string): void => {
    if (extraKeys.has(control.key)) { onExtraChange?.(control.key, value); return }
    onChange(storyboardComposerChange(control, value, modelControls))
  }

  // 最窄一档（行宽 < 520，E1a 的 320）：模型钮和摘要钮整颗换行、不截字。
  const compact = useStoryboardRowDensity() === 'compact'
  // 「默认模型」那一行：和别的行同一个排法（品牌图 + 名字 + 一句说明）。点它 = 这一镜不存模型、跟随默认
  // （落画布时按设置里的默认模型解析，见 resolveStoryboard*Default）。说明里写现在解析到的是哪个。
  const defaultModel = useStoryboardDefaultModel(kind, modelOptions, orderedVendorKeys)
  const defaultIdentity = defaultModel ? modelOptionIdentity(modelOptions, defaultModel) : null
  const leadingModelOption = {
    label: t('storyboardEditor.defaultModel'),
    description: defaultIdentity ? t('storyboardEditor.defaultModelNow', { name: defaultIdentity.label }) : t('storyboardEditor.defaultModelNone'),
    ...(defaultIdentity ? { icon: defaultIdentity.icon } : {}),
  }
  return (
      <InlineParameterBar
        modelOptions={modelOptions}
        modelGroupLabels={modelGroupLabels}
        modelCatalogStatus={{ message: kind === 'image' ? t('storyboardEditor.anchor.noImageModel') : t('storyboardEditor.strategy.noVideoModelTitle') }}
        renderedControls={controls}
        selectedModelOption={option}
        archetype={archetype}
        meta={meta}
        onModelChange={onModelChange}
        onCatalogControlChange={(control, value) => route({ key: control.key, type: undefined as never, options: [] }, value)}
        onParameterControlChange={(control, value) => route(control, value)}
        {...(headlineParts.length ? { summaryParts: headlineParts } : {})}
        wrap={compact}
        leadingModelOption={leadingModelOption}
        {...(modeOptions.length ? {
          modeMenu: {
            value: modeId,
            heading: t('generationCommon.modeMenu.heading'),
            ariaLabel: t('generationCommon.modeMenu.heading'),
            onChange: onModeChange,
            options: modeOptions,
          },
        } : {})}
        footer={{ ...footer, wrap: compact, attrs: { ...footer.attrs, 'data-storyboard-composer-params': kind } }}
      />
  )
}
