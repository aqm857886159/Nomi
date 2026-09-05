// 设计实验室 · 供应商偏好屏的夹具（只有数据，没有渲染）。
//
// 这些是**喂给现役函数的输入**，不是画出来的假图：`buildModelSelectOptions` 与
// `sortModelProviders` 就是真机下拉里跑的那两个函数，实验室只是给它们一份固定的目录。
// 换句话说，屏上任何一行长成什么样，都是生产代码决定的——夹具只决定「有哪些模型、哪几家」。
import type { ModelOption } from '../../../config/models'

/** 内置中转两家 + 官方一家 + 一家没配 key 的。够覆盖偏好、分级、未配置三种排序来源。 */
export const VENDOR_APIMART = 'apimart'
export const VENDOR_KIE = 'kie'
export const VENDOR_VOLCENGINE = 'volcengine'
export const VENDOR_RUNNINGHUB = 'runninghub'

type Row = {
  label: string
  canonicalId: string
  vendors: ReadonlyArray<{ vendor: string; configured: boolean }>
}

function toOptions(rows: readonly Row[]): ModelOption[] {
  return rows.flatMap((row) => row.vendors.map(({ vendor, configured }) => ({
    value: `${vendor}-${row.canonicalId}`,
    modelKey: `${vendor}-${row.canonicalId}`,
    label: row.label,
    vendor,
    configured,
    meta: { archetypeId: 'agnes-image', canonicalModelId: row.canonicalId },
  })))
}

/** 三家都配好：偏好顺序与供应商分级各自的效果都能在这一份上看出来。 */
export const CONFIGURED_MODELS: ModelOption[] = toOptions([
  {
    label: 'Seedream 4.5',
    canonicalId: 'seedream-4-5',
    vendors: [
      { vendor: VENDOR_VOLCENGINE, configured: true },
      { vendor: VENDOR_APIMART, configured: true },
      { vendor: VENDOR_KIE, configured: true },
    ],
  },
  {
    label: 'Nano Banana 2',
    canonicalId: 'nano-banana-2',
    vendors: [
      { vendor: VENDOR_APIMART, configured: true },
      { vendor: VENDOR_KIE, configured: true },
    ],
  },
  // 单家 = 另一种表达（厂商短名附注，没有 chip）。同屏放一条，两种表达的边界一眼可辨。
  { label: 'FLUX.2 Pro', canonicalId: 'flux-2-pro', vendors: [{ vendor: VENDOR_KIE, configured: true }] },
])

/** 混合：能跑的在上，没配 key 的沉到「未配置的供应商」分组里。 */
export const MIXED_MODELS: ModelOption[] = toOptions([
  {
    label: 'Seedream 4.5',
    canonicalId: 'seedream-4-5',
    vendors: [
      { vendor: VENDOR_APIMART, configured: true },
      { vendor: VENDOR_KIE, configured: true },
      { vendor: VENDOR_RUNNINGHUB, configured: false },
    ],
  },
  { label: 'Nano Banana 2', canonicalId: 'nano-banana-2', vendors: [{ vendor: VENDOR_APIMART, configured: true }] },
  { label: 'Kling 3', canonicalId: 'kling-3', vendors: [{ vendor: VENDOR_RUNNINGHUB, configured: false }] },
  { label: 'Wan 2.6', canonicalId: 'wan-2-6', vendors: [{ vendor: VENDOR_RUNNINGHUB, configured: false }] },
])

/** 一家都没配：整张单子只剩「未配置的供应商」那一组。 */
export const ALL_UNCONFIGURED_MODELS: ModelOption[] = toOptions([
  { label: 'Seedream 4.5', canonicalId: 'seedream-4-5', vendors: [{ vendor: VENDOR_RUNNINGHUB, configured: false }] },
  { label: 'Kling 3', canonicalId: 'kling-3', vendors: [{ vendor: VENDOR_RUNNINGHUB, configured: false }] },
])

export const CONFIGURED_VENDOR_ENTRIES = [
  { vendorKey: VENDOR_APIMART, name: 'APIMart' },
  { vendorKey: VENDOR_KIE, name: 'Kie' },
  { vendorKey: VENDOR_VOLCENGINE, name: '火山方舟' },
]
