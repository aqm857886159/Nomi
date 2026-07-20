import type { AssetKind } from './assetTypes'

export type FilterValue = 'all' | AssetKind

export const ASSET_KIND_FILTER_VALUES: AssetKind[] = ['image', 'video', 'audio']

export const FILTER_OPTIONS: { value: FilterValue }[] = [
  { value: 'all' },
  { value: 'image' },
  { value: 'video' },
  { value: 'audio' },
]
