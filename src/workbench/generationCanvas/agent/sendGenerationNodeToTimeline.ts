import { adoptGenerationNode } from '../../adoption/adoptGenerationNode'
import type { AdoptionOutcome } from '../../adoption/adoptionTypes'
import { useGenerationCanvasStore } from '../store/generationCanvasStore'
import { useWorkbenchStore } from '../../workbenchStore'

/**
 * Agent 的单产物入口现在只是采纳桥的适配器。
 *
 * 旧实现接收一组 `addTimelineClipAtFrame` ports，并在这里直接写时间轴；这条旁路
 * 让 Agent 绕过 Proposal、幂等和一步 Undo。保留工具名和返回形状，内部只转发到
 * `adoptGenerationNode`，这样 MCP/画布调用方无需新增用户可见动作。
 */
export type SendGenerationNodeToTimelineOptions = {
  fps?: number
  startFrame?: number
  resultId?: string
  trackType?: 'image' | 'video'
}

export type SendGenerationNodeToTimelineResult =
  | {
      ok: true
      nodeId: string
      status: 'applied'
      replayed: boolean
      clipIds: string[]
    }
  | {
      ok: false
      nodeId: string
      error: 'node_not_found' | 'clip_unavailable' | 'stale' | 'needs_attention' | 'failed' | 'needs_recovery'
      detail?: string
    }

function mapOutcome(nodeId: string, outcome: AdoptionOutcome): SendGenerationNodeToTimelineResult {
  if (outcome.status === 'applied') {
    return {
      ok: true,
      nodeId,
      status: 'applied',
      replayed: outcome.replayed,
      clipIds: outcome.proposal.clipIds,
    }
  }
  if (outcome.status === 'nothing_to_adopt') {
    return {
      ok: false,
      nodeId,
      error: 'clip_unavailable',
    }
  }
  return {
    ok: false,
    nodeId,
    error: outcome.status,
    ...('error' in outcome ? { detail: outcome.error } : {}),
  }
}

export async function sendGenerationNodeToTimeline(
  nodeId: string,
  options: SendGenerationNodeToTimelineOptions = {},
): Promise<SendGenerationNodeToTimelineResult> {
  const id = String(nodeId || '').trim()
  const node = useGenerationCanvasStore.getState().nodes.find((candidate) => candidate.id === id)
  if (!node) return { ok: false, nodeId: id || nodeId, error: 'node_not_found' }

  const outcome = await adoptGenerationNode(node, {
    // 保留旧 Agent 工具「缺省贴播放头」语义；UI 的节点按钮仍显式走 append。
    placement: {
      kind: 'frame',
      startFrame: options.startFrame ?? useWorkbenchStore.getState().timeline.playheadFrame,
    },
  })
  return mapOutcome(id, outcome)
}
