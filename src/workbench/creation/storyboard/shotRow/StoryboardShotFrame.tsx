import React from 'react'
import { useTranslation } from 'react-i18next'
import { IconLock } from '../../../../vendor/tablerIcons'
import { cn } from '../../../../utils/cn'
import { NomiImage } from '../../../../design/media'
import type { PlanShot } from '../../../generationCanvas/agent/storyboardPlan'
import { effectiveShotDurationSec } from '../../../generationCanvas/agent/storyboardPlan'
import { translateModelDisplayText } from '../../../../i18n/modelDisplayText'
import type { ShotRowExec } from '../exec/storyboardRowStatus'
import { FRAME_COLUMN_WIDTH, type FrameMediaBox } from './shotFrameGeometry'

/**
 * 画面格（v6 §2.4）——行状态机的脸。
 *
 * v6 相对 v5 改了两件事，其余状态语义原样：
 * ① **列宽固定 136px，媒体盒由整张表 derive**（v5 写死 76×132，横版镜头没有任何真实表达）。
 *    盒子是**表级**的（`tableFrameMediaBox`，2026-09-06 用户反馈四）：全表同一画幅时盒子就是那个
 *    画幅的框、缩略图铺满；混排时全表共用一只 136×108 的盒，画面在盒内 letterbox 居中。
 *    盒不随行内容变形，所以每一行的顶线、盒、参数行、生成钮四条线都对得上——
 *    "列宽固定就够齐了"在混排下不成立，人眼读的是盒子不是列。
 * ② **动作条搬到图下方常驻**（`StoryboardFrameActions`），不再是压在图上的半透明悬停浮层。
 *    半透明按钮压缩略图是设计系统 §1.5.3 点名的反例；媒体框下方本来就是空白，不需要遮住内容省这点空间。
 *
 * 状态（与 exec/storyboardRowStatus 同一份 derive，组头/footer 计数共用）：
 * ready 虚线空格 + 常驻「生成」/ waiting-refs ⏳ 可点直达 / missing-required 红虚线 /
 * generating 进度覆盖 / failed 红边 + 重试 / done 结果铺满 / locked 同 done + 🔒。
 */

type Props = {
  shot: PlanShot
  exec: ShotRowExec
  /** 这一行**生效**的画幅（storyboardAspectScope.effectiveShotAspect）；只用于挂点与图片语义，
   *  几何不读它——几何来自表级的 `box`。 */
  aspect: string
  /** 整张表共用的媒体盒（`tableFrameMediaBox`）。行不自己算，算了就又不齐了。 */
  box: FrameMediaBox
  onGenerate?: (() => void) | undefined
  /** ⏳ 态点参考卡名 → 滚动定位那张参考卡。 */
  onJumpToAnchor?: ((anchorId: string) => void) | undefined
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
  onGenerate,
  onJumpToAnchor,
  onOpenPreview,
  selected,
  onSelect,
}: Props): JSX.Element {
  const { t } = useTranslation()
  const mediaStyle = { width: box.width, height: box.height }

  const indexBadge = (quiet: boolean): JSX.Element => (
    <button
      type="button"
      onClick={onSelect}
      aria-label={t('storyboardEditor.row.selectAria', { index: shot.index })}
      data-storyboard-select={shot.index}
      className={cn(
        'absolute top-1 left-1 z-[4] px-1 rounded-nomi-sm text-micro tabular-nums',
        selected
          ? 'bg-nomi-accent text-nomi-paper'
          : quiet
            ? 'bg-nomi-ink-10 text-nomi-ink-60'
            : 'bg-nomi-overlay-chip text-nomi-paper',
      )}
    >
      {String(shot.index).padStart(2, '0')}
    </button>
  )
  const durationBadge = (
    <span className="absolute bottom-1 right-1 z-[2] px-1 rounded-nomi-sm bg-nomi-overlay-chip text-micro text-nomi-paper tabular-nums">
      {t('storyboardEditor.frame.durationBadge', { seconds: effectiveShotDurationSec(shot) })}
    </span>
  )

  /** 固定 136 列的外框；里面那一格才是按比例缩放的媒体框（两个几何概念，走查分别断言）。 */
  const column = (status: string, media: JSX.Element): JSX.Element => (
    <div style={{ width: FRAME_COLUMN_WIDTH }} data-storyboard-frame={status}>
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
      >
        {/* 盒是固定的，画面在盒内 letterbox 居中（object-contain）：混排时不拉伸也不裁切。 */}
        <NomiImage
          src={exec.resultUrl}
          alt={t('storyboardEditor.frame.resultAlt', { index: shot.index })}
          className="absolute inset-0 w-full h-full object-contain"
        />
        {indexBadge(false)}
        {durationBadge}
        {locked ? (
          <span className="absolute top-1 right-1 z-[2] px-1 py-0.5 rounded-pill bg-nomi-overlay-chip-strong text-nomi-paper inline-flex items-center gap-0.5">
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
      >
        {exec.resultUrl ? (
          <NomiImage src={exec.resultUrl} alt="" className="absolute inset-0 w-full h-full object-contain opacity-50" />
        ) : null}
        {indexBadge(false)}
        <div className="absolute inset-0 z-[1] flex flex-col items-center justify-center gap-1.5 bg-nomi-scrim text-nomi-paper p-1.5 text-center">
          <div className="w-[52px] h-1 rounded-pill bg-nomi-paper/25 overflow-hidden">
            <div className="h-full bg-nomi-paper transition-[width]" style={{ width: `${exec.progressPercent ?? 12}%` }} />
          </div>
          <span className="text-micro leading-tight">
            {exec.progressPercent !== null
              ? t('storyboardEditor.frame.generatingPercent', { percent: Math.round(exec.progressPercent) })
              : t('storyboardEditor.frame.generating')}
          </span>
        </div>
      </div>,
    )
  }

  if (exec.status === 'failed') {
    return column(
      'failed',
      <div
        className="relative rounded-nomi overflow-hidden border border-workbench-danger bg-workbench-danger-soft flex flex-col items-center justify-center gap-1 p-1.5 text-center"
        style={mediaStyle}
        data-storyboard-frame-media={aspect || 'default'}
      >
        {exec.resultUrl ? (
          <NomiImage src={exec.resultUrl} alt="" className="absolute inset-0 w-full h-full object-contain opacity-40" />
        ) : null}
        {indexBadge(true)}
        <span
          className="relative z-[1] text-micro text-workbench-danger leading-tight line-clamp-3"
          title={exec.errorMessage ?? undefined}
        >
          {t('storyboardEditor.frame.failed')}
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

  if (exec.status === 'waiting-refs') {
    const first = exec.waitingRefs[0]
    const name = first?.anchor.name.trim() || t('storyboardEditor.unnamed')
    return column(
      'waiting-refs',
      <div
        className="relative rounded-nomi border border-dashed border-nomi-ink-20 bg-nomi-ink-05 flex flex-col items-center justify-center gap-1 p-2 text-center"
        style={mediaStyle}
        data-storyboard-frame-media={aspect || 'default'}
      >
        {indexBadge(true)}
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
      </div>,
    )
  }

  // ready：空格即生成入口（虚线占位框按整片默认画幅撑出尺寸，合同 §2.4）。
  return column(
    'ready',
    <div
      className="relative rounded-nomi border border-dashed border-nomi-ink-20 bg-nomi-ink-05 grid place-items-center"
      style={mediaStyle}
      data-storyboard-frame-media={aspect || 'default'}
    >
      {indexBadge(true)}
      {onGenerate ? (
        <button
          type="button"
          onClick={onGenerate}
          className="h-6 px-2.5 rounded-nomi-sm bg-nomi-ink text-nomi-paper text-micro font-medium hover:opacity-90 active:opacity-80"
          aria-label={t('storyboardEditor.frame.generateAria', { index: shot.index })}
        >
          {t('storyboardEditor.frame.generate')}
        </button>
      ) : null}
    </div>,
  )
}
