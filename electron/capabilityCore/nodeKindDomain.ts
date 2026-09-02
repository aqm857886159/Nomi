// 节点 kind 的纯几何/语义表 · **electron 主进程侧的注入源**（供 canvasNodeFactory / canvasNodeLayout）。
//
// 为什么存在这份表：单一真相源在 src（registry.defaultSize / getGenerationNodeDefaultTitle /
// getDefaultCategoryForNodeKind / shotNumbering），但 electron production 反向 import 不了 src。
// 故这里放一份**纯镜像**，并由 `nodeKindDomain.equivalence.test.ts` 钉死 === src registry 值——
// 漂移即测试红（本仓既有「重复 + 等价测试守恒」模式：thumbnailDerive.equivalence / dreaminaSeed）。
// 渲染层**不用**这份表：它注入 src 真函数，故 UI 路径永远吃单一真相源。
//
// 纯净：零 import（可在纯 Node 单测）。

import { CANVAS_NODE_KINDS } from '../shared/agentCapabilities/canvasRead'

/** per-kind 名义默认尺寸（镜像 registry.defaultSize）。 */
export const NODE_KIND_DEFAULT_SIZE: Record<string, { width: number; height: number }> = {
  text: { width: 280, height: 200 },
  character: { width: 300, height: 190 },
  scene: { width: 300, height: 190 },
  image: { width: 340, height: 280 },
  keyframe: { width: 320, height: 220 },
  video: { width: 420, height: 340 },
  audio: { width: 420, height: 80 },
  clip: { width: 760, height: 132 },
  shot: { width: 340, height: 230 },
  output: { width: 280, height: 170 },
  panorama: { width: 480, height: 270 },
  scene3d: { width: 480, height: 320 },
  whiteboard: { width: 320, height: 240 },
  model3d: { width: 320, height: 300 },
  asset: { width: 340, height: 280 },
}

/** per-kind 英文默认标题（镜像 registry.defaultTitle；locale 版在渲染层 i18n，headless 用英文回退）。 */
export const NODE_KIND_DEFAULT_TITLE: Record<string, string> = {
  text: 'Text',
  character: 'Character',
  scene: 'Scene',
  image: 'Image',
  keyframe: 'Keyframe',
  video: 'Video',
  audio: 'Audio',
  clip: '剪辑',
  shot: 'Shot',
  output: 'Output',
  panorama: 'Panorama',
  scene3d: '3D Scene',
  whiteboard: 'Whiteboard',
  model3d: '3D Model',
  asset: 'Asset',
}

/** Persisted canvas kind registry. Every reader and writer uses this list. */
export const NODE_KINDS = CANVAS_NODE_KINDS

export function isNodeKind(value: unknown): value is string {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(NODE_KIND_DEFAULT_SIZE, value)
}

// 极端兜底尺寸（理论不可达；仅防 kind 串入非法值）。与 src generationNodeKinds FOOTPRINT_FALLBACK_SIZE 同值。
const FALLBACK_SIZE = { width: 340, height: 280 }

// 「渲染足迹 = 名义 + 安全余量」的余量常量——**必须与 src NODE_RENDER_SAFETY 同值**（等价测试守恒）。
// 足迹自带余量即是间距，单插避让与批量布局共用同一足迹。
export const NODE_RENDER_SAFETY = 64

// 占镜号的 kind 集合（镜像 src shotNumbering SHOT_NUMBERED_KINDS）。
const SHOT_NUMBERED_KINDS = new Set(['image', 'video', 'shot', 'keyframe'])

/** per-kind 默认尺寸（缺省兜底）。 */
export function nodeKindDefaultSize(kind: string): { width: number; height: number } {
  return NODE_KIND_DEFAULT_SIZE[kind] ?? FALLBACK_SIZE
}

/** 渲染足迹（名义或显式 size + 安全余量）。 */
export function nodeKindFootprint(kind: string, size?: { width: number; height: number }): { width: number; height: number } {
  const base = size ?? nodeKindDefaultSize(kind)
  return { width: base.width + NODE_RENDER_SAFETY, height: base.height + NODE_RENDER_SAFETY }
}

/** per-kind 默认标题（英文回退）。 */
export function nodeKindDefaultTitle(kind: string): string {
  return NODE_KIND_DEFAULT_TITLE[kind] ?? kind
}

/**
 * kind→默认分类（镜像 src getDefaultCategoryForNodeKind）：
 * character→cast；scene/panorama/scene3d/model3d→scene；audio→audio；其余→shots。
 */
export function nodeKindDefaultCategory(kind: string): string {
  switch (kind) {
    case 'character':
      return 'cast'
    case 'scene':
    case 'panorama':
    case 'scene3d':
    case 'model3d':
      return 'scene'
    case 'audio':
      return 'audio'
    default:
      return 'shots'
  }
}

/**
 * 是否占镜号（镜像 src isShotNumberedNode）：仅「shots 分类里的 image/video/shot/keyframe」占号，
 * 且排除参考卡（meta.referenceSheet）与首帧图（meta.storyboardKeyframe）——它们不领独立镜号。
 */
export function nodeKindIsShotNumbered(node: { kind: string; categoryId?: string; meta?: Record<string, unknown> }): boolean {
  const meta = node.meta as Record<string, unknown> | undefined
  if (meta && meta.referenceSheet === true) return false
  if (meta && meta.storyboardKeyframe === true) return false
  return (node.categoryId ?? 'shots') === 'shots' && SHOT_NUMBERED_KINDS.has(node.kind)
}

/** 下一个可用镜号（max+1，1-based；镜像 src nextShotIndex）。 */
export function nodeKindNextShotIndex(existing: readonly { shotIndex?: number }[]): number {
  let max = 0
  for (const node of existing) {
    if (typeof node.shotIndex === 'number' && node.shotIndex > max) max = node.shotIndex
  }
  return max + 1
}
