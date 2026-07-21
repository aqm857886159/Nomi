import i18n from '../../../i18n'

export type PendingToolCallLike = {
  toolCallId: string
  toolName: string
  args: unknown
  /** 时序内联:这张卡跟在哪条消息后(=入队时的「卡前气泡」或用户消息 id)。 */
  anchorMessageId?: string
}

export type PlannedNode = {
  clientId: string
  kind: string
  title: string
  prompt: string
  position?: { x: number; y: number }
  // bug①：agent 建议的模型 + 模式 + 标量参数（计划卡 chip 展示 + 用户可改 + 确认后写入节点 meta）。
  modelKey?: string
  modeId?: string
  params?: Record<string, string | number | boolean>
}

/** 只保留标量值（string/number/boolean），丢弃 agent 可能塞进来的对象/数组等非法参数值。 */
function sanitizeAgentParams(raw: Record<string, unknown>): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {}
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      out[key] = value
    }
  }
  return out
}

export type PlannedEdge = {
  sourceClientId: string
  targetClientId: string
  /** T1 边语义（character_ref/style_ref/first_frame…），缺省=通用参考。 */
  mode?: string
}

export type AgentPlanSummary = {
  summary: string
  nodes: PlannedNode[]
  /** 全部边（create 携带 + 遗留 connect 调用合并去重）——展示用。 */
  edges: PlannedEdge[]
  /** 仅 create 调用携带的边——批准时 overrides.edges 只允许覆盖这部分。 */
  createEdges: PlannedEdge[]
  createCallId: string
  connectCallId: string | null
}

/** 轨迹层（T3 计划卡分组）：由 kind 纯函数推导，与 trajectoryLayout 同规则。 */
export type AgentPlanLayer = 'reference' | 'keyframe' | 'video'

export function planNodeLayer(node: Pick<PlannedNode, 'kind'>): AgentPlanLayer | null {
  if (node.kind === 'character' || node.kind === 'scene') return 'reference'
  if (node.kind === 'image') return 'keyframe'
  if (node.kind === 'video') return 'video'
  return null
}

/** 尾帧接力边：video 源 + video 目标 + first_frame 语义（计划卡单独勾选的付费行为）。 */
export function isRelayEdge(edge: PlannedEdge, kindByClientId: ReadonlyMap<string, string>): boolean {
  return (
    edge.mode === 'first_frame' &&
    kindByClientId.get(edge.sourceClientId) === 'video' &&
    kindByClientId.get(edge.targetClientId) === 'video'
  )
}

/**
 * Pure helper extracted from AgentPlanCard so it can be unit-tested
 * without pulling in React. Detects a `create_canvas_nodes` call
 * optionally paired with `connect_canvas_edges` and folds them into a
 * single summary the storyboard plan card can render.
 */
export function summarizeAgentPlan(calls: readonly PendingToolCallLike[]): AgentPlanSummary | null {
  const createCall = calls.find((call) => call.toolName === 'create_canvas_nodes')
  if (!createCall) return null
  const createArgs = (createCall.args && typeof createCall.args === 'object')
    ? createCall.args as Record<string, unknown>
    : {}
  const rawNodes = Array.isArray(createArgs.nodes) ? createArgs.nodes : []
  if (rawNodes.length === 0) return null
  const nodes: PlannedNode[] = rawNodes.map((raw, index) => {
    const node = (raw && typeof raw === 'object') ? raw as Record<string, unknown> : {}
    const position = (node.position && typeof node.position === 'object') ? node.position as Record<string, unknown> : null
    return {
      clientId: typeof node.clientId === 'string' && node.clientId.trim()
        ? node.clientId
        : `n${index + 1}`,
      kind: typeof node.kind === 'string' ? node.kind : 'image',
      title:
        typeof node.title === 'string'
          ? node.title
          : i18n.t('generationCommon.agentRuntime.shotTitle', { index: index + 1 }),
      prompt: typeof node.prompt === 'string' ? node.prompt : '',
      ...(position && typeof position.x === 'number' && typeof position.y === 'number'
        ? { position: { x: position.x, y: position.y } }
        : {}),
      ...(typeof node.modelKey === 'string' && node.modelKey.trim() ? { modelKey: node.modelKey.trim() } : {}),
      ...(typeof node.modeId === 'string' && node.modeId.trim() ? { modeId: node.modeId.trim() } : {}),
      ...(node.params && typeof node.params === 'object' && !Array.isArray(node.params)
        ? { params: sanitizeAgentParams(node.params as Record<string, unknown>) }
        : {}),
    }
  })

  const normalizeEdges = (rawEdges: unknown[]): PlannedEdge[] =>
    rawEdges
      .map((raw) => (raw && typeof raw === 'object') ? raw as Record<string, unknown> : {})
      .map((edge) => ({
        sourceClientId: String(edge.sourceClientId || edge.source || '').trim(),
        targetClientId: String(edge.targetClientId || edge.target || '').trim(),
        ...(typeof edge.mode === 'string' && edge.mode ? { mode: edge.mode } : {}),
      }))
      .filter((edge) => edge.sourceClientId && edge.targetClientId)

  // 主路径：边随 create 一起提交（节点+边一个计划一次批准）；
  // 兼容旧轨迹/模型仍分轮发 connect 的情况，两处合并去重。
  const createEdges: PlannedEdge[] = normalizeEdges(Array.isArray(createArgs.edges) ? createArgs.edges : [])
  const edges: PlannedEdge[] = [...createEdges]
  const connectCall = calls.find((call) => call.toolName === 'connect_canvas_edges')
  if (connectCall) {
    const connectArgs = (connectCall.args && typeof connectCall.args === 'object')
      ? connectCall.args as Record<string, unknown>
      : {}
    const seen = new Set(edges.map((edge) => `${edge.sourceClientId}→${edge.targetClientId}`))
    for (const edge of normalizeEdges(Array.isArray(connectArgs.edges) ? connectArgs.edges : [])) {
      if (!seen.has(`${edge.sourceClientId}→${edge.targetClientId}`)) edges.push(edge)
    }
  }

  const summary = typeof createArgs.summary === 'string' && createArgs.summary.trim()
    ? createArgs.summary.trim()
    : `${nodes.length} 个镜头 + ${edges.length} 条引用边`

  return {
    summary,
    nodes,
    edges,
    createEdges,
    createCallId: createCall.toolCallId,
    connectCallId: connectCall?.toolCallId ?? null,
  }
}
