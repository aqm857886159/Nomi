import type { AssetKind } from './assetTypes'

export type FilterValue = 'all' | AssetKind

export const ASSET_KIND_FILTER_VALUES: AssetKind[] = ['image', 'video', 'audio']

export const FILTER_OPTIONS: { value: FilterValue; label: string }[] = [
  { value: 'all', label: '全部' },
  { value: 'image', label: '图片' },
  { value: 'video', label: '视频' },
  { value: 'audio', label: '音频' },
]
