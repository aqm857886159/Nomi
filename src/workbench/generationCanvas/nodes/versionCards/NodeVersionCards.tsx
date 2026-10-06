// 版本卡片（原地铺开成宫格）的两块界面：
// - NodeVersionStackHandle：节点身后那几张叠卡**就是入口**（用户 2026-10-06：「icon 能不能删掉，就靠点击后面那个卡片」）。
//   悬停叠卡轻轻扇开、露出「N 版」小标；点它铺开。铺开后原位置留一个淡轮廓，再点它（或按 Esc）收起。
// - NodeVersionGrid：铺开的宫格。每张卡就是那一版的画面本身，和节点一样大、一样的圆角 / 描边 / 阴影，
//   不加标题条；版本号是角上的小字，主图带「✓ 主图」；悬停才出动作条（设为主图 / 下载 / 删除）；点卡 = 预览。
//
// 几何只来自 versionGridLayout.ts（纯函数）；这里不量 DOM。数据（哪几版、谁是主图）由调用方从
// model/nodeResultLifecycle.ts 的 listNodeResultVersions 读，这里不拼版本列表。
import React, { type JSX } from 'react'
import { useTranslation } from 'react-i18next'
import { IconCheck, IconDownload, IconLoader2, IconTrash } from '../../../../vendor/tablerIcons'
import { cn } from '../../../../utils/cn'
import { GROUP_VISUAL_CLASS } from '../../components/groupVisualContract'
import type { VersionGridLayout } from './versionGridLayout'

export type VersionCardEntry = Readonly<{
  identity: string
  versionNo: number
  type: 'image' | 'video'
  /** 画布上挂的预览图（视频是封面）。 */
  previewUrl: string
}>

const REAR_RESTING = ['translate(11px, 4px) rotate(1.5deg)', 'translate(20px, 8px) rotate(3deg)'] as const
const REAR_FANNED = ['translate(18px, 3px) rotate(2.4deg)', 'translate(34px, 8px) rotate(4.5deg)'] as const

export function NodeVersionStackHandle({
  count,
  expanded,
  forceHover = false,
  onToggle,
}: {
  count: number
  expanded: boolean
  /** 实验室 / 走查钉住悬停态用；产品里由指针决定。 */
  forceHover?: boolean
  onToggle: () => void
}): JSX.Element | null {
  const { t } = useTranslation()
  const [hovered, setHovered] = React.useState(false)
  if (count < 2) return null
  const rear = count === 2 ? 1 : 2
  const fanned = !expanded && (hovered || forceHover)
  return (
    <div className="pointer-events-none absolute inset-0 z-0" data-version-stack={expanded ? 'expanded' : 'collapsed'}>
      {Array.from({ length: rear }, (_, index) => (
        <div
          key={index}
          aria-hidden="true"
          data-version-stack-rear={index + 1}
          className={cn(
            'absolute inset-0 origin-left rounded-nomi border transition-[transform,opacity] duration-200 ease-out motion-reduce:transition-none',
            expanded ? 'border-dashed border-nomi-ink-20 bg-transparent shadow-none' : GROUP_VISUAL_CLASS.stackRear,
          )}
          style={{ transform: fanned ? REAR_FANNED[index] : REAR_RESTING[index], opacity: expanded && index > 0 ? 0 : 1 }}
        />
      ))}
      {/* 叠卡露出来的那一条边就是可点的地方：节点右缘外侧到最外那张卡的右缘。 */}
      <button
        type="button"
        className="pointer-events-auto absolute right-[-26px] top-2 bottom-0 w-[30px] cursor-pointer rounded-r-nomi border-0 bg-transparent p-0 focus-visible:outline-2 focus-visible:outline-nomi-accent"
        aria-label={expanded ? t('generationCommon.versionCards.collapseAria') : t('generationCommon.versionCards.expandAria', { count })}
        aria-expanded={expanded}
        data-version-stack-handle
        onPointerDown={(event) => event.stopPropagation()}
        onPointerEnter={() => setHovered(true)}
        onPointerLeave={() => setHovered(false)}
        onFocus={() => setHovered(true)}
        onBlur={() => setHovered(false)}
        onClick={(event) => { event.stopPropagation(); onToggle() }}
      />
      {fanned ? (
        <span
          className="absolute -bottom-4 -right-9 whitespace-nowrap rounded-pill bg-nomi-overlay-chip px-2 py-0.5 text-micro font-semibold tabular-nums text-nomi-media-ink"
          data-version-stack-count
        >
          {t('generationCommon.versionCards.stackCount', { count })}
        </span>
      ) : null}
    </div>
  )
}

function CardShell({ children, className }: { children: React.ReactNode; className?: string }): JSX.Element {
  // 与节点预览同一套外壳（BaseGenerationNode 的 generation-canvas-v2-node__preview）：卡长得就是节点。
  return <div className={cn('relative h-full w-full overflow-hidden rounded-nomi shadow-nomi-md ring-1 ring-inset ring-nomi-line bg-nomi-ink-05', className)}>{children}</div>
}

function VersionCardBar({ versionNo, primary, onSetPrimary, onDownload, onDelete }: {
  versionNo: number
  primary: boolean
  onSetPrimary?: () => void
  onDownload?: () => void
  onDelete?: () => void
}): JSX.Element {
  const { t } = useTranslation()
  const button = 'inline-flex min-h-8 items-center justify-center gap-1.5 rounded-nomi-sm border-0 bg-transparent text-body-sm leading-none whitespace-nowrap transition-colors duration-nomi-fast ease-nomi-fast'
  return (
    <div
      role="toolbar"
      aria-label={t('generationCommon.versionCards.barAria', { n: versionNo })}
      data-version-card-bar
      className="absolute bottom-[calc(100%+6px)] left-1/2 z-[2] inline-flex -translate-x-1/2 items-center gap-1 rounded-nomi border border-nomi-line bg-nomi-paper px-1.5 py-1 shadow-nomi-md"
      onPointerDown={(event) => event.stopPropagation()}
    >
      {!primary ? (
        <button type="button" className={cn(button, 'px-3 font-medium text-nomi-accent hover:bg-nomi-accent-soft')} onClick={onSetPrimary}>
          <IconCheck size={16} stroke={1.6} aria-hidden="true" />
          <span>{t('generationCommon.versionCards.setPrimary')}</span>
        </button>
      ) : null}
      <button type="button" className={cn(button, 'w-8 text-nomi-ink-80 hover:bg-nomi-ink-05')} aria-label={t('generationCommon.versionCards.download')} title={t('generationCommon.versionCards.download')} onClick={onDownload}>
        <IconDownload size={16} stroke={1.6} aria-hidden="true" />
      </button>
      <span className="mx-0.5 h-4 w-px bg-nomi-line" aria-hidden="true" />
      <button type="button" className={cn(button, 'w-8 text-nomi-ink-80 hover:bg-nomi-danger-soft hover:text-nomi-danger')} aria-label={t('generationCommon.versionCards.delete')} title={t('generationCommon.versionCards.delete')} onClick={onDelete}>
        <IconTrash size={16} stroke={1.6} aria-hidden="true" />
      </button>
    </div>
  )
}

export type NodeVersionGridProps = {
  layout: VersionGridLayout<VersionCardEntry>
  node: Readonly<{ width: number; height: number }>
  primaryIdentity: string
  /** 悬停中的那一版（它和它的动作条浮到最上层）；实验室用它钉住悬停态。 */
  hoveredIdentity?: string
  onHoverChange?: (identity: string) => void
  onPreview?: (entry: VersionCardEntry) => void
  onSetPrimary?: (entry: VersionCardEntry) => void
  onDownload?: (entry: VersionCardEntry) => void
  onDelete?: (entry: VersionCardEntry) => void
  onShowAll?: () => void
}

export function NodeVersionGrid({ layout, node, primaryIdentity, hoveredIdentity, onHoverChange, onPreview, onSetPrimary, onDownload, onDelete, onShowAll }: NodeVersionGridProps): JSX.Element {
  const { t } = useTranslation()
  return (
    <div className="pointer-events-none absolute left-0 top-0" data-version-grid data-version-grid-columns={layout.columns}>
      {layout.cells.map((cell) => {
        const style: React.CSSProperties = { left: cell.x, top: cell.y, width: node.width, height: node.height }
        if (cell.kind === 'pending') {
          return (
            <div key="pending" className="absolute" style={style} data-version-card="pending">
              <CardShell className="grid place-items-center bg-nomi-ink-05 [background-image:repeating-linear-gradient(45deg,transparent_0_10px,var(--nomi-ink-05)_10px_20px)]">
                <span className="flex flex-col items-center gap-1 text-caption text-nomi-ink-60" role="status">
                  <IconLoader2 size={18} stroke={1.6} className="animate-spin motion-reduce:animate-none" aria-hidden="true" />
                  <b className="font-semibold text-nomi-ink-80">{t('generationCommon.versionCards.pending')}</b>
                  <span className="text-micro">{t('generationCommon.versionCards.pendingCaption')}</span>
                </span>
              </CardShell>
            </div>
          )
        }
        if (cell.kind === 'more') {
          const peek = cell.hidden.slice(0, 3)
          return (
            <div key="more" className="absolute" style={style} data-version-card="more">
              <button
                type="button"
                className="pointer-events-auto block h-full w-full cursor-pointer rounded-nomi border border-dashed border-nomi-ink-20 bg-nomi-ink-05 p-0 text-nomi-ink-80 hover:border-nomi-ink-40"
                aria-label={t('generationCommon.versionCards.moreAria', { count: cell.hidden.length })}
                onClick={onShowAll}
              >
                <span className="relative mx-auto mb-2 block h-[44%] w-[56%]">
                  {peek.map((entry, peekIndex) => (
                    <img
                      key={entry.identity}
                      src={entry.previewUrl}
                      alt=""
                      draggable={false}
                      className="absolute inset-0 h-full w-full rounded-nomi-sm object-cover shadow-nomi-sm ring-1 ring-nomi-line"
                      style={{ transform: `translate(${(peekIndex - 1) * 10}px, ${(1 - peekIndex) * 4}px) rotate(${(peekIndex - 1) * 3}deg)`, zIndex: 3 - peekIndex }}
                    />
                  ))}
                </span>
                <span className="block text-title font-semibold tabular-nums">{t('generationCommon.versionCards.moreCount', { count: cell.hidden.length })}</span>
                <span className="block text-micro text-nomi-ink-60">{t('generationCommon.versionCards.moreCaption', { count: cell.hidden.length })}</span>
              </button>
            </div>
          )
        }
        const entry = cell.version
        const primary = entry.identity === primaryIdentity
        const hovered = entry.identity === hoveredIdentity
        return (
          <div
            key={entry.identity}
            className={cn('absolute', hovered ? 'z-[3]' : 'z-[1]')}
            style={style}
            data-version-card={entry.versionNo}
            data-primary={primary ? 'true' : undefined}
            onPointerEnter={() => onHoverChange?.(entry.identity)}
            onPointerLeave={() => onHoverChange?.('')}
          >
            {hovered ? (
              <VersionCardBar
                versionNo={entry.versionNo}
                primary={primary}
                onSetPrimary={() => onSetPrimary?.(entry)}
                onDownload={() => onDownload?.(entry)}
                onDelete={() => onDelete?.(entry)}
              />
            ) : null}
            <button
              type="button"
              className="pointer-events-auto block h-full w-full cursor-pointer border-0 bg-transparent p-0"
              aria-label={t('generationCommon.versionCards.previewAria', { n: entry.versionNo })}
              onClick={() => onPreview?.(entry)}
            >
              <CardShell className={hovered ? 'ring-nomi-ink-20' : undefined}>
                <img src={entry.previewUrl} alt="" draggable={false} className="h-full w-full object-contain" />
                <span className="absolute bottom-1.5 left-1.5 rounded-pill bg-nomi-overlay-chip px-1.5 py-0.5 text-micro font-semibold tabular-nums text-nomi-media-ink" data-version-card-number>
                  {node.width < 200 ? t('generationCommon.versionCards.versionTiny', { n: entry.versionNo }) : t('generationCommon.versionCards.versionShort', { n: entry.versionNo })}
                </span>
                {primary ? (
                  <span className="absolute left-1.5 top-1.5 inline-flex items-center gap-0.5 rounded-pill bg-nomi-accent px-1.5 py-0.5 text-micro font-semibold text-nomi-paper">
                    <IconCheck size={11} stroke={2.2} aria-hidden="true" />
                    {t('generationCommon.versionCards.primary')}
                  </span>
                ) : null}
              </CardShell>
            </button>
          </div>
        )
      })}
    </div>
  )
}
