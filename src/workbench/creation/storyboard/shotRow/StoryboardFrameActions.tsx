import React from 'react'
import { useTranslation } from 'react-i18next'
import {
  IconArrowUpRight,
  IconLayersSubtract,
  IconLock,
  IconLockOpen,
  IconMaximize,
  IconRefresh,
} from '../../../../vendor/tablerIcons'
import { cn } from '../../../../utils/cn'
import type { PlanShot } from '../../../generationCanvas/agent/storyboardPlan'
import type { ShotRowExec } from '../exec/storyboardRowStatus'
import { resolveResultTargetShotIndex } from '../storyboardDInteractions'
import type { ShotVariant } from './shotVariants'

/**
 * 画面格**下方**的常驻动作条（合同 v6 §2.3/§2.4）。
 *
 * v5 把这些按钮做成半透明浮层压在缩略图上、悬停才现——设计系统 §1.5.3 点名的反例
 * （常驻遮挡内容），而且"要先把鼠标放上去才知道能做什么"。v6 把它移到图下方常驻：
 * 媒体框下面本来就是空白区，不需要靠遮住画面来省这点空间。
 *
 * 「变体 ×N」是本条里唯一的新入口（§2.9）：点重生成不再顶掉画面格，而是往抽屉里追加一版，
 * 这里的计数 +1；计数值挂在 DOM 上（`data-storyboard-variants`），走查才证得出"画面格没变、计数变了"。
 */

type Props = {
  shot: PlanShot
  exec: ShotRowExec
  variants: readonly ShotVariant[]
  /**
   * 这一次产出的 `@tag`（§2.10）。它住在**图下方**而不是图上：9:16 的画面格只有 76px 宽，
   * 贴在图上会和时长角标抢同一条底边，被截成「@…」——而这个字符串正是用户要照着在别的镜里
   * 打出来的东西，看不全等于没有。
   */
  outputTag?: string | undefined
  onRegenerate?: (() => void) | undefined
  onOpenPreview?: (() => void) | undefined
  onToggleLock?: (() => void) | undefined
  onOpenVariants?: (() => void) | undefined
  onGenerate?: (() => void) | undefined
  targetShots?: readonly PlanShot[]
  allShots?: readonly PlanShot[]
  sourcePosition?: number
  onSaveAsReference?: (() => void) | undefined
  onSetAsFirstFrame?: ((targetIndex: number) => void) | undefined
}

/** 动作条按钮：26×26 常驻小图标钮（合同 §6.3 `.acts button`）。 */
function ActButton({
  label,
  onClick,
  tone = 'quiet',
  children,
}: {
  label: string
  onClick?: (() => void) | undefined
  tone?: 'quiet' | 'danger'
  children: React.ReactNode
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className={cn(
        'size-6 grid place-items-center rounded-nomi-sm border border-transparent text-micro',
        tone === 'danger'
          ? 'text-workbench-danger hover:bg-workbench-danger-soft'
          : 'text-nomi-ink-60 hover:bg-nomi-ink-10 hover:text-nomi-ink-80',
      )}
    >
      {children}
    </button>
  )
}

function ResultIntakeMenu({
  shot,
  targetShots,
  allShots,
  sourcePosition,
  onSaveAsReference,
  onSetAsFirstFrame,
}: {
  shot: PlanShot
  targetShots: readonly PlanShot[]
  allShots: readonly PlanShot[]
  sourcePosition: number
  onSaveAsReference: () => void
  onSetAsFirstFrame?: ((targetPosition: number) => void) | undefined
}): JSX.Element {
  const { t } = useTranslation()
  const [open, setOpen] = React.useState(false)
  const [targetPosition, setTargetPosition] = React.useState(() => resolveResultTargetShotIndex(allShots, sourcePosition) ?? -1)
  const targetPositionOf = (target: PlanShot): number => allShots.findIndex((candidate) => (
    (candidate.shotId ?? `index:${candidate.index}`) === (target.shotId ?? `index:${target.index}`)
  ))
  return (
    <div className="relative">
      <ActButton label={t('storyboardEditor.resultIntake.useAs')} onClick={() => setOpen((value) => !value)}>
        <IconArrowUpRight size={14} stroke={1.8} />
      </ActButton>
      {open ? (
        <div
          className="absolute left-0 top-full z-20 mt-1 flex min-w-40 flex-col gap-1 rounded-nomi-sm border border-nomi-line bg-nomi-paper p-1.5 shadow-nomi-md"
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
              <span className="px-2 pt-1 text-micro text-nomi-ink-40">{t('storyboardEditor.resultIntake.targetShot')}</span>
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

export default function StoryboardFrameActions({
  shot,
  exec,
  variants,
  outputTag,
  onRegenerate,
  onOpenPreview,
  onToggleLock,
  onOpenVariants,
  onGenerate,
  targetShots = [],
  allShots = [],
  sourcePosition = -1,
  onSaveAsReference,
  onSetAsFirstFrame,
}: Props): JSX.Element | null {
  const { t } = useTranslation()
  const hasResult = Boolean(exec.resultUrl) && (exec.status === 'done' || exec.status === 'locked')
  const failed = exec.status === 'failed'
  if (!hasResult && !failed && variants.length === 0) return null
  const locked = exec.status === 'locked'

  return (
    <div className="mt-1 flex flex-col gap-0.5" data-storyboard-actbar="true">
    {/* 五件动作要在 136px 的列宽里排成一行（4 枚 24px 图标钮 + 一枚带计数的变体钮 ≈ 132px）。
        给了 gap 就会挤到第二行——第二行会让"这镜做完没有"的竖向节奏错开，正是 v6 要修的那种噪音。 */}
    <div className="flex items-center">
      {failed && onGenerate ? (
        <button
          type="button"
          onClick={onGenerate}
          className="h-6 px-2 rounded-nomi-sm border border-workbench-danger text-micro text-workbench-danger inline-flex items-center gap-1 hover:bg-workbench-danger-soft"
        >
          <IconRefresh size={12} stroke={1.8} />
          {t('storyboardEditor.frame.retry')}
        </button>
      ) : null}
      {hasResult && !locked ? (
        <ActButton label={t('storyboardEditor.frame.regenerate')} onClick={onRegenerate}>
          <IconRefresh size={14} stroke={1.8} />
        </ActButton>
      ) : null}
      {variants.length > 0 ? (
        <button
          type="button"
          onClick={onOpenVariants}
          title={t('storyboardEditor.variants.openHint')}
          aria-label={t('storyboardEditor.variants.open', { count: variants.length })}
          data-storyboard-variants={variants.length}
          className="inline-flex h-6 items-center gap-0.5 rounded-nomi-sm px-1 text-micro text-nomi-ink-60 hover:bg-nomi-ink-10 hover:text-nomi-ink-80"
        >
          <IconLayersSubtract size={14} stroke={1.8} />
          <span className="tabular-nums">{variants.length}</span>
        </button>
      ) : null}
      {hasResult ? (
        <ActButton label={t('storyboardEditor.frame.zoom')} onClick={onOpenPreview}>
          <IconMaximize size={14} stroke={1.8} />
        </ActButton>
      ) : null}
      {hasResult ? (
        <ActButton
          label={locked ? t('storyboardEditor.frame.unlock') : t('storyboardEditor.frame.lock')}
          onClick={onToggleLock}
        >
          {locked ? <IconLockOpen size={14} stroke={1.8} /> : <IconLock size={14} stroke={1.8} />}
        </ActButton>
      ) : null}
      {hasResult && !locked && onSaveAsReference ? (
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
    {outputTag ? (
      <span
        className="max-w-[136px] truncate text-micro text-nomi-ink-40"
        data-storyboard-output-tag={outputTag}
        title={t('storyboardEditor.row.outputTagHint', { tag: outputTag })}
      >
        @{outputTag}
      </span>
    ) : null}
    </div>
  )
}
