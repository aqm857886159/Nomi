import { describe, expect, it } from 'vitest'

import { MCP_TOOL_NAMES } from './mcpProtocol'
import { MCP_TOOL_RESOLVER, CANVAS_READ_METHOD, type McpToolDefinition } from './mcpToolCatalog'

// 面收敛（surface-16-collapse）等价锚 + P1 无并行版断言。
// ① 退役：42 个旧 MCP name 同 commit 从目录删净（resolve→undefined、不在 tools/list、不在 MCP_TOOL_NAMES）。
// ② 映射断言表：每个旧 name 的 method+params 形状 ≡ 新 name 某枚举分支的 resolveMethod+build 输出（逐条 assert）。

// 收敛前的 42 个旧 MCP 工具名（inventory.md 清单）——全部必须退役。
const RETIRED_OLD_NAMES = [
  'nomi_get_generation_context', 'nomi_operation_create', 'nomi_submit_generation_plan', 'nomi_preview_execution',
  'nomi_request_generation_gate', 'nomi_decide_generation_gate', 'nomi_start_generation', 'nomi_operation_read',
  'nomi_cancel_generation', 'nomi_reconcile_generation', 'nomi_integration_begin', 'nomi_integration_open_credentials',
  'nomi_integration_discover', 'nomi_integration_select', 'nomi_integration_request_confirmation',
  'nomi_integration_submit_workflow', 'nomi_integration_resolve_input', 'nomi_integration_start', 'nomi_integration_get',
  'nomi_integration_cancel', 'nomi_list_projects', 'nomi_create_project', 'nomi_list_models', 'nomi_read_canvas',
  'nomi_add_nodes', 'nomi_connect_nodes', 'nomi_set_node_prompt', 'nomi_delete_nodes', 'nomi_start_playbook',
  'nomi_get_run', 'nomi_subscribe_run', 'nomi_get_artifact', 'nomi_read_artifact', 'nomi_request_script_revision',
  'nomi_request_storyboard_revision', 'nomi_review_artifact', 'nomi_materialize_storyboard', 'nomi_control_run',
  'nomi_decide_gate', 'nomi_intake_brief', 'nomi_import_asset',
  // session_open 保留原名（唯一 1→1），不在退役表。
]

// 收敛后的 15 个工具名（nomi_canvas_edit 槽位现由 M2 语义 canvas.write 适配器承担）+ 8 个 M2 语义编辑工具（catalog 末尾原样保留）。
const COLLAPSED_TOOL_NAMES = [
  'nomi_session_open', 'nomi_read', 'nomi_canvas_edit', 'nomi_asset_import', 'nomi_operation_plan',
  'nomi_operation_preview', 'nomi_operation_gate', 'nomi_operation_execute', 'nomi_operation_control',
  'nomi_run_start', 'nomi_run_control', 'nomi_artifact_review', 'nomi_run_gate', 'nomi_integration',
  'nomi_project_create',
]
// M2 语义编辑（非本次 42→15 收敛的一员；此处只断言「原样保留、不被误删」）。并线裁定（2026-09-02）：
// M2 canvas/document 语义面 4 个透传工具随并线加入（canvas_read 收进 nomi_read target=canvas、canvas 写即 T3 本体，
// 均不在透传里，见 mcpToolCatalog.ts）。
const M2_EDITING_TOOL_NAMES = [
  'nomi_canvas_plan', 'nomi_canvas_maintenance', 'nomi_document_read', 'nomi_document_edit',
  'nomi_timeline_read', 'nomi_timeline_edit', 'nomi_export_job', 'nomi_media_query',
]
const NEW_TOOL_NAMES = [...COLLAPSED_TOOL_NAMES, ...M2_EDITING_TOOL_NAMES]

function tool(name: string): McpToolDefinition {
  const resolved = MCP_TOOL_RESOLVER.resolve(name)
  if (!resolved) throw new Error(`Expected collapsed tool present: ${name}`)
  return resolved
}

/** 新工具对给定 args 的实际派发 = { method, params }（resolveMethod 缺省回退 tool.method）。 */
function route(name: string, args: Record<string, unknown>): { method: string; params: Record<string, unknown> } {
  const t = tool(name)
  const method = typeof (t as { resolveMethod?: unknown }).resolveMethod === 'function'
    ? (t as { resolveMethod: (a: Record<string, unknown>) => string }).resolveMethod(args)
    : t.method
  return { method, params: t.build(args) }
}

describe('MCP surface collapse 42→15 · P1 retirement', () => {
  it('retires every one of the 42 legacy MCP tool names', () => {
    const listed = MCP_TOOL_RESOLVER.list().map((t) => t.name)
    for (const oldName of RETIRED_OLD_NAMES) {
      expect(MCP_TOOL_RESOLVER.resolve(oldName), `${oldName} must resolve to undefined`).toBeUndefined()
      expect(listed, `${oldName} must not appear in tools/list`).not.toContain(oldName)
      expect(MCP_TOOL_NAMES, `${oldName} must not appear in MCP_TOOL_NAMES`).not.toContain(oldName)
    }
    // nomi_generate stays retired too (pre-existing tombstone).
    expect(MCP_TOOL_RESOLVER.resolve('nomi_generate')).toBeUndefined()
  })

  it('exposes exactly the 15 collapsed tools + 4 preserved M2 editing tools', () => {
    const listed = MCP_TOOL_RESOLVER.list()
    expect(listed.map((t) => t.name)).toEqual(NEW_TOOL_NAMES)
    // 收敛的 15 个带人读 title；M2 语义工具（含 T3 槽位的语义 canvas_edit）沿用已发布形态（暂无 title，续裁时补）。
    for (const t of listed.filter((t) => COLLAPSED_TOOL_NAMES.includes(t.name) && t.name !== 'nomi_canvas_edit')) {
      expect(typeof (t as { title?: unknown }).title, `${t.name} carries a title`).toBe('string')
    }
  })

  it('marks read-only via annotations (not a name set): nomi_read + nomi_operation_preview + M2 read tools', () => {
    const readOnly = MCP_TOOL_RESOLVER.list().filter((t) => (t as { annotations?: { readOnlyHint?: boolean } }).annotations?.readOnlyHint).map((t) => t.name)
    // timeline_edit 是写（reversible_write），不在只读集；timeline_read/export_job/media_query 是读。
    expect(readOnly).toEqual(['nomi_read', 'nomi_operation_preview', 'nomi_timeline_read', 'nomi_export_job', 'nomi_media_query'])
  })
})

describe('MCP surface collapse · equivalence-anchor mapping table', () => {
  // 每行：旧 name 的 { method, params } ≡ route(新 name, 对应枚举 args)。
  // params 用一份具体 fixture 验证形状与字段透传一致。
  const L = 'lease-1'
  const P = 'proj-1'

  it('T2 nomi_read absorbs the 10 read tools (each = a target)', () => {
    // canvas (was nomi_read_canvas, method=canvas.read)
    expect(route('nomi_read', { target: 'canvas', leaseHandle: L, projectId: P }))
      .toEqual({ method: CANVAS_READ_METHOD, params: { leaseHandle: L, projectId: P } })
    // projects (was nomi_list_projects)
    expect(route('nomi_read', { target: 'projects' })).toEqual({ method: 'project.list', params: {} })
    // models (was nomi_list_models)
    expect(route('nomi_read', { target: 'models' })).toEqual({ method: 'models.list', params: {} })
    // generation_context (was nomi_get_generation_context)
    expect(route('nomi_read', { target: 'generation_context', leaseHandle: L, projectId: P }))
      .toEqual({ method: 'nomi_get_generation_context', params: { projectId: P, leaseHandle: L } })
    // operation (was nomi_operation_read)
    expect(route('nomi_read', { target: 'operation', leaseHandle: L, operationId: 'op-1', projectId: P }))
      .toEqual({ method: 'nomi_operation_read', params: { projectId: P, leaseHandle: L, operationId: 'op-1' } })
    // run (was nomi_get_run)
    expect(route('nomi_read', { target: 'run', projectId: P, runId: 'r-1' }))
      .toEqual({ method: 'production.get', params: { projectId: P, runId: 'r-1' } })
    // run_events (was nomi_subscribe_run)
    expect(route('nomi_read', { target: 'run_events', projectId: P, runId: 'r-1', afterCursor: 5, waitMs: 25000 }))
      .toEqual({ method: 'production.events', params: { projectId: P, runId: 'r-1', afterCursor: 5, waitMs: 25000 } })
    // run_events defaults (afterCursor/waitMs → 0)
    expect(route('nomi_read', { target: 'run_events', projectId: P, runId: 'r-1' }))
      .toEqual({ method: 'production.events', params: { projectId: P, runId: 'r-1', afterCursor: 0, waitMs: 0 } })
    // artifact (was nomi_get_artifact)
    expect(route('nomi_read', { target: 'artifact', projectId: P, runId: 'r-1', artifactId: 'a-1' }))
      .toEqual({ method: 'production.artifact', params: { projectId: P, runId: 'r-1', artifactId: 'a-1' } })
    // artifact_content (was nomi_read_artifact)
    expect(route('nomi_read', { target: 'artifact_content', projectId: P, runId: 'r-1', artifactId: 'a-1' }))
      .toEqual({ method: 'production.artifact.read', params: { projectId: P, runId: 'r-1', artifactId: 'a-1' } })
    // integration (was nomi_integration_get)
    expect(route('nomi_read', { target: 'integration', sessionId: 's-1' }))
      .toEqual({ method: 'integration.get', params: { sessionId: 's-1' } })
  })

  it('T3 nomi_canvas_edit routes canvas writes through the semantic lease-scoped surface (no legacy catalog methods)', () => {
    // 并线裁定：action→canvas.addNodes/... 薄路由被 M2 语义面（根因契约）取代——leaseHandle 必填、operation 枚举、
    // 统一 canvas.write 能力路由；删除/撤销拆去 nomi_canvas_maintenance（destructiveHint + confirmation + undoToken）。
    expect(route('nomi_canvas_edit', { leaseHandle: L, projectId: P, operation: 'set_node_prompt', nodeId: 'n-1', prompt: 'x' }))
      .toEqual({ method: 'canvas.write', params: { leaseHandle: L, projectId: P, operation: 'set_node_prompt', nodeId: 'n-1', prompt: 'x' } })
    expect(route('nomi_canvas_edit', {
      leaseHandle: L, projectId: P, operation: 'create_canvas_nodes', summary: '创建画布节点',
      nodes: [{ clientId: 'c-1', kind: 'image', title: '镜 1', prompt: '镜头 1' }, { clientId: 'c-2', kind: 'video', title: '镜 2', prompt: '镜头 2' }],
    }).method).toBe('canvas.write')
    expect(route('nomi_canvas_edit', { leaseHandle: L, projectId: P, operation: 'connect_canvas_edges', edges: [{ sourceClientId: 'c-1', targetClientId: 'c-2', mode: 'reference' }] }))
      .toEqual({ method: 'canvas.write', params: { leaseHandle: L, projectId: P, operation: 'connect_canvas_edges', edges: [{ sourceClientId: 'c-1', targetClientId: 'c-2', mode: 'reference' }] } })
    expect(route('nomi_canvas_maintenance', { leaseHandle: L, projectId: P, operation: 'delete_canvas_nodes', nodeIds: ['n-1'], confirmation: true }))
      .toEqual({ method: 'canvas.delete', params: { leaseHandle: L, projectId: P, operation: 'delete_canvas_nodes', nodeIds: ['n-1'], confirmation: true } })
    // 旧目录级路由键彻底退役（P1）：语义面不再把这些字面量当 catalog method 暴露。
    for (const legacy of ['canvas.addNodes', 'canvas.connect', 'canvas.setPrompt', 'canvas.deleteNodes']) {
      expect(MCP_TOOL_RESOLVER.list().map((t) => t.method)).not.toContain(legacy)
    }
  })

  it('T4 nomi_asset_import ≡ nomi_import_asset', () => {
    expect(route('nomi_asset_import', { projectId: P, path: '/tmp/a.png', title: 'ref' }))
      .toEqual({ method: 'asset.import', params: { projectId: P, path: '/tmp/a.png', title: 'ref' } })
  })

  it('T5 nomi_operation_plan absorbs create + submit (operationId presence switches)', () => {
    // create (no operationId) → nomi_operation_create, passes prompt/shots/scriptText through
    expect(route('nomi_operation_plan', { leaseHandle: L, projectId: P, prompt: 'a cat' }))
      .toEqual({ method: 'nomi_operation_create', params: { projectId: P, leaseHandle: L, prompt: 'a cat' } })
    expect(route('nomi_operation_plan', { leaseHandle: L, scriptText: '四镜' }))
      .toEqual({ method: 'nomi_operation_create', params: { projectId: undefined, leaseHandle: L, scriptText: '四镜' } })
    // patch (operationId + patch) → nomi_submit_generation_plan
    expect(route('nomi_operation_plan', { leaseHandle: L, projectId: P, operationId: 'op-1', patch: { prompt: 'b' } }))
      .toEqual({ method: 'nomi_submit_generation_plan', params: { projectId: P, leaseHandle: L, operationId: 'op-1', patch: { prompt: 'b' } } })
  })

  it('T6 nomi_operation_preview ≡ nomi_preview_execution (read-only)', () => {
    expect(route('nomi_operation_preview', { leaseHandle: L, operationId: 'op-1', projectId: P }))
      .toEqual({ method: 'nomi_preview_execution', params: { projectId: P, leaseHandle: L, operationId: 'op-1' } })
  })

  it('T7 nomi_operation_gate absorbs request + decide (phase switches)', () => {
    expect(route('nomi_operation_gate', { phase: 'request', leaseHandle: L, operationId: 'op-1', projectId: P }))
      .toEqual({ method: 'nomi_request_generation_gate', params: { projectId: P, leaseHandle: L, operationId: 'op-1' } })
    expect(route('nomi_operation_gate', { phase: 'decide', leaseHandle: L, operationId: 'op-1', projectId: P, attempt: 1, receiptId: 'rc', receiptToken: 'tk' }))
      .toEqual({ method: 'nomi_decide_generation_gate', params: { projectId: P, leaseHandle: L, operationId: 'op-1', attempt: 1, receiptId: 'rc', receiptToken: 'tk' } })
  })

  it('T8 nomi_operation_execute ≡ nomi_start_generation', () => {
    expect(route('nomi_operation_execute', { leaseHandle: L, operationId: 'op-1', projectId: P, receiptId: 'rc', receiptToken: 'tk' }))
      .toEqual({ method: 'nomi_start_generation', params: { projectId: P, leaseHandle: L, operationId: 'op-1', receiptId: 'rc', receiptToken: 'tk' } })
  })

  it('T9 nomi_operation_control absorbs cancel + reconcile (action switches)', () => {
    expect(route('nomi_operation_control', { action: 'cancel', leaseHandle: L, operationId: 'op-1', projectId: P }))
      .toEqual({ method: 'nomi_cancel_generation', params: { projectId: P, leaseHandle: L, operationId: 'op-1' } })
    expect(route('nomi_operation_control', { action: 'reconcile', leaseHandle: L, operationId: 'op-1', projectId: P, outcome: 'found' }))
      .toEqual({ method: 'nomi_reconcile_generation', params: { projectId: P, leaseHandle: L, operationId: 'op-1', outcome: 'found' } })
  })

  it('T10 nomi_run_start ≡ nomi_start_playbook · T11 nomi_run_control ≡ nomi_control_run', () => {
    expect(route('nomi_run_start', { projectId: P, playbook: 'brand.promo', brief: { goal: 'g' }, trustLevel: 'budget_only' }))
      .toEqual({ method: 'production.start', params: { projectId: P, playbook: 'brand.promo', playbookVersion: undefined, brief: { goal: 'g' }, trustLevel: 'budget_only' } })
    expect(route('nomi_run_control', { projectId: P, runId: 'r-1', action: 'pause' }))
      .toEqual({ method: 'production.control', params: { projectId: P, runId: 'r-1', action: 'pause' } })
    expect(route('nomi_run_control', { projectId: P, runId: 'r-1', action: 'set_trust', trustLevel: 'budget_only' }))
      .toEqual({ method: 'production.control', params: { projectId: P, runId: 'r-1', action: 'set_trust', trustLevel: 'budget_only' } })
  })

  it('T12 nomi_artifact_review absorbs review + script/storyboard revision', () => {
    // approve/request_changes/reject → production.artifact.review with mapped decision
    expect(route('nomi_artifact_review', { action: 'approve', projectId: P, runId: 'r-1', artifactId: 'a-1', expectedVersion: 1 }))
      .toEqual({ method: 'production.artifact.review', params: { projectId: P, runId: 'r-1', artifactId: 'a-1', expectedVersion: 1, decision: 'approved' } })
    expect(route('nomi_artifact_review', { action: 'request_changes', projectId: P, runId: 'r-1', artifactId: 'a-1', expectedVersion: 1 }).params)
      .toMatchObject({ decision: 'changes_requested' })
    expect(route('nomi_artifact_review', { action: 'reject', projectId: P, runId: 'r-1', artifactId: 'a-1', expectedVersion: 1 }).params)
      .toMatchObject({ decision: 'rejected' })
    // revise + kind=script (was nomi_request_script_revision)
    expect(route('nomi_artifact_review', { action: 'revise', kind: 'script', projectId: P, runId: 'r-1', artifactId: 'a-1', expectedVersion: 2, instruction: 'tighten' }))
      .toEqual({ method: 'production.artifact.revise', params: { projectId: P, runId: 'r-1', artifactId: 'a-1', expectedVersion: 2, instruction: 'tighten', kind: 'script' } })
    // revise + kind=storyboard (was nomi_request_storyboard_revision)
    expect(route('nomi_artifact_review', { action: 'revise', kind: 'storyboard', projectId: P, runId: 'r-1', artifactId: 'a-1', expectedVersion: 2, instruction: 'reorder' }).params)
      .toMatchObject({ kind: 'storyboard' })
  })

  it('T13 nomi_run_gate absorbs decide_gate + materialize (action switches)', () => {
    expect(route('nomi_run_gate', { action: 'decide', projectId: P, runId: 'r-1', gateId: 'gate-direction-v1', decision: 'approved', choiceKey: 'k1' }))
      .toEqual({ method: 'production.decide-gate', params: { projectId: P, runId: 'r-1', gateId: 'gate-direction-v1', decision: 'approved', choiceKey: 'k1' } })
    expect(route('nomi_run_gate', { action: 'materialize', projectId: P, runId: 'r-1', artifactId: 'a-1', expectedVersion: 3 }))
      .toEqual({ method: 'production.storyboard.materialize', params: { projectId: P, runId: 'r-1', artifactId: 'a-1', expectedVersion: 3 } })
  })

  it('T14 nomi_integration absorbs the 9 write transitions (get went to nomi_read)', () => {
    expect(route('nomi_integration', { action: 'begin', kind: 'http-api-provider', name: 'X', baseUrl: 'https://x', authType: 'bearer', authHeader: 'Authorization' }))
      .toEqual({ method: 'integration.begin', params: { kind: 'http-api-provider', name: 'X', baseUrl: 'https://x', authType: 'bearer', authHeader: 'Authorization' } })
    expect(route('nomi_integration', { action: 'open_credentials', sessionId: 's', expectedRevision: 1 }))
      .toEqual({ method: 'integration.open_credentials', params: { sessionId: 's', expectedRevision: 1 } })
    expect(route('nomi_integration', { action: 'discover', sessionId: 's', expectedRevision: 1, page: 0, search: 'flux' }))
      .toEqual({ method: 'integration.discover', params: { sessionId: 's', expectedRevision: 1, page: 0, search: 'flux' } })
    expect(route('nomi_integration', { action: 'select', sessionId: 's', expectedRevision: 1, selections: [{ modelKey: 'm' }] }))
      .toEqual({ method: 'integration.select', params: { sessionId: 's', expectedRevision: 1, selections: [{ modelKey: 'm' }] } })
    // confirm → integration.request_confirmation ($ 付费两相之一)
    expect(route('nomi_integration', { action: 'confirm', sessionId: 's', expectedRevision: 1, idempotencyKey: 'k' }))
      .toEqual({ method: 'integration.request_confirmation', params: { sessionId: 's', expectedRevision: 1, idempotencyKey: 'k' } })
    expect(route('nomi_integration', { action: 'submit_workflow', sessionId: 's', expectedRevision: 1, workflow: '{}' }))
      .toEqual({ method: 'integration.submit_workflow', params: { sessionId: 's', expectedRevision: 1, workflow: '{}' } })
    expect(route('nomi_integration', { action: 'resolve_input', sessionId: 's', expectedRevision: 1, answers: { a: 1 } }))
      .toEqual({ method: 'integration.resolve_input', params: { sessionId: 's', expectedRevision: 1, answers: { a: 1 } } })
    // start → integration.start ($ 付费两相之二，前置 receipt)
    expect(route('nomi_integration', { action: 'start', sessionId: 's', expectedRevision: 1, idempotencyKey: 'k', receipt: 'rc' }))
      .toEqual({ method: 'integration.start', params: { sessionId: 's', expectedRevision: 1, idempotencyKey: 'k', receipt: 'rc' } })
    expect(route('nomi_integration', { action: 'cancel', sessionId: 's', expectedRevision: 1 }))
      .toEqual({ method: 'integration.cancel', params: { sessionId: 's', expectedRevision: 1 } })
  })

  it('T15 nomi_project_create ≡ nomi_create_project', () => {
    expect(route('nomi_project_create', { name: 'demo' })).toEqual({ method: 'project.create', params: { name: 'demo' } })
    expect(route('nomi_project_create', {})).toEqual({ method: 'project.create', params: {} })
  })
})
