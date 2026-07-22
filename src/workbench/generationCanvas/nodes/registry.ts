import type { ComponentType } from 'react'
import type { BillingModelKind } from '../../../api/desktopClient'

export type GenerationNodeRenderProps<TNode = unknown> = {
  node: TNode
  selected: boolean
  readOnly?: boolean
  focusFlash?: boolean
  /** 新落点（add/paste/Agent）一次性弹入动画；开项目已有节点不传（不齐闪）。 */
  appear?: boolean
}

export type GenerationNodeComponent = ComponentType<GenerationNodeRenderProps<unknown>>
export type GenerationNodeExecutionKind = 'image' | 'video' | 'text' | 'audio' | 'model3d'
export type GenerationNodeIconKey =
  | 'text'
  | 'character'
  | 'scene'
  | 'image'
  | 'keyframe'
  | 'video'
  | 'shot'
  | 'output'
  | 'panorama'
  | 'scene3d'
  | 'model3d'
  | 'whiteboard'
  | 'audio'

export type GenerationNodePluginDefinition<TKind extends string = string> = {
  kind: TKind
  label: string
  menuLabel: string
  component: () => Promise<{ default: GenerationNodeComponent }>
  icon: GenerationNodeIconKey
  defaultTitle?: string
  defaultSize: { width: number; height: number }
  catalogKind: BillingModelKind
  executionKind?: GenerationNodeExecutionKind
  quickAdd?: boolean
  agentCreatable?: boolean
  providesImageReference?: boolean
  promptPlaceholder?: string
}

function defineGenerationNodePlugins<
  const TPlugins extends readonly [GenerationNodePluginDefinition, ...GenerationNodePluginDefinition[]],
>(plugins: TPlugins): TPlugins {
  return plugins
}

const loadBaseGenerationNode = () =>
  import('./BaseGenerationNode') as Promise<{
    default: GenerationNodeComponent
  }>

export const GENERATION_NODE_PLUGINS = defineGenerationNodePlugins([
  {
    kind: 'text',
    label: 'Text',
    menuLabel: 'Text',
    component: loadBaseGenerationNode,
    icon: 'text',
    defaultTitle: 'Text',
    defaultSize: { width: 280, height: 200 },
    catalogKind: 'text',
    executionKind: 'text',
    quickAdd: true,
    agentCreatable: true,
    promptPlaceholder: 'Enter text...',
  },
  {
    kind: 'character',
    label: 'Character',
    menuLabel: 'Character',
    component: loadBaseGenerationNode,
    icon: 'character',
    defaultTitle: 'Character',
    defaultSize: { width: 300, height: 190 },
    catalogKind: 'image',
    executionKind: 'image',
    quickAdd: true,
    agentCreatable: true,
    providesImageReference: true,
    promptPlaceholder: 'Describe the character...',
  },
  {
    kind: 'scene',
    label: 'Scene',
    menuLabel: 'Scene',
    component: loadBaseGenerationNode,
    icon: 'scene',
    defaultTitle: 'Scene',
    defaultSize: { width: 300, height: 190 },
    catalogKind: 'image',
    executionKind: 'image',
    quickAdd: true,
    agentCreatable: true,
    providesImageReference: true,
    promptPlaceholder: 'Describe the scene...',
  },
  {
    kind: 'image',
    label: 'Image',
    menuLabel: 'Image',
    component: loadBaseGenerationNode,
    icon: 'image',
    defaultTitle: 'Image',
    defaultSize: { width: 340, height: 280 },
    catalogKind: 'image',
    executionKind: 'image',
    quickAdd: true,
    agentCreatable: true,
    providesImageReference: true,
    promptPlaceholder: 'Describe this frame...',
  },
  {
    kind: 'keyframe',
    label: 'Keyframe',
    menuLabel: 'Keyframe',
    component: loadBaseGenerationNode,
    icon: 'keyframe',
    defaultTitle: 'Keyframe',
    defaultSize: { width: 320, height: 220 },
    catalogKind: 'image',
    executionKind: 'image',
    quickAdd: true,
    providesImageReference: true,
    promptPlaceholder: 'Describe the keyframe...',
  },
  {
    kind: 'video',
    label: 'Video',
    menuLabel: 'Video',
    component: loadBaseGenerationNode,
    icon: 'video',
    defaultTitle: 'Video',
    defaultSize: { width: 420, height: 340 },
    catalogKind: 'video',
    executionKind: 'video',
    quickAdd: true,
    agentCreatable: true,
    promptPlaceholder: 'Describe the video...',
  },
  {
    // 声音：配音生成（TTS，文→音）/ 转写（Whisper，音→文）/ 上传音频。渲染走 audio-strip（按 kind 强制，
    // 见 BaseGenerationNode renderKind 分发），生成类挂 composer（模式切换在 NodeGenerationComposer）。
    kind: 'audio',
    label: 'Audio',
    menuLabel: 'Audio',
    component: loadBaseGenerationNode,
    icon: 'audio',
    defaultTitle: 'Audio',
    defaultSize: { width: 420, height: 80 },
    catalogKind: 'audio',
    executionKind: 'audio',
    quickAdd: true,
    agentCreatable: true,
    promptPlaceholder: 'Enter dialogue or narration...',
  },
  {
    kind: 'shot',
    label: 'Shot',
    menuLabel: 'Shot',
    component: loadBaseGenerationNode,
    icon: 'shot',
    defaultTitle: 'Shot',
    defaultSize: { width: 340, height: 230 },
    catalogKind: 'text',
    quickAdd: true,
    promptPlaceholder: 'Describe the shot...',
  },
  {
    kind: 'output',
    label: 'Output',
    menuLabel: 'Output',
    component: loadBaseGenerationNode,
    icon: 'output',
    defaultTitle: 'Output',
    defaultSize: { width: 280, height: 170 },
    catalogKind: 'text',
    quickAdd: true,
    promptPlaceholder: 'Add output notes...',
  },
  {
    kind: 'panorama',
    label: 'Panorama',
    menuLabel: 'Panorama',
    component: loadBaseGenerationNode,
    icon: 'panorama',
    defaultTitle: 'Panorama',
    defaultSize: { width: 480, height: 270 },
    catalogKind: 'image',
    quickAdd: true,
    providesImageReference: true,
    promptPlaceholder: 'Add a panorama reference...',
  },
  {
    kind: 'scene3d',
    label: '3D Scene',
    menuLabel: '3D Scene',
    component: loadBaseGenerationNode,
    icon: 'scene3d',
    defaultTitle: '3D Scene',
    defaultSize: { width: 480, height: 320 },
    catalogKind: 'text',
    quickAdd: true,
    agentCreatable: false,
    providesImageReference: true,
    promptPlaceholder: 'Arrange a 3D scene...',
  },
  {
    kind: 'whiteboard',
    label: 'Whiteboard',
    menuLabel: 'Whiteboard',
    // 画板复用共享外壳 BaseGenerationNode(renderKind=whiteboard-card)，和其他节点同一套外壳；
    // body 在 whiteboard/WhiteboardCardBody（懒加载）。删了旧 WhiteboardCardNode 平行外壳。
    component: loadBaseGenerationNode,
    icon: 'whiteboard',
    defaultTitle: 'Whiteboard',
    defaultSize: { width: 320, height: 240 },
    catalogKind: 'image',
    quickAdd: true,
    providesImageReference: true,
    promptPlaceholder: 'Draw a reference...',
  },
  {
    // 3D 模型：文生 / 图生 3D 生成节点（RunningHub 混元/HiTem/Meshy，输出 .glb）。是**生成节点**
    // （拿 composer），区别于 scene3d 编辑器节点。body 走 model3d-card（懒加载 Model3DViewer，
    // 复用 scene3d 的 R3F useGLTF 栈）。composer 挂载放行（不在 BaseGenerationNode 的 scene3d 排除名单）。
    kind: 'model3d',
    label: '3D Model',
    menuLabel: '3D Model',
    component: loadBaseGenerationNode,
    icon: 'model3d',
    defaultTitle: '3D Model',
    defaultSize: { width: 320, height: 300 },
    catalogKind: 'model3d',
    executionKind: 'model3d',
    quickAdd: true,
    agentCreatable: true,
    promptPlaceholder: 'Describe the 3D model...',
  },
  {
    // 素材：导入图 / 文件树拖入 / 本地切图裁剪旋转衍生物。它就是一张图，不是生成节点：
    // 无 executionKind（不会生成）、无 composer（壳按 isAssetKind 关闭）、不可手动新建（quickAdd:false）、
    // 不进 agent 工具（agentCreatable 缺省 false）。仍可作参考被连线（providesImageReference）。
    kind: 'asset',
    label: 'Asset',
    menuLabel: 'Asset',
    component: loadBaseGenerationNode,
    icon: 'image',
    defaultTitle: 'Asset',
    defaultSize: { width: 340, height: 280 },
    catalogKind: 'image',
    quickAdd: false,
    providesImageReference: true,
  },
])

export type GenerationNodePlugin = (typeof GENERATION_NODE_PLUGINS)[number]
export type GenerationNodeKind = GenerationNodePlugin['kind']

export const GENERATION_NODE_KINDS = GENERATION_NODE_PLUGINS.map((plugin) => plugin.kind) as [
  GenerationNodeKind,
  ...GenerationNodeKind[],
]

export const GENERATION_NODE_PLUGIN_BY_KIND: Record<GenerationNodeKind, GenerationNodePlugin> = Object.fromEntries(
  GENERATION_NODE_PLUGINS.map((plugin) => [plugin.kind, plugin]),
) as Record<GenerationNodeKind, GenerationNodePlugin>
