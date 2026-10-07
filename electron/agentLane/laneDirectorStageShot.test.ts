// 3D-BOX 开关开时 `stage_shot` 的 lane 绑定：参数 → director.write 语义输入；领域拒绝 → 模型读得懂的失败；
// 成功收据带修订号、实测 cut、预演状态与下一次补丁的基准计划。工具轨迹在这里用假 port 钉住；真实模型的
// 端到端回合是门槛 ①，不在单测里冒充。
import { afterEach, describe, expect, it, vi } from 'vitest'
import { installDirector3DBoxFace, resetDirector3DBoxFaceForTests } from '../shared/featureFlags/director3dboxFace'
import type { DirectorWriteInput, DirectorWriteResult } from '../shared/agentCapabilities/directorWrite'

const PLAN = {
  scene: { environment: 'day', template: 'room', tags: ['书房'] },
  actors: [
    { id: 'reader', kind: 'person', desc: '读者', placement: { relation: 'at', ref: 's1-room-floor' } },
    { id: 'friend', kind: 'person', desc: '朋友', placement: { relation: 'in_front_of', ref: 'reader' } },
  ],
  shots: [{ id: 'wide', window: [0, 3], transitionIn: 'cut', subject: 'reader', size: '全景', angle: 'front', height: 'eye', move: { kind: 'static' } }],
}

async function stageShotTool(write: (input: DirectorWriteInput) => DirectorWriteResult) {
  vi.resetModules()
  resetDirector3DBoxFaceForTests()
  installDirector3DBoxFace(true)
  const { createCanvasLaneTools } = await import('./laneCanvasTools')
  const seen: DirectorWriteInput[] = []
  const tools = createCanvasLaneTools({
    read: async () => ({ nodes: [], edges: [], groups: [], selectedNodeIds: [] }),
    write: async () => { throw new Error('canvas.write must not be used for stage_shot when 3D-BOX is on') },
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

afterEach(() => {
  resetDirector3DBoxFaceForTests()
  vi.resetModules()
})

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
