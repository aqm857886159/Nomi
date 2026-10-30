import { describe, it, expect } from 'vitest'
import { canvasReadResultSchema, projectCanvasRead } from '../shared/agentCapabilities/canvasRead'
import { safeRunProjection } from '../productionRun/productionRunProjections'
import type { ProductionRun } from '../productionRun/productionRunTypes'
import {
  buildCanonicalMcpToolResult,
  buildToolOutcome,
  buildToolErrorOutcome,
  buildProgressStartMessage,
} from './mcpToolResults'

describe('buildToolOutcome (A2 结果重写：转述原材料 + 参数回显)', () => {
  it('run_start：状态首行 + 参数回显 + 下一步；结构化字段齐 runId/nextActions', () => {
    const { text, outcome } = buildToolOutcome(
      'nomi_run_start',
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

  it('read target=run：状态翻成人话 + 预算行 + 下一步（en locale 全英文）', () => {
    const { text, outcome } = buildToolOutcome(
      'nomi_read',
      { target: 'run', projectId: 'p1', runId: 'run_1' },
      { runId: 'run_1', status: 'awaiting_contract', stageId: 'contract', budget: { authorized: 99.74, actual: 0 } },
      'en',
    )
    expect(text).toContain('awaiting budget approval')
    expect(text).toContain('budget cap 99.74')
    expect(text).toContain('approve the production contract')
    expect(outcome).toMatchObject({ kind: 'run_status', status: 'awaiting_contract', nextActions: ['approve_contract'] })
  })

  it('read target=run_events 空事件：明说「暂无」+ cursor；有事件逐行透出', () => {
    const empty = buildToolOutcome('nomi_read', { target: 'run_events', runId: 'r' }, { events: [], nextCursor: 5 })
    expect(empty.text).toContain('暂无新的重要事件')
    expect(empty.text).toContain('next cursor 5')
    const some = buildToolOutcome('nomi_read', { target: 'run_events', runId: 'r' }, {
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

describe('nomi_read target=models 转述（交付1：只有 keyStatus=ok 说可用 + 参考能力 + locale）', () => {
  const modelsResult = {
    models: [
      { vendor: 'apimart', modelId: 'seedream', label: 'Seedream', kind: 'image', usable: true, keyStatus: 'ok', statusReason: '已接入且可用', accepts: { image: true, video: false, audio: false, multiImage: true }, modeIds: ['image_edit'] },
      { vendor: 'kie', modelId: 'kie-x', label: 'Kie X', kind: 'video', keyStatus: 'missing', statusReason: '未配置 Kie 的 API Key；请先在 Nomi 应用的模型接入里填入', accepts: { image: false, video: false, audio: false, multiImage: false }, modeIds: [] },
      { vendor: 'volcengine', modelId: 'volc-y', label: '火山 Y', kind: 'image', keyStatus: 'locked', statusReason: '火山 的 API Key 已保存但当前宿主身份解不开；请在 Nomi 应用里重新保存该 Key', accepts: { image: false, video: false, audio: false, multiImage: false }, modeIds: [] },
    ],
  }

  it('分组：可用（ok）与「已列出但不可用」（missing/locked）分开；只 ok 打 ✓', () => {
    const { text, outcome } = buildToolOutcome('nomi_read', { target: 'models' }, modelsResult)
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
    const { text } = buildToolOutcome('nomi_read', { target: 'models' }, modelsResult, 'en')
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
    const { text, outcome } = buildToolOutcome('nomi_read', { target: 'models' }, {
      models: [{ vendor: 'kie', modelId: 'x', label: 'X', kind: 'image', keyStatus: 'missing', statusReason: '未配置', accepts: { image: false, video: false, audio: false, multiImage: false }, modeIds: [] }],
    })
    expect(text).toContain('无——请先配置 API Key')
    expect(outcome).toMatchObject({ usable: 0, nextActions: ['configure_api_key'] })
  })

  it('空清单：明说没有已启用模型', () => {
    const { text, outcome } = buildToolOutcome('nomi_read', { target: 'models' }, { models: [] })
    expect(text).toContain('没有已启用的模型')
    expect(outcome).toMatchObject({ kind: 'model_list', total: 0, usable: 0 })
  })
})

describe('nomi_run_control 诚实敞口（中转已提交≈收不回）', () => {
  it('pausing 且有在途任务：⚠ 报数量 + 会跑完并计费 + 自动落停；outcome 带 inFlightJobs', () => {
    const { text, outcome } = buildToolOutcome(
      'nomi_run_control',
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
    const clean = buildToolOutcome('nomi_run_control', { runId: 'r', action: 'pause' }, { runId: 'r', status: 'paused', jobs: [] })
    expect(clean.text).toContain('✓ 已暂停')
    expect(clean.text).not.toContain('⚠')
    const cancelled = buildToolOutcome('nomi_run_control', { runId: 'r', action: 'cancel' }, {
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
    // 2026-09-21：`phase_not_ready` 与 `phase` 随 env flag / 三段式 rollout 一起删除，
    // 换成仍在册的策略码。**同时新增一条阳性对照**：已删除的码不许再被当成策略码放行，
    // 否则删了一半（抛的那半没了、认的这半还在）会长出一份失真的清单。
    const error = Object.assign(new Error('generation.single-shot lease_required'), {
      code: 'lease_required', nextAction: 'Open a new project session and retry', capability: 'start',
    })
    const { outcome } = buildToolErrorOutcome('nomi_start_generation', error)
    expect(outcome).toMatchObject({
      kind: 'error', errorCode: 'lease_required', nextAction: 'Open a new project session and retry', capability: 'start',
    })
  })

  it.each(['feature_disabled', 'phase_not_ready'])(
    '已删除的 %s 不再被当成策略码（它抛不出来了，认它只会留下一份失真的清单）', (code) => {
      const error = Object.assign(new Error('some private cause'), { code, nextAction: 'x', capability: 'start' })
      const { outcome } = buildToolErrorOutcome('nomi_start_generation', error)
      expect(outcome).toMatchObject({ kind: 'error', errorCode: null })
      expect(outcome).not.toHaveProperty('phase')
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
    expect(text).toContain('这一步要你本人在 Nomi 里确认一次')
    expect(text).not.toContain('human_approval_required')
    expect(outcome).toMatchObject({ errorCode: 'human_approval_required', nextActions: ['in_nomi'], nextAction: 'nomi://settings/automation' })
  })

  it('turns submission_unknown into reconcile-only user language', () => {
    const { text, outcome } = buildToolOutcome('nomi_read', { target: 'run', projectId: 'p1', runId: 'run-1' }, {
      runId: 'run-1', status: 'needs_attention', stageId: 'generate',
      budget: { authorized: 5, actual: 0 }, jobs: [{ jobId: 'job-1', status: 'submission_unknown' }],
    })
    expect(text).toContain('等待对账')
    expect(text).not.toContain('retry')
    expect(outcome).toMatchObject({ nextActions: ['wait_reconciliation'] })
    expect(outcome).toMatchObject({ recovery: { allowAutomaticRetry: false, allowNewAttempt: true, nextAction: 'manual_review' } })
  })

  it('names the unknown shot and tells the agent not to generate it again (the user decides in the task center)', () => {
    const run = { runId: 'run-1', status: 'needs_attention', stageId: 'generate', budget: {}, jobs: [{ jobId: 'job-1', status: 'submission_unknown', metadata: { shotId: 'shot-1' } }] }
    const zh = buildToolOutcome('nomi_read', { target: 'run', projectId: 'p1', runId: 'run-1' }, run).text
    expect(zh).toContain('shot-1 结果未知，服务商可能已经收下；不要再调用 generate 生成它')
    expect(zh).toContain('请让用户去服务商后台核对，要不要重新生成由用户在任务中心决定')
    const en = buildToolOutcome('nomi_read', { target: 'run', projectId: 'p1', runId: 'run-1' }, run, 'en').text
    expect(en).toContain('shot-1: outcome unknown, the provider may have already received it; do not call generate for it again')
    expect(en).toContain('leave the decision to generate again to the user in the task center')
  })

  it('keeps the recovery message in the requested locale', () => {
    const { text, outcome } = buildToolOutcome('nomi_read', { target: 'run', projectId: 'p1', runId: 'run-1' }, {
      runId: 'run-1', status: 'needs_attention', stageId: 'generate',
      budget: {}, jobs: [{ jobId: 'job-1', status: 'submission_unknown' }],
    }, 'en')
    expect(text).toContain('waiting for reconciliation')
    expect((outcome as Record<string, unknown>).recovery).toMatchObject({ profile: 'submit_only', nextAction: 'manual_review' })
  })
})

describe('buildProgressStartMessage (A1 起始帧参数回显)', () => {
  it('start_playbook：草稿 + playbook；其它工具 null', () => {
    expect(buildProgressStartMessage('nomi_run_start', { playbook: 'brand.promo' }))
      .toBe('正在创建制作草稿 · brand.promo')
    expect(buildProgressStartMessage('nomi_read', { target: 'canvas' })).toBeNull()
  })
})

// Agent 读 Run 时读的是停下那一刻记下的原因（2026-09-29）：投影透出 stopReason（runStopReason），转述按它说。
// 以前 needs_attention 一律「有任务卡住了」，Agent 分不清是失败、预算还是重启后要核对。
describe('nomi_read target=run：停下的原因来自 Run 记下的事实', () => {
  const stoppedRun = (stop?: ProductionRun['stop']) => ({
    schemaVersion: 1, runId: 'run-stop', projectId: 'p1', revision: 3, status: 'needs_attention', stageId: 'generate',
    playbook: { name: 'generation.single-shot', version: '1' }, origin: { host: 'semantic-mcp' },
    budget: { currency: 'CNY', authorized: 0, reserved: 0, actual: 0, unsettled: 0, unknownInFlight: 0 },
    policy: {}, planVersion: 1, snapshotCursor: 3, stages: [], gates: [], jobs: [], artifacts: [],
    ...(stop ? { stop } : {}), createdAt: '2026-09-29T00:00:00.000Z', updatedAt: '2026-09-29T00:00:00.000Z',
  }) as unknown as ProductionRun

  it('a batch stopped because a shot failed says so, with the recorded reason in the outcome', () => {
    const projection = safeRunProjection(stoppedRun({ reason: 'failed', at: '2026-09-29T00:00:00.000Z' }))
    const { text, outcome } = buildToolOutcome('nomi_read', { target: 'run', projectId: 'p1', runId: 'run-stop' }, projection)
    expect(outcome).toMatchObject({ stopReason: 'failed' })
    expect(text).toContain('有镜头没生成成功')
    expect(text, '不是预算停下的，不说额度用完').not.toContain('额度用完')
  })

  it('an older run that stopped without a recorded reason is never described as a budget stop', () => {
    const projection = safeRunProjection(stoppedRun())
    const { text, outcome } = buildToolOutcome('nomi_read', { target: 'run', projectId: 'p1', runId: 'run-stop' }, projection, 'en')
    expect(outcome).toMatchObject({ stopReason: 'unknown' })
    expect(text).toContain('reason not recorded')
    expect(text, '没记原因就不猜成预算').not.toMatch(/budget used up/i)
  })
})

// Agent 只转述知道的数（2026-10-27）：账本合计只加已知价，算不出价的笔在另一根轴上，实付从不回写。
// 投影（knownRunBudget）把「不知道」给成 null，这里只核转述：null 就不写钱、不写 0；结构化结果同样是 null。
describe('nomi_read / nomi_run_control：预算只报知道的数', () => {
  const at = '2026-10-27T00:00:00.000Z'
  const approvedGate = (unknownJobCount: number) => ({
    gateId: 'gate-generate-v1', scope: 'budget_envelope', status: 'approved', planHash: 'h', title: 'Approve', summary: 'Approve the shots',
    jobIds: ['job-1'], createdAt: at, expiresAt: '2099-01-01T00:00:00.000Z', decidedAt: at,
    authorizationEnvelope: { budget: { currency: 'CNY', maximum: 0, ledgerCeiling: 0, unknownJobCount } },
  })
  const run = (budget: Partial<ProductionRun['budget']>, gates: unknown[] = []) => ({
    schemaVersion: 1, runId: 'run-money', projectId: 'p1', revision: 4, status: 'running', stageId: 'generate',
    playbook: { name: 'generation.single-shot', version: '1' }, origin: { host: 'semantic-mcp' },
    budget: { currency: 'CNY', authorized: 0, reserved: 0, actual: 0, unsettled: 0, unknownInFlight: 0, ...budget },
    policy: {}, planVersion: 1, snapshotCursor: 4, stages: [], gates, jobs: [], artifacts: [], createdAt: at, updatedAt: at,
  }) as unknown as ProductionRun
  const read = (value: ProductionRun, locale?: 'en') =>
    buildToolOutcome('nomi_read', { target: 'run', projectId: 'p1', runId: 'run-money' }, safeRunProjection(value), locale)
  const ZH_MONEY = /预算上限|已花费/
  const EN_MONEY = /budget cap|spent -?\d/

  it('批过算不出价的镜头、在途：中英转述都不写钱也不写 0，结构化结果给 null', () => {
    const unknown = run({ unknownInFlight: 1 }, [approvedGate(1)])
    const zh = read(unknown)
    const en = read(unknown, 'en')
    expect(zh.text).not.toMatch(ZH_MONEY)
    expect(en.text).not.toMatch(EN_MONEY)
    expect(zh.outcome).toMatchObject({ budget: { authorized: null, actual: null } })
  })

  it('已知价、还有预留中的笔：只报上限，不报已花费', () => {
    const { text, outcome } = read(run({ authorized: 12, reserved: 8 }, [approvedGate(0)]))
    expect(text).toContain('预算上限 12')
    expect(text).not.toContain('已花费')
    expect(outcome).toMatchObject({ budget: { authorized: 12, actual: null } })
  })

  it('已知价且每一笔都落定：照报两个数', () => {
    const { text, outcome } = read(run({ authorized: 12, actual: 7 }, [approvedGate(0)]), 'en')
    expect(text).toContain('budget cap 12')
    expect(text).toContain('spent 7')
    expect(outcome).toMatchObject({ budget: { authorized: 12, actual: 7 } })
  })

  it('草稿什么都没批：0 是真数，照报', () => {
    const { outcome } = read(run({}))
    expect(outcome).toMatchObject({ budget: { authorized: 0, actual: 0 } })
  })

  it('暂停一个有未知价在途的 Run：回执不写已花费，结构化结果给 null', () => {
    const projection = safeRunProjection(run({ authorized: 12, reserved: 8, unknownInFlight: 1 }, [approvedGate(1)]))
    const zh = buildToolOutcome('nomi_run_control', { action: 'pause', projectId: 'p1', runId: 'run-money' }, projection)
    const en = buildToolOutcome('nomi_run_control', { action: 'pause', projectId: 'p1', runId: 'run-money' }, projection, 'en')
    expect(zh.text).not.toMatch(ZH_MONEY)
    expect(en.text).not.toMatch(EN_MONEY)
    expect(zh.outcome).toMatchObject({ kind: 'run_control', budget: { actual: null } })
  })
})


describe('model list summary preserves authoritative row usability', () => {
  it.each(['en', 'zh-CN'] as const)('does not count key-ok but unusable models in %s', locale => {
    const models = [
      { vendor: 'ready', modelId: 'usable', label: 'Ready', kind: 'image', usable: true, keyStatus: 'ok', statusReason: 'ready' },
      { vendor: 'unsupported', modelId: 'blocked', label: 'Unsupported', kind: 'text', usable: false, keyStatus: 'ok', statusReason: 'platform_unsupported' },
    ]
    const { text, outcome } = buildToolOutcome('nomi_read', { target: 'models' }, { models }, locale)
    expect(outcome).toMatchObject({ total: 2, usable: 1 })
    expect(outcome!.models).toEqual(models)
    expect(text?.split('\n').find(line => line.includes('unsupported · blocked'))).toContain('✗')
  })
  it('does not infer missing usability evidence from key status', () => {
    const { outcome } = buildToolOutcome('nomi_read', { target: 'models' }, {
      models: [{ vendor: 'unknown', modelId: 'missing-evidence', keyStatus: 'ok' }],
    }, 'en')
    expect(outcome).toMatchObject({ usable: 0 })
  })
})
