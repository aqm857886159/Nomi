import React from 'react'
import { useTranslation } from 'react-i18next'
import { IconArrowUpRight, IconLock, IconLockOpen, IconMaximize, IconRefresh } from '@tabler/icons-react'
import { cn } from '../../../../utils/cn'
import { NomiImage } from '../../../../design/media'
import type { PlanShot } from '../../../generationCanvas/agent/storyboardPlan'
import { effectiveShotDurationSec } from '../../../generationCanvas/agent/storyboardPlan'
import { translateModelDisplayText } from '../../../../i18n/modelDisplayText'
import type { ShotRowExec } from '../exec/storyboardRowStatus'
import { resolveResultTargetShotIndex } from '../storyboardDInteractions'

/**
 * 画面格（行内最大元素，图是主角）——行状态机的脸（样张 2026-09-01 v5）：
 * - ready：虚线空格 + **常驻「生成」按钮**（空格即生成入口，与有图的悬停浮条是两套出现逻辑，F3 有意为之）；
 * - waiting-refs：⏳ 等「某参考卡」，点参考卡名直达其卡片（亮不拦）；
 * - missing-required：红虚线 + 缺哪个必填槽（换模型/补参考才能跑）；
 * - generating：进度覆盖（有 percent 显进度条，无则活动文案）；
 * - failed：红边 + 人话错误一行 + 重试；
 * - done：结果图铺满 + 角标；双击放大（AssetPreviewDialog）+ 悬停中央 2×2 浮条
 *   ↻ 重生成 · ×3 变体 · ⛶ 放大 · 🔒 锁定（第 4 格 D 期加 ⤴ 后重排）；
 * - locked：同结果图 + 🔒 徽章，浮条只剩 🔓 解锁 · ⛶ 放大（锁了不被重跑，重跑入口一并收走）。
 * 常驻角标只有镜号/时长/锁——动作浮条是悬停瞬时覆盖，不违 §1.5 禁常驻压图。
 */

type Props = {
  shot: PlanShot
  exec: ShotRowExec
  onGenerate?: (() => void) | undefined
  /** ⏳ 态点参考卡名 → 滚动定位那张参考卡。 */
  onJumpToAnchor?: ((anchorId: string) => void) | undefined
  /** 结果态双击 / 浮条 ⛶（AssetPreviewDialog body-portal 放大）。 */
  onOpenPreview?: (() => void) | undefined
  /** 浮条 ↻：写回行编辑 + 原地重生成。 */
  onRegenerate?: (() => void) | undefined
  /** 浮条 ×3：同镜连出 3 版。 */
  onVariants?: (() => void) | undefined
  /** 浮条 🔒/🔓：镜级锁定开关（锁=不进批量不被重跑）。 */
  onToggleLock?: (() => void) | undefined
  targetShots?: readonly PlanShot[]
  onSaveAsReference?: (() => void) | undefined
  onSetAsFirstFrame?: ((targetIndex: number) => void) | undefined
  selected?: boolean
  onSelect?: ((event: React.MouseEvent) => void) | undefined
}

/** 浮条按钮（mockup .actbar button：32×26 深底白字，悬停瞬时覆盖）。 */
function BarButton({
  label,
  onClick,
  children,
}: {
  label: string
  onClick?: (() => void) | undefined
  children: React.ReactNode
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className="w-8 h-[26px] grid place-items-center rounded-nomi-sm bg-nomi-overlay-chip-strong text-nomi-paper text-micro hover:bg-nomi-ink"
    >
      {children}
    </button>
  )
}

function ResultIntakeMenu({
  shot,
  targetShots,
  onSaveAsReference,
  onSetAsFirstFrame,
}: {
  shot: PlanShot
  targetShots: readonly PlanShot[]
  allShots: readonly PlanShot[]
  sourcePosition: number
  onSaveAsReference: () => void
  onSetAsFirstFrame?: (targetPosition: number) => void
}): JSX.Element {
  const { t } = useTranslation()
  const [open, setOpen] = React.useState(false)
  const [targetPosition, setTargetPosition] = React.useState(() => resolveResultTargetShotIndex(allShots, sourcePosition) ?? -1)
  const targetPositionOf = (target: PlanShot): number => allShots.findIndex((candidate) => (
    (candidate.shotId ?? `index:${candidate.index}`) === (target.shotId ?? `index:${target.index}`)
  ))
  return (
    <div className="relative">
      <BarButton label={t('storyboardEditor.resultIntake.useAs')} onClick={() => setOpen((value) => !value)}>
        <IconArrowUpRight size={13} stroke={1.8} />
      </BarButton>
      {open ? (
        <div
          className="absolute left-1/2 top-full z-20 mt-1.5 flex min-w-40 -translate-x-1/2 flex-col gap-1 rounded-nomi-sm border border-nomi-line bg-nomi-paper p-1.5 shadow-nomi-md"
          onPointerDown={(event) => event.stopPropagation()}
        >
          <button
            type="button"
            className="rounded-nomi-sm px-2 py-1 text-left text-micro text-nomi-ink-80 hover:bg-nomi-ink-05"
            onClick={onSaveAsReference}
          >
            {t('storyboardEditor.resultIntake.reference')}
          </button>
          {targetShots.length > 0 && onSetAsFirstFrame ? (
            <>
              <span className="px-2 pt-1 text-micro text-nomi-ink-40">
                {t('storyboardEditor.resultIntake.targetShot')}
              </span>
              <select
                value={targetPosition}
                onChange={(event) => setTargetPosition(Number(event.target.value))}
                aria-label={t('storyboardEditor.resultIntake.targetShot')}
                className="h-7 rounded-nomi-sm border border-nomi-line bg-nomi-paper px-1.5 text-micro text-nomi-ink-80"
              >
                {targetShots.map((target) => (
                  <option key={target.shotId ?? target.index} value={targetPositionOf(target)}>
                    {target.index === shot.index + 1
                      ? t('storyboardEditor.resultIntake.nextShot', { index: target.index })
                      : t('storyboardEditor.resultIntake.shot', { index: target.index })}
                  </option>
                ))}
              </select>
              <button
                type="button"
                disabled={targetPosition < 0}
                className="rounded-nomi-sm px-2 py-1 text-left text-micro text-nomi-ink-80 hover:bg-nomi-ink-05 disabled:opacity-40"
                onClick={() => onSetAsFirstFrame(targetPosition)}
              >
                {t('storyboardEditor.resultIntake.firstFrame')}
              </button>
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

export default function StoryboardShotFrame({
  shot,
  exec,
  onGenerate,
  onJumpToAnchor,
  onOpenPreview,
  onRegenerate,
  onVariants,
  onToggleLock,
  targetShots = [],
  allShots = [],
  sourcePosition = -1,
  onSaveAsReference,
  onSetAsFirstFrame,
  selected,
  onSelect,
}: Props): JSX.Element {
  const { t } = useTranslation()
  const indexBadge = (
    <button
      type="button"
      onClick={onSelect}
      aria-label={t('storyboardEditor.row.selectAria', { index: shot.index })}
      className={cn(
        'absolute top-1 left-1 z-[4] px-1 rounded-nomi-sm text-micro text-nomi-paper tabular-nums',
        selected ? 'bg-nomi-accent' : 'bg-nomi-overlay-chip',
      )}
    >
      {String(shot.index).padStart(2, '0')}
    </button>
  )
  const quietIndexBadge = (
    <button
      type="button"
      onClick={onSelect}
      aria-label={t('storyboardEditor.row.selectAria', { index: shot.index })}
      className={cn(
        'absolute top-1 left-1 z-[4] px-1 rounded-nomi-sm text-micro tabular-nums',
        selected ? 'bg-nomi-accent text-nomi-paper' : 'bg-nomi-ink-10 text-nomi-ink-60',
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

  // 结果态（done / locked）：图铺满 + 角标；悬停中央动作浮条（瞬时覆盖，移开即散）。
  if (exec.resultUrl && (exec.status === 'done' || exec.status === 'locked')) {
    const locked = exec.status === 'locked'
    return (
      <div
        className="group/frame relative w-[76px] h-[132px] rounded-nomi overflow-hidden border border-nomi-line bg-nomi-ink-05"
        onDoubleClick={onOpenPreview}
        data-storyboard-frame={exec.status}
      >
        <NomiImage
          src={exec.resultUrl}
          alt={t('storyboardEditor.frame.resultAlt', { index: shot.index })}
          className="absolute inset-0 w-full h-full object-cover"
        />
        {indexBadge}
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
        <div
          className="absolute inset-0 z-[3] hidden group-hover/frame:grid place-items-center bg-nomi-scrim"
          data-storyboard-actbar="true"
        >
          {locked ? (
            <div className="grid grid-cols-2 gap-1">
              <BarButton label={t('storyboardEditor.frame.unlock')} onClick={onToggleLock}>
                <IconLockOpen size={13} stroke={1.8} />
              </BarButton>
              <BarButton label={t('storyboardEditor.frame.zoom')} onClick={onOpenPreview}>
                <IconMaximize size={13} stroke={1.8} />
              </BarButton>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-1">
              <BarButton label={t('storyboardEditor.frame.regenerate')} onClick={onRegenerate}>
                <IconRefresh size={13} stroke={1.8} />
              </BarButton>
              <BarButton label={t('storyboardEditor.frame.variants3')} onClick={onVariants}>
                ×3
              </BarButton>
              <BarButton label={t('storyboardEditor.frame.zoom')} onClick={onOpenPreview}>
                <IconMaximize size={13} stroke={1.8} />
              </BarButton>
              <BarButton label={t('storyboardEditor.frame.lock')} onClick={onToggleLock}>
                <IconLock size={13} stroke={1.8} />
              </BarButton>
              {onSaveAsReference ? (
                <ResultIntakeMenu
                  shot={shot}
                  targetShots={targetShots}
                  allShots={allShots}
                  sourcePosition={sourcePosition}
                  onSaveAsReference={onSaveAsReference}
                  onSetAsFirstFrame={onSetAsFirstFrame}
                />
              ) : null}
            </div>
          )}
        </div>
      </div>
    )
  }

  if (exec.status === 'generating') {
    return (
      <div
        className="relative w-[76px] h-[132px] rounded-nomi overflow-hidden border border-nomi-line bg-nomi-ink-05"
        data-storyboard-frame="generating"
      >
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
      <div
        className="relative w-[76px] h-[132px] rounded-nomi overflow-hidden border border-workbench-danger bg-workbench-danger-soft"
        data-storyboard-frame="failed"
      >
        {exec.resultUrl ? (
          <NomiImage src={exec.resultUrl} alt="" className="absolute inset-0 w-full h-full object-cover opacity-40" />
        ) : null}
        {quietIndexBadge}
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 p-1.5 text-center">
          <span
            className="text-micro text-workbench-danger leading-tight line-clamp-3"
            title={exec.errorMessage ?? undefined}
          >
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
          {t('storyboardEditor.row.missingRequired', {
            slot: translateModelDisplayText(exec.missingSlots[0]?.label ?? ''),
          })}
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
        <span aria-hidden className="text-body-sm text-nomi-ink-40">
          ⏳
        </span>
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
