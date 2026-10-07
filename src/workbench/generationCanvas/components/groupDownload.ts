import { getDesktopBridge } from '../../../desktop/bridge'
import type { GenerationCanvasNode, GenerationNodeResult } from '../model/generationCanvasTypes'

export type GroupDownloadTarget = {
  nodeId: string
  title: string
  result: GenerationNodeResult
}

export function groupDownloadTargets(
  nodes: readonly GenerationCanvasNode[],
  nodeIds: readonly string[],
): GroupDownloadTarget[] {
  const wanted = new Set(nodeIds)
  return nodes
    .filter((node) => wanted.has(node.id) && node.result?.url && node.result.type !== 'text')
    .map((node) => ({ nodeId: node.id, title: node.title.trim(), result: node.result! }))
}

function extension(result: GenerationNodeResult): string {
  if (result.type === 'video') return '.mp4'
  if (result.type === 'audio') return '.mp3'
  if (result.type === 'model3d') return '.glb'
  return '.png'
}

export async function downloadGroupResults(
  targets: readonly GroupDownloadTarget[],
  defaultName: string,
  report: (message: string) => void,
): Promise<void> {
  const bridge = getDesktopBridge()
  if (!bridge || targets.length === 0) return
  let saved = 0
  for (const target of targets) {
    const result = await bridge.assets.download({
      url: target.result.url!,
      suggestedName: `${target.title || defaultName}-${target.nodeId.slice(-6)}${extension(target.result)}`,
    })
    if (result.ok) saved += 1
    if (result.canceled) break
  }
  report(String(saved))
}
