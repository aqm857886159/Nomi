import React from 'react'
import { useTranslation } from 'react-i18next'
import { IconLock, IconRefresh } from '@tabler/icons-react'
import { cn } from '../../../../utils/cn'
import { NomiImage } from '../../../../design/media'
import type { PlanShot } from '../../../generationCanvas/agent/storyboardPlan'
import { effectiveShotDurationSec } from '../../../generationCanvas/agent/storyboardPlan'
import { translateModelDisplayText } from '../../../../i18n/modelDisplayText'
import type { ShotRowExec } from '../exec/storyboardRowStatus'

/**
 * 画面格（行内最大元素，图是主角）——行状态机的脸（样张 2026-09-01 v5）：
 * - ready：虚线空格 + **常驻「生成」按钮**（空格即生成入口，与有图的悬停浮条是两套出现逻辑，F3 有意为之）；
 * - waiting-refs：⏳ 等「某参考卡」，点参考卡名直达其卡片（亮不拦）；
 * - missing-required：红虚线 + 缺哪个必填槽（换模型/补参考才能跑）；
 * - generating：进度覆盖（有 percent 显进度条，无则活动文案）；
 * - failed：红边 + 人话错误一行 + 重试；
 * - done/locked：结果图铺满 + 时长角标（+🔒 已锁徽章）；双击放大与悬停浮条由父层挂（B2）。
 * 常驻角标只有镜号/时长/锁——动作浮条是悬停瞬时覆盖，不违 §1.5 禁常驻压图。
 */

type Props = {
  shot: PlanShot
  exec: ShotRowExec
  onGenerate?: (() => void) | undefined
  /** ⏳ 态点参考卡名 → 滚动定位那张参考卡。 */
  onJumpToAnchor?: ((anchorId: string) => void) | undefined
  /** 结果态双击（放大预览，B2 接 AssetPreviewDialog）。 */
  onOpenPreview?: (() => void) | undefined
  /** 结果态悬停中央动作浮条（B2：↻ 重生成 · ×3 变体 · ⛶ 放大）。 */
  hoverActions?: React.ReactNode
}

export default function StoryboardShotFrame({ shot, exec, onGenerate, onJumpToAnchor, onOpenPreview, hoverActions }: Props): JSX.Element {
  const { t } = useTranslation()
  const indexBadge = (
    <span className="absolute top-1 left-1 z-[2] px-1 rounded-nomi-sm bg-nomi-overlay-chip text-micro text-nomi-paper tabular-nums">
      {String(shot.index).padStart(2, '0')}
    </span>
  )
  const quietIndexBadge = (
    <span className="absolute top-1 left-1 z-[2] px-1 rounded-nomi-sm bg-nomi-ink-10 text-micro text-nomi-ink-60 tabular-nums">
      {String(shot.index).padStart(2, '0')}
    </span>
  )
  const durationBadge = (
    <span className="absolute bottom-1 right-1 z-[2] px-1 rounded-nomi-sm bg-nomi-overlay-chip text-micro text-nomi-paper tabular-nums">
      {t('storyboardEditor.frame.durationBadge', { seconds: effectiveShotDurationSec(shot) })}
    </span>
  )

  // 结果态（done / locked / 带旧图的 failed）：图铺满 + 角标。
  if (exec.resultUrl && (exec.status === 'done' || exec.status === 'locked')) {
    return (
      <div
        className="group/frame relative w-[76px] h-[132px] rounded-nomi overflow-hidden border border-nomi-line bg-nomi-ink-05"
        onDoubleClick={onOpenPreview}
        data-storyboard-frame={exec.status}
      >
        <NomiImage src={exec.resultUrl} alt={t('storyboardEditor.frame.resultAlt', { index: shot.index })} className="absolute inset-0 w-full h-full object-cover" />
        {indexBadge}
        {durationBadge}
        {exec.status === 'locked' ? (
          <span className="absolute top-1 right-1 z-[2] px-1 py-0.5 rounded-pill bg-nomi-overlay-chip-strong text-nomi-paper inline-flex items-center gap-0.5">
            <IconLock size={10} stroke={2} aria-label={t('storyboardEditor.frame.lockedBadge')} />
          </span>
        ) : null}
        {hoverActions}
      </div>
    )
  }

  if (exec.status === 'generating') {
    return (
      <div className="relative w-[76px] h-[132px] rounded-nomi overflow-hidden border border-nomi-line bg-nomi-ink-05" data-storyboard-frame="generating">
        {exec.resultUrl ? (
          <NomiImage src={exec.resultUrl} alt="" className="absolute inset-0 w-full h-full object-cover opacity-50" />
        ) : null}
        {indexBadge}
        <div className="absolute inset-0 z-[1] flex flex-col items-center justify-center gap-1.5 bg-nomi-scrim text-nomi-paper p-1.5 text-center">
          <div className="w-[52px] h-1 rounded-pill bg-nomi-paper/25 overflow-hidden">
            <div
              className="h-full bg-nomi-paper transition-[width]"
              style={{ width: `${exec.progressPercent ?? 12}%` }}
            />
          </div>
          <span className="text-micro leading-tight">
            {exec.progressPercent !== null
              ? t('storyboardEditor.frame.generatingPercent', { percent: Math.round(exec.progressPercent) })
              : t('storyboardEditor.frame.generating')}
          </span>
        </div>
      </div>
    )
  }

  if (exec.status === 'failed') {
    return (
      <div className="relative w-[76px] h-[132px] rounded-nomi overflow-hidden border border-workbench-danger bg-workbench-danger-soft" data-storyboard-frame="failed">
        {exec.resultUrl ? (
          <NomiImage src={exec.resultUrl} alt="" className="absolute inset-0 w-full h-full object-cover opacity-40" />
        ) : null}
        {quietIndexBadge}
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 p-1.5 text-center">
          <span className="text-micro text-workbench-danger leading-tight line-clamp-3" title={exec.errorMessage ?? undefined}>
            {t('storyboardEditor.frame.failed')}
          </span>
          {onGenerate ? (
            <button
              type="button"
              onClick={onGenerate}
              className="h-6 px-2 rounded-nomi-sm border border-workbench-danger bg-nomi-paper text-micro text-workbench-danger inline-flex items-center gap-0.5"
            >
              <IconRefresh size={11} stroke={1.8} />
              {t('storyboardEditor.frame.retry')}
            </button>
          ) : null}
        </div>
      </div>
    )
  }

  if (exec.status === 'missing-required') {
    return (
      <div
        className="relative w-[76px] h-[132px] rounded-nomi border border-dashed border-workbench-danger bg-workbench-danger-soft flex flex-col items-center justify-center gap-1 p-2 text-center"
        title={t('storyboardEditor.row.missingRequiredHint')}
        data-storyboard-frame="missing-required"
      >
        {quietIndexBadge}
        <span className="text-micro text-workbench-danger leading-normal">
          {t('storyboardEditor.row.missingRequired', { slot: translateModelDisplayText(exec.missingSlots[0]?.label ?? '') })}
        </span>
      </div>
    )
  }

  if (exec.status === 'waiting-refs') {
    const first = exec.waitingRefs[0]
    const name = first?.anchor.name.trim() || t('storyboardEditor.unnamed')
    return (
      <div
        className="relative w-[76px] h-[132px] rounded-nomi border border-dashed border-nomi-ink-20 bg-nomi-ink-05 flex flex-col items-center justify-center gap-1 p-2 text-center"
        data-storyboard-frame="waiting-refs"
      >
        {quietIndexBadge}
        <span aria-hidden className="text-body-sm text-nomi-ink-40">⏳</span>
        <span className="text-micro text-nomi-ink-40 leading-normal">
          {first && onJumpToAnchor ? (
            <button
              type="button"
              onClick={() => onJumpToAnchor(first.anchor.id)}
              className="underline underline-offset-2 text-nomi-ink-60 hover:text-nomi-accent"
              title={t('storyboardEditor.frame.jumpToAnchor', { name })}
            >
              {t('storyboardEditor.frame.waitingRef', { name })}
            </button>
          ) : (
            t('storyboardEditor.frame.waitingRef', { name })
          )}
        </span>
      </div>
    )
  }

  // ready：空格即生成入口（常驻按钮；与结果图的悬停浮条是两套出现逻辑，F3）。
  return (
    <div
      className="relative w-[76px] h-[132px] rounded-nomi border border-dashed border-nomi-ink-20 bg-nomi-ink-05 grid place-items-center"
      data-storyboard-frame="ready"
    >
      {quietIndexBadge}
      {onGenerate ? (
        <button
          type="button"
          onClick={onGenerate}
          className={cn(
            'h-6 px-2.5 rounded-nomi-sm bg-nomi-ink text-nomi-paper text-micro font-medium',
            'hover:opacity-90 active:opacity-80',
          )}
          aria-label={t('storyboardEditor.frame.generateAria', { index: shot.index })}
        >
          {t('storyboardEditor.frame.generate')}
        </button>
      ) : null}
    </div>
  )
}
