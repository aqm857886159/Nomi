// 设计实验室 · 供应商偏好屏的夹具（只有数据，没有渲染）。
//
// 这些是**喂给现役函数的输入**，不是画出来的假图：`keepRunnableVendorOptions`、
// `buildModelSelectOptions` 与 `sortModelProviders` 就是真机下拉里跑的那几个函数，
// 实验室只是给它们一份固定的目录。换句话说，屏上任何一行长成什么样、哪几行**没**出现，
// 都是生产代码决定的——夹具只决定「目录里有哪些模型、哪几家，以及哪几家接入了」。
//
// 关键：夹具喂进去的是**整份目录**（含没接入的家）。先把它们筛掉再喂，屏上「没接入的不出现」
// 就成了夹具自己造的假象，改坏生产代码照样绿——那正是这间实验室要消灭的东西。
import type { ModelOption } from '../../../config/models'

/** 内置中转两家 + 官方一家 + 一家没接入的。够覆盖偏好、分级、未接入三种来源。 */
export const VENDOR_APIMART = 'apimart'
export const VENDOR_KIE = 'kie'
export const VENDOR_VOLCENGINE = 'volcengine'
export const VENDOR_RUNNINGHUB = 'runninghub'

/** 「接入了的家」= catalog 层 `getRunnableVendorKeys()` 在真机上算出来的那个集合。 */
export const RUNNABLE_VENDORS: ReadonlySet<string> = new Set([VENDOR_APIMART, VENDOR_KIE, VENDOR_VOLCENGINE])
/** 一家都没接入（新装机、或钥匙全被拔了）。 */
export const NO_RUNNABLE_VENDORS: ReadonlySet<string> = new Set<string>()

type Row = {
  label: string
  canonicalId: string
  vendors: readonly string[]
}

function toOptions(rows: readonly Row[]): ModelOption[] {
  return rows.flatMap((row) => row.vendors.map((vendor) => ({
    value: `${vendor}-${row.canonicalId}`,
    modelKey: `${vendor}-${row.canonicalId}`,
    label: row.label,
    vendor,
    meta: { archetypeId: 'agnes-image', canonicalModelId: row.canonicalId },
  })))
}

/** 三家都接入了：偏好顺序与供应商分级各自的效果都能在这一份上看出来。 */
export const CONFIGURED_MODELS: ModelOption[] = toOptions([
  {
    label: 'Seedream 4.5',
    canonicalId: 'seedream-4-5',
    vendors: [VENDOR_VOLCENGINE, VENDOR_APIMART, VENDOR_KIE],
  },
  { label: 'Nano Banana 2', canonicalId: 'nano-banana-2', vendors: [VENDOR_APIMART, VENDOR_KIE] },
  // 单家 = 另一种表达（厂商短名附注，没有 chip）。同屏放一条，两种表达的边界一眼可辨。
  { label: 'FLUX.2 Pro', canonicalId: 'flux-2-pro', vendors: [VENDOR_KIE] },
])

/**
 * 混合目录：RunningHub 这一家没接入。
 * 屏上应当**看不到** Kling 3 / Wan 2.6（只有那一家能跑），Seedream 4.5 也不该出现 RunningHub 那个 chip。
 */
export const MIXED_MODELS: ModelOption[] = toOptions([
  { label: 'Seedream 4.5', canonicalId: 'seedream-4-5', vendors: [VENDOR_APIMART, VENDOR_KIE, VENDOR_RUNNINGHUB] },
  { label: 'Nano Banana 2', canonicalId: 'nano-banana-2', vendors: [VENDOR_APIMART] },
  { label: 'Kling 3', canonicalId: 'kling-3', vendors: [VENDOR_RUNNINGHUB] },
  { label: 'Wan 2.6', canonicalId: 'wan-2-6', vendors: [VENDOR_RUNNINGHUB] },
])

export const CONFIGURED_VENDOR_ENTRIES = [
  { vendorKey: VENDOR_APIMART, name: 'APIMart' },
  { vendorKey: VENDOR_KIE, name: 'Kie' },
  { vendorKey: VENDOR_VOLCENGINE, name: '火山方舟' },
]
