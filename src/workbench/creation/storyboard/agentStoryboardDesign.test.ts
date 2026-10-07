import { beforeEach, describe, expect, it, vi } from 'vitest'
import { extendAgentStoryboardDesign, patchAgentStoryboardDesign, upsertAgentStoryboardDesign } from './agentStoryboardDesign'
import { useWorkbenchStore } from '../../workbenchStore'
import { useGenerationCanvasStore } from '../../generationCanvas/store/generationCanvasStore'
import type { StoryboardPlan } from '../../generationCanvas/agent/storyboardPlan'

const context = vi.hoisted(() => ({ projectId: 'p', current: true }))
vi.mock('../../project/projectCanvasReadSurface', () => ({
  withProjectAction: (action: (value: unknown) => unknown) => action({
    binding: { projectId: context.projectId }, signal: new AbortController().signal,
    assertCurrent: () => { if (!context.current) throw new Error('project changed') },
  }),
}))

const plan = (title: string, prompt: string): StoryboardPlan => ({ title, anchors: [],
  shots: [{ index: 1, shotId: 'shot-1', shotKind: 'image', durationSec: 0, anchorIds: [], prompt }] })
const designs = () => useWorkbenchStore.getState().storyboardDesignsByDocumentId.doc ?? []
const upsert = (designId: string, value: StoryboardPlan, initiator: 'user' | 'agent' = 'agent') => upsertAgentStoryboardDesign({ projectId: 'p', documentId: 'doc', designId, plan: value, initiator })

beforeEach(() => {
  context.projectId = 'p'; context.current = true
  const store = useWorkbenchStore.getState()
  store.hydrateWorkbenchDocuments([{ id: 'doc', version: 1, title: 'Doc', updatedAt: 1, contentJson: { type: 'doc', content: [] } }], 'doc')
  store.hydrateStoryboardDesigns({})
  useGenerationCanvasStore.getState().restoreSnapshot({ nodes: [], edges: [], groups: [], selectedNodeIds: [] })
})

describe('the agent writes into the same plan list a hand-made plan lives in', () => {
  it('creates one ordinary plan whose id is the draft id the model holds', () => {
    expect(upsert('op-1', plan('Seaside', 'A'))).toEqual({ status: 'saved', designId: 'op-1' })
    expect(designs()).toHaveLength(1)
    expect(designs()[0]).toMatchObject({ id: 'op-1', documentId: 'doc', title: 'Seaside', committed: false, status: 'draft' })
    // 用户手建的方案有的能力，这一条也必须有：它就是同一种东西。
    useWorkbenchStore.getState().renameStoryboardDesign('op-1', 'My cut')
    expect(designs()[0].title).toBe('My cut')
    useWorkbenchStore.getState().deleteStoryboardDesign('op-1', 'doc')
    expect(designs()).toEqual([])
  })

  it('replaces only the plan the model named, never the one that happens to be open', () => {
    upsert('op-1', plan('First', 'A'))
    upsert('op-2', plan('Second', 'B'))
    useWorkbenchStore.getState().setActiveStoryboardId('op-2', 'doc')
    upsert('op-1', plan('First', 'A revised'))
    expect(designs().map(design => design.plan.shots[0].prompt)).toEqual(['A revised', 'B'])
  })

  it('patches one shot and keeps every field the model did not send', () => {
    upsert('op-1', { title: 'Plan', anchors: [], shots: [
      { index: 1, shotId: 'shot-1', shotKind: 'image', durationSec: 0, anchorIds: [], prompt: 'A', modelKey: 'm', modelVendor: 'v' },
      { index: 2, shotId: 'shot-2', shotKind: 'image', durationSec: 0, anchorIds: [], prompt: 'B' },
    ] })
    expect(patchAgentStoryboardDesign({ projectId: 'p', documentId: 'doc', designId: 'op-1', shotId: 'shot-1', patch: { prompt: 'A at dusk' } }))
      .toEqual({ status: 'saved', shotId: 'shot-1' })
    expect(designs()[0].plan.shots[0]).toMatchObject({ prompt: 'A at dusk', modelKey: 'm', modelVendor: 'v' })
    expect(designs()[0].plan.shots[1].prompt).toBe('B')
  })

  it('appends shots and reference cards to the named plan, numbering shots after the existing ones and never in the anchor range', () => {
    upsert('op-1', { title: 'Plan', anchors: [{ id: 'anchor-1', kind: 'character', carrier: 'visual', name: 'Hero', description: 'red coat' }], shots: [
      { index: 1, shotId: 'shot-1', shotKind: 'image', durationSec: 0, anchorIds: [], prompt: 'A' },
    ] })
    const reply = extendAgentStoryboardDesign({ projectId: 'p', documentId: 'doc', designId: 'op-1', subjects: [
      { index: 0, shotId: 'pending', shotKind: 'image', durationSec: 0, anchorIds: [], prompt: 'B' },
      { id: 'pending-anchor', kind: 'scene', carrier: 'visual', name: 'Alley', description: 'neon' },
    ] })
    expect(reply).toEqual({ status: 'saved', designId: 'op-1', added: [{ role: 'shot', id: 'shot-2', row: 2 }, { role: 'anchor', id: 'anchor-2', title: 'Alley' }] })
    expect(designs()).toHaveLength(1)
    expect(designs()[0].plan.shots.map(shot => [shot.index, shot.shotId, shot.prompt])).toEqual([[1, 'shot-1', 'A'], [2, 'shot-2', 'B']])
    expect(designs()[0].plan.anchors.map(anchor => anchor.id)).toEqual(['anchor-1', 'anchor-2'])
  })

  it('refuses to add to a plan that is gone instead of starting a new one', () => {
    expect(() => extendAgentStoryboardDesign({ projectId: 'p', documentId: 'doc', designId: 'op-missing', subjects: [
      { index: 0, shotId: 'pending', shotKind: 'image', durationSec: 0, anchorIds: [], prompt: 'B' },
    ] })).toThrow('storyboard_design_missing')
    expect(designs()).toEqual([])
  })

  it('answers with the real shots when "shot 1" is a reference card in an older plan, and changes nothing', () => {
    upsert('op-1', { title: 'Old', anchors: [{ id: 'shot-1', kind: 'character', carrier: 'visual', name: 'Hero', description: 'red coat' }], shots: [
      { index: 2, shotId: 'shot-2', shotKind: 'image', durationSec: 0, anchorIds: [], prompt: 'A' },
    ] })
    expect(patchAgentStoryboardDesign({ projectId: 'p', documentId: 'doc', designId: 'op-1', shotId: 'shot-1', patch: { prompt: 'rooftop' } }))
      .toEqual({ status: 'shot-not-found', shotId: 'shot-1', shots: [{ id: 'shot-2', row: 2 }], anchorHoldsShotNumber: true })
    expect(designs()[0].plan.anchors[0].description).toBe('red coat')
    expect(designs()[0].plan.shots[0].prompt).toBe('A')
  })

  it('refuses to invent a plan when the model names one that is gone', () => {
    expect(() => patchAgentStoryboardDesign({ projectId: 'p', documentId: 'doc', designId: 'op-missing', shotId: 'shot-1', patch: { prompt: 'x' } }))
      .toThrow('storyboard_design_missing')
    expect(designs()).toEqual([])
  })

  it('refuses a write aimed at another project or a document that is gone', () => {
    context.projectId = 'other'
    expect(() => upsert('op-1', plan('Seaside', 'A'))).toThrow('storyboard_project_changed')
    context.projectId = 'p'
    expect(() => upsertAgentStoryboardDesign({ projectId: 'p', documentId: 'missing', designId: 'op-1', plan: plan('Seaside', 'A'), initiator: 'agent' }))
      .toThrow('storyboard_document_missing')
    expect(designs()).toEqual([])
  })

  it('falls back to exactly the name a hand-made new plan gets when the model gives no title', () => {
    // 决策 3：标题缺省时与手动新建**同一套**命名。2026-09-21 那一套长出了编号
    // （`uniqueDesignTitle`：基名没被占就用基名，占了取最小可用序号），所以「一致」
    // 现在钉的是**同一条规则**：手动拿基名，紧接着的 Agent 方案拿下一个号——
    // 两行不许同名，而这个号也不是 Agent 这条路自己编出来的。
    const manual = useWorkbenchStore.getState().addStoryboardDesign({ initiator: 'user', documentId: 'doc' })!
    expect(manual.title).toBe('分镜方案')
    upsert('op-1', plan('', 'A'))
    expect(designs().find(design => design.id === 'op-1')!.title).toBe('分镜方案 2')
    // 模型给了名字就用模型的，不套编号。
    upsert('op-2', plan('海边黄昏', 'A'))
    expect(designs().find(design => design.id === 'op-2')!.title).toBe('海边黄昏')
  })
})

describe('程序 / Agent 新建的方案不替用户打开', () => {
  const view = () => { const s = useWorkbenchStore.getState(); return { doc: s.activeDocumentId, design: s.activeStoryboardId } }

  it('Agent 新建一份：进列表，用户正在看的那份不变（原来正看着的是原稿）', () => {
    const before = view()
    upsert('op-1', plan('Seaside', 'A'))
    expect(designs().map(design => design.id)).toEqual(['op-1'])
    expect(view()).toEqual(before)
    expect(before.design).toBeNull()
  })

  it('用户正看着 A 方案，Agent 再新建 B：还在看 A', () => {
    upsert('op-a', plan('A', 'a'))
    useWorkbenchStore.getState().setActiveStoryboardId('op-a', 'doc')
    upsert('op-b', plan('B', 'b'))
    expect(designs()).toHaveLength(2)
    expect(view().design).toBe('op-a')
  })

  it('用户点「新建方案」：新方案被打开（用户的动作才能打开）', () => {
    const design = useWorkbenchStore.getState().addStoryboardDesign({ initiator: 'user', documentId: 'doc' })!
    expect(view()).toEqual({ doc: 'doc', design: design.id })
  })

  it('用户亲手点「拆分镜」发起的方案：照常替他打开（谁发起决定，不是经不经过 Agent 工具）', () => {
    upsert('op-btn', plan('Button', 'a'), 'user')
    expect(view()).toEqual({ doc: 'doc', design: 'op-btn' })
  })

  it('发起人缺了或不认识：拒绝，不猜', () => {
    expect(() => upsertAgentStoryboardDesign({ projectId: 'p', documentId: 'doc', designId: 'x', plan: plan('X', 'a') })).toThrow('storyboard_initiator_required')
    expect(() => upsertAgentStoryboardDesign({ projectId: 'p', documentId: 'doc', designId: 'x', plan: plan('X', 'a'), initiator: 'model' })).toThrow('storyboard_initiator_required')
    expect(designs()).toEqual([])
  })

  it('用户点开 Agent 写好的方案：正常打开', () => {
    upsert('op-1', plan('Seaside', 'A'))
    useWorkbenchStore.getState().setActiveStoryboardId('op-1', 'doc')
    expect(view()).toEqual({ doc: 'doc', design: 'op-1' })
  })

  it('另一扇门：setStoryboardPlan 新建分支同样服从发起人（Agent 新建不打开，用户新建打开）', () => {
    const store = useWorkbenchStore.getState()
    const agent = store.setStoryboardPlan(plan('Agent 的', 'x'), 'doc', undefined, true, 'agent')!
    expect(designs().map(design => design.id)).toEqual([agent.id])
    expect(view().design).toBeNull()
    const user = useWorkbenchStore.getState().setStoryboardPlan(plan('用户的', 'y'), 'doc', undefined, true, 'user')!
    expect(view().design).toBe(user.id)
  })
})
