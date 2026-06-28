// 从画布节点组装镜级 verify 入参(纯函数,显式传入 nodes/edges → 可裸测;runner 层注入 store 快照)。
// 方案:docs/plan/2026-06-28-storyboard-closed-loop-verify.md（Stage 1 实时编排）。
//
// 逐镜:身份锚描述 = 入边(参考边)的源锚节点「标题 + 描述」;连贯对照 = shotIndex-1 的那一镜;
// 取帧源 = 该镜 result.url(图片镜=帧本身;视频镜=视频,待抽帧)。无产物的镜跳过(没生成谈不上校验)。

import type { GenerationCanvasEdge, GenerationCanvasNode } from '../model/generationCanvasTypes'
import { getGenerationNodeExecutionKind } from '../model/generationNodeKinds'
import type { ShotVerifyInput } from './shotVerifyRunner'

function trim(text: string | undefined, max = 160): string {
  const t = (text ?? '').trim()
  return t.length > max ? `${t.slice(0, max)}…` : t
}

/** 锚节点 → 身份对照描述(标题为主,补一句提示词摘要)。 */
function anchorDescription(node: GenerationCanvasNode): string {
  const title = (node.title || '').trim()
  const desc = trim(node.prompt, 120)
  if (title && desc) return `${title}：${desc}`
  return title || desc
}

export function gatherShotVerifyInputs(
  shotNodeIds: readonly string[],
  nodes: readonly GenerationCanvasNode[],
  edges: readonly GenerationCanvasEdge[],
): ShotVerifyInput[] {
  const byId = new Map(nodes.map((n) => [n.id, n]))
  // shotIndex → 节点(连贯轴找前一镜用);只收有 shotIndex 的镜头节点。
  const byShotIndex = new Map<number, GenerationCanvasNode>()
  for (const n of nodes) {
    if (typeof n.shotIndex === 'number') byShotIndex.set(n.shotIndex, n)
  }
  const inputs: ShotVerifyInput[] = []
  for (const id of shotNodeIds) {
    const node = byId.get(id)
    if (!node) continue
    const frameSourceUrl = node.result?.url || node.result?.providerUrl || ''
    if (!frameSourceUrl) continue // 没产物 → 无从校验,跳过(失败镜不算偏差)
    const isVideo = getGenerationNodeExecutionKind(node.kind) === 'video'
    // 入边的源锚节点(角色/场景/道具/站位参考…)→ 身份对照描述。
    const anchorDescriptions = edges
      .filter((e) => e.target === id)
      .map((e) => byId.get(e.source))
      .filter((n): n is GenerationCanvasNode => Boolean(n) && getGenerationNodeExecutionKind(n!.kind) !== 'video')
      .map(anchorDescription)
      .filter(Boolean)
    // 前一镜(shotIndex-1)提示词 → 连贯对照;首镜或无编号 → 不传。
    const prevNode = typeof node.shotIndex === 'number' ? byShotIndex.get(node.shotIndex - 1) : undefined
    const previousShotPrompt = trim(prevNode?.prompt, 160) || undefined
    inputs.push({
      shotNodeId: id,
      shotTitle: (node.title || '').trim() || id,
      shotPrompt: (node.prompt || '').trim(),
      anchorDescriptions,
      ...(previousShotPrompt ? { previousShotPrompt } : {}),
      frameSourceUrl,
      isVideo,
    })
  }
  return inputs
}
