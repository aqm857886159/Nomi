import React from 'react'
import {
  Icon360,
  Icon3dCubeSphere,
  IconBoxMultiple,
  IconBrush,
  IconCube,
  IconFlag,
  IconLayoutGrid,
  IconPhoto,
  IconUser,
  IconVideo,
  IconWaveSine,
  IconWriting,
  IconScissors,
  type IconProps,
} from '@tabler/icons-react'
import {
  GENERATION_NODE_PLUGIN_BY_KIND,
  GENERATION_NODE_PLUGINS,
  type GenerationNodeComponent,
  type GenerationNodeIconKey,
  type GenerationNodeKind,
  type GenerationNodePlugin,
} from './registry'
import type { GenerationNodeRenderProps } from './registry'
import i18n from '../../../i18n'
import type { GenerationCanvasNode } from '../model/generationCanvasTypes'
import { canvasPluginRegistry } from '../plugins/defaultCanvasPluginRegistry'
import { MissingCanvasPluginNode } from '../plugins/MissingCanvasPluginNode'

export type { GenerationNodeRenderProps, GenerationNodeComponent } from './registry'

export type GenerationNodeIcon = React.ComponentType<IconProps>

export type GenerationNodeRenderPlugin = Omit<
  GenerationNodePlugin,
  'component' | 'icon' | 'label' | 'menuLabel' | 'defaultTitle'
> & {
  label: string
  menuLabel: string
  defaultTitle?: string
  icon: GenerationNodeIcon
  component: React.LazyExoticComponent<GenerationNodeComponent>
  promptPlaceholder?: string
}

const NODE_ICONS: Record<GenerationNodeIconKey, GenerationNodeIcon> = {
  text: IconWriting,
  character: IconUser,
  scene: IconLayoutGrid,
  image: IconPhoto,
  keyframe: IconFlag,
  video: IconVideo,
  shot: IconBoxMultiple,
  output: IconFlag,
  panorama: Icon360,
  scene3d: IconCube,
  model3d: Icon3dCubeSphere,
  whiteboard: IconBrush,
  audio: IconWaveSine,
  clip: IconScissors,
}

/**
 * 节点种类 → 图标组件。左侧工具栏按钮、右键菜单与设计实验室的空态**共用这一个出口**，
 * 所以「实验室里那颗图标和左边栏那颗不是同一个」这种漂移在结构上不可能发生（P1 无并行版）。
 */
export function getGenerationNodeIcon(kind: GenerationNodeKind): GenerationNodeIcon {
  return NODE_ICONS[GENERATION_NODE_PLUGIN_BY_KIND[kind].icon]
}

const lazyComponents = new Map<GenerationNodeKind, React.LazyExoticComponent<GenerationNodeComponent>>()

function getLazyGenerationNodeComponent(
  plugin: GenerationNodePlugin,
): React.LazyExoticComponent<GenerationNodeComponent> {
  const cached = lazyComponents.get(plugin.kind)
  if (cached) return cached
  const component = React.lazy(plugin.component)
  lazyComponents.set(plugin.kind, component)
  return component
}

export function getGenerationNodePlugin(kind: GenerationNodeKind): GenerationNodeRenderPlugin {
  const plugin = GENERATION_NODE_PLUGIN_BY_KIND[kind]
  return {
    ...plugin,
    label: i18n.t(`runtime.nodeRegistry.${kind}.menu` as 'runtime.nodeRegistry.text.menu'),
    menuLabel: i18n.t(`runtime.nodeRegistry.${kind}.menu` as 'runtime.nodeRegistry.text.menu'),
    defaultTitle: i18n.t(`runtime.nodeRegistry.${kind}.title` as 'runtime.nodeRegistry.text.title'),
    promptPlaceholder: i18n.t(`runtime.nodeRegistry.${kind}.placeholder` as 'runtime.nodeRegistry.text.placeholder'),
    icon: NODE_ICONS[plugin.icon],
    component: getLazyGenerationNodeComponent(plugin),
  }
}

export function getGenerationNodeComponent(kind: GenerationNodeKind): GenerationNodeRenderPlugin['component'] {
  return getGenerationNodePlugin(kind).component
}

/** Resolve the node renderer through the host registry without changing React Flow's nodeTypes contract. */
export function getGenerationNodeComponentForNode(node: GenerationCanvasNode): React.ComponentType<GenerationNodeRenderProps<GenerationCanvasNode>> {
  if (!node.typeId) return getGenerationNodeComponent(node.kind) as React.ComponentType<GenerationNodeRenderProps<GenerationCanvasNode>>
  const plugin = canvasPluginRegistry.resolve(node.typeId)
  const pluginState = node.pluginState
  const manifest = pluginState ? canvasPluginRegistry.getManifest(pluginState.pluginId) : undefined
  const manifestNode = manifest?.nodes.find((candidate) => candidate.typeId === node.typeId)
  if (
    !plugin ||
    plugin.typeId !== pluginState?.typeId ||
    pluginState.pluginId !== manifest?.id ||
    !manifestNode ||
    pluginState.schemaVersion !== manifestNode.schemaVersion ||
    plugin.schemaVersion !== manifestNode.schemaVersion
  ) return MissingCanvasPluginNode
  return plugin.component as unknown as React.ComponentType<GenerationNodeRenderProps<GenerationCanvasNode>>
}

export function getQuickAddGenerationNodePlugins(): GenerationNodeRenderPlugin[] {
  return GENERATION_NODE_PLUGINS.filter((plugin): boolean => (plugin as { quickAdd?: boolean }).quickAdd !== false).map(
    (plugin) => getGenerationNodePlugin(plugin.kind),
  )
}
