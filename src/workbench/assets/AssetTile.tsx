import React from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { Icon3dCubeSphere, IconPlayerPlayFilled, IconPlus } from '@tabler/icons-react'
import { cn } from '../../utils/cn'
import { NomiImage } from '../../design/media'
import { AssetVideoCover } from './AssetVideoCover'
import type { AssetRef } from './assetTypes'

// hover 放大浮层（#52 群反馈「鼠标放置参考图自动弹出放大图片」）：参考块太小（56px）看不清细节，
// 悬停延迟后在块旁弹一张放大图。延迟 450ms 防「划过」误触；浮层 pointer-events-none 不拦鼠标；
// 贴边时翻到另一侧。图/视频（视频用首帧 thumbUrl）才弹，音频无缩略图跳过。
const HOVER_ZOOM_MAX = 320
const HOVER_ZOOM_DELAY_MS = 450

/** 放大浮层定位：默认贴块右侧；右边放不下就翻到左侧；上边贴顶/下边溢出都夹回视口内。纯函数便于单测。 */
export function computeHoverZoomPosition(
  rect: { left: number; right: number; top: number },
  viewport: { width: number; height: number },
  size = HOVER_ZOOM_MAX,
): { left: number; top: number } {
  const left =
    viewport.width - rect.right > size + 24 ? rect.right + 8 : Math.max(8, rect.left - size - 8)
  const top = Math.max(8, Math.min(rect.top, viewport.height - size - 16))
  return { left, top }
}

function useHoverZoom(zoomSrc: string | undefined): {
  onMouseEnter: (e: React.MouseEvent<HTMLDivElement>) => void
  onMouseLeave: () => void
  overlay: JSX.Element | null
} {
  const [rect, setRect] = React.useState<DOMRect | null>(null)
  const timerRef = React.useRef<number | undefined>(undefined)
  const clear = React.useCallback(() => {
    if (timerRef.current !== undefined) {
      window.clearTimeout(timerRef.current)
      timerRef.current = undefined
    }
  }, [])
  React.useEffect(() => clear, [clear])
  const onMouseEnter = React.useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    if (!zoomSrc) return
    const box = event.currentTarget.getBoundingClientRect()
    clear()
    timerRef.current = window.setTimeout(() => setRect(box), HOVER_ZOOM_DELAY_MS)
  }, [zoomSrc, clear])
  const onMouseLeave = React.useCallback(() => {
    clear()
    setRect(null)
  }, [clear])
  const overlay =
    rect && zoomSrc
      ? createPortal(
          <div
            className={cn('pointer-events-none rounded-nomi border border-nomi-line bg-nomi-paper overflow-hidden shadow-nomi-lg')}
            style={{
              position: 'fixed',
              zIndex: 10000,
              ...computeHoverZoomPosition(rect, { width: window.innerWidth, height: window.innerHeight }),
              maxWidth: HOVER_ZOOM_MAX,
              maxHeight: HOVER_ZOOM_MAX,
            }}
          >
            <img src={zoomSrc} alt="" className={cn('block object-contain')} style={{ maxWidth: HOVER_ZOOM_MAX, maxHeight: HOVER_ZOOM_MAX }} />
          </div>,
          document.body,
        )
      : null
  return { onMouseEnter, onMouseLeave, overlay }
}

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
  const { t } = useTranslation()
  return (
    <button
      type="button"
      aria-label={t('assetLibrary.removeNamed', { name: label })}
      className={cn('absolute -top-[5px] -right-[5px] w-[16px] h-[16px] rounded-pill bg-nomi-paper border border-nomi-line text-nomi-ink-60 text-micro leading-none flex items-center justify-center cursor-pointer z-[2]')}
      onClick={(event) => { event.stopPropagation(); onRemove() }}
    >×</button>
  )
}

// 形态自明的内层渲染,被 56px 参考块和 48px picker 项共用(单一真相源,避免两份渲染逻辑)。
export function AssetThumb({ asset, playSize = 22 }: { asset: AssetRef; playSize?: number }): JSX.Element {
  const { t } = useTranslation()
  if (asset.kind === 'audio') {
    return (
      <span className={cn('flex items-center gap-[2px] h-[22px]')} aria-hidden>
        {WAVE_HEIGHTS.map((h, i) => (
          <i key={i} className={cn('w-[2px] rounded-nomi-sm bg-nomi-ink-40')} style={{ height: `${h}px` }} />
        ))}
      </span>
    )
  }
  if (asset.kind === 'video') {
    return (
      <>
        <AssetVideoCover asset={asset} />
        <span className={cn('absolute inset-0 bg-[oklch(0.2_0.01_80/0.28)]')} aria-hidden />
        <span className={cn('absolute inset-0 flex items-center justify-center z-[1]')} aria-hidden>
          <IconPlayerPlayFilled size={playSize} className={cn('text-nomi-paper drop-shadow-[0_1px_2px_oklch(0_0_0/0.5)]')} />
        </span>
      </>
    )
  }
  if (asset.kind === 'model3d') {
    return <Icon3dCubeSphere size={playSize + 4} stroke={1.5} className="text-nomi-ink-40" aria-hidden="true" />
  }
  return (
    <NomiImage
      className={cn('w-full h-full object-cover')}
      thumbnailSrc={asset.thumbUrl}
      src={asset.renderUrl}
      alt={asset.name}
      // 参考语境的失效占位说「怎么办」：泛化的「加载失败」会被当成无害缩略图问题忽略，
      // 而这张图随后就是发不出去（预览与发送同一份 URL 口径）。
      fallbackLabel={t('assetLibrary.expiredReference')}
      fallbackTitle={t('assetLibrary.expiredReferenceDetail', { url: asset.renderUrl })}
    />
  )
}

export default function AssetTile({ asset, index, onRemove, onClick, dragProps, className }: AssetTileProps): JSX.Element {
  const clickable = Boolean(onClick)
  // 图用原图、视频用首帧缩略图放大；音频无缩略图不弹。
  const zoomSrc = asset.kind === 'audio' || asset.kind === 'model3d' ? undefined : asset.kind === 'video' ? asset.thumbUrl : asset.renderUrl
  const zoom = useHoverZoom(zoomSrc)
  return (
    <>
      <div
        className={cn(
          'relative w-14 h-14 rounded-nomi-sm border border-nomi-line bg-nomi-ink-05 overflow-hidden flex items-center justify-center',
          clickable && 'cursor-pointer hover:outline hover:outline-2 hover:outline-offset-1 hover:outline-nomi-accent',
          dragProps?.draggable && 'data-[dragover=true]:outline data-[dragover=true]:outline-2 data-[dragover=true]:outline-nomi-accent',
          className,
        )}
        // 稳定走查锚点（同 AssetAddTile 的理由）：按 kind 数 tile 才能验「视频进视频桶、没污染图片桶」。
        data-asset-tile={asset.kind}
        role={clickable ? 'button' : undefined}
        tabIndex={clickable ? 0 : undefined}
        aria-label={clickable ? asset.name : undefined}
        onClick={onClick}
        onKeyDown={clickable ? (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onClick?.() } } : undefined}
        {...dragProps}
        onMouseEnter={zoom.onMouseEnter}
        onMouseLeave={zoom.onMouseLeave}
      >
        <AssetThumb asset={asset} />
        {typeof index === 'number' ? <NumberBadge index={index} /> : null}
        {onRemove ? <RemoveButton label={asset.name} onRemove={onRemove} /> : null}
      </div>
      {zoom.overlay}
    </>
  )
}

// 空态/添加块:虚线「+」,点开统一选择器(样张 v4 的 .tile.add)。
export function AssetAddTile({ onClick, selected, label, className }: { onClick: () => void; selected?: boolean; label?: string; className?: string }): JSX.Element {
  const { t } = useTranslation()
  return (
    <button
      type="button"
      // 稳定走查锚点：两处空槽入口的 aria-label 不同（具名槽是「添加{label}」、合并数组槽是「加参考」），
      // 靠文案选元素会在改文案时静默失效（死选择器既造假红也造假绿）。
      data-asset-add-tile="true"
      aria-label={label ?? t('assetLibrary.addReference')}
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
