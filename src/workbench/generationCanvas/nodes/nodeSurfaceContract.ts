// 节点视图能力契约（编译期穷尽锁）：每一种 GenerationNodeKind 必须显式声明：
// 1. stageMode：接入与 React Flow 坐标解耦的同源舞台（'shared-stage'），还是仅能在空间画布编辑（'canvas-only'，列表详情给显式「去画布」指路）；
// 2. hasGenerationComposer：单选或列表大详情下是否挂载生成输入框；
// 3. defaultListRole：在生成页列表投影里的默认归类（'generation' 完整卡 / 'tool' 紧凑跳画布卡 / 'asset' 素材与参考）。
//
// 新增任何 GenerationNodeKind 若不在此登记，TypeScript 编译期直接报错（satisfies Record<GenerationNodeKind, ...>），
// 禁止各视图手抄散落的 kind 集合。
import { isGenerationNodeKind, type GenerationNodeKind } from '../model/generationNodeKinds'

export type NodeSurfaceStageMode = 'shared-stage' | 'canvas-only'
export type NodeListDefaultRole = 'generation' | 'tool' | 'asset'

export type NodeSurfaceContract = Readonly<{
  stageMode: NodeSurfaceStageMode
  hasGenerationComposer: boolean
  defaultListRole: NodeListDefaultRole
}>

export const NODE_SURFACE_CONTRACTS = {
  shot_table: { stageMode: 'canvas-only', hasGenerationComposer: false, defaultListRole: 'tool' },
  text: { stageMode: 'shared-stage', hasGenerationComposer: true, defaultListRole: 'generation' },
  character: { stageMode: 'shared-stage', hasGenerationComposer: true, defaultListRole: 'asset' },
  scene: { stageMode: 'shared-stage', hasGenerationComposer: true, defaultListRole: 'asset' },
  image: { stageMode: 'shared-stage', hasGenerationComposer: true, defaultListRole: 'generation' },
  keyframe: { stageMode: 'shared-stage', hasGenerationComposer: true, defaultListRole: 'generation' },
  video: { stageMode: 'shared-stage', hasGenerationComposer: true, defaultListRole: 'generation' },
  audio: { stageMode: 'shared-stage', hasGenerationComposer: true, defaultListRole: 'generation' },
  clip: { stageMode: 'canvas-only', hasGenerationComposer: false, defaultListRole: 'tool' },
  shot: { stageMode: 'canvas-only', hasGenerationComposer: true, defaultListRole: 'tool' },
  output: { stageMode: 'canvas-only', hasGenerationComposer: true, defaultListRole: 'tool' },
  panorama: { stageMode: 'canvas-only', hasGenerationComposer: false, defaultListRole: 'tool' },
  director: { stageMode: 'canvas-only', hasGenerationComposer: false, defaultListRole: 'tool' },
  whiteboard: { stageMode: 'canvas-only', hasGenerationComposer: false, defaultListRole: 'tool' },
  model3d: { stageMode: 'canvas-only', hasGenerationComposer: true, defaultListRole: 'tool' },
  asset: { stageMode: 'shared-stage', hasGenerationComposer: false, defaultListRole: 'asset' },
  'agent-artifact': { stageMode: 'canvas-only', hasGenerationComposer: false, defaultListRole: 'tool' },
} as const satisfies Record<GenerationNodeKind, NodeSurfaceContract>

export function getNodeSurfaceContract(kind: string): NodeSurfaceContract {
  return isGenerationNodeKind(kind)
    ? NODE_SURFACE_CONTRACTS[kind]
    : { stageMode: 'canvas-only', hasGenerationComposer: true, defaultListRole: 'generation' }
}
