import { shotPresentation } from '../shotPresentation'
import React, { type JSX } from 'react'
import { useTranslation } from 'react-i18next'
import { IconClockSearch, IconLock } from '../../../../vendor/tablerIcons'
import { cn } from '../../../../utils/cn'
import { NomiImage } from '../../../../design/media'
import { DeferredNodeVideo } from '../../../generationCanvas/nodes/DeferredNodeMedia'
import type { PlanShot } from '../../../generationCanvas/agent/storyboardPlan'
import { effectiveShotDurationSec } from '../../../generationCanvas/agent/storyboardPlan'
import { translateModelDisplayText } from '../../../../i18n/modelDisplayText'
import { recoverableHintKey } from '../../../generationCanvas/model/recoverableCopy'
import type { ShotRowExec } from '../exec/storyboardRowStatus'
import { storyboardFailureCopy } from '../exec/storyboardFailureCopy'
import { containedBox, densityBox, sameAspectAsBox, type FrameMediaBox } from './shotFrameGeometry'
import { useStoryboardRowNarrow } from './storyboardRowDensity'

/**
 * 画面格 = 视觉列顶上那只预览框（2026-10-06 第二轮）——行状态机的脸。
 *
 * 框是**表级**的（`frameMediaBox(planDefaultAspect(plan))`：整片画幅定，全表同一只；窄档按 176/240 等比缩），所以每一行
 * 左右边缘、上沿逐行对齐。这一镜的画幅和框不同时，画面在框里按比例完整显示（contain）、空处是浅底，
 * 左下角标这一镜的画幅——框不变形，混排照样对齐；未生成时框里画一只这一镜画幅的虚线轮廓，
 * 让用户在生成前就看得到「这镜出来是竖的」。
 *
 * 状态（与 exec/storyboardRowStatus 同一份 derive）：ready 虚线轮廓（「生成」只在内容列底栏右端一处）/
 * missing-required 红虚线 / generating 进度覆盖 / failed 红边（重试在框下动作条）/
 * recoverable 中性纸底 + 免费重新拉取 / done 结果 / locked 同 done + 🔒。
 */

type Props = {
  shot: PlanShot
  exec: ShotRowExec
  /** 这一行**生效**的画幅（storyboardShotScope.effectiveShotAspect）；只用于挂点与图片语义，
   *  几何不读它——几何来自表级的 `box`。 */
  aspect: string
  /** 整张表共用的预览框（整片默认画幅的框，宽档尺寸；窄档在这里按行的档位缩）。行不自己算，算了就又不齐了。 */
  box: FrameMediaBox
  /** 结果态双击 → 放大预览（AssetPreviewDialog，编辑器统一挂）。 */
  onOpenPreview?: (() => void) | undefined
  selected?: boolean
  onSelect?: ((event: React.MouseEvent) => void) | undefined
}

export default function StoryboardShotFrame({
  shot,
  exec,
  aspect,
  box,
  onOpenPreview,
  selected,
  onSelect,
}: Props): JSX.Element {
  const { t } = useTranslation()
  const presentation = shotPresentation(shot, shot.index)
  const narrow = useStoryboardRowNarrow()
  const frame = densityBox(box, narrow)
  const mediaStyle = { width: frame.width, height: frame.height }
  const ownAspect = !sameAspectAsBox(frame, aspect)
  // 这一镜画幅 ≠ 框：左下角标出它自己的画幅（混排时一眼看出哪镜是竖的）。
  const aspectTag = ownAspect && aspect ? (
    <span className="absolute bottom-1 left-1 z-[3] rounded-nomi-sm bg-nomi-overlay-chip px-1 text-micro tabular-nums text-nomi-media-ink" data-storyboard-aspect-tag={aspect}>
      {aspect}
    </span>
  ) : null

  // One decoder boundary for final results and retained media during a rerun.
  // A raw video URL is never an image; an explicit thumbnail can use NomiImage.
  const renderResult = (className: string, alt: string): JSX.Element | null => {
    if (!exec.resultUrl) return null
    const result = exec.node?.result
    return result?.type === 'video' && !result.thumbnailUrl ? (
      <DeferredNodeVideo
        src={exec.resultUrl}
        className={className}
        muted
        playsInline
        preload="auto"
        aria-label={alt || undefined}
      />
    ) : (
      <NomiImage src={exec.resultUrl} alt={alt} className={className} />
    )
  }

  const indexBadge = (quiet: boolean): JSX.Element => (
    <button
      type="button"
      onClick={onSelect}
      aria-label={t('storyboardEditor.row.selectAria', { index: shot.index })}
      title={[presentation.title, presentation.description].filter(Boolean).join(' · ')}
      data-storyboard-select={shot.index}
      className={cn(
        'absolute top-1 left-1 z-[4] px-1 rounded-nomi-sm text-micro tabular-nums',
        selected
          ? 'bg-nomi-accent text-nomi-paper'
          : quiet
            ? 'bg-nomi-ink-10 text-nomi-ink-60'
            : 'bg-nomi-overlay-chip text-nomi-media-ink',
      )}
    >
      {String(shot.index).padStart(2, '0')}
    </button>
  )
  const durationBadge = (
    <span className="absolute bottom-1 right-1 z-[2] px-1 rounded-nomi-sm bg-nomi-overlay-chip text-micro text-nomi-media-ink tabular-nums">
      {t('storyboardEditor.frame.durationBadge', { seconds: effectiveShotDurationSec(shot) })}
    </span>
  )

  /** 视觉列宽 = 框宽；`data-storyboard-visual-box` 是对齐量尺的锚点（各行左右边缘逐像素一致）。 */
  const column = (status: string, media: JSX.Element): JSX.Element => (
    <div style={{ width: frame.width }} data-storyboard-frame={status}>
      {media}
    </div>
  )

  if (exec.resultUrl && (exec.status === 'done' || exec.status === 'locked')) {
    const locked = exec.status === 'locked'
    return column(
      exec.status,
      <div
        className="relative rounded-nomi overflow-hidden border border-nomi-line bg-nomi-ink-05"
        style={mediaStyle}
        onDoubleClick={onOpenPreview}
        data-storyboard-frame-media={aspect || 'default'}
        data-storyboard-visual-box="true"
      >
        {/* 盒是固定的，画面在盒内 letterbox 居中（object-contain）：混排时不拉伸也不裁切。 */}
        {renderResult('absolute inset-0 w-full h-full object-contain', t('storyboardEditor.frame.resultAlt', { index: shot.index }))}
        {indexBadge(false)}
        {aspectTag}
        {durationBadge}
        {locked ? (
          <span className="absolute top-1 right-1 z-[2] px-1 py-0.5 rounded-pill bg-nomi-overlay-chip-strong text-nomi-media-ink inline-flex items-center gap-0.5">
            <IconLock size={10} stroke={2} aria-label={t('storyboardEditor.frame.lockedBadge')} />
          </span>
        ) : exec.changedRefs.length > 0 ? (
          <span
            className="absolute top-1 right-1 z-[2] px-1.5 py-0.5 rounded-pill bg-workbench-danger text-nomi-paper text-micro"
            data-storyboard-ref-changed="true"
          >
            {t('storyboardEditor.frame.refChangedBadge')}
          </span>
        ) : null}
      </div>,
    )
  }

  if (exec.status === 'generating') {
    return column(
      'generating',
      <div
        className="relative rounded-nomi overflow-hidden border border-nomi-line bg-nomi-ink-05"
        style={mediaStyle}
        data-storyboard-frame-media={aspect || 'default'}
        data-storyboard-visual-box="true"
      >
        {renderResult('absolute inset-0 w-full h-full object-contain opacity-50', '')}
        {indexBadge(false)}
        <div className="absolute inset-0 z-[1] bg-nomi-scrim" aria-hidden />
      </div>,
    )
  }

  if (exec.status === 'failed') {
    const failure = storyboardFailureCopy(exec.errorMessage)
    return column(
      'failed',
      <div
        className="relative rounded-nomi overflow-hidden border border-workbench-danger bg-workbench-danger-soft flex flex-col items-center justify-center gap-1 p-1.5 text-center"
        style={mediaStyle}
        data-storyboard-frame-media={aspect || 'default'}
        data-storyboard-visual-box="true"
      >
        {renderResult('absolute inset-0 w-full h-full object-contain opacity-40', '')}
        {indexBadge(true)}
        <span
          className="relative z-[1] text-micro text-workbench-danger leading-tight line-clamp-3"
          title={failure.hint}
          data-storyboard-failure-reason="true"
        >
          {failure.reason}
        </span>
      </div>,
    )
  }

  // 可找回：**中性**纸底 + 细描边（与画布 NodeRecoverableReport 同一副长相），不进红色错误桶。
  // 红色会让用户读成"白花了钱、得重来"，而这一镜恰恰是钱已经花了、片多半已经出了。
  if (exec.status === 'recoverable') {
    return column(
      'recoverable',
      <div
        className="relative rounded-nomi overflow-hidden border border-nomi-line bg-nomi-paper flex flex-col items-center justify-center gap-1 p-1.5 text-center"
        style={mediaStyle}
        title={t(recoverableHintKey(exec.recoverableNode))}
        data-storyboard-frame-media={aspect || 'default'}
        data-storyboard-visual-box="true"
      >
        {indexBadge(true)}
        <IconClockSearch size={14} stroke={1.6} className="text-nomi-ink-60" aria-hidden />
        <span
          className="text-micro text-nomi-ink-60 leading-tight line-clamp-2"
          title={exec.recoverableNode?.error ?? undefined}
        >
          {t('storyboardEditor.frame.recoverable')}
        </span>
      </div>,
    )
  }

  if (exec.status === 'missing-required') {
    return column(
      'missing-required',
      <div
        className="relative rounded-nomi border border-dashed border-workbench-danger bg-workbench-danger-soft flex flex-col items-center justify-center gap-1 p-2 text-center"
        style={mediaStyle}
        title={t('storyboardEditor.row.missingRequiredHint')}
        data-storyboard-frame-media={aspect || 'default'}
        data-storyboard-visual-box="true"
      >
        {indexBadge(true)}
        <span className="text-micro text-workbench-danger leading-normal">
          {t('storyboardEditor.row.missingRequired', {
            slot: translateModelDisplayText(exec.missingSlots[0]?.label ?? ''),
          })}
        </span>
      </div>,
    )
  }

  // ready：虚线占位框按画幅撑出尺寸（合同 §2.4）。「生成」不在这里——同一行只有一颗，在提示词框底栏右端。
  return column(
    'ready',
    <div
      className={cn('relative grid place-items-center rounded-nomi bg-nomi-ink-05', !ownAspect && 'border border-dashed border-nomi-ink-20')}
      style={mediaStyle}
      data-storyboard-frame-media={aspect || 'default'}
        data-storyboard-visual-box="true"
    >
      {ownAspect ? (
        <span className="rounded-nomi-sm border border-dashed border-nomi-ink-20" style={containedBox(frame, aspect)} aria-hidden />
      ) : null}
      {indexBadge(true)}
      {aspectTag}
    </div>,
  )
}
