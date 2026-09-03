import React from 'react'
import { useTranslation } from 'react-i18next'
import { IconStack2 } from '@tabler/icons-react'
import { NomiSelect } from '../../../design'
import type { ModelOption } from '../../../config/models'
import BulkModelPicker from '../../common/BulkModelPicker'
import type { StoryboardPlan } from '../../generationCanvas/agent/storyboardPlan'
import {
  BULK_ASPECT_OPTIONS,
  DURATION_OPTIONS_SEC,
  MIXED_VALUE,
  applyAspectToAll,
  applyDurationToAll,
  applyModelToAll,
  applyShotKindToAll,
  deriveBulkAspect,
  deriveBulkDuration,
  deriveBulkModelKey,
  deriveBulkShotKind,
  type ShotTypeValue,
} from '../../generationCanvas/agent/storyboardPlanEdits'

/**
 * 「全部镜头」批量条（样张 A 拍板 2026-08-17）。
 *
 * 为什么存在：拆镜头默认全出图片镜，用户可在批量栏切换视频而不必逐镜改
 * 十几次——类型/模型选择器过去只住在单张镜卡里，唯一批量入口还埋在 L3 参数抽屉。这条是**归位**
 * 不是新增（§1.5.3 手法优先级：分组 → 去重 → 归位 → 最后才收纳）：整片作用域的控件提到 L1 常驻。
 *
 * §1.5/C3「不同作用域不混排」：底下每张镜卡有一排长得一模一样的 xs 选择器（作用域=这一镜）。
 * 所以这条**必须带「全部镜头」这个组名 + 右侧「改这里 = N 个镜头一起改」**，用户才分得清改的是谁。
 *
 * 状态全 derive 自 plan（deriveBulk*），不自持——多镜取值不一致时显「混合」临时项，选任何真值即整片应用。
 * 应用走 storyboardPlanEdits 的纯函数（与镜卡逐镜改共用 shotKindPatch，P1 无并行版）。
 */

type Props = {
  plan: StoryboardPlan
  /** 图片/视频模型清单（编辑器各拉一次传进来）；按当前生效类型选用哪份。 */
  imageModelOptions: ModelOption[]
  videoModelOptions: ModelOption[]
  onChange: (plan: StoryboardPlan) => void
}

export default function StoryboardBulkBar({ plan, imageModelOptions, videoModelOptions, onChange }: Props): JSX.Element | null {
  const { t } = useTranslation()
  const bulkKind = deriveBulkShotKind(plan)
  const bulkModelKey = deriveBulkModelKey(plan)
  const bulkDuration = deriveBulkDuration(plan)
  const bulkAspect = deriveBulkAspect(plan)

  // 生效类型：全镜一致 → 那一档；混合 → 按 image 之外处理不了，取视频清单（混合里只要有视频镜就有视频模型可选）。
  const effectiveKind: ShotTypeValue = bulkKind ?? 'video'
  const isImageKind = effectiveKind === 'image'
  const modelOptions = isImageKind ? imageModelOptions : videoModelOptions

  // 批量选模型：走 BulkModelPicker（与画布框选工具条同一份实现，P1 无并行版），选项厂商明确。
  //
  // ⚠️ 已知缺口（2026-08-18 实查，不假装修好）：PlanShot 没有 vendor 字段，applyModelToAll 也只写
  // modelKey。所以这里选的「哪一家」在落画布时**不被保留**——storyboardPlanToCreateNodesArgs 只把
  // modelKey 透传给 PlanCreatedNode，buildPlannedNodeMeta 再用 entryByKey.get(modelKey) 反查厂商，
  // 而 buildAgentModelEntries 按 modelKey 首次出现去重（首家胜出）。落地厂商 = 目录里第一家，
  // 与用户所选无关。要真正贯通须给 PlanShot/PlanCreatedNode 加 vendor 字段（见 storyboardPlan.test.ts
  // 的「厂商在 plan→canvas 落地路径上被丢弃」用例，那条测试就是这个缺口的固化记录）。
  const onBulkModelPick = React.useCallback(
    (value: string) => onChange(applyModelToAll(plan, value)),
    [plan, onChange],
  )

  if (plan.shots.length === 0) return null

  const mixedOption = { value: MIXED_VALUE, label: t('storyboardEditor.bulk.mixed') }

  const kindOptions = [
    ...(bulkKind === null ? [mixedOption] : []),
    { value: 'image', label: t('storyboardEditor.image') },
    { value: 'video', label: t('storyboardEditor.video') },
    { value: 'image-video', label: t('storyboardEditor.imageVideo') },
  ]

  // 固定项（「混合」= 当前不一致的显示态；「默认模型」= 清空该镜模型）排在摊平的厂商行之前。
  const modelLeadingOptions = [
    ...(bulkModelKey === null ? [mixedOption] : []),
    { value: '', label: t('storyboardEditor.defaultModel') },
  ]

  const durationOptions = [
    ...(bulkDuration === null ? [mixedOption] : []),
    ...[...new Set([...DURATION_OPTIONS_SEC, ...(bulkDuration !== null ? [bulkDuration] : [])])]
      .filter((sec) => Number.isFinite(sec) && sec > 0)
      .sort((a, b) => a - b)
      .map((sec) => ({ value: String(sec), label: t('storyboardEditor.second', { count: sec }) })),
  ]

  // 画幅（v5）：混合/「按模型默认」（全镜都没写 aspect）都是显示态，选中不做事；预设 ∪ 当前值
  // （Agent 可能写了预设外的档，别让触发器显错）。应用走 applyAspectToAll（空串在纯函数里就是 no-op）。
  const aspectOptions = [
    ...(bulkAspect === null ? [mixedOption] : []),
    ...(bulkAspect === '' ? [{ value: '', label: t('storyboardEditor.bulk.aspectDefault') }] : []),
    ...[...new Set([...BULK_ASPECT_OPTIONS, ...(bulkAspect ? [bulkAspect] : [])])]
      .map((aspect) => ({ value: aspect, label: aspect })),
  ]

  // 选「混合」这个临时项不做事（它只是「当前不一致」的显示态，不是可应用的值）。
  const applyIfReal = (value: string, apply: (value: string) => void): void => {
    if (value !== MIXED_VALUE) apply(value)
  }

  return (
    <div className="flex items-center gap-2 flex-wrap px-4 py-2 border-b border-nomi-line-soft bg-nomi-ink-05" data-storyboard-bulkbar="true">
      <span className="inline-flex items-center gap-1.5 shrink-0 text-caption font-medium text-nomi-ink-80">
        <IconStack2 size={14} stroke={1.6} className="text-nomi-ink-60" aria-hidden />
        {t('storyboardEditor.bulk.scope')}
      </span>
      <span className="shrink-0 w-px self-stretch bg-nomi-line" aria-hidden />

      <NomiSelect
        ariaLabel={t('storyboardEditor.bulk.typeAria')}
        leadingLabel={t('storyboardEditor.type')}
        size="xs"
        value={bulkKind ?? MIXED_VALUE}
        options={kindOptions}
        onChange={(value) => applyIfReal(value, (v) => onChange(applyShotKindToAll(plan, v as ShotTypeValue)))}
      />
      <BulkModelPicker
        modelOptions={modelOptions}
        ariaLabel={t('storyboardEditor.bulk.modelAria')}
        leadingLabel={t('storyboardEditor.model')}
        placeholder={t('generationCommon.production.unifyModel')}
        size="xs"
        triggerMaxWidth={150}
        leadingOptions={modelLeadingOptions}
        // 触发上只显得出固定项（「混合」/「默认模型」）——摊平项的 value 是厂商寻址串，
        // 而 plan 只存 modelKey，对不上；选过具体模型后回落占位「统一模型」（它本就是一次性命令）。
        value={bulkModelKey === null ? MIXED_VALUE : ''}
        onPick={(value) => onBulkModelPick(value)}
        onPickLeadingOption={(value) => applyIfReal(value, () => onBulkModelPick(''))}
      />
      {!isImageKind ? (
        <NomiSelect
          ariaLabel={t('storyboardEditor.bulk.durationAria')}
          leadingLabel={t('storyboardEditor.duration')}
          size="xs"
          value={bulkDuration === null ? MIXED_VALUE : String(bulkDuration)}
          options={durationOptions}
          onChange={(value) => applyIfReal(value, (v) => onChange(applyDurationToAll(plan, Number(v))))}
        />
      ) : null}
      <NomiSelect
        ariaLabel={t('storyboardEditor.bulk.aspectAria')}
        leadingLabel={t('storyboardEditor.aspect')}
        size="xs"
        value={bulkAspect === null ? MIXED_VALUE : bulkAspect}
        options={aspectOptions}
        onChange={(value) => applyIfReal(value, (v) => onChange(applyAspectToAll(plan, v)))}
      />

      <span className="ml-auto shrink-0 text-micro text-nomi-ink-40">
        {t('storyboardEditor.bulk.hint', { count: plan.shots.length })}
      </span>
    </div>
  )
}
