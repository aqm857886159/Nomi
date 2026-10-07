// 画布节点上「不是用户编辑」的字段——唯一清单与唯一规则（渲染层与主进程共用）。
//
// 节点对象里混着两层：编辑层（位置、提示词、参数、连线……用户 / Agent 改的）和事实层（只由生成运行写，钱已经花了）：
// - 运行态：任务此刻的真实状态（运行记录 / 状态 / 错误 / 进度）；
// - 落地：生成结局留在节点上的东西（主图 / 版本列表 / 出过的最大版本号 / 文本定稿）；
// - 跟主图走的媒体尺寸：结果落地时由结果本身算出来写进 meta 的那几个键（不是用户设的参数）。
//
// 所有「整图 / 整节点写回」都只经画布 store 的统一提交口（store/canvasDocumentCommit.ts），规则只有一条：
// **编辑层取传进来的，事实层取活的**。主进程盘上的外部写（externalCanvasWrite）用的是同一个函数。
export const NODE_RUN_STATE_FIELDS = ['runs', 'status', 'error', 'progress'] as const
export const NODE_LANDED_FIELDS = ['result', 'history', 'resultVersionMax', 'contentJson'] as const
/** 结果落地时写进 meta 的媒体尺寸（nodeSizing.computeMediaMetaPatch 的产物）：跟着主图走，不跟着编辑走。 */
export const NODE_LANDED_META_KEYS = [
  'imageWidth', 'imageHeight', 'imageAspectRatio',
  'videoWidth', 'videoHeight', 'videoAspectRatio', 'videoDuration',
] as const

type NodeRecord = Readonly<Record<string, unknown>>

const NODE_FACT_FIELDS: readonly string[] = [...NODE_RUN_STATE_FIELDS, ...NODE_LANDED_FIELDS]

const metaOf = (node: NodeRecord): NodeRecord | undefined =>
  node.meta && typeof node.meta === 'object' && !Array.isArray(node.meta) ? node.meta as NodeRecord : undefined

function sameFields(target: NodeRecord, live: NodeRecord, fields: readonly string[]): boolean {
  return fields.every((field) => target[field] === live[field])
}

function sameLandedMeta(target: NodeRecord, live: NodeRecord): boolean {
  const targetMeta = metaOf(target)
  const liveMeta = metaOf(live)
  return NODE_LANDED_META_KEYS.every((key) => targetMeta?.[key] === liveMeta?.[key])
}

function copyFields(next: Record<string, unknown>, live: NodeRecord, fields: readonly string[]): void {
  for (const field of fields) {
    if (live[field] === undefined) delete next[field]
    else next[field] = live[field]
  }
}

/**
 * 运行态取活的、其余原样（撤销 / 重做用：落地由日志按顺序叠回，用户撤得掉自己「设为主图 / 删版本」的编辑；
 * 运行态永远等于任务此刻的真实状态）。没有变化时返回 target 本身。
 */
export function withLiveRunState<T extends object>(target: T, live: object): T {
  const from = target as NodeRecord
  const current = live as NodeRecord
  if (sameFields(from, current, NODE_RUN_STATE_FIELDS)) return target
  const next: Record<string, unknown> = { ...from }
  copyFields(next, current, NODE_RUN_STATE_FIELDS)
  return next as T
}

/**
 * 编辑层取 target、事实层（运行态 + 落地 + 跟主图走的媒体尺寸）全部取 live。整写写手（外部写、放回节点字段）
 * 无权改事实层，传进来的是哪一刻的样子都一样。没有变化时返回 target 本身。
 */
export function withLiveNodeFacts<T extends object>(target: T, live: object): T {
  const from = target as NodeRecord
  const current = live as NodeRecord
  const factsSame = sameFields(from, current, NODE_FACT_FIELDS)
  const metaSame = sameLandedMeta(from, current)
  if (factsSame && metaSame) return target
  const next: Record<string, unknown> = { ...from }
  if (!factsSame) copyFields(next, current, NODE_FACT_FIELDS)
  if (!metaSame) {
    const meta: Record<string, unknown> = { ...(metaOf(from) ?? {}) }
    copyFields(meta, metaOf(current) ?? {}, NODE_LANDED_META_KEYS)
    next.meta = meta
  }
  return next as T
}
