// 角色圣经 · 锚 meta 的键名单一真相源 + 纯判据（electron 主进程侧）。
//
// 为什么存在这份表：static/dynamic 特征 + frozen 状态落进 `node.meta`（`Record<string,unknown>` 且持久化
// 是 `z.array(z.unknown())` passthrough，`projectRecordSchema.ts` —— 自动落盘、零 schema 改动）。GUI 与
// headless 两侧都读写同一份 `node.meta`，故键名（`'staticFeatures'`/`'dynamicFeatures'`/`'frozen'`）必须**只有
// 一份定义**，否则会出「GUI 写 staticFeatures、headless 读 static_features」的漂移（同 connection-reference-bugs
// 那类「槽读 meta、生成读边」分裂的同型隐患）。这里放键名常量 + 纯判据，src 侧读同名键并由
// `anchorBible.equivalence.test.ts` 逐项钉死 === 本常量（照 nodeKindDomain 先例的「重复 + 等价测试守恒」）。
//
// 纯净：零 import（可在纯 Node 单测）。electron production 反向 import 不了 src，故本表是权威、src 是镜像。

/** 锚 meta 的语义键名（单一真相源）。GUI 落画布写这些键、headless/production 冻结门读这些键。 */
export const ANCHOR_META_KEYS = {
  /** 已有：这是一张参考卡（角色/场景/道具）。 */
  referenceSheet: 'referenceSheet',
  /** 身份 DNA（脸型/发色/骨相/标志物）——身份轴对照的基准；跨镜必须一致。 */
  staticFeatures: 'staticFeatures',
  /** 服装/配饰/状态（允许跨镜变，不进身份匹配）。 */
  dynamicFeatures: 'dynamicFeatures',
  /** 冻结状态（对象：时间戳 + 谁冻的，story-order 无关）。未冻结 = 键缺失。 */
  frozen: 'frozen',
} as const

/** 冻结记录形态：交付/审计要显示「XX 冻结于何时」；未来若「改了 static 自动解冻」需要时间戳判据。 */
export type AnchorFrozenMark = {
  /** 冻结时刻（epoch ms）。 */
  at: number
  /** 谁冻的：目前只有用户视觉确认这一种（不吃 spend/plan 会话信任的自动放行）。 */
  by: 'user'
}

/** 锚节点的最小读取形状（GUI/headless 两侧的节点都满足：kind + 可选 meta map）。 */
export type AnchorNodeLike = {
  kind?: string
  meta?: Record<string, unknown> | null
}

/** 视觉锚 kind：只有角色/场景/道具会生成参考卡、需要冻结；style 是文本锚不走冻结门。 */
const VISUAL_ANCHOR_KINDS: ReadonlySet<string> = new Set(['character', 'scene', 'prop'])

function metaOf(node: AnchorNodeLike | undefined | null): Record<string, unknown> | undefined {
  const meta = node?.meta
  return meta && typeof meta === 'object' && !Array.isArray(meta) ? (meta as Record<string, unknown>) : undefined
}

/**
 * 这个 kind 本身是不是「视觉锚卡」的 kind（character/scene/prop）。
 * 落节点的地方据它自动打 referenceSheet 标记——**别让调用方记得传**，忘一次冻结门就对那条路失明
 * （2026-08-20 实测：headless MCP 建的角色卡因为没这个标记，整条 MCP 路的冻结门从来没生效过）。
 */
export function isVisualAnchorKind(kind: string | undefined | null): boolean {
  return VISUAL_ANCHOR_KINDS.has(String(kind || ''))
}

/** 是否是「需要冻结的视觉锚」：meta.referenceSheet===true 且 kind ∈ character/scene/prop。 */
export function isVisualAnchorNode(node: AnchorNodeLike | undefined | null): boolean {
  const meta = metaOf(node)
  if (!meta || meta[ANCHOR_META_KEYS.referenceSheet] !== true) return false
  return VISUAL_ANCHOR_KINDS.has(String(node?.kind || ''))
}

/** 冻结判据（单一真相源）：meta.frozen 是带正整数时间戳的对象即为已冻结；缺失/畸形 = 未冻结。 */
export function isAnchorFrozen(node: AnchorNodeLike | undefined | null): boolean {
  const meta = metaOf(node)
  const mark = meta?.[ANCHOR_META_KEYS.frozen]
  if (!mark || typeof mark !== 'object' || Array.isArray(mark)) return false
  const at = (mark as Record<string, unknown>).at
  return typeof at === 'number' && Number.isFinite(at) && at > 0
}

/** 身份轴对照基准：优先用 meta.staticFeatures（身份 DNA，比整串 prompt 更准），退化到 prompt。 */
export function anchorStaticFeatures(
  node: (AnchorNodeLike & { prompt?: string }) | undefined | null,
): string {
  const meta = metaOf(node)
  const staticFeatures = meta?.[ANCHOR_META_KEYS.staticFeatures]
  if (typeof staticFeatures === 'string' && staticFeatures.trim()) return staticFeatures.trim()
  const prompt = node?.prompt
  return typeof prompt === 'string' ? prompt.trim() : ''
}

/**
 * 从一批节点里挑出「需要冻结但还没冻结」的视觉锚（冻结门的判据）。
 * 纯函数、可裸测：GUI 依赖波次拦截与 production 冻结门共用这一份判据（P1 单一真相源）。
 */
export function unfrozenVisualAnchors<T extends AnchorNodeLike & { id?: string; title?: string }>(
  nodes: readonly T[],
): T[] {
  return nodes.filter((node) => isVisualAnchorNode(node) && !isAnchorFrozen(node))
}

/**
 * 单镜生成时「你引用的这几张卡还没冻结」的提醒判据（W2 冻结门的**第三层**，2026-08-20 补）。
 *
 * 为什么需要第三层：旧单次生成路曾能绕开 ProductionRun，一镜一镜循环，二十个镜头全建在没定妆的脸上。
 * 该路已退役；纯判据仍供既有画布逻辑使用，避免同类回归。
 *
 * **但这一层只提醒不拦。** 单镜生成是低层工具，用户就想出一张图时不该被批量语义的门挡住
 * （同审片环哲学：增益不是关卡）。所以这里返回「该被提醒的锚」，由结果文本如实带一句给 agent——
 * 它读到后可以自己决定先请用户过目，或者明知故犯地继续。信息到位，选择权留给上面。
 *
 * 纯函数：调用方把「这一镜实际引用了哪些源节点」算好传进来，我们不猜边。
 */
export function unfrozenAnchorsForShot<T extends AnchorNodeLike & { id?: string; title?: string }>(
  referencedNodes: readonly T[],
): T[] {
  return unfrozenVisualAnchors(referencedNodes)
}
