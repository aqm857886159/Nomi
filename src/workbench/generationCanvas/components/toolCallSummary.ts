// 工具调用的人话摘要(时间线步骤标题 / committed 记录 stepLabels 共用单源)。
// 杀 toolName 原文与 raw JSON:面板里直接显示给用户看的只能是这套词表。
export function summarizeToolCall(toolName: string, args: unknown): string {
  const record = args && typeof args === 'object' ? (args as Record<string, unknown>) : {}
  if (toolName === 'create_canvas_nodes') {
    const nodes = Array.isArray(record.nodes) ? record.nodes : []
    const summary = typeof record.summary === 'string' ? record.summary : ''
    return `创建 ${nodes.length} 个节点${summary ? `：${summary}` : ''}`
  }
  if (toolName === 'connect_canvas_edges') {
    const edges = Array.isArray(record.edges) ? record.edges : []
    return `连接 ${edges.length} 条引用线`
  }
  if (toolName === 'set_node_prompt') {
    return `改写节点 ${String(record.nodeId || '')} 的提示词`
  }
  if (toolName === 'delete_canvas_nodes') {
    const ids = Array.isArray(record.nodeIds) ? record.nodeIds : []
    return `删除 ${ids.length} 个节点`
  }
  if (toolName === 'run_generation_batch') {
    const ids = Array.isArray(record.nodeIds) ? record.nodeIds : []
    return `批量生成 ${ids.length} 个节点（将产生生成费用）`
  }
  if (toolName === 'read_canvas_state') {
    return '读取画布当前状态'
  }
  return toolName
}

/** 单工具 pending 卡(非计划折叠)的副标题:把 args 翻成一行人话,不再直怼 JSON。 */
export function describeToolCallDetail(toolName: string, args: unknown): string {
  const record = args && typeof args === 'object' ? (args as Record<string, unknown>) : {}
  if (toolName === 'connect_canvas_edges') {
    const edges = Array.isArray(record.edges) ? record.edges : []
    return edges
      .map((edge) => {
        const e = edge && typeof edge === 'object' ? (edge as Record<string, unknown>) : {}
        return `${String(e.sourceClientId || e.source || '?')} → ${String(e.targetClientId || e.target || '?')}`
      })
      .join('，')
  }
  if (toolName === 'set_node_prompt') {
    const prompt = String(record.prompt || '')
    return prompt.length > 80 ? `${prompt.slice(0, 80)}…` : prompt
  }
  if (toolName === 'delete_canvas_nodes') {
    const ids = Array.isArray(record.nodeIds) ? record.nodeIds.map((id) => String(id)) : []
    return ids.join('，')
  }
  if (toolName === 'run_generation_batch') {
    const ids = Array.isArray(record.nodeIds) ? record.nodeIds.map((id) => String(id)) : []
    return ids.join('，')
  }
  return ''
}
