// 节点的版本卡片数据：有没有入口、卡上要什么。只读 model/nodeResultLifecycle.ts（几版的唯一主人），不拼版本列表。
import type { GenerationCanvasNode } from '../../model/generationCanvasTypes'
import { listNodeResultVersions, resultIdentity } from '../../model/nodeResultLifecycle'
import { isCardRenderKind, resolveNodeRenderKind } from '../resolveRenderKind'
import type { VersionCardEntry } from './NodeVersionCards'

/**
 * 这个节点有没有版本卡片：图 / 视频结果、可视的版本 ≥ 2 才有（1 版没有叠卡，也就没有入口）。
 * 与是不是制作流程的镜头无关（#953：单版镜头不再借它当重拍入口）。卡片类（角色 / 场景卡）、文本、全景没有版本卡片。
 */
export function nodeHasVersionCards(node: GenerationCanvasNode): boolean {
  if (isCardRenderKind(resolveNodeRenderKind(node)) || node.kind === 'text' || node.kind === 'panorama') return false
  if (!node.result?.url || (node.result.type !== 'image' && node.result.type !== 'video')) return false
  return listNodeResultVersions(node).length >= 2
}

/** 卡片上要的东西：新 → 旧（按「第 N 版」从大到小）。 */
export function nodeVersionEntries(node: GenerationCanvasNode): VersionCardEntry[] {
  return listNodeResultVersions(node).map((entry) => ({
    identity: resultIdentity(entry),
    versionNo: entry.versionNo,
    type: entry.type === 'video' ? 'video' : 'image',
    previewUrl: entry.thumbnailUrl || (entry.type === 'image' ? entry.url || '' : ''),
    ...(entry.url ? { url: entry.url } : {}),
  }))
}
