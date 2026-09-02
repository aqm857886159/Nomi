import { describe, it, expect } from 'vitest'
import { canvasReadResultSchema, projectCanvasRead } from '../shared/agentCapabilities/canvasRead'
import {
  buildCanonicalMcpToolResult,
  buildToolOutcome,
  buildToolErrorOutcome,
  buildProgressStartMessage,
} from './mcpToolResults'

describe('buildToolOutcome (A2 结果重写：转述原材料 + 参数回显)', () => {
  it('start_playbook：状态首行 + 参数回显 + 下一步；结构化字段齐 runId/nextActions', () => {
    const { text, outcome } = buildToolOutcome(
      'nomi_start_playbook',
      { projectId: 'p1', playbook: 'brand.promo', brief: { goal: '一条 60 秒品牌宣传片，主角小满', durationSeconds: 60 } },
      { runId: 'run_7f32', openInNomi: 'nomi://open/run_7f32' },
    )
    expect(text).toContain('✓')
    expect(text).toContain('run_7f32')
    expect(text).toContain('未花费')
    expect(text).toContain('brand.promo')
    expect(text).toContain('60s')
    expect(text).toContain('在 Nomi 打开 nomi://open/run_7f32')
    expect(outcome).toMatchObject({ kind: 'run_draft', runId: 'run_7f32', projectId: 'p1', nextActions: ['pick_direction'] })
  })

  it('get_run：状态翻成人话 + 预算行 + 下一步（en locale 全英文）', () => {
    const { text, outcome } = buildToolOutcome(
      'nomi_get_run',
      { projectId: 'p1', runId: 'run_1' },
      { runId: 'run_1', status: 'awaiting_contract', stageId: 'contract', budget: { authorized: 99.74, actual: 0 } },
      'en',
    )
    expect(text).toContain('awaiting budget approval')
    expect(text).toContain('budget cap 99.74')
    expect(text).toContain('approve the production contract')
    expect(outcome).toMatchObject({ kind: 'run_status', status: 'awaiting_contract', nextActions: ['approve_contract'] })
  })

  it('subscribe_run 空事件：明说「暂无」+ cursor；有事件逐行透出', () => {
    const empty = buildToolOutcome('nomi_subscribe_run', { runId: 'r' }, { events: [], nextCursor: 5 })
    expect(empty.text).toContain('暂无新的重要事件')
    expect(empty.text).toContain('next cursor 5')
    const some = buildToolOutcome('nomi_subscribe_run', { runId: 'r' }, {
      events: [{ type: 'gate.waiting', message: '等待预算批准' }], nextCursor: 6,
    })
    expect(some.text).toContain('gate.waiting · 等待预算批准')
    expect(some.outcome).toMatchObject({ eventCount: 1, nextCursor: 6 })
  })

  it('canvas.read text + structuredContent accept only the canonical safe result', () => {
    const canonical = projectCanvasRead({
      nodes: [{
        id: 'node-a', kind: 'image', title: 'A', position: { x: 1, y: 2 },
        result: { id: 'result-a', url: 'https://provider.invalid/a.png', providerTaskId: 'secret' },
      }],
      edges: [], groups: [], selectedNodeIds: ['node-a'],
    })
    const payload = buildCanonicalMcpToolResult(canvasReadResultSchema, canonical)

    expect(JSON.parse(payload.content[0]!.text)).toEqual(canonical)
    expect(payload.structuredContent).toEqual(canonical)
    expect(payload.content[0]!.text).not.toContain('provider.invalid')
    expect(() => buildCanonicalMcpToolResult(canvasReadResultSchema, {
      ...canonical,
      nodes: [{ ...canonical.nodes[0], url: 'https://provider.invalid/leak.png' }],
    })).toThrow()
  })
})

describe('nomi_list_models 转述（交付1：只有 keyStatus=ok 说可用 + 参考能力 + locale）', () => {
  const modelsResult = {
    models: [
      { vendor: 'apimart', modelKey: 'seedream', label: 'Seedream', kind: 'image', keyStatus: 'ok', statusReason: '已接入且可用', references: { image: true, video: false, audio: false, multiImage: true, referenceModes: ['image_edit'] } },
      { vendor: 'kie', modelKey: 'kie-x', label: 'Kie X', kind: 'video', keyStatus: 'missing', statusReason: '未配置 Kie 的 API Key；请先在 Nomi 应用的模型接入里填入', references: { image: false, video: false, audio: false, multiImage: false, referenceModes: [] } },
      { vendor: 'volcengine', modelKey: 'volc-y', label: '火山 Y', kind: 'image', keyStatus: 'locked', statusReason: '火山 的 API Key 已保存但当前宿主身份解不开；请在 Nomi 应用里重新保存该 Key', references: { image: false, video: false, audio: false, multiImage: false, referenceModes: [] } },
    ],
  }

  it('分组：可用（ok）与「已列出但不可用」（missing/locked）分开；只 ok 打 ✓', () => {
    const { text, outcome } = buildToolOutcome('nomi_list_models', {}, modelsResult)
    expect(text).toContain('可用模型 1 个')
    expect(text).toContain('apimart · seedream')
    expect(text).toContain('✓ 可用')
    // 不可用的照列，带缺口，不静默丢。
    expect(text).toContain('另有 2 个已列出但暂不可用')
    expect(text).toContain('kie · kie-x')
    expect(text).toContain('未配置 Kie')
    expect(text).toContain('volcengine · volc-y')
    expect(text).toContain('重新保存')
    // 参考能力点出来：seedream 多图 @image_edit。
    expect(text).toContain('参考:多图@image_edit')
    expect(outcome).toMatchObject({ kind: 'model_list', total: 3, usable: 1, nextActions: ['pick_model'] })
    // 结构化逐模型真话透传。
    const outModels = (outcome!.models as Array<Record<string, unknown>>)
    expect(outModels.find((m) => m.vendor === 'kie')!.keyStatus).toBe('missing')
  })

  it('en locale：分组标题与状态标签全英文（走 L(ctx,zh,en) 机制）', () => {
    const { text } = buildToolOutcome('nomi_list_models', {}, modelsResult, 'en')
    expect(text).toContain('1 usable model(s)')
    expect(text).toContain('usable')
    expect(text).toContain('listed but not usable')
    expect(text).toContain('no API key')
    expect(text).toContain('key locked')
    expect(text).toContain('refs:multi-image@image_edit')
    // 中文分组词不该出现在英文转述里。
    expect(text).not.toContain('可用模型')
  })

  it('全部无 key：明说去配 + nextActions=configure_api_key', () => {
    const { text, outcome } = buildToolOutcome('nomi_list_models', {}, {
      models: [{ vendor: 'kie', modelKey: 'x', label: 'X', kind: 'image', keyStatus: 'missing', statusReason: '未配置', references: { image: false, video: false, audio: false, multiImage: false, referenceModes: [] } }],
    })
    expect(text).toContain('无——请先配置 API Key')
    expect(outcome).toMatchObject({ usable: 0, nextActions: ['configure_api_key'] })
  })

  it('空清单：明说没有已启用模型', () => {
    const { text, outcome } = buildToolOutcome('nomi_list_models', {}, { models: [] })
    expect(text).toContain('没有已启用的模型')
    expect(outcome).toMatchObject({ kind: 'model_list', total: 0, usable: 0 })
  })
})

describe('nomi_control_run 诚实敞口（中转已提交≈收不回）', () => {
  it('pausing 且有在途任务：⚠ 报数量 + 会跑完并计费 + 自动落停；outcome 带 inFlightJobs', () => {
    const { text, outcome } = buildToolOutcome(
      'nomi_control_run',
      { projectId: 'p1', runId: 'run_1', action: 'pause' },
      { runId: 'run_1', status: 'pausing', jobs: [
        { jobId: 'j1', status: 'polling' },
        { jobId: 'j2', status: 'provider_accepted' },
        { jobId: 'j3', status: 'authorized' },
      ] },
    )
    expect(text).toContain('✓ 正在暂停')
    expect(text).toContain('⚠ 2 个已提交的任务无法撤回，会跑完并计费')
    expect(text).toContain('完成后自动落停')
    expect(text).toContain('未提交的任务不再提交、不计费')
    expect(outcome).toMatchObject({ kind: 'run_control', inFlightJobs: 2 })
  })

  it('paused 无在途：不出 ⚠ 行；cancel 有在途：⚠ 仍会计费', () => {
    const clean = buildToolOutcome('nomi_control_run', { runId: 'r', action: 'pause' }, { runId: 'r', status: 'paused', jobs: [] })
    expect(clean.text).toContain('✓ 已暂停')
    expect(clean.text).not.toContain('⚠')
    const cancelled = buildToolOutcome('nomi_control_run', { runId: 'r', action: 'cancel' }, {
      runId: 'r', status: 'cancelled', jobs: [{ jobId: 'j1', status: 'downloading' }],
    })
    expect(cancelled.text).toContain('⚠ 1 个已提交的任务无法撤回，会跑完并计费')
    expect(cancelled.text).toContain('已完成的产物保留在项目里')
  })
})

describe('buildToolErrorOutcome (A6 错误契约)', () => {
  it('已知错误码：人话原因 + 诊断码 + 恢复动作编号列表', () => {
    const { text, outcome } = buildToolErrorOutcome('nomi_start_generation', new Error('generate failed: renderer_or_provider_unknown'))
    expect(text).toContain('✗')
    expect(text).toContain('找不到能执行这次生成的渲染器或供应商配置')
    expect(text).toContain('诊断 renderer_or_provider_unknown')
    expect(text).toContain('1. ')
    expect(outcome).toMatchObject({ kind: 'error', errorCode: 'renderer_or_provider_unknown' })
    expect((outcome.recoveryActions as string[]).length).toBeGreaterThan(0)
  })

  it('未知错误：原样透传 message，不编造原因', () => {
    const { text, outcome } = buildToolErrorOutcome('nomi_start_generation', new Error('ECONNRESET boom'))
    expect(text).toContain('ECONNRESET boom')
    expect(outcome).toMatchObject({ errorCode: null, message: 'ECONNRESET boom' })
  })

  it('preserves typed generation policy codes in structured MCP outcomes', () => {
    const error = Object.assign(new Error('generation.single-shot phase_not_ready'), {
      code: 'phase_not_ready', nextAction: 'finish P0', phase: 'schema_only', capability: 'start',
    })
    const { outcome } = buildToolErrorOutcome('nomi_start_generation', error)
    expect(outcome).toMatchObject({
      kind: 'error', errorCode: 'phase_not_ready', nextAction: 'finish P0', phase: 'schema_only', capability: 'start',
    })
  })

  it.each([
    'capability_invocation_unverified',
    'capability_authority_invalid',
    'capability_input_invalid',
    'capability_policy_stale',
    'capability_output_invalid',
    'capability_timeout',
    'capability_cancelled',
    'capability_execution_failed',
    'project_identity_unavailable',
    'project_binding_stale',
    'surface_port_suspended',
    'surface_port_unavailable',
    'surface_port_stale',
    'surface_owner_mismatch',
  ])('preserves canonical canvas-read code %s without leaking a raw cause', (code) => {
    const privateCause = `/Users/private/${code}/provider-secret`
    const error = Object.assign(new Error(privateCause), { code })
    const { text, outcome } = buildToolErrorOutcome('nomi_canvas_read', error)

    expect(outcome).toMatchObject({ kind: 'error', errorCode: code, message: code })
    expect(text).not.toContain(privateCause)
    expect(JSON.stringify(outcome)).not.toContain(privateCause)
  })

  it('keeps established lease recovery projection unchanged', () => {
    const error = Object.assign(new Error('lease expired on this connection'), {
      code: 'lease_expired', nextAction: 'open a new project session', capability: 'project.session',
    })
    const { text, outcome } = buildToolErrorOutcome('nomi_canvas_read', error)

    expect(text).toContain('项目连接已过期，请重新选择当前项目')
    expect(outcome).toMatchObject({
      errorCode: 'lease_expired',
      message: 'lease expired on this connection',
      nextAction: 'open a new project session',
      nextActions: ['reselect_project'],
    })
  })

  it('turns authorization failures into one simple user action while retaining machine fields', () => {
    const error = Object.assign(new Error('A main-process receipt is required'), {
      code: 'human_approval_required', nextAction: 'nomi://settings/automation', phase: 'e1_paid', capability: 'gate_decide',
    })
    const { text, outcome } = buildToolErrorOutcome('nomi_decide_generation_gate', error)
    expect(text).toContain('请在 Nomi 确认这次生成')
    expect(text).not.toContain('human_approval_required')
    expect(outcome).toMatchObject({ errorCode: 'human_approval_required', nextActions: ['in_nomi'], nextAction: 'nomi://settings/automation' })
  })

  it('turns submission_unknown into reconcile-only user language', () => {
    const { text, outcome } = buildToolOutcome('nomi_get_run', { projectId: 'p1', runId: 'run-1' }, {
      runId: 'run-1', status: 'needs_attention', stageId: 'generate',
      budget: { authorized: 5, actual: 0 }, jobs: [{ jobId: 'job-1', status: 'submission_unknown' }],
    })
    expect(text).toContain('等待对账')
    expect(text).not.toContain('retry')
    expect(outcome).toMatchObject({ nextActions: ['wait_reconciliation'] })
    expect(outcome).toMatchObject({ recovery: { allowAutomaticRetry: false, allowNewAttempt: true, nextAction: 'manual_review' } })
  })

  it('keeps the recovery message in the requested locale', () => {
    const { text, outcome } = buildToolOutcome('nomi_get_run', { projectId: 'p1', runId: 'run-1' }, {
      runId: 'run-1', status: 'needs_attention', stageId: 'generate',
      budget: {}, jobs: [{ jobId: 'job-1', status: 'submission_unknown' }],
    }, 'en')
    expect(text).toContain('waiting for reconciliation')
    expect((outcome as Record<string, unknown>).recovery).toMatchObject({ profile: 'submit_only', nextAction: 'manual_review' })
  })
})

describe('buildProgressStartMessage (A1 起始帧参数回显)', () => {
  it('start_playbook：草稿 + playbook；其它工具 null', () => {
    expect(buildProgressStartMessage('nomi_start_playbook', { playbook: 'brand.promo' }))
      .toBe('正在创建制作草稿 · brand.promo')
    expect(buildProgressStartMessage('nomi_canvas_read', {})).toBeNull()
  })
})
