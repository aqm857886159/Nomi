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

let lastNodes: readonly GenerationCanvasNode[] | null = null
let lastImages: CanvasImage[] = []

/**
 * 给 store 选择器用：同一份 nodes 只收集一次；内容（逐字段）没变就返回上一份数组引用，
 * 于是导演台不随无关画布写入重渲——以前靠选择器里 JSON.stringify 防抖，每次 store 写都序列化一遍。
 */
export function selectCanvasImages(nodes: readonly GenerationCanvasNode[]): CanvasImage[] {
  if (nodes === lastNodes) return lastImages
  const next = collectCanvasImages(nodes)
  lastNodes = nodes
  const same = next.length === lastImages.length && next.every((image, index) => {
    const previous = lastImages[index]
    return image.id === previous.id && image.name === previous.name && image.url === previous.url && image.historical === previous.historical
  })
  if (!same) lastImages = next
  return lastImages
}
