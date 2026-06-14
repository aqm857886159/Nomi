import {
  GENERATION_NODE_KINDS,
  GENERATION_NODE_PLUGINS,
  type GenerationNodeExecutionKind,
  type GenerationNodeKind,
  type GenerationNodePluginDefinition,
} from '../nodes/registry'
import type { GenerationCanvasNode } from './generationCanvasTypes'

export { GENERATION_NODE_KINDS }
export type { GenerationNodeExecutionKind, GenerationNodeKind }

export type GenerationNodeDefinition = Omit<GenerationNodePluginDefinition<GenerationNodeKind>, 'component' | 'icon'>

export const GENERATION_NODE_DEFINITIONS: Record<GenerationNodeKind, GenerationNodeDefinition> =
  Object.fromEntries(GENERATION_NODE_PLUGINS.map((plugin) => {
    const { component: _component, icon: _icon, ...definition } = plugin
    return [plugin.kind, definition]
  })) as Record<GenerationNodeKind, GenerationNodeDefinition>

const NODE_KIND_SET = new Set<GenerationNodeKind>(GENERATION_NODE_KINDS)

export const DEFAULT_NODE_SIZE: Record<GenerationNodeKind, { width: number; height: number }> =
  Object.fromEntries(GENERATION_NODE_KINDS.map((kind) => [kind, GENERATION_NODE_DEFINITIONS[kind].defaultSize])) as Record<GenerationNodeKind, { width: number; height: number }>

export const NODE_KIND_LABEL: Record<GenerationNodeKind, string> =
  Object.fromEntries(GENERATION_NODE_KINDS.map((kind) => [kind, GENERATION_NODE_DEFINITIONS[kind].label])) as Record<GenerationNodeKind, string>

export function isGenerationNodeKind(value: unknown): value is GenerationNodeKind {
  return typeof value === 'string' && NODE_KIND_SET.has(value as GenerationNodeKind)
}

export function getGenerationNodeDefinition(kind: GenerationNodeKind): GenerationNodeDefinition {
  return GENERATION_NODE_DEFINITIONS[kind]
}

export function getGenerationNodeDefaultSize(kind: GenerationNodeKind): { width: number; height: number } {
  return getGenerationNodeDefinition(kind).defaultSize
}

// 极端兜底：理论不可达（registry 必含每个 kind 的 defaultSize），仅防 kind 串入非法值。
const FOOTPRINT_FALLBACK_SIZE = { width: 340, height: 280 }

// 节点尺寸的**单一真相源**（跨 store / components / fixation 共用，避免第二份真相源）：
// 显式 node.size 优先，否则回退到 registry 的 per-kind defaultSize。所有几何子系统
// （虚拟化 / fitView / 连线命中 / 框选 / 自适应散落 / minimap / 边 / 分组框 / 碰撞避让）
// 都经此函数取尺寸，不再各自内联 ||300/220 或裸 320×360——那些常量与真实渲染宽不一致，
// 让同一无 size 节点在不同子系统被算成不同大小（框选命中框比真实窄 → 选不中可见卡）。
export function getNodeSize(node: Pick<GenerationCanvasNode, 'kind' | 'size'>): { width: number; height: number } {
  return node.size ?? DEFAULT_NODE_SIZE[node.kind] ?? FOOTPRINT_FALLBACK_SIZE
}

// 名义尺寸（registry.defaultSize）与真实渲染尺寸有差：footer/动态内容让实际比名义高一截
// （真机实测十几到数十 px）。凡「落点间距 / 碰撞避让」都用这个外扩后的**足迹**来算，让间距
// 吸收「渲染 > 名义」的增量 → 任何 kind、任何布局路径都不重叠。
// 单插避让（store/resolveInsertionPosition）与批量布局（agent/trajectoryLayout）共用同一常量，
// 不许各搞一套余量（那就是第二份真相源，正是「有的路径会重叠」这类 bug 的来源）。
// 基础尺寸同样走 getNodeSize（共用单一真相源，不再各自 size ?? DEFAULT[kind]）。
export const NODE_RENDER_SAFETY = 64

export function getGenerationNodeFootprintSize(
  kind: GenerationNodeKind,
  size?: { width: number; height: number },
): { width: number; height: number } {
  const base = getNodeSize({ kind, size })
  return { width: base.width + NODE_RENDER_SAFETY, height: base.height + NODE_RENDER_SAFETY }
}

export function getGenerationNodeLabel(kind: GenerationNodeKind): string {
  return getGenerationNodeDefinition(kind).label
}

export function getGenerationNodeDefaultTitle(kind: GenerationNodeKind): string {
  const definition = getGenerationNodeDefinition(kind)
  return definition.defaultTitle || definition.label
}

export function getGenerationNodePromptPlaceholder(kind: GenerationNodeKind): string {
  return getGenerationNodeDefinition(kind).promptPlaceholder || '描述节点内容...'
}

export function getAgentCreatableGenerationNodeKinds(): GenerationNodeKind[] {
  return GENERATION_NODE_KINDS.filter((kind) => GENERATION_NODE_DEFINITIONS[kind].agentCreatable === true)
}

export function getGenerationNodeCatalogKind(kind: GenerationNodeKind): GenerationNodeDefinition['catalogKind'] {
  return getGenerationNodeDefinition(kind).catalogKind
}

export function getGenerationNodeExecutionKind(kind: GenerationNodeKind): GenerationNodeExecutionKind | undefined {
  return getGenerationNodeDefinition(kind).executionKind
}

export function isImageLikeGenerationNodeKind(kind: GenerationNodeKind): boolean {
  return getGenerationNodeExecutionKind(kind) === 'image' || getGenerationNodeDefinition(kind).providesImageReference === true
}

export function isVideoLikeGenerationNodeKind(kind: GenerationNodeKind): boolean {
  return getGenerationNodeExecutionKind(kind) === 'video'
}

// kind→分类映射的实现已下沉到 generationCanvasTypes（纯模型层，迁移与创建共用，
// 不拖 nodes/registry 的 UI 依赖链）。此处保留导出面，既有调用方 import 路径不变。
export { getDefaultCategoryForNodeKind } from './generationCanvasTypes'
