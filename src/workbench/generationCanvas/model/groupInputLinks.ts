/**
 * 组连线声明层：既支持「一个来源喂给整组」，也支持「整组成员作为来源喂给一个目标」。
 *
 * 语义（一句话）：编组连接 = ①给组内现有成员各展开一根**真边** ②记下输入/输出声明，
 * **以后新进组的成员自动补一根**。
 *
 * 为什么是「展开式」而不是让 edge.source/target 直接指向 group（拍板 2026-08-02）：
 * 后者会引入**平行的图语义**——`resolveReferenceSlots` / `buildDependencyWaves` /
 * `referenceEdgeCapability` / 持久化 schema 每一处读边的地方都要再认一种端点，漏一处就是静默 bug（违 P1）。
 * 展开式下图结构完全不变，组只是**输入手势的语法糖**，所有既有读边逻辑零改动。
 *
 * 物化时机**只有两处，刻意不做持续对账**：建立入参时、成员加入/移出时。
 * 用户在边菜单点“断开”时，store 按这次编组声明的语义范围撤掉全部展开边和声明；
 * 不会出现“删了一根，其余重叠线还在，视觉像没反应”，也不留会给新成员复活连线的幽灵声明。
 *
 * 撤边靠 `edge.viaGroupId` 溯源，不靠 (source,target) 猜：
 * 用户**手工**连过的同一对节点边没有 viaGroupId，成员移出组时绝不会被误删。
 */
import type {
  GenerationCanvasEdge,
  GenerationCanvasEdgeMode,
  GenerationCanvasNode,
  NodeGroup,
} from './generationCanvasTypes'
import { selectConnectionEdgeMode, validateReferenceEdge } from '../agent/referenceEdgeCapability'
import type { EdgeSkipReason } from '../agent/referenceEdgeCapability'

export type GroupInputLink = {
  sourceNodeId: string
  mode?: GenerationCanvasEdgeMode
}

/** 编组作为来源时指向的目标节点。真边仍展开为每个成员 source → target。 */
export type GroupOutputLink = {
  targetNodeId: string
}

export type GroupLinkEdgePlan = {
  /** 该建的边（已过能力校验、且当前还不存在）。 */
  connect: { sourceNodeId: string; targetNodeId: string; mode?: GenerationCanvasEdgeMode }[]
  /** 过不了能力校验被跳过的成员——**必须给用户人话**，不许静默丢。 */
  skipped: { targetNodeId: string; reason: EdgeSkipReason }[]
  /** 已经连过的（同 source+target+mode），不重复建。 */
  alreadyConnected: string[]
}

/** 组内**当前分类下**的真实成员（组可能残留已删/已跨分类的 id）。 */
export function groupMemberNodes(
  group: Pick<NodeGroup, 'nodeIds' | 'categoryId'>,
  nodes: readonly GenerationCanvasNode[],
): GenerationCanvasNode[] {
  const memberIds = new Set(group.nodeIds)
  return nodes.filter((node) => memberIds.has(node.id) && (node.categoryId || 'shots') === group.categoryId)
}

/**
 * 一条组入参要给这批成员建哪些边。
 *
 * **每个成员各自算 mode**（`selectConnectionEdgeMode`，和手动拖把柄同一把尺）：一组里混着图片镜头和
 * 视频镜头时，同一张定妆图对前者该落 character_ref、对后者该填首帧位——写死一个 mode 会把一半连错。
 * 组入参不记 mode（`link.mode` 留空），每次物化按目标当时的模式重算，与手动连线**同一真相源**。
 *
 * 能力校验（`validateReferenceEdge`）在这里逐条过——展开出来的每条边和手动连线走**同一把闸**，
 * 组里混了不吃这类参考的模型时进 `skipped`，由调用方一条 toast 说清「哪几个跳过了、为什么」。
 */
export function planGroupLinkEdges(params: {
  link: GroupInputLink
  targets: readonly GenerationCanvasNode[]
  nodes: readonly GenerationCanvasNode[]
  edges: readonly GenerationCanvasEdge[]
}): GroupLinkEdgePlan {
  const { link, targets, nodes, edges } = params
  const plan: GroupLinkEdgePlan = { connect: [], skipped: [], alreadyConnected: [] }
  const source = nodes.find((node) => node.id === link.sourceNodeId)
  if (!source) return plan
  for (const target of targets) {
    if (target.id === source.id) continue
    const mode = link.mode
      ?? selectConnectionEdgeMode(source, target, edges.filter((edge) => edge.target === target.id))
    // graphOps.connectNodes 按 (source,target,mode) 去重；这里先判一次，好把「已连」和「新连」分开计数报给用户。
    if (edges.some((edge) => edge.source === source.id && edge.target === target.id && edge.mode === mode)) {
      plan.alreadyConnected.push(target.id)
      continue
    }
    const verdict = validateReferenceEdge(source, target, mode)
    if (!verdict.ok) {
      plan.skipped.push({ targetNodeId: target.id, reason: verdict.reason })
      continue
    }
    plan.connect.push({ sourceNodeId: source.id, targetNodeId: target.id, mode })
  }
  return plan
}

/**
 * 某个成员**不再属于**这个组时（移出 / 改投别的组），撤掉该组给它连的边。
 *
 * 为什么要撤：镜头 4 从「第 1 场」改投「第 2 场」，若第 1 场的角色边留着、第 2 场的又补上，
 * 它就**同时挂着两个角色参考**、悄悄出错图。撤掉才是用户的本意。
 *
 * 为什么安全：只认 `viaGroupId`，**手工连的同一对节点边没有这个标记，绝不会被误删**。
 * 另：`ungroup` / `deleteGroup` **刻意不撤边**——解散的是「组织方式」，不是节点之间的真实关系，
 * 把用户连好的线一起删掉是破坏性的。这两者语义不同，别合并。
 *
 * 按对象过滤而非按 edge.id：`createEdgeId` 只吃 (source,target)，同两点连两种语义时 id 会撞。
 */
export function removeGroupLinkEdgesForMember(
  edges: readonly GenerationCanvasEdge[],
  groupId: string,
  memberNodeId: string,
): GenerationCanvasEdge[] {
  const next = edges.filter((edge) => !(
    edge.viaGroupId === groupId && (edge.source === memberNodeId || edge.target === memberNodeId)
  ))
  return next.length === edges.length ? [...edges] : next
}

/** 去重后的组入参列表（同一 source+mode 只留一条）。 */
export function upsertGroupInputLink(
  links: readonly GroupInputLink[] | undefined,
  next: GroupInputLink,
): GroupInputLink[] {
  const mode = next.mode
  const existing = links ?? []
  if (existing.some((link) => link.sourceNodeId === next.sourceNodeId && link.mode === mode)) {
    return [...existing]
  }
  return [...existing, next]
}

/** 去重后的组出参列表（同一 target 只留一条）。 */
export function upsertGroupOutputLink(
  links: readonly GroupOutputLink[] | undefined,
  next: GroupOutputLink,
): GroupOutputLink[] {
  const existing = links ?? []
  if (existing.some((link) => link.targetNodeId === next.targetNodeId)) return [...existing]
  return [...existing, next]
}
