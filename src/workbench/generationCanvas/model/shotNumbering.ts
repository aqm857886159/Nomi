import type { GenerationCanvasNode, GenerationNodeKind } from './generationCanvasTypes'

/**
 * 镜头编号 = 存储身份，不是位置衍生量（审计 A2 根治）。
 *
 * 旧实现把编号做成渲染层 live 计算（categoryId='shots' 按 position.y 排序、
 * y 相同按随机后缀 id tiebreak），后果是一整类视觉错乱：同行编号实质随机、
 * 加一个无关 text/全景节点会改写所有既有镜头编号、与 AI 计划标题里写死的
 * 「镜头 N」永远对不上。
 *
 * 新契约：
 * - 编号只属于「分镜分类里的镜头内容节点」（image/video/shot/keyframe）；
 *   text/panorama/scene3d/output 永不参与编号。
 * - shotIndex 在节点创建/进入分镜分类时一次性分配（max+1），此后移动节点、
 *   添加无关节点、布局变更都不再改号；删除留空号（编号是身份，如章节号）。
 * - 存量项目在 hydrate 时按 (y, x, id) 确定性回填一次（与旧视觉顺序最接近）。
 */

const SHOT_NUMBERED_KINDS: ReadonlySet<GenerationNodeKind> = new Set([
  'image',
  'video',
  'shot',
  'keyframe',
])

export function isShotNumberedNode(
  node: Pick<GenerationCanvasNode, 'kind'> & { categoryId?: string; meta?: GenerationCanvasNode['meta'] },
): boolean {
  // 参考卡（分镜方案的角色/场景/道具锚）永不占镜号——道具锚 kind=image 落 shots 分类,
  // 与镜头节点同 kind 无法靠 kind 区分,靠落画布时打的 meta.referenceSheet 身份标记
  // (R13 走查抓出:道具卡吃掉「镜头 1/2」,真镜头从 3 起编,编号与方案镜号错位)。
  if (node.meta && (node.meta as Record<string, unknown>).referenceSheet === true) return false
  return (node.categoryId ?? 'shots') === 'shots' && SHOT_NUMBERED_KINDS.has(node.kind)
}

/** 下一个可用镜头编号：现存最大编号 + 1（1-based）。 */
export function nextShotIndex(nodes: readonly GenerationCanvasNode[]): number {
  let max = 0
  for (const node of nodes) {
    if (typeof node.shotIndex === 'number' && node.shotIndex > max) max = node.shotIndex
  }
  return max + 1
}

/**
 * 为缺编号的镜头节点确定性回填（幂等）：已有编号原样保留；缺号节点按
 * (y 升序, x 升序, id) 排序后从 max+1 续编。供项目 hydrate 链调用。
 */
export function backfillShotIndexes(
  nodes: readonly GenerationCanvasNode[],
): { nodes: GenerationCanvasNode[]; changed: boolean } {
  const missing = nodes.filter(
    (node) => isShotNumberedNode(node) && typeof node.shotIndex !== 'number',
  )
  if (missing.length === 0) return { nodes: [...nodes], changed: false }

  const ordered = [...missing].sort((a, b) => {
    const ay = a.position?.y ?? 0
    const by = b.position?.y ?? 0
    if (ay !== by) return ay - by
    const ax = a.position?.x ?? 0
    const bx = b.position?.x ?? 0
    if (ax !== bx) return ax - bx
    return a.id.localeCompare(b.id)
  })
  const assigned = new Map<string, number>()
  let next = nextShotIndex(nodes)
  for (const node of ordered) assigned.set(node.id, next++)

  return {
    nodes: nodes.map((node) => {
      const shotIndex = assigned.get(node.id)
      return shotIndex == null ? node : { ...node, shotIndex }
    }),
    changed: true,
  }
}
