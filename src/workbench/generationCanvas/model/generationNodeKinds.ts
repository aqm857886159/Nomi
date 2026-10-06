import {
  GENERATION_NODE_KINDS,
  GENERATION_NODE_PLUGINS,
  type GenerationNodeExecutionKind,
  type GenerationNodeKind,
  type GenerationNodePluginDefinition,
} from '../nodes/registry'
import type { GenerationCanvasNode } from './generationCanvasTypes'
import i18n, { SUPPORTED_LOCALES } from '../../../i18n'

export { GENERATION_NODE_KINDS }
export type { GenerationNodeExecutionKind, GenerationNodeKind }

export type GenerationNodeDefinition = Omit<GenerationNodePluginDefinition<GenerationNodeKind>, 'component' | 'icon'>

export const GENERATION_NODE_DEFINITIONS: Record<GenerationNodeKind, GenerationNodeDefinition> = Object.fromEntries(
  GENERATION_NODE_PLUGINS.map((plugin) => {
    const { component: _component, icon: _icon, ...definition } = plugin
    return [plugin.kind, definition]
  }),
) as Record<GenerationNodeKind, GenerationNodeDefinition>

const NODE_KIND_SET = new Set<GenerationNodeKind>(GENERATION_NODE_KINDS)

export const DEFAULT_NODE_SIZE: Record<GenerationNodeKind, { width: number; height: number }> = Object.fromEntries(
  GENERATION_NODE_KINDS.map((kind) => [kind, GENERATION_NODE_DEFINITIONS[kind].defaultSize]),
) as Record<GenerationNodeKind, { width: number; height: number }>

export const NODE_KIND_LABEL: Record<GenerationNodeKind, string> = Object.fromEntries(
  GENERATION_NODE_KINDS.map((kind) => [kind, GENERATION_NODE_DEFINITIONS[kind].label]),
) as Record<GenerationNodeKind, string>

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

// 节点的**基础模型尺寸**：显式 node.size 优先，否则回退到 registry defaultSize。
// 它只服务尚无完整节点状态的布局估算（例如新节点碰撞足迹），不是屏幕渲染尺寸。
// 已有节点的 fit / focus / 框选 / minimap / 派生落点必须走 resolveNodeVisualSize；该函数还会纳入
// renderKind、媒体 previewHeight、画幅和 clip 特例。刻意不用含混的 getNodeSize 名称，防止两种语义再混用。
export function getNodeBaseSize(node: Pick<GenerationCanvasNode, 'kind' | 'size'>): { width: number; height: number } {
  return node.size ?? DEFAULT_NODE_SIZE[node.kind] ?? FOOTPRINT_FALLBACK_SIZE
}

// 名义尺寸（registry.defaultSize）与真实渲染尺寸有差：footer/动态内容让实际比名义高一截
// （真机实测十几到数十 px）。凡「落点间距 / 碰撞避让」都用这个外扩后的**足迹**来算，让间距
// 吸收「渲染 > 名义」的增量 → 任何 kind、任何布局路径都不重叠。
// 单插避让（store/resolveInsertionPosition）与批量布局（agent/trajectoryLayout）共用同一常量，
// 不许各搞一套余量（那就是第二份真相源，正是「有的路径会重叠」这类 bug 的来源）。
// 基础尺寸同样走 getNodeBaseSize（不再各自 size ?? DEFAULT[kind]）。
export const NODE_RENDER_SAFETY = 64

export function getGenerationNodeFootprintSize(
  kind: GenerationNodeKind,
  size?: { width: number; height: number },
): { width: number; height: number } {
  const base = getNodeBaseSize({ kind, size })
  return { width: base.width + NODE_RENDER_SAFETY, height: base.height + NODE_RENDER_SAFETY }
}

export function getGenerationNodeLabel(kind: GenerationNodeKind): string {
  return i18n.t(`runtime.nodeRegistry.${kind}.menu` as 'runtime.nodeRegistry.text.menu')
}

/** 新建节点的默认标题（建节点工厂注入的就是它）；不给 `lng` = 当前界面语言。 */
export function getGenerationNodeDefaultTitle(kind: GenerationNodeKind, lng?: string): string {
  return i18n.t(`runtime.nodeRegistry.${kind}.title` as 'runtime.nodeRegistry.text.title', lng ? { lng } : undefined)
}

/**
 * **系统给节点起的全部默认标题**（单一来源）：每种节点类型的默认标题（建节点工厂用的同一个 `getGenerationNodeDefaultTitle`
 * 那份 i18n 键）× 每种界面语言，加上导入 / 粘贴 / 拖入入口给的默认标题（`generationCommon.defaultTitles.*`）。
 *
 * 用途：判断一个标题是不是**用户自己起的名字**。节点上没有「改过名」的标记，标题等于其中任何一个就当没改过名。
 * 新增节点类型 / 新语言自动覆盖，不手抄列表（2026-10-06 独立验收 V-1042：画布自动引用把默认标题「图片」当名字，
 * 「让这张图片动起来」被插了 @、一张无关的图进了付费请求）。
 */
export function generationNodeDefaultTitles(): ReadonlySet<string> {
  const titles = new Set<string>()
  for (const lng of SUPPORTED_LOCALES) {
    for (const kind of GENERATION_NODE_KINDS) {
      titles.add(getGenerationNodeDefaultTitle(kind, lng).trim())
    }
    // 读资源表本身（不经 t()）：这是一组文案的整棵子树，不是某一条要显示的文案。
    const entryDefaults = i18n.getResource(lng, 'translation', 'generationCommon.defaultTitles') as unknown
    if (entryDefaults && typeof entryDefaults === 'object') {
      for (const value of Object.values(entryDefaults as Record<string, unknown>)) if (typeof value === 'string') titles.add(value.trim())
    }
  }
  titles.delete('')
  return titles
}

export function getGenerationNodePromptPlaceholder(kind: GenerationNodeKind): string {
  const key = `runtime.nodeRegistry.${kind}.placeholder` as 'runtime.nodeRegistry.text.placeholder'
  return i18n.exists(key) ? i18n.t(key) : i18n.t('runtime.nodeRegistry.fallbackPlaceholder')
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
  return (
    getGenerationNodeExecutionKind(kind) === 'image' ||
    getGenerationNodeDefinition(kind).providesImageReference === true
  )
}

export function isVideoLikeGenerationNodeKind(kind: GenerationNodeKind): boolean {
  return getGenerationNodeExecutionKind(kind) === 'video'
}

export function isAudioLikeGenerationNodeKind(kind: GenerationNodeKind): boolean {
  return getGenerationNodeExecutionKind(kind) === 'audio'
}

// 3D 模型节点同为可生成节点（executionKind:'model3d'，走通用 catalog 任务路径 generate3D）——
// 要渲染模型选择器 + 自动选默认，否则接了 3D 模型（meshy/混元…）也没处在节点上选它、生成路径断在选型。
export function isModel3dLikeGenerationNodeKind(kind: GenerationNodeKind): boolean {
  return getGenerationNodeExecutionKind(kind) === 'model3d'
}

// kind→分类映射的实现已下沉到 generationCanvasTypes（纯模型层，迁移与创建共用，
// 不拖 nodes/registry 的 UI 依赖链）。此处保留导出面，既有调用方 import 路径不变。
export { getDefaultCategoryForNodeKind } from './generationCanvasTypes'
