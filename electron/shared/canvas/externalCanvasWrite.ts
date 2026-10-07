// 外部写画布（MCP / 能力核）落到「当前画布」上的唯一规则——渲染层 store 与盘上项目共用。
//
// 外部写入的形状是「读整张图（base）→ 算出整张新图（next）→ 写回」。读和写之间画布可能已经变了：
// 生成结局落地（钱已经花了）、用户新建 / 改了节点。整张 next 直接覆盖会把这些一起抹掉。
// 所以写回只把 base → next 里**外部自己改了的东西**放到当前画布上（按 id 三方合并）：
// - 外部新增的节点 / 边 / 组：加上（当前已有同 id 的不重复加）；
// - 外部删掉的：从当前删掉；
// - 外部改了的字段：只写那几个字段；当前画布已经没有这个节点（用户删了）就不复活；
// - 外部没碰的、以及读图之后才出现的节点 / 边 / 组：保持当前的样子；
// - 节点上的运行态与落地字段（landedNodeFields）外部写入永远改不动：以当前真实值为准。
// 合完把两端已不在的边去掉，免得悬挂。
import { NODE_LANDED_FIELDS, NODE_RUN_STATE_FIELDS } from './landedNodeFields'

type Keyed = { id: string } & Record<string, unknown>
export type CanvasDocLike = { nodes: readonly unknown[]; edges: readonly unknown[]; groups?: readonly unknown[] }

/** 线上收到的画布文档（外部写入的 base / next）：至少要有 nodes 与 edges 两个数组。 */
export function isCanvasDocument(value: unknown): value is CanvasDocLike {
  const doc = value as Partial<CanvasDocLike> | null
  return Boolean(doc) && typeof doc === 'object' && Array.isArray(doc!.nodes) && Array.isArray(doc!.edges)
}

const NODE_SYSTEM_FIELDS: ReadonlySet<string> = new Set([...NODE_RUN_STATE_FIELDS, ...NODE_LANDED_FIELDS])
const NO_PROTECTED_FIELDS: ReadonlySet<string> = new Set()

const isKeyed = (value: unknown): value is Keyed =>
  Boolean(value) && typeof value === 'object' && typeof (value as { id?: unknown }).id === 'string'

const same = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right)

function mergeKeyed(
  base: readonly unknown[],
  next: readonly unknown[],
  current: readonly unknown[],
  protectedFields: ReadonlySet<string>,
): unknown[] {
  const baseById = new Map(base.filter(isKeyed).map((item) => [item.id, item]))
  const nextById = new Map(next.filter(isKeyed).map((item) => [item.id, item]))
  const currentIds = new Set(current.filter(isKeyed).map((item) => item.id))
  const merged: unknown[] = []
  for (const item of current) {
    if (!isKeyed(item)) { merged.push(item); continue }
    const before = baseById.get(item.id)
    const after = nextById.get(item.id)
    if (before && !after) continue // 外部删掉了
    if (!before || !after || same(before, after)) { merged.push(item); continue }
    const patched: Record<string, unknown> = { ...item }
    for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
      if (protectedFields.has(key) || same(before[key], after[key])) continue
      if (key in after && after[key] !== undefined) patched[key] = after[key]
      else delete patched[key]
    }
    merged.push(patched)
  }
  for (const item of next) {
    if (isKeyed(item) && !baseById.has(item.id) && !currentIds.has(item.id)) merged.push(item) // 外部新增
  }
  return merged
}

export function mergeExternalCanvasWrite<T extends CanvasDocLike>(input: Readonly<{ base: CanvasDocLike; next: CanvasDocLike; current: T }>): T {
  const { base, next, current } = input
  const nodes = mergeKeyed(base.nodes, next.nodes, current.nodes, NODE_SYSTEM_FIELDS)
  const nodeIds = new Set(nodes.filter(isKeyed).map((node) => node.id))
  const edges = mergeKeyed(base.edges, next.edges, current.edges, NO_PROTECTED_FIELDS).filter((edge) => {
    const { source, target } = edge as { source?: unknown; target?: unknown }
    return typeof source === 'string' && typeof target === 'string' && nodeIds.has(source) && nodeIds.has(target)
  })
  const groups = mergeKeyed(base.groups ?? [], next.groups ?? [], current.groups ?? [], NO_PROTECTED_FIELDS)
  return { ...current, nodes, edges, groups }
}
