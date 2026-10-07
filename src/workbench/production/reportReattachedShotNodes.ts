import type { GenerationCanvasNode } from '../generationCanvas/model/generationCanvasTypes'
import type { DesktopProductionRunBridge } from '../../desktop/productionRunBridgeTypes'
import { executeProductionRunCommand } from './productionRunCommands'

export type ReattachReportApi = Pick<DesktopProductionRunBridge, 'read' | 'command'>

function shotIdOf(node: GenerationCanvasNode): string | null {
  const meta = node.meta as Record<string, unknown> | undefined
  const value = meta?.productionShotId
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

export async function reportReattachedShotNodes(
  projectId: string,
  runId: string,
  nodes: readonly GenerationCanvasNode[],
  api: ReattachReportApi,
): Promise<'reattached' | 'not-applicable'> {
  const run = await api.read(projectId, runId)
  if (!run || run.generationPlan?.state === 'cancelled') return 'not-applicable'
  const bindings = nodes
    .map((node) => {
      const shotId = shotIdOf(node)
      return shotId ? { shotId, nodeId: node.id } : null
    })
    .filter((binding): binding is { shotId: string; nodeId: string } => Boolean(binding))
  if (!bindings.length) return 'not-applicable'
  await executeProductionRunCommand(projectId, runId, {
    commandId: `canvas-reattach:${runId}:${bindings.map((binding) => `${binding.shotId}:${binding.nodeId}`).join(',')}:${run.revision}`,
    expectedRevision: run.revision,
    type: 'plan.bind-shot-nodes',
    payload: { bindings },
    issuedAt: new Date().toISOString(),
  }, { read: api.read, execute: api.command })
  return 'reattached'
}
