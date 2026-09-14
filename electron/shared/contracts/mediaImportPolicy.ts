// 媒体导入准入的**单一 owner** —— 「哪个入口收哪些媒体、收多大」唯一一份声明。
//
// 为什么存在（2026-09-14 用户原话：「粘贴/拖入素材库只收图片、视频一律不支持——这地方要通用
// 支持，不能只支持一部分」）：此前每个入口自己判，同一个问题从五处各回来一次——
//   · 素材库粘贴/拖入那条路自己写了一句 `assetKindFromContentType(ct) !== "image"` → 视频音频全拒；
//   · 画布那条路自己写了 30MB / 600MB 两个常量，而素材库「上传」按钮把图/视频转手给它，
//     于是画布的上限悄悄变成了素材库的上限（用户看到「已跳过：1 个过大」，连数字都没有）；
//   · 音频、Agent 附件、全景各自还有第三、第四、第五个常量。
// 收口成一份声明后，新增入口只能来这里登记，不许在调用点自己判（`check:media-import-owner` 守）。
//
// 住在 electron/shared/ 是因为渲染层也要用它：R26 只允许渲染层 import 中立契约层
// （.dependency-cruiser.mjs 的 src-no-import-electron 对 `^electron/shared/` 放行）。
//
// 与 mediaTypes.ts 的分工：那张表回答「这个扩展名/这段字节是什么格式」（格式事实），
// 这里回答「这个面收不收它、能收多大」（产品决定）。两者都是纯模块（只做数值/字符串运算，
// 不碰 node:fs），renderer 与主进程同源 import。

import { acceptAttrForKinds, type MediaKind } from '../../assets/mediaTypes'

/** 能承载媒体的入口。新增入口必须在这里登记。 */
export type MediaImportSurfaceId =
  | 'asset-library'
  | 'generation-canvas'
  | 'agent-composer'
  | 'director-3d'
  | 'panorama'

/** 素材库能持有的全部媒体种类——其余面只能是它的子集，且必须说明为什么窄。 */
export const LIBRARY_MEDIA_KINDS: readonly MediaKind[] = ['image', 'video', 'audio', 'model3d']

export type MediaImportSurface = {
  id: MediaImportSurfaceId
  /** 这个面能落地的媒体种类。 */
  kinds: readonly MediaKind[]
  /**
   * 比 LIBRARY_MEDIA_KINDS 窄的**领域理由**。只许写「下游结构上放不下」这类约束，
   * 不许写「还没做」「暂不支持」——那种是欠账，该修不该登记。全集时为 null。
   */
  narrowedBecause: string | null
  /**
   * 磁盘之外的额外硬上限（字节）。只有确实存在下游硬约束才准填；
   * 「我觉得太大了」不是约束，磁盘剩多少才是（见 admitMediaImport）。
   */
  hardCapBytes: number | null
  hardCapBecause: string | null
}

export const MEDIA_IMPORT_SURFACES: Readonly<Record<MediaImportSurfaceId, MediaImportSurface>> = {
  'asset-library': {
    id: 'asset-library',
    kinds: LIBRARY_MEDIA_KINDS,
    narrowedBecause: null,
    hardCapBytes: null,
    hardCapBecause: null,
  },
  'generation-canvas': {
    id: 'generation-canvas',
    kinds: ['image', 'video'],
    narrowedBecause: '画布节点只有图/视频两种 archetype 落点；音频与 3D 在画布上没有节点可落（它们的家是素材库 → 时间轴 / 导演台）',
    hardCapBytes: null,
    hardCapBecause: null,
  },
  'agent-composer': {
    id: 'agent-composer',
    // 附件不是项目素材：它多了文档/文本（模型读得懂），少了 3D 模型（模型读不了 .glb 二进制）。
    kinds: ['image', 'video', 'audio', 'document', 'text'],
    narrowedBecause: '附件要进模型上下文，3D 模型二进制模型读不了；它的家是素材库与导演台',
    // 附件要整份进模型上下文，这是供应商侧的硬边界，不是我们的偏好。
    hardCapBytes: 30 * 1024 * 1024,
    hardCapBecause: '附件整份随请求进模型上下文，受供应商单请求体积上限约束',
  },
  'director-3d': {
    id: 'director-3d',
    kinds: ['image', 'model3d'],
    narrowedBecause: '导演台场景里只放得下贴图与 3D 模型；视频/音频在 3D 场景中无落点',
    hardCapBytes: null,
    hardCapBecause: null,
  },
  panorama: {
    id: 'panorama',
    kinds: ['image'],
    narrowedBecause: '全景天空盒必须是等距圆柱投影**静态图片**，视频/音频结构上放不进纹理槽',
    // 整张图要一次性上传成 WebGL 纹理，受 GPU 单纹理内存约束。
    hardCapBytes: 80 * 1024 * 1024,
    hardCapBecause: '整张图一次性上传成 WebGL 纹理，受 GPU 单纹理内存约束',
  },
}

/** 项目盘的容量事实（主进程 statfs 量到，渲染层经 IPC 取快照）。null = 还没量到。 */
export type StorageCapacity = { freeBytes: number }

/**
 * 落盘预留：写一份拷贝之外，还要给系统留喘气空间（Spotlight、交换、日志）。
 * 这是**磁盘现实**派生出来的，不是拍脑袋的导入上限。
 */
export const IMPORT_DISK_RESERVE_BYTES = 2 * 1024 * 1024 * 1024

/**
 * 视频最坏情况在盘上同时存在两份（原片 + 可播产物），所以要按两倍算得下才放行。
 * 图片/音频不产生派生产物，一倍即可。
 */
export function diskFootprintMultiplier(kind: MediaKind): number {
  return kind === 'video' ? 2 : 1
}

/** 某种媒体在当前磁盘状况下能收多大；容量未知 → null（不设限，让落盘自己报 ENOSPC）。 */
export function diskLimitBytes(capacity: StorageCapacity | null, kind: MediaKind): number | null {
  if (!capacity || !Number.isFinite(capacity.freeBytes)) return null
  const usable = capacity.freeBytes - IMPORT_DISK_RESERVE_BYTES
  if (usable <= 0) return 0
  return Math.floor(usable / diskFootprintMultiplier(kind))
}

export type MediaImportRejection =
  | { reason: 'unsupported-kind'; kind: MediaKind | null; accepted: readonly MediaKind[]; narrowedBecause: string | null }
  | { reason: 'no-disk-space'; fileBytes: number; freeBytes: number; neededBytes: number }
  | { reason: 'over-hard-cap'; fileBytes: number; capBytes: number; because: string }

/**
 * 把 `{ ok: false }` 分配到每个拒绝分支上，而不是写成 `{ ok: false } & MediaImportRejection`。
 * 后者在类型层面是「一个交叉类型」，`reason` 不在顶层，调用方 `switch (admission.reason)`
 * narrow 不动——拿不到那一支独有的字段（fileBytes / narrowedBecause …）。分配之后
 * 它是一个真正的可辨识联合，谁都能按 reason 收窄。
 */
type Rejected<R> = R extends unknown ? { ok: false } & R : never

export type MediaImportAdmission =
  | { ok: true; kind: MediaKind }
  | Rejected<MediaImportRejection>

export type MediaImportCandidate = {
  /** 已由 mediaTypes 判定的媒体种类（魔数优先、扩展名兜底）。认不出传 null。 */
  kind: MediaKind | null
  /** 文件字节数；未知传 0（未知不当拒绝理由，交给落盘时的真实错误）。 */
  sizeBytes: number
}

/**
 * 这个文件能不能从这个入口进来。**所有入口的唯一判据**——渲染层调它做预检（免得先建节点
 * 再失败），主进程落盘前调同一个函数做权威闸门。同一个函数两个调用者 = 派生，不是并行版。
 */
export function admitMediaImport(
  surfaceId: MediaImportSurfaceId,
  candidate: MediaImportCandidate,
  capacity: StorageCapacity | null,
): MediaImportAdmission {
  const surface = MEDIA_IMPORT_SURFACES[surfaceId]
  const kind = candidate.kind
  if (!kind || !surface.kinds.includes(kind)) {
    return { ok: false, reason: 'unsupported-kind', kind, accepted: surface.kinds, narrowedBecause: surface.narrowedBecause }
  }
  const sizeBytes = Number.isFinite(candidate.sizeBytes) && candidate.sizeBytes > 0 ? candidate.sizeBytes : 0
  if (surface.hardCapBytes !== null && sizeBytes > surface.hardCapBytes) {
    return { ok: false, reason: 'over-hard-cap', fileBytes: sizeBytes, capBytes: surface.hardCapBytes, because: surface.hardCapBecause || '' }
  }
  const limit = diskLimitBytes(capacity, kind)
  if (limit !== null && sizeBytes > limit) {
    return {
      ok: false,
      reason: 'no-disk-space',
      fileBytes: sizeBytes,
      freeBytes: capacity?.freeBytes ?? 0,
      neededBytes: sizeBytes * diskFootprintMultiplier(kind) + IMPORT_DISK_RESERVE_BYTES,
    }
  }
  return { ok: true, kind }
}

/** `<input accept>` 的值：从该面声明的 kinds 派生，不许在组件里手写字面量。 */
export function acceptAttrForSurface(surfaceId: MediaImportSurfaceId): string {
  return acceptAttrForKinds([...MEDIA_IMPORT_SURFACES[surfaceId].kinds])
}

/** 人话体积（拒绝文案必须带数字——「过大」不告诉用户任何可行动的信息）。 */
export function formatMediaBytes(bytes: number): string {
  const value = Number.isFinite(bytes) && bytes > 0 ? bytes : 0
  if (value >= 1024 ** 3) return `${(value / 1024 ** 3).toFixed(1)}GB`
  if (value >= 1024 ** 2) return `${(value / 1024 ** 2).toFixed(1)}MB`
  if (value >= 1024) return `${Math.round(value / 1024)}KB`
  return `${value}B`
}
