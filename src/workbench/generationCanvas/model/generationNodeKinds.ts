import {
  GENERATION_NODE_KINDS,
  GENERATION_NODE_PLUGINS,
  type GenerationNodeExecutionKind,
  type GenerationNodeKind,
  type GenerationNodePluginDefinition,
} from '../nodes/registry'
import type { BuiltinCanvasCategoryId } from './generationCanvasTypes'

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

/**
 * agent/工具新建节点时，按 kind 推断默认所属分类（单一真相源，避免 categoryId 缺省落
 * 'shots' 导致角色/场景被误归分镜、镜头拿不到「镜头 N」编号）：
 * - character → 'cast'（角色）
 * - scene → 'scene'（场景）
 * - 其余（image/video/keyframe/shot/output/panorama/text…）→ 'shots'（分镜）
 * prop/audio 无独占 kind，由各自创建流程显式指定，不在此推断。
 */
export function getDefaultCategoryForNodeKind(kind: GenerationNodeKind): BuiltinCanvasCategoryId {
  switch (kind) {
    case 'character':
      return 'cast'
    case 'scene':
      return 'scene'
    default:
      return 'shots'
  }
}
