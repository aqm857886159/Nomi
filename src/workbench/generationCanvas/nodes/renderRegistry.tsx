import React from 'react'
import {
  Icon360,
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
} from '@tabler/icons-react'
import {
  GENERATION_NODE_PLUGIN_BY_KIND,
  GENERATION_NODE_PLUGINS,
  type GenerationNodeComponent,
  type GenerationNodeIconKey,
  type GenerationNodeKind,
  type GenerationNodePlugin,
} from './registry'

export type { GenerationNodeRenderProps, GenerationNodeComponent } from './registry'

export type GenerationNodeIcon = React.ComponentType<any>

export type GenerationNodeRenderPlugin = Omit<GenerationNodePlugin, 'component' | 'icon'> & {
  icon: GenerationNodeIcon
  component: React.LazyExoticComponent<GenerationNodeComponent>
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
  model3d: IconCube,
  whiteboard: IconBrush,
  audio: IconWaveSine,
}

const lazyComponents = new Map<GenerationNodeKind, React.LazyExoticComponent<GenerationNodeComponent>>()

function getLazyGenerationNodeComponent(plugin: GenerationNodePlugin): React.LazyExoticComponent<GenerationNodeComponent> {
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
    icon: NODE_ICONS[plugin.icon],
    component: getLazyGenerationNodeComponent(plugin),
  }
}

export function getGenerationNodeComponent(kind: GenerationNodeKind): GenerationNodeRenderPlugin['component'] {
  return getGenerationNodePlugin(kind).component
}

export function getQuickAddGenerationNodePlugins(): GenerationNodeRenderPlugin[] {
  return GENERATION_NODE_PLUGINS
    .filter((plugin): boolean => (plugin as { quickAdd?: boolean }).quickAdd !== false)
    .map((plugin) => getGenerationNodePlugin(plugin.kind))
}
