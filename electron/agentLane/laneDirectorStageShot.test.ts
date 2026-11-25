// `stage_shot`（3D-BOX，唯一导演台）的 lane 绑定：参数 → director.write 语义输入；领域拒绝 → 模型读得懂的失败；
// 成功收据带修订号、实测 cut、预演状态与下一次补丁的基准计划。工具轨迹在这里用假 port 钉住；真实模型的
// 端到端回合是门槛 ①，不在单测里冒充。
import { describe, expect, it } from 'vitest'
import { createCanvasLaneTools } from './laneCanvasTools'
import type { DirectorWriteInput, DirectorWriteResult } from '../shared/agentCapabilities/directorWrite'
import { parseDirectorPlan } from '../shared/director/directorPlanSchema'
import { applyDirectorPlanEdits, directorPlanRevision } from '../shared/director/planPatch'

const PLAN = {
  scene: { environment: 'day', template: 'room', tags: ['书房'] },
  actors: [
    { id: 'reader', kind: 'person', desc: '读者', placement: { relation: 'at', ref: 's1-room-floor' } },
    { id: 'friend', kind: 'person', desc: '朋友', placement: { relation: 'in_front_of', ref: 'reader' } },
  ],
  shots: [{ id: 'wide', window: [0, 3], transitionIn: 'cut', subject: 'reader', size: '全景', angle: 'front', height: 'eye', move: { kind: 'static' } }],
}

async function stageShotTool(write: (input: DirectorWriteInput) => DirectorWriteResult) {
  const seen: DirectorWriteInput[] = []
  const tools = createCanvasLaneTools({
    read: async () => ({ nodes: [], edges: [], groups: [], selectedNodeIds: [] }),
    write: async () => { throw new Error('canvas.write must not be used for stage_shot') },
    writeDirector: async (input) => { seen.push(input); return write(input) },
  })
  const tool = tools.find((candidate) => candidate.name === 'stage_shot')
  if (!tool) throw new Error('stage_shot not assembled')
  return { tool, seen }
}

const context = { toolCallId: 'call-1', signal: new AbortController().signal }

function applied(overrides: Partial<Extract<DirectorWriteResult, { applied: true }>> = {}): DirectorWriteResult {
  return {
    applied: true, proposalId: 'prop-1', changeId: 'canvas:v1:prop-1', operation: 'create_director_plan', directorNodeId: 'node-d1',
    revision: 'dplan-0123456789abcdef', unchanged: false, plan: PLAN, issues: [], cuts: [{ shot: 'wide', start: 0, end: 3, shotSize: '全景', move: 'static' }],
    touched: ['shot:wide'], reorderedOverrides: [], changedEntities: [], preview: { status: 'rendering', targetNodeId: 'node-v1' }, ...overrides,
  }
}

describe('stage_shot (3D-BOX) lane binding', () => {
  it('turns a create call into create_director_plan for the shot and reports revision, cuts and preview', async () => {
    const { tool, seen } = await stageShotTool(() => applied())
    const args = tool.prepareArguments ? tool.prepareArguments({ target: { shotId: 'node-v1' }, plan: PLAN }) : { target: { shotId: 'node-v1' }, plan: PLAN }
    const outcome = await tool.execute(args, context)
    expect(seen[0]).toMatchObject({ operation: 'create_director_plan', shotNodeId: 'node-v1' })
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.text).toContain('revision dplan-0123456789abcdef')
    expect(outcome.text).toContain('- shot 1 (wide) 0.0-3.0s: measured 全景, move static; plan asked 全景, matches')
    expect(outcome.text).toContain('Preview: rendering for node-v1')
    expect(outcome.text).toContain('"shots"')
    expect(outcome.nextAction).toMatchObject({ kind: 'none', changeId: 'canvas:v1:prop-1' })
  })

  it('turns an edit call into patch_director_plan and says unchanged when the plan already says it', async () => {
    const { tool, seen } = await stageShotTool(() => applied({ operation: 'patch_director_plan', unchanged: true, touched: [] }))
    const outcome = await tool.execute({ target: { directorNodeId: 'node-d1' }, baseRevision: 'dplan-0123456789abcdef', edits: [{ op: 'replace', path: '/shots/wide/size', value: '全景' }] }, context)
    expect(seen[0]).toMatchObject({ operation: 'patch_director_plan', directorNodeId: 'node-d1', baseRevision: 'dplan-0123456789abcdef' })
    expect(outcome.ok && outcome.text).toMatch(/^Unchanged: the plan already says this/)
  })

  // 真实测试 ④（DeepSeek）：计划要特写、实测近景，模型把计划里的 size 当实测复述成「特写（实测）」；被覆盖的手调收据里根本没有。
  it('puts measured framing next to the requested size and names the hand adjustments the edit replaced', async () => {
    const plan = { ...PLAN, shots: [PLAN.shots[0], { ...PLAN.shots[0], id: 'close', window: [3, 6], size: '特写' }] }
    const { tool } = await stageShotTool(() => applied({
      operation: 'patch_director_plan', plan,
      cuts: [{ shot: 'wide', start: 0, end: 3, shotSize: '全景', move: 'static' }, { shot: 'close', start: 3, end: 6, shotSize: '近景', move: 'push_in' }],
      reorderedOverrides: ['shot:close/camera.position'], changedEntities: ['actor:friend'],
    }))
    const outcome = await tool.execute({ target: { directorNodeId: 'node-d1' }, baseRevision: 'dplan-0123456789abcdef', edits: [{ op: 'replace', path: '/shots/close/size', value: '特写' }] }, context)
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.text).toContain('- shot 2 (close) 3.0-6.0s: measured 近景, move push_in; plan asked 特写, measured differs — say so')
    expect(outcome.text).toContain('Hand adjustments REPLACED by this edit: shot 2 (close) camera position.')
    expect(outcome.text).toContain('undo brings them back')
    expect(outcome.text).toContain('undo with changeId canvas:v1:prop-1')
    expect(outcome.text).toContain('Also moved by recompiling (the user\'s hand adjustments there are kept): actor:friend.')
    expect(outcome.text).toContain('"size" fields are REQUESTS, not measurements')
  })

  it('renders a stale revision as a failure that names the current revision', async () => {
    const { tool } = await stageShotTool(() => ({ applied: false, proposalId: 'prop-2', operation: 'patch_director_plan', rejected: 'stale_revision', messages: ['old'], currentRevision: 'dplan-ffffffffffffffff' }))
    const outcome = await tool.execute({ target: { directorNodeId: 'node-d1' }, baseRevision: 'dplan-0123456789abcdef', edits: [{ op: 'remove', path: '/shots/wide' }] }, context)
    expect(outcome.ok).toBe(false)
    if (outcome.ok) return
    expect(outcome.failure.code).toBe('capability_target_stale')
    expect(outcome.failure.message).toContain('dplan-ffffffffffffffff')
  })

  it('rejects a plan that references undefined names before anything is sent', async () => {
    const { tool } = await stageShotTool(() => applied())
    const broken = { ...PLAN, shots: [{ ...PLAN.shots[0], subject: 'stranger' }] }
    expect(() => tool.prepareArguments?.({ plan: broken })).toThrow(/never defines/)
  })

  it('refuses plan together with an existing node and edits without a revision', async () => {
    const { tool } = await stageShotTool(() => applied())
    expect(tool.schema.safeParse({ target: { directorNodeId: 'node-d1' }, plan: PLAN }).success).toBe(false)
    expect(tool.schema.safeParse({ target: { directorNodeId: 'node-d1' }, edits: [{ op: 'remove', path: '/shots/wide' }] }).success).toBe(false)
    expect(tool.schema.safeParse({ plan: PLAN }).success).toBe(true)
  })
})

describe('stage_shot edits schema ↔ applyDirectorPlanEdits (NF-1107-0003 / NF-1029-0001)', () => {
  const basePlan = (() => {
    const parsed = parseDirectorPlan(PLAN)
    if (!parsed.success) throw new Error('test fixture PLAN must be valid')
    return parsed.data
  })()
  const baseRevision = directorPlanRevision(basePlan)

  async function parseAndApply(edits: ReadonlyArray<{ op: 'add' | 'remove' | 'replace'; path: string; value?: unknown }>) {
    const { tool } = await stageShotTool(() => applied())
    const parsedArgs = tool.schema.safeParse({
      target: { directorNodeId: 'node-d1' },
      baseRevision,
      edits,
    })
    return { parsedArgs, tool }
  }

  it('accepts a full camera move object at /shots/<id>/move without dropping fields (NF-1029-0001)', async () => {
    const { parsedArgs } = await parseAndApply([
      { op: 'replace', path: '/shots/wide/move', value: { kind: 'pan', direction: 'left' } },
    ])
    expect(parsedArgs.success).toBe(true)
    if (!parsedArgs.success) return
    expect(parsedArgs.data.edits?.[0]?.value).toEqual({
      kind: 'pan',
      direction: 'left',
      speed: 'medium',
      easing: 'linear',
    })
    const patched = applyDirectorPlanEdits(basePlan, parsedArgs.data.edits!)
    expect(patched.ok).toBe(true)
    if (!patched.ok) return
    expect(patched.plan.shots[0]?.move).toEqual({
      kind: 'pan',
      direction: 'left',
      speed: 'medium',
      easing: 'linear',
    })
  })

  it('accepts full camera move with amount/speed/easing, field-level /window and /move/kind, and angle object', async () => {
    const moveRes = await parseAndApply([
      { op: 'replace', path: '/shots/wide/move', value: { kind: 'orbit_right', direction: 'right', amount: 45, speed: 'slow', easing: 'ease_in_out' } },
    ])
    expect(moveRes.parsedArgs.success).toBe(true)
    if (moveRes.parsedArgs.success) {
      const appliedMove = applyDirectorPlanEdits(basePlan, moveRes.parsedArgs.data.edits!)
      expect(appliedMove.ok).toBe(true)
      if (appliedMove.ok) {
        expect(appliedMove.plan.shots[0]?.move).toEqual({
          kind: 'orbit_right',
          direction: 'right',
          amount: 45,
          speed: 'slow',
          easing: 'ease_in_out',
        })
      }
    }

    const fieldRes = await parseAndApply([
      { op: 'replace', path: '/shots/wide/window', value: [0, 8] },
      { op: 'replace', path: '/shots/wide/move/kind', value: 'push_in' },
      { op: 'replace', path: '/shots/wide/angle', value: { over_shoulder: 'friend' } },
      { op: 'add', path: '/scene/setPieces/desk', value: { kind: 'desk', relation: { type: 'in_front_of', ref: 'reader' } } },
    ])
    expect(fieldRes.parsedArgs.success).toBe(true)
    if (fieldRes.parsedArgs.success) {
      const appliedFields = applyDirectorPlanEdits(basePlan, fieldRes.parsedArgs.data.edits!)
      expect(appliedFields.ok).toBe(true)
      if (appliedFields.ok) {
        expect(appliedFields.plan.shots[0]?.window).toEqual([0, 8])
        expect(appliedFields.plan.shots[0]?.move.kind).toBe('push_in')
        expect(appliedFields.plan.shots[0]?.angle).toEqual({ over_shoulder: 'friend' })
        expect(appliedFields.plan.scene.setPieces).toEqual([{ id: 'desk', kind: 'desk', relation: { type: 'in_front_of', ref: 'reader' } }])
      }
    }
  })

  it('still rejects reversed window, move missing kind, whole shot missing window, wrong object on field path, and stale revision', async () => {
    // 1. 逆序时窗：field-level number[] 过顶层模型 schema 后，由 applyDirectorPlanEdits 的 windowSchema 精确拒掉
    const reversedWindow = await parseAndApply([{ op: 'replace', path: '/shots/wide/window', value: [8, 2] }])
    expect(reversedWindow.parsedArgs.success).toBe(true)
    if (reversedWindow.parsedArgs.success) {
      const patched = applyDirectorPlanEdits(basePlan, reversedWindow.parsedArgs.data.edits!)
      expect(patched.ok).toBe(false)
      if (!patched.ok) expect(patched.errors.join(' ')).toContain('window end must be greater than start')
    }

    // 2. 缺 kind 的完整 move：模型 schema 与补丁应用双拒
    const missingKind = await parseAndApply([{ op: 'replace', path: '/shots/wide/move', value: { direction: 'left' } }])
    expect(missingKind.parsedArgs.success).toBe(false)
    expect(applyDirectorPlanEdits(basePlan, [{ op: 'replace', path: '/shots/wide/move', value: { direction: 'left' } }]).ok).toBe(false)

    // 3. 缺 window 的完整 shot：模型 schema 与补丁应用双拒
    const missingWindow = await parseAndApply([{ op: 'add', path: '/shots/close', value: { size: '特写' } }])
    expect(missingWindow.parsedArgs.success).toBe(false)
    expect(applyDirectorPlanEdits(basePlan, [{ op: 'add', path: '/shots/close', value: { size: '特写' } }]).ok).toBe(false)

    // 4. 把另一分支对象送到字段路径（NF-1107-0003 报错形状）：模型 schema 与补丁应用双拒
    const wrappedWindow = await parseAndApply([{ op: 'replace', path: '/shots/wide/window', value: { window: [0, 8] } }])
    expect(wrappedWindow.parsedArgs.success).toBe(false)
    expect(applyDirectorPlanEdits(basePlan, [{ op: 'replace', path: '/shots/wide/window', value: { window: [0, 8] } }]).ok).toBe(false)

    // 5. 过期 revision 照旧被拒并给出最新 revision
    const { tool } = await stageShotTool(() => ({
      applied: false,
      proposalId: 'prop-stale',
      operation: 'patch_director_plan',
      rejected: 'stale_revision',
      messages: ['revision mismatch'],
      currentRevision: baseRevision,
    }))
    const stale = await tool.execute({
      target: { directorNodeId: 'node-d1' },
      baseRevision: 'dplan-0000000000000000',
      edits: [{ op: 'replace', path: '/shots/wide/window', value: [0, 8] }],
    }, context)
    expect(stale.ok).toBe(false)
    if (!stale.ok) {
      expect(stale.failure.code).toBe('capability_target_stale')
      expect(stale.failure.message).toContain(baseRevision)
    }
  })
})
