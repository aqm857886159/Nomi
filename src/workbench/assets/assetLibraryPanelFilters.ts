import type { AssetKind } from './assetTypes'

export type FilterValue = 'all' | AssetKind

export const ASSET_KIND_FILTER_VALUES: AssetKind[] = ['image', 'video', 'audio', 'model3d']

// labelKey → assetLibrary.* i18n 键；在 render 时用 t(labelKey) 解析（随语言切换重渲，不在模块求值期冻结）。
export const FILTER_OPTIONS: { value: FilterValue; labelKey: string }[] = [
  { value: 'all', labelKey: 'assetLibrary.all' },
  { value: 'image', labelKey: 'assetLibrary.image' },
  { value: 'video', labelKey: 'assetLibrary.video' },
  { value: 'audio', labelKey: 'assetLibrary.audio' },
  { value: 'model3d', labelKey: 'assetLibrary.model3d' },
]
