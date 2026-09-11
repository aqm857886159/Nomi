import { describe, expect, it } from 'vitest'

import { MCP_TOOL_NAMES } from './mcpProtocol'
import { MCP_TOOL_RESOLVER, CANVAS_READ_METHOD, type McpToolDefinition } from './mcpToolCatalog'
import { ONBOARDING_VERBS } from './modelOnboarding/declarations'

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
  'nomi_integration_cancel', 'nomi_list_projects', 'nomi_create_project', 'nomi_read_canvas',
  // 'nomi_list_models' 于 2026-09-11 复活为**接入设置的读门**（连接 / 模型 / 在途接入 + 未试跑角标），
  // 与 nomi_read target=models（「现在能拿来生成的是哪些」，带 moduleId 与参考槽）职责不同、描述互指。
  // 它不在退役表里，因为它现在是活的工具名，不是被收敛掉的旧 1→1 镜像。
  'nomi_add_nodes', 'nomi_connect_nodes', 'nomi_set_node_prompt', 'nomi_delete_nodes', 'nomi_start_playbook',
  'nomi_get_run', 'nomi_subscribe_run', 'nomi_get_artifact', 'nomi_read_artifact', 'nomi_request_script_revision',
  'nomi_request_storyboard_revision', 'nomi_review_artifact', 'nomi_materialize_storyboard', 'nomi_control_run',
  'nomi_decide_gate', 'nomi_intake_brief', 'nomi_import_asset',
  // session_open 保留原名（唯一 1→1），不在退役表。
]

// 收敛后的 15 个工具名 + T14 管理补充工具 + 8 个 M2 语义编辑工具。
const COLLAPSED_TOOL_NAMES = [
  'nomi_session_open', 'nomi_read', 'nomi_canvas_edit', 'nomi_asset_import', 'nomi_operation_plan',
  'nomi_operation_preview', 'nomi_operation_gate', 'nomi_operation_execute', 'nomi_operation_control',
  'nomi_run_start', 'nomi_run_control', 'nomi_artifact_review', 'nomi_run_gate',
  // T14 · 接模型这条路（2026-09-11 重做）：4 个工具 = 4 种后果。
  'nomi_list_models', 'nomi_await_setup', 'nomi_model_setup', 'nomi_remove_provider',
  'nomi_project_create',
]
// M2 语义编辑（非本次 42→15 收敛的一员；此处只断言「原样保留、不被误删」）。并线裁定（2026-09-02）：
// M2 canvas/document 语义面 4 个透传工具随并线加入（canvas_read 收进 nomi_read target=canvas、canvas 写即 T3 本体，
// 均不在透传里，见 mcpToolCatalog.ts）。
// nomi_canvas_plan 于 2026-09-05 退役：它与 nomi_canvas_edit 在 tools/list 里 description/inputSchema/
// method 字节级相同，只有名字不同（P1 并行版发生在公开面上）；画布语义写只剩 T3 一个名字，operation 枚举
// 即全部合法动作（含原先只在 plan 上放行的 5 个分镜/站位/运镜动作）。
const M2_EDITING_TOOL_NAMES = [
  'nomi_canvas_maintenance', 'nomi_document_read', 'nomi_document_edit',
  'nomi_timeline_read', 'nomi_timeline_edit', 'nomi_export_job', 'nomi_media_query',
  'nomi_layout_read', 'nomi_layout_write',
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

  it('exposes exactly the 15 collapsed tools + the preserved M2 editing tools', () => {
    const listed = MCP_TOOL_RESOLVER.list()
    expect(listed.map((t) => t.name)).toEqual(NEW_TOOL_NAMES)
    // 所有公开工具都必须带人读 title；M2 语义工具的中英文标题由目录层补齐。
    for (const t of listed) {
      expect(typeof (t as { title?: unknown }).title, `${t.name} carries a title`).toBe('string')
      expect((t as { title: string }).title.length, `${t.name} title is non-empty`).toBeGreaterThan(0)
    }
  })

  it('marks read-only via annotations (not a name set): nomi_read + nomi_operation_preview + M2 read tools', () => {
    const readOnly = MCP_TOOL_RESOLVER.list().filter((t) => (t as { annotations?: { readOnlyHint?: boolean } }).annotations?.readOnlyHint).map((t) => t.name)
    // timeline_edit 是写（reversible_write），不在只读集；timeline_read/export_job/media_query 是读。
    // 阶段 5a：注解**全量派生**自契约的 effect/effectClass（`mcpAnnotationsFor`），不再是一张
    // 手写的 4 个适配器名单。名单漏掉的两个（document_read / layout_read）因此第一次带上
    // readOnlyHint —— 它们的契约本来就是 `effect:"read"`，漏标的后果是宿主对一次读也去问用户。
    expect(readOnly).toEqual(['nomi_read', 'nomi_operation_preview', 'nomi_list_models', 'nomi_await_setup', 'nomi_document_read', 'nomi_timeline_read', 'nomi_export_job', 'nomi_media_query', 'nomi_layout_read'])
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

  it('T14 接模型这条路是 4 个工具 = 4 种后果（读 / 等 / 可撤销六步 / 唯一不可逆）', () => {
    // 一个工具 = 一种后果 = 动哪个状态 × 效果类别；同格合并用 action，跨格必拆。
    expect(route('nomi_model_setup', { action: 'connect_provider', kind: 'http-api-provider', name: 'X', baseUrl: 'https://x', authType: 'bearer', authHeader: 'Authorization' }))
      .toEqual({ method: 'modelSetup.connect_provider', params: { action: 'connect_provider', kind: 'http-api-provider', name: 'X', baseUrl: 'https://x', authType: 'bearer', authHeader: 'Authorization' } })
    expect(route('nomi_model_setup', { action: 'choose_models', setupId: 's', models: [{ modelKey: 'm', kind: 'text' }] }))
      .toEqual({ method: 'modelSetup.choose_models', params: { action: 'choose_models', setupId: 's', models: [{ modelKey: 'm', kind: 'text' }] } })
    expect(route('nomi_model_setup', { action: 'check_connection', vendorKey: 'relay' }))
      .toEqual({ method: 'modelSetup.check_connection', params: { action: 'check_connection', vendorKey: 'relay' } })
    expect(route('nomi_model_setup', { action: 'show_models', vendorKey: 'relay', modelKeys: ['m'], visible: false }))
      .toEqual({ method: 'modelSetup.show_models', params: { action: 'show_models', vendorKey: 'relay', modelKeys: ['m'], visible: false } })
    expect(route('nomi_model_setup', { action: 'cancel', setupId: 's' }))
      .toEqual({ method: 'modelSetup.cancel', params: { action: 'cancel', setupId: 's' } })
    expect(route('nomi_await_setup', { setupId: 's' }))
      .toEqual({ method: 'modelSetup.await', params: { action: 'nomi_await_setup', setupId: 's' } })
    expect(route('nomi_remove_provider', { vendorKey: 'relay', ifUnchanged: 'fp_1' }))
      .toEqual({ method: 'modelSetup.remove_provider', params: { action: 'nomi_remove_provider', vendorKey: 'relay', ifUnchanged: 'fp_1' } })

    // 可撤销那一格里的 6 步全在一个工具上；不可逆那一步**不在**里面。
    const setupActions = ONBOARDING_VERBS.filter((verb) => verb.tool === 'nomi_model_setup').map((verb) => verb.action)
    expect(setupActions).toEqual(['connect_provider', 'choose_models', 'draft_adapter', 'check_connection', 'show_models', 'cancel'])
    expect(setupActions).not.toContain('remove_provider')
    // 花钱的动作一个都没有（09-11 拍板：自检免费）。
    expect(ONBOARDING_VERBS.some((verb) => (verb.effect as string) === 'spend')).toBe(false)
  })

  it('T15 nomi_project_create ≡ nomi_create_project', () => {
    expect(route('nomi_project_create', { name: 'demo' })).toEqual({ method: 'project.create', params: { name: 'demo' } })
    expect(route('nomi_project_create', {})).toEqual({ method: 'project.create', params: {} })
  })
})
