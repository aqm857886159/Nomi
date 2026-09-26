import { cn } from '../../utils/cn'
import { NomiImage } from '../../design/media'
import { useLocalAssetPreview } from './useLocalAssetPreview'
import type { AssetRef } from './assetTypes'

/**
 * 视频素材封面的唯一渲染点（素材库瀑布流 / 方格 / 选择器 / @ 列表共用）。
 *
 * 封面的唯一来源是落盘边界派生的预览（electron/assets/assetPreview.ts，`thumbUrl`）。
 * 早于它导入的视频没有 `thumbUrl`：按 URL 向同一个 owner 要一份（sidecar 有就给、没有就抽首帧写回），
 * 不再从时间轴的 16 帧胶片条里截第一格——那是第二份封面来源，而且一次要解 16 帧（2026-09-25 画布跟手方案）。
 */
export function AssetVideoCover({ asset, className }: { asset: AssetRef; className?: string }): JSX.Element {
  // 已有封面就不问（传空串 = 不需要）
  const ensured = useLocalAssetPreview(asset.thumbUrl ? '' : asset.renderUrl)
  const cover = asset.thumbUrl || ensured
  if (cover) {
    return <NomiImage className={cn('h-full w-full object-cover', className)} src={cover} alt={asset.name} />
  }
  return <div className={cn('h-full w-full bg-nomi-ink-05', className)} aria-hidden="true" />
}
