import { describe, expect, it } from 'vitest'
import { MODEL_ARCHETYPES } from '../../../../electron/shared/modelArchetypes/builtInCatalog'
import { anchorsConsumedBy } from '../../../../electron/shared/modelArchetypes/anchorPolicy'
import { validatePlan } from './storyboardPlanEdits'
import { validateAnchorModelFit } from './storyboardAnchorPolicy'
import { deriveAnchorCardRuntimes, deriveStoryboardRowRuntimes } from '../../creation/storyboard/exec/storyboardRowStatus'
import { useWorkbenchStore } from '../../workbenchStore'
import { applyCanvasToolCall } from './applyCanvasToolCall'
import type { StoryboardPlan } from './storyboardPlan'

const profile = MODEL_ARCHETYPES.find(profile => profile.kind === 'video' && profile.modes.some(mode => anchorsConsumedBy(mode).includes('none')) && profile.modes.some(mode => !anchorsConsumedBy(mode).includes('none')))!
const textMode = profile.modes.find(mode => anchorsConsumedBy(mode).includes('none'))!
const imageMode = profile.modes.find(mode => !anchorsConsumedBy(mode).includes('none'))!
const modelKey = profile.identifierPatterns[0]
// 「参考图不会被使用」只看这一行参考列里真摆着的绑定：第 1 镜文生图模式没有槽，第 2 镜换成有槽的模式。
const slotKind = imageMode.slots.find(slot => slot.kind === 'image_ref')?.kind ?? imageMode.slots[0].kind
const bound = { [slotKind]: [{ url: 'nomi-local://hero.png', name: '主角', anchorId: 'hero' }] }
const plan: StoryboardPlan = { title: '锚策略', anchors: [{ id: 'hero', kind: 'character', carrier: 'visual', name: '主角', description: '短发' }], shots: [
  { index: 1, prompt: '奔跑', durationSec: 5, anchorIds: [], referenceBindings: bound, modelKey, modeId: textMode.id },
  { index: 2, prompt: '回头', durationSec: 5, anchorIds: [], referenceBindings: bound, modelKey, modeId: imageMode.id },
  { index: 3, prompt: '只有 anchorIds 的一镜', durationSec: 5, anchorIds: ['hero'], modelKey, modeId: textMode.id },
] }

describe('visual anchors with explicit text-only mode', () => {
  it('advises a concrete same-model mode for a reference that sits on a text-only row; anchorIds alone never warn', () => {
    const original = structuredClone(plan)
    const issues = validateAnchorModelFit(plan)
    expect(issues).toHaveLength(1)
    expect(issues[0]).toMatchObject({ kind: 'anchor-not-consumable', shotIndex: 1, ignoredAnchors: [{ anchorId: 'hero' }] })
    expect(issues[0].correction).toContain(imageMode.id)
    expect(validatePlan(plan)).toContainEqual(issues[0])
    expect(plan).toEqual(original)
  })
  it('exposes the ignored reference on the row by name; a row with no reference on it says nothing', () => {
    const rows = deriveStoryboardRowRuntimes({ plan, designId: 'd', nodes: [], imageModelOptions: [], videoModelOptions: [{ value: modelKey, label: profile.label }] })
    expect(rows[0].exec.status).toBe('anchor-ignored')
    expect(rows[0].exec.ignoredAnchors).toMatchObject([{ anchorId: 'hero', name: '主角' }])
    expect(rows[1].exec.ignoredAnchors).toEqual([])
    expect(rows[2].exec.status).toBe('ready')
    expect(rows[2].exec.ignoredAnchors).toEqual([])
    const cards = deriveAnchorCardRuntimes({ plan, designId: 'd', nodes: [] })
    expect(cards[0]).toMatchObject({ referencedByCount: 2 })
  })
  it('loopback tool result returns actionable correction without rejecting t2v', async () => {
    useWorkbenchStore.getState().hydrateWorkbenchDocuments([{ id: 'policy-doc', version: 1, title: '测试', contentJson: { type: 'doc', content: [] }, updatedAt: 1 }], 'policy-doc')
    const result = await applyCanvasToolCall('propose_storyboard_plan', plan) as { status: string; message: string; anchorIssues: unknown[] }
    expect(result.status).toBe('applied')
    expect(result.message).toContain(imageMode.id)
    expect(result.anchorIssues).toHaveLength(1)
  })
})
