/**
 * [INPUT]: 画布节点结果与历史记录。
 * [OUTPUT]: 导演台 AI 参考图候选列表。
 * [POS]: 画布结果到导演台的只读适配边界。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md。
 */
import type { GenerationCanvasNode } from '../../../model/generationCanvasTypes'
export type CanvasImage = { id: string; name: string; url: string; historical?: boolean }
export function collectCanvasImages(nodes: readonly GenerationCanvasNode[]): CanvasImage[] {
  const images: CanvasImage[] = []
  for (const node of nodes) {
    const seen = new Set<string>()
    for (const result of [node.result, ...(node.history ?? [])]) {
      if (!result || result.type !== 'image' || !result.url?.trim() || seen.has(result.url)) continue
      seen.add(result.url)
      images.push({ id: `${node.id}:${result.id}`, name: node.title || node.id, url: result.url, historical: result !== node.result })
    }
  }
  return images
}
