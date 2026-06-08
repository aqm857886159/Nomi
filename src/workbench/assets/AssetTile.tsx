import React from 'react'
import { IconPlayerPlayFilled, IconPlus } from '@tabler/icons-react'
import { cn } from '../../utils/cn'
import { NomiImage } from '../../design/media'
import type { AssetRef } from './assetTypes'

// 通用素材块(P0.2,样张 v4)。形态自明 > 文字解释:
//   图  → 缩略图铺满
//   视频 → 缩略图(或暗块)+ 暗蒙层 + 居中播放三角
//   音频 → 整块波形(音频无缩略图,波形本身就是它的形态语言)
// 56px 正方形;可选编号徽标(①②③ = prompt 的 character1..N)、删除、点选高亮。token + Tabler,无 emoji。

type AssetTileProps = {
  asset: AssetRef
  /** 1-based 编号徽标;不传 = 不显示。 */
  index?: number
  /** 传了才显示删除「×」。 */
  onRemove?: () => void
  /** 传了则可点(hover 高亮)。 */
  onClick?: () => void
  /** 拖拽重排用:spread 到根 div(draggable + onDragStart/onDragOver/onDrop)。 */
  dragProps?: React.HTMLAttributes<HTMLDivElement> & { draggable?: boolean }
  className?: string
}

// 音频波形:固定高度图案(我们不分析音频,波形是纯形态符号)。
const WAVE_HEIGHTS = [8, 16, 22, 12, 18, 9]

function NumberBadge({ index }: { index: number }): JSX.Element {
  return (
    <span className={cn('absolute -top-[5px] -left-[5px] min-w-[16px] h-[16px] px-[4px] rounded-pill bg-nomi-accent text-nomi-paper text-micro font-semibold flex items-center justify-center leading-none')}>
      {index}
    </span>
  )
}

function RemoveButton({ label, onRemove }: { label: string; onRemove: () => void }): JSX.Element {
  return (
    <button
      type="button"
      aria-label={`移除${label}`}
      className={cn('absolute -top-[5px] -right-[5px] w-[16px] h-[16px] rounded-pill bg-nomi-paper border border-nomi-line text-nomi-ink-60 text-micro leading-none flex items-center justify-center cursor-pointer z-[2]')}
      onClick={(event) => { event.stopPropagation(); onRemove() }}
    >×</button>
  )
}

// 形态自明的内层渲染,被 56px 参考块和 48px picker 项共用(单一真相源,避免两份渲染逻辑)。
export function AssetThumb({ asset, playSize = 22 }: { asset: AssetRef; playSize?: number }): JSX.Element {
  if (asset.kind === 'audio') {
    return (
      <span className={cn('flex items-center gap-[2px] h-[22px]')} aria-hidden>
        {WAVE_HEIGHTS.map((h, i) => (
          <i key={i} className={cn('w-[2px] rounded-[1px] bg-nomi-ink-40')} style={{ height: `${h}px` }} />
        ))}
      </span>
    )
  }
  if (asset.kind === 'video') {
    return (
      <>
        {asset.thumbUrl ? <NomiImage className={cn('w-full h-full object-cover')} src={asset.thumbUrl} alt={asset.name} /> : null}
        <span className={cn('absolute inset-0 bg-[oklch(0.2_0.01_80/0.28)]')} aria-hidden />
        <span className={cn('absolute inset-0 flex items-center justify-center z-[1]')} aria-hidden>
          <IconPlayerPlayFilled size={playSize} className={cn('text-nomi-paper drop-shadow-[0_1px_2px_oklch(0_0_0/0.5)]')} />
        </span>
      </>
    )
  }
  return <NomiImage className={cn('w-full h-full object-cover')} thumbnailSrc={asset.thumbUrl} src={asset.renderUrl} alt={asset.name} />
}

export default function AssetTile({ asset, index, onRemove, onClick, dragProps, className }: AssetTileProps): JSX.Element {
  const clickable = Boolean(onClick)
  return (
    <div
      className={cn(
        'relative w-14 h-14 rounded-nomi-sm border border-nomi-line bg-nomi-ink-05 overflow-hidden flex items-center justify-center',
        clickable && 'cursor-pointer hover:outline hover:outline-2 hover:outline-offset-1 hover:outline-nomi-accent',
        dragProps?.draggable && 'data-[dragover=true]:outline data-[dragover=true]:outline-2 data-[dragover=true]:outline-nomi-accent',
        className,
      )}
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      aria-label={clickable ? asset.name : undefined}
      onClick={onClick}
      onKeyDown={clickable ? (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onClick?.() } } : undefined}
      {...dragProps}
    >
      <AssetThumb asset={asset} />
      {typeof index === 'number' ? <NumberBadge index={index} /> : null}
      {onRemove ? <RemoveButton label={asset.name} onRemove={onRemove} /> : null}
    </div>
  )
}

// 空态/添加块:虚线「+」,点开统一选择器(样张 v4 的 .tile.add)。
export function AssetAddTile({ onClick, selected, label = '加参考', className }: { onClick: () => void; selected?: boolean; label?: string; className?: string }): JSX.Element {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className={cn(
        'w-14 h-14 rounded-nomi-sm border border-dashed border-nomi-ink-20 bg-nomi-ink-05 text-nomi-ink-40 flex items-center justify-center cursor-pointer hover:border-nomi-accent hover:text-nomi-accent',
        selected && 'outline outline-2 outline-offset-1 outline-nomi-accent',
        className,
      )}
    >
      <IconPlus size={18} stroke={2} />
    </button>
  )
}
