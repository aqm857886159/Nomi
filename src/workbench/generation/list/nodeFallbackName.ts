// 一个节点在「列表卡 / 生成全部确认卡」里叫什么——唯一来源。
// 用户要在确认卡上分清「我在为哪一张付钱」，所以名字不能全是「未命名」：
//   1. 用户起的标题（系统自己起的默认标题「图片」「Image」不算名字，见 generationNodeDefaultTitles）；
//   2. 没有就用提示词的前若干字，超长截断加省略号；
//   3. 连提示词也没有，用「类型 + 组内序号」（图片 1 / 图片 2）。
// 分镜节点的「镜 03」不走这里（见 storyboardShotLabel）。
import { generationNodeDefaultTitles, getGenerationNodeLabel } from '../../generationCanvas/model/generationNodeKinds'
import type { GenerationNodeKind } from '../../generationCanvas/model/generationNodeKinds'

export const NODE_NAME_PROMPT_CHARS = 14

export type NameableNode = { title?: string | null; prompt?: string | null; kind: GenerationNodeKind }
export type NodeNameDeps = { isDefaultTitle: (title: string) => boolean; kindLabel: (kind: GenerationNodeKind) => string }

/** 纯函数（单测钉三档兜底）：`ordinal` 是它在同批 / 同分区里同类型节点中的序号（从 1 数）。 */
export function resolveNodeName(node: NameableNode, ordinal: number, deps: NodeNameDeps): string {
  const title = node.title?.trim() ?? ''
  if (title && !deps.isDefaultTitle(title)) return title
  const prompt = (node.prompt ?? '').replace(/\s+/g, ' ').trim()
  if (prompt) {
    const chars = Array.from(prompt)
    return chars.length > NODE_NAME_PROMPT_CHARS ? `${chars.slice(0, NODE_NAME_PROMPT_CHARS).join('')}…` : prompt
  }
  return `${deps.kindLabel(node.kind)} ${ordinal}`
}

const liveDeps = (): NodeNameDeps => {
  const defaults = generationNodeDefaultTitles()
  return { isDefaultTitle: (title) => defaults.has(title), kindLabel: getGenerationNodeLabel }
}

/** 同批节点（按给定顺序）的名字：每个节点的序号 = 它在同类型节点里排第几。 */
export function nodeNamesInOrder(nodes: readonly NameableNode[]): string[] {
  const deps = liveDeps()
  const seen = new Map<string, number>()
  return nodes.map((node) => {
    const ordinal = (seen.get(node.kind) ?? 0) + 1
    seen.set(node.kind, ordinal)
    return resolveNodeName(node, ordinal, deps)
  })
}
