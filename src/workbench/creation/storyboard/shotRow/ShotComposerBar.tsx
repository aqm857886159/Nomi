import React, { type JSX } from 'react'
import { useTranslation } from 'react-i18next'
import { IconLoader2 } from '../../../../vendor/tablerIcons'
import { cn } from '../../../../utils/cn'
import type { ModelOption } from '../../../../config/models'
import type { DynamicModelControl } from '../../../generationCanvas/nodes/controls/parameterControlModel'
import type { PlanShot } from '../../../generationCanvas/agent/storyboardPlan'
import { effectiveShotDurationSec } from '../../../generationCanvas/agent/storyboardPlan'
import { DURATION_OPTIONS_SEC, planModelSelection, shotTypeOf, type PlanShotPatch } from '../../../generationCanvas/agent/storyboardPlanEdits'
import StoryboardComposerParams from './StoryboardComposerParams'

/**
 * 镜头行提示词框下方的底栏：**左边是画布节点同一套参数区，右边是「生成」**。
 *
 * 2026-10-05 用户：「选择参数要复用画布那个地方的方式」「有些按钮明显空间浪费很大」。于是这一条
 * 不再自己摆「模型 / 模式 / 时长 / 清晰度 / ⋯」一排胶囊（旧版的让位表、下限、挪进 ⋯ 那整套随之删除），
 * 只剩两颗按钮 + 生成：模型按钮、参数汇总按钮（「全能参考 · 16:9 · 5 秒」），点开是平铺面板。
 * 参数集合、控件形态、面板摆法全由 `InlineParameterBar` 决定，与画布节点逐字节同一份。
 *
 * 已生成 / 已锁定 / 可找回的行，「生成」的位置换成一枚状态标签——那几种状态下这颗钮是一条会重新扣费的路。
 */

/** 图片镜的停留时长不是模型参数：作为面板里一组选项出现，键名带前缀，不会撞上任何档案参数。 */
const STAY_SECONDS_CONTROL_KEY = '__storyboard_stay_seconds'

type Props = {
  shot: PlanShot
  modelOptions?: ModelOption[] | undefined
  /** 这一行**生效**的画幅（行覆盖 ?? 整片默认）——参数面板里比例那一组显示它。 */
  aspect: string
  /** 改这一行的画幅；与整片默认相同 = 收回覆盖（`setShotAspectOverride` 归一）。 */
  onChangeAspect: (aspect: string | null) => void
  onUpdate: (patch: PlanShotPatch) => void
  /** 行内「生成 / 重试」；缺省 = 不渲染主按钮（如已生成态）。 */
  onGenerate?: (() => void) | undefined
  /**
   * 这一镜正在跑。忙态同时是**闸**：`disabled` 让第二下点不进去（2026-09-11 用户实测连点三下 = 排队三次）。
   */
  generating?: boolean
  /** 已生成/已锁定时替代主按钮的那枚状态标签文案。 */
  statusTag?: string | null
}

export default function ShotComposerBar({
  shot, modelOptions, aspect, onChangeAspect, onUpdate, onGenerate, generating = false, statusTag,
}: Props): JSX.Element {
  const { t } = useTranslation()
  const isImageShot = shotTypeOf(shot) === 'image'
  const duration = effectiveShotDurationSec(shot)

  // 发出去时携带的参数 = 行写着的 + 生效画幅（整片默认在这里合进来，与 `resolveShotParams` 同一语义）。
  const target = React.useMemo(() => ({
    modelKey: shot.modelKey,
    modelVendor: shot.modelVendor,
    modeId: shot.modeId,
    params: { ...(shot.params ?? {}), ...(aspect ? { aspect_ratio: aspect } : {}) },
  }), [shot.modelKey, shot.modelVendor, shot.modeId, shot.params, aspect])
  // 视频时长的家是 `durationSec`（合计时长、时间轴都读它），落画布时也是它写进节点 duration。
  const metaOverrides = React.useMemo(() => (isImageShot ? undefined : { duration }), [isImageShot, duration])
  const stayControl = React.useMemo((): DynamicModelControl[] => {
    if (!isImageShot) return []
    const seconds = [...new Set([3, ...DURATION_OPTIONS_SEC, duration])].sort((a, b) => a - b)
    return [{
      binding: 'parameter',
      key: STAY_SECONDS_CONTROL_KEY,
      label: t('storyboardEditor.duration'),
      type: 'select',
      defaultValue: duration,
      options: seconds.map((sec) => ({ value: sec, label: t('storyboardEditor.second', { count: sec }) })),
    }]
  }, [isImageShot, duration, t])

  return (
    <ComposerBarRow
      barId="true"
      params={(
        <StoryboardComposerParams
          target={target}
          kind={isImageShot ? 'image' : 'video'}
          modelOptions={modelOptions ?? []}
          metaOverrides={metaOverrides}
          extraControls={stayControl}
          onModelChange={(value, vendor) => onUpdate(planModelSelection(value, vendor))}
          onModeChange={(modeId) => onUpdate({ modeId, params: undefined })}
          onChange={(change) => {
            if (change.kind === 'aspect') onChangeAspect(change.value)
            else if (change.kind === 'duration') onUpdate({ durationSec: change.value })
            else onUpdate({ params: { ...(shot.params ?? {}), [change.key]: change.value } })
          }}
          onExtraChange={(_key, value) => onUpdate({ durationSec: Number(value) })}
        />
      )}
      action={statusTag ? (
        <span className="rounded-pill bg-nomi-ink-05 px-2 py-0.5 text-micro text-nomi-ink-60">{statusTag}</span>
      ) : onGenerate ? (
        <ComposerGenerateButton
          onGenerate={onGenerate}
          generating={generating}
          ariaLabel={t('storyboardEditor.frame.generateAria', { index: shot.index })}
        />
      ) : null}
    />
  )
}

/**
 * 底栏的一行：左边参数区，右端一个动作（「生成」或状态标签）。镜头行与参考卡共用这一份——
 * 「生成钉在最右」只在这里写一次（`check:tokens` 行尾贴边的棘轮按文件数，不许每处各写一份）。
 */
export function ComposerBarRow({ barId, params, action }: { barId: string; params: React.ReactNode; action: React.ReactNode }): JSX.Element {
  return (
    <div
      className="mt-auto flex min-w-0 flex-nowrap items-center gap-2 border-t border-nomi-line-soft px-2 py-1.5"
      data-storyboard-composer-bar={barId}
    >
      {params}
      {/* 「生成」永远钉在最右，和参数区同一基线。 */}
      {action ? <div className="ml-auto shrink-0">{action}</div> : null}
    </div>
  )
}

/** 「生成」按钮。忙态同时是闸：`disabled` 让第二下点不进去（2026-09-11 用户实测连点三下 = 排队三次）。 */
export function ComposerGenerateButton({ onGenerate, generating = false, ariaLabel }: { onGenerate: () => void; generating?: boolean; ariaLabel: string }): JSX.Element {
  const { t } = useTranslation()
  return (
    <button
      type="button"
      onClick={onGenerate}
      disabled={generating}
      data-storyboard-generate-state={generating ? 'busy' : 'idle'}
      className={cn(
        'inline-flex h-7 items-center gap-1 rounded-nomi-sm bg-nomi-ink px-2.5 text-caption font-medium text-nomi-paper',
        generating ? 'cursor-default opacity-60' : 'hover:opacity-90 active:opacity-80',
      )}
      aria-label={ariaLabel}
      aria-busy={generating}
    >
      {generating ? <IconLoader2 size={12} stroke={2} className="animate-spin" aria-hidden /> : null}
      {generating ? t('storyboardEditor.frame.generating') : t('storyboardEditor.frame.generate')}
    </button>
  )
}
