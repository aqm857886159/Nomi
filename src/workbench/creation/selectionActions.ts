import { IconLayoutRows, IconPhoto, IconVideo, type Icon } from '@tabler/icons-react'
import type { GenerationCanvasNode } from '../generationCanvas/model/generationCanvasTypes'
import type { WorkspaceMode } from '../workbenchStore'
import type { TranslationKey } from '../../i18n/translationKey'
import i18n from '../../i18n'

/**
 * 创作文档里选中文字后，浮条上把这句话「交出去」的每一颗钮：画什么、叫什么、住哪一簇、按下去交给谁。**只此一份**。
 *
 * 2026-11-08 用户：「滑中句子，点击视频icon，然后为什么发送了文字」。真机复现：「拆成镜头」那颗画的是胶片
 * （`IconMovie`），和「生成图片 / 生成视频」排在一起，看着就是「视频」，按下去却把句子发进了 Agent 对话。
 * 之前三颗钮在浮条里各自手接（两颗走 `handleCreate(kind)` 建节点，一颗内联调分镜启动器），「哪颗钮做什么」
 * 散在 JSX 里，没有一处能一眼对上「图标 ↔ 后果」。现在：长相、名字、位置、去处在这张表里一行一颗，
 * 分派只走 `runSelectionAction`，浮条只按表出钮。
 *
 * 位置（用户 2026-11-12 拍板样张 B）：「拆成镜头」不是「生成一个节点」，不和图片、视频排在一起，
 * 住「AI 编辑」右边（`cluster: 'beside-ai-edit'`）；图标用设计系统「语义图标登记」里的分镜 `IconLayoutRows`。
 */
export type SelectionActionTarget =
  | { readonly kind: 'canvas-node'; readonly nodeKind: 'image' | 'video' }
  | { readonly kind: 'agent-storyboard' }

/** 浮条上的哪一簇：`beside-ai-edit` = 紧挨「AI 编辑」右边；`generate` = 「生成」组（建画布节点）。 */
export type SelectionActionCluster = 'beside-ai-edit' | 'generate'

export type SelectionAction = {
  readonly id: string
  readonly labelKey: TranslationKey
  readonly Icon: Icon
  readonly cluster: SelectionActionCluster
  readonly target: SelectionActionTarget
}

export const SELECTION_ACTIONS = [
  { id: 'storyboard', labelKey: 'creationAi.selection.storyboard', Icon: IconLayoutRows, cluster: 'beside-ai-edit', target: { kind: 'agent-storyboard' } },
  { id: 'image', labelKey: 'creationAi.selection.image', Icon: IconPhoto, cluster: 'generate', target: { kind: 'canvas-node', nodeKind: 'image' } },
  { id: 'video', labelKey: 'creationAi.selection.video', Icon: IconVideo, cluster: 'generate', target: { kind: 'canvas-node', nodeKind: 'video' } },
] as const satisfies readonly SelectionAction[]

export function selectionActionsIn(cluster: SelectionActionCluster): readonly SelectionAction[] {
  return SELECTION_ACTIONS.filter((action) => action.cluster === cluster)
}

const NODE_TITLE_KEY = {
  image: 'runtime.nodeRegistry.image.title',
  video: 'runtime.nodeRegistry.video.title',
} as const satisfies Record<'image' | 'video', TranslationKey>

type AddGenerationCanvasNode = (input: {
  kind: 'image' | 'video'
  title: string
  prompt: string
}) => GenerationCanvasNode

export type SelectionActionPorts = {
  addGenerationNode: AddGenerationCanvasNode
  setWorkspaceMode: (mode: WorkspaceMode) => void
  /** 常驻 Agent 发布的分镜启动器（只在创作面有）；没有 = 「拆成镜头」灰。 */
  launchStoryboard: ((selectedText: string) => void) | null
}

export function canRunSelectionAction(target: SelectionActionTarget, ports: Pick<SelectionActionPorts, 'launchStoryboard'>): boolean {
  return target.kind === 'agent-storyboard' ? ports.launchStoryboard !== null : true
}

/** 唯一分派：按动作的去处做那一件事，别的去处一个都不碰。返回 true = 真的交出去了（浮条据此收起）。 */
export function runSelectionAction(target: SelectionActionTarget, selectedText: string, ports: SelectionActionPorts): boolean {
  const text = selectedText.trim()
  if (!text) return false
  switch (target.kind) {
    case 'canvas-node':
      ports.addGenerationNode({ kind: target.nodeKind, title: i18n.t(NODE_TITLE_KEY[target.nodeKind]), prompt: text })
      ports.setWorkspaceMode('generation')
      return true
    case 'agent-storyboard':
      if (!ports.launchStoryboard) return false
      ports.launchStoryboard(text)
      return true
  }
}
