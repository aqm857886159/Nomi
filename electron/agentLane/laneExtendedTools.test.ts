import { describe, expect, it } from 'vitest'
import { createExtendedLaneTools } from './laneExtendedTools'
import { z } from 'zod'
import { flattenDiscriminatedUnion, ConflictingBranchField } from '../shared/agentCapabilities/flatModelInput'
import { modelToolCapabilityId } from '../shared/agentCapabilities/modelFacingTools'
import { timelineEditPlanModelSchema } from '../shared/agentCapabilities/timelineRead'
import { collectVendorCompatibilityFailures, toPublishedJsonSchema } from '../shared/agentCapabilities/modelVisibleJsonSchema'
import { modelFacingToolSpecs } from '../shared/agentCapabilities/modelFacingToolRegistry'
import { LANE_MODEL_TOOL_CATALOG, LANE_TOOL_BUDGET, LANE_DEFERRED_TOOL_CATALOG, LANE_DEFERRED_TOOL_GROUPS } from './laneToolCatalog'
import { VERB_DECLARATIONS } from '../shared/agentCapabilities/verbDeclarations'
import { objectFieldKeys } from '../shared/agentCapabilities/verbs/verbProjections'
import {
  LANE_TOOL_NEXT_ACTION_REFS, renderLaneToolNextAction, type LaneToolNextAction,
} from '../shared/agentLane/laneToolNextAction'

const preserved = ['edit_timeline', 'undo', 'export_video',
  'make_artifact', 'stage_shot', 'draft_shots', 'check_job',
  'look_at_media', 'cancel_job', 'delete_from_canvas']

describe('lane extended domain menu', () => {
  it('retains editing, production and media intents in the shared internal profile', () => {
    expect(modelFacingToolSpecs('internal').map(tool => tool.name)).toEqual(expect.arrayContaining(preserved))
  })
  it('keeps the initial menu inside the unchanged budget', () => {
    expect(LANE_TOOL_BUDGET).toBe(12)
    expect(LANE_MODEL_TOOL_CATALOG.length).toBeLessThan(LANE_TOOL_BUDGET)
  })
})


it('every retained tool belongs to exactly one unlockable group', () => {
  const names = LANE_DEFERRED_TOOL_GROUPS.flatMap(group => group.toolNames)
  expect(new Set(names).size).toBe(names.length)
  expect(names.sort()).toEqual(LANE_DEFERRED_TOOL_CATALOG.map(tool => tool.name).sort())
  expect(names.every(name => !LANE_MODEL_TOOL_CATALOG.some(tool => tool.name === name))).toBe(true)
})

it('production parameter preparation preserves run/artifact identity and revision', () => {
  const spec = LANE_DEFERRED_TOOL_CATALOG.find(tool => tool.name === 'draft_shots')!
  const args = { shots: [{ prompt: 'Fixture shot', taskKind: 'text_to_image' }] }
  expect(spec.schema.parse(spec.prepareArguments!(JSON.stringify(args)))).toEqual(args)
})

it('generation read operations have read authority while cancel and reconcile remain writes', () => {
  // check_job 按生成组延迟披露（与 draft_shots / generate 同组）。
  const status = LANE_DEFERRED_TOOL_CATALOG.find(tool => tool.name === 'check_job')!
  expect(modelToolCapabilityId(status, {})).toBe('generation.run.read')
})

it('published timeline operations have no const and still enforce their original branch', () => {
  const failures: string[] = []
  collectVendorCompatibilityFailures(toPublishedJsonSchema(timelineEditPlanModelSchema), '', failures)
  expect(failures).toEqual([])
  const plan = { planId: 'plan-1', baseRevision: 'revision-1', summary: 'Edit timeline' }
  expect(timelineEditPlanModelSchema.safeParse({ ...plan, operations: [{ kind: 'move', clipId: 'clip-1', startFrame: 0 }] }).success).toBe(true)
  expect(timelineEditPlanModelSchema.safeParse({ ...plan, operations: [{ kind: 'move', clipId: 'clip-1', action: 'remove', startFrame: 0 }] }).success).toBe(false)
})

it('enum merging is opt-in and never relaxes the source branch constraints', () => {
  const schema = z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('first'), action: z.enum(['one']) }).strict(),
    z.object({ kind: z.literal('second'), action: z.enum(['two']) }).strict(),
  ])
  expect(() => flattenDiscriminatedUnion(schema, { name: 'test' })).toThrow(ConflictingBranchField)
  const flat = flattenDiscriminatedUnion(schema, { name: 'test', mergeEnumFields: ['action'] })
  expect(flat.safeParse({ kind: 'first', action: 'one' }).success).toBe(true)
  expect(flat.safeParse({ kind: 'first', action: 'two' }).success).toBe(false)
  const conflict = z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('first'), action: z.string() }),
    z.object({ kind: z.literal('second'), action: z.number() }),
  ])
  expect(() => flattenDiscriminatedUnion(conflict, { name: 'test', mergeEnumFields: ['action'] })).toThrow(ConflictingBranchField)
})

// 2026-09-14：域端口的失败 message 必须到得了模型。常驻生成面的 owner 会把「为什么不在」说清楚
//（按配置关掉 / 还在起 / 装配抛了），这一层若只转发 code，模型仍只能对用户说「暂时不可用」。
describe('domain failure message reaches the model', () => {
  const signal = new AbortController().signal
  const run = async (decision: { ok: false; code: string; message?: string }) => {
    // 20 动词面：读一个任务的动词叫 `check_job`（旧的 `nomi_generation_status` 已退役）。
    // 入参先过它自己的 schema，所以这里给的是 `jobId`，不是旧契约的 operation/operationId。
    const tool = createExtendedLaneTools({ execute: async () => decision }).find(candidate => candidate.name === 'check_job')!
    return tool.execute({ jobId: 'run-1' }, { toolCallId: 'call-1', signal }) as Promise<{ ok: boolean; failure?: { code: string; message: string } }>
  }
  it('forwards a message that says more than the code', async () => {
    const result = await run({ ok: false, code: 'generation_surface_unavailable', message: "Nomi's resident generation surface is still starting; retry this step in a moment." })
    expect(result.ok).toBe(false)
    expect(result.failure).toMatchObject({ code: 'generation_surface_unavailable', message: expect.stringMatching(/\(generation_surface_unavailable\)\. Nomi's resident generation surface is still starting/) })
  })
  it('does not repeat a message that is only the code', async () => {
    const result = await run({ ok: false, code: 'capability_unsupported', message: 'capability_unsupported' })
    expect(result.failure?.message).toBe('check_job could not complete the requested action (capability_unsupported).')
  })
})

// ── T-ED-02：回执必须从**真实的审批结论**派生，不许照静态表抄 ──────────────────
//
// 2026-09-12 真实会话：用户让 Agent 把素材「劈成两半」，模型回「请在确认卡里批准」，
// 槽里一张卡都没有。成因是这一层对 `edit_timeline` 无条件回 `user_sees_review_card` ——
// 而闸跑在 `before_tool`，回执写出来的那一刻，卡要么早被答完、要么这一档压根没出过。
describe('工具回执从真实审批结论派生', () => {
  const signal = new AbortController().signal
  const runVerb = async (
    name: string, result: unknown, approvalDecision?: 'auto-granted' | 'granted-once' | 'granted-session',
    args: Record<string, unknown> = {},
  ) => {
    const tool = createExtendedLaneTools({ execute: async () => ({ ok: true, result }) })
      .find(candidate => candidate.name === name)!
    return tool.execute(tool.schema.parse(args), {
      toolCallId: 'call-1', signal, ...(approvalDecision ? { approvalDecision } : {}),
    }) as Promise<{ ok: boolean; nextAction?: { kind: string; userSees: string; jobId?: string } }>
  }

  const editArgs = {
    baseRevision: 'revision-1', summary: '劈成两半',
    operations: [{ kind: 'split', clipId: 'clip-1', atFrame: 30 }],
  }

  it('自动放行的那一档：回执说「已经应用」，绝不提一张不存在的卡', async () => {
    const outcome = await runVerb('edit_timeline', { undoToken: 'undo-1' }, 'auto-granted', editArgs)
    expect(outcome.nextAction?.kind).toBe('none')
    expect(outcome.nextAction?.userSees).toMatch(/applied directly/)
    // 「没有卡在等你」可以说；「一张卡在问你」不许说——后者正是 2026-09-12 那句话。
    expect(outcome.nextAction?.userSees).toMatch(/no card is waiting/)
    expect(outcome.nextAction?.userSees).not.toMatch(/card asks|review card/)
  })

  it('用户答过卡的那一档：回执说「他批了、已经应用」，同样不说「有卡在等你」', async () => {
    const outcome = await runVerb('edit_timeline', { undoToken: 'undo-1' }, 'granted-once', editArgs)
    expect(outcome.nextAction?.kind).toBe('none')
    expect(outcome.nextAction?.userSees).toMatch(/approved the review card/)
    expect(outcome.nextAction?.userSees).toMatch(/now applied/)
  })

  // 真实测试 ④：撤销一笔 3D-BOX 画布改动，回执却说「时间线回去了」。同一个动词撤两种面，回执跟 changeId 前缀走。
  it('撤销的回执说的是被撤的那一面', async () => {
    const canvas = await runVerb('undo', { operation: 'undo_timeline_edit', ok: true, undone: true, revision: 'r-1', changeId: 'canvas:v1:receipt-1' }, 'auto-granted', { changeId: 'canvas:v1:receipt-1' })
    expect(canvas.nextAction?.userSees).toMatch(/^The canvas is back/)
    expect(canvas.nextAction?.userSees).not.toMatch(/timeline/)
    const timeline = await runVerb('undo', { operation: 'undo_timeline_edit', ok: true, undone: true, revision: 'r-1', changeId: 'timeline:v1:receipt-2' }, 'auto-granted', { changeId: 'timeline:v1:receipt-2', expectedRevision: 'r-2' })
    expect(timeline.nextAction?.userSees).toBe('The timeline is back to before that change.')
  })

  it('不可逆动词的 kind 也从结论取：没出过卡就不说出过', async () => {
    const confirmed = await runVerb('delete_from_canvas', {}, 'granted-once', { nodeIds: ['node-1'] })
    expect(confirmed.nextAction?.kind).toBe('user_sees_confirm_card')
    const silent = await runVerb('delete_from_canvas', {}, 'auto-granted', { nodeIds: ['node-1'] })
    expect(silent.nextAction?.kind).toBe('none')
    expect(silent.nextAction?.userSees).not.toMatch(/confirmed/)
  })

  it('全自动档代答的 generate 已经开跑：不许再把模型停在一张不存在的报价卡上', async () => {
    const outcome = await runVerb('generate', {
      drafted: { operation: { operationId: 'op-7' } },
      spendDecision: { decidedBy: 'policy:full_auto', receiptId: 'receipt-1' },
      started: { ok: true },
    }, 'auto-granted', { operationId: 'op-7' })
    expect(outcome.ok).toBe(true)
    expect(outcome.nextAction?.kind).toBe('job_running')
    expect(outcome.nextAction?.jobId).toBe('op-7')
    expect(outcome.nextAction?.userSees).toMatch(/generation has started/)
  })

  it.each(['document-create', 'document-patch', 'canvas-create'])('%s reports saved draft facts without inventing placement', async kind => {
    const result = { operation: { operationId: 'op-draft', state: 'draft',
      ...(kind.startsWith('document') ? { sourceDocumentId: 'doc-1' } : {}) } }
    const args = { shots: [{ prompt: 'saved prompt' }],
      ...(kind === 'document-patch' ? { operationId: 'op-draft' } : {}) }
    const outcome = await runVerb('draft_shots', result, 'auto-granted', args)
    expect(outcome.ok).toBe(true)
    expect(outcome.nextAction).toMatchObject({ kind: 'none', operationId: 'op-draft' })
    expect(outcome.nextAction?.userSees).toMatch(/saved in the project/)
    expect(outcome.nextAction?.userSees).not.toMatch(/are on the canvas|price badge|generation has started/)
  })

  it('a draft patch reports actual policy-started spend through the same receipt as generate', async () => {
    const result = { drafted: { operation: { operationId: 'op-7', sourceDocumentId: 'doc-1' } },
      spendDecision: { decidedBy: 'policy:full_auto', receiptId: 'receipt-1' }, started: { ok: true } }
    const generated = await runVerb('generate', result, 'auto-granted', { operationId: 'op-7' })
    const patched = await runVerb('draft_shots', result, 'auto-granted', { operationId: 'op-7', shots: [{ prompt: 'updated' }] })
    expect(patched.nextAction).toMatchObject({ kind: 'job_running', jobId: 'op-7', operationId: 'op-7' })
    expect(patched.nextAction?.userSees).toBe(generated.nextAction?.userSees)
    expect(patched.nextAction?.userSees).not.toMatch(/nothing has been spent/)
  })

  it('a presented draft patch reports only saved facts when transport returns no new spend decision', async () => {
    const outcome = await runVerb('draft_shots', { operation: { operationId: 'op-7', state: 'draft' } },
      'auto-granted', { operationId: 'op-7', shots: [{ prompt: 'updated' }] })
    expect(outcome.nextAction).toMatchObject({ kind: 'none', operationId: 'op-7' })
    expect(outcome.nextAction?.userSees).toMatch(/saved in the project/)
    expect(outcome.nextAction?.userSees).not.toMatch(/call generate|no card|generation has started/)
  })

  it('historical submitted state without a current spendDecision does not claim this edit started generation', async () => {
    const outcome = await runVerb('draft_shots', { operation: { operationId: 'op-7', state: 'submitted' } },
      'auto-granted', { operationId: 'op-7', shots: [{ prompt: 'updated' }] })
    expect(outcome.nextAction).toMatchObject({ kind: 'none', operationId: 'op-7' })
    expect(outcome.nextAction?.userSees).not.toMatch(/generation has started|nothing has been spent/)
  })

  // 2026-09-22 裁决 A：等用户住在预检期，`generate` 返回时用户**已经答完了**。三种结局都是成功形状——
  // 错误形状会让模型重试、进熔断、向用户报「出错了」，对一个「他说不」或「他想先改一下」三样都是错的。
  it.each([
    ['approved', { outcome: 'approved' }, 'job_running', /generation has started/],
    // 2026-09-22 下午用户拍板改窄：× 收回的是这一次出价，草稿留着——回执必须这么说，
    // 否则模型会替他重新起草一份（旧文案「closed for good / draft the shots again」正是那个）。
    ['declined', { outcome: 'declined' }, 'none', /withdrew this quote, not the draft/],
    ['redirected', { outcome: 'redirected', userSaid: '第二镜改成竖版' }, 'none', /第二镜改成竖版/],
  ] as const)('用户在报价卡上 %s → 成功形状的回执，照实说', async (_name, userDecision, kind, says) => {
    const outcome = await runVerb('generate', { operation: { operationId: 'op-7' }, nextAction: 'await_user', userDecision },
      'auto-granted', { operationId: 'op-7' })
    expect(outcome.ok, '「用户没同意」不是错误').toBe(true)
    expect(outcome.nextAction).toMatchObject({ kind })
    expect(outcome.nextAction?.userSees).toMatch(says)
    if (userDecision.outcome !== 'approved') expect(outcome.nextAction?.userSees).toMatch(/[Nn]othing was (generated|spent)/)
  })
})

// ── 宿主拼给模型看的那一行，用的必须是模型真能填的字段名（2026-09-18 第三刀）──────────────
//
// 工具结果的末行是**宿主替模型写的**：`User sees: … (changeId=timeline:v1:undo-1)`。它的作用是告诉模型
// 「下一步要填的那个值在这里」。所以那一行里出现的每个名字，都必须是某个动词 schema 上**真的有**
// 的字段——否则模型照着填就是一个未知字段，照着不填就得自己猜。
//
// 这条曾经抓到过：`edit_timeline` 的末行印 `changeId=`，而 `undo` 收的字段却叫 `undoToken`；
// `draft_shots` 的末行把草稿 id 印成 `jobId=`，而下一步 `draft_shots` / `generate` 要求填 `operationId`。
// 断言里没有写死任何期望名字——期望值从注册表里的动词 schema 取，动词改名这两条自己跟着走。
describe('工具结果末行里的引用名 = 模型下一步真能填的字段名', () => {
  const signal = new AbortController().signal
  const fieldsOf = (verb: string): readonly string[] =>
    objectFieldKeys(VERB_DECLARATIONS.find(declaration => declaration.name === verb)!.schema, `verb ${verb}`)
  /** 末行里 `name=value` 那几个引用名（`User sees:` 那句人话不参与）。 */
  const refNamesOf = (next: LaneToolNextAction): string[] =>
    [...renderLaneToolNextAction(next).matchAll(/([A-Za-z][A-Za-z0-9_]*)=/g)].map(match => match[1]!)

  const nextActionOf = async (name: string, result: unknown, args: Record<string, unknown>) => {
    const tool = createExtendedLaneTools({ execute: async () => ({ ok: true, result }) })
      .find(candidate => candidate.name === name)!
    const outcome = await tool.execute(tool.schema.parse(args), { toolCallId: 'call-1', signal, approvalDecision: 'auto-granted' }) as
      { nextAction?: LaneToolNextAction }
    return outcome.nextAction!
  }

  it('edit_timeline 的正文已带 canonical changeId，尾行不重复同一句柄', async () => {
    const next = await nextActionOf('edit_timeline', { changeId: 'timeline:v1:undo-1' }, {
      baseRevision: 'revision-1', summary: '劈成两半', operations: [{ kind: 'split', clipId: 'clip-1', atFrame: 30 }],
    })
    expect(renderLaneToolNextAction(next)).not.toContain('changeId=timeline:v1:undo-1')
  })

  it('draft_shots 交回的草稿 id，名字就是 draft_shots 与 generate 收的那个字段', async () => {
    const next = await nextActionOf('draft_shots', { operation: { operationId: 'op-7' } }, {
      shots: [{ prompt: '海上日出' }],
    })
    const rendered = renderLaneToolNextAction(next)
    const named = refNamesOf(next).filter(name => rendered.includes(`${name}=op-7`))
    expect(named.length).toBeGreaterThan(0)
    for (const name of named) {
      expect(fieldsOf('draft_shots')).toContain(name)
      expect(fieldsOf('generate')).toContain(name)
    }
  })

  it('末行支持的每个引用名，都至少有一个动词真的收它（不许留一个没人要的名字）', () => {
    const everyVerbField = new Set(VERB_DECLARATIONS.flatMap(declaration => fieldsOf(declaration.name)))
    for (const name of LANE_TOOL_NEXT_ACTION_REFS) expect([...everyVerbField]).toContain(name)
  })
})
