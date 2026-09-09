import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync, writeFileSync } from 'node:fs'
import { buildAgentModelEntries } from './availableModels'
import { applyCanvasToolCall } from './applyCanvasToolCall'
import { useWorkbenchStore } from '../../workbenchStore'
import { parseStoryboardPlan } from './storyboardPlanSchema'
import type { StoryboardPlan } from './storyboardPlan'
import { resolveArchetypeForModel } from '../../../config/modelArchetypes'
import { anchorsConsumedBy } from '../../../config/modelArchetypes/anchorPolicy'
import { deriveStoryboardRowRuntimes } from '../../creation/storyboard/exec/storyboardRowStatus'
import { normalizeStoryboardAnchorDefaults, validateAnchorModelFit } from './storyboardAnchorPolicy'
import { shotReferenceMetaPatch } from '../../creation/storyboard/shotRow/shotReferenceSlots'

vi.mock('./availableModels', async importOriginal => ({
  ...await importOriginal<typeof import('./availableModels')>(),
  listAvailableModelsForAgent: vi.fn(async () => buildAgentModelEntries([
    { value: 'MiniMax-H3', modelKey: 'MiniMax-H3', vendor: 'apimart', label: 'MiniMax H3', kind: 'video' },
    { value: 'imagen-4', modelKey: 'imagen-4', vendor: 'google', label: 'Imagen 4', kind: 'image' },
  ])),
}))

const anchor = { id: 'hero', kind: 'character' as const, carrier: 'visual' as const, name: '小禾', description: '短发蓝衣', referenceUrl: 'https://example.com/fixture-hero.png', referenceKind: 'image' as const }
const fixture = (): StoryboardPlan => ({ title: '真实锚八镜', anchors: [{ ...anchor }], shots: Array.from({ length: 8 }, (_, i) => ({
  index: i + 1, shotKind: 'video', durationSec: 8, prompt: `小禾走到河边，第${i + 1}镜`, anchorIds: ['hero'],
  modelKey: 'MiniMax-H3', modelVendor: 'apimart', modeId: 't2v', params: { resolution: '768P', aspect_ratio: '16:9', duration: 8 },
})) })
async function write(plan: StoryboardPlan) {
  const result = await applyCanvasToolCall('propose_storyboard_plan', plan) as { storyboardDesignId: string }
  return useWorkbenchStore.getState().storyboardDesignsByDocumentId['anchor-doc'].find(design => design.id === result.storyboardDesignId)!.plan
}

beforeEach(() => {
  useWorkbenchStore.getState().hydrateWorkbenchDocuments([{ id: 'anchor-doc', version: 1, title: '隔离夹具', contentJson: { type: 'doc', content: [] }, updatedAt: 1 }], 'anchor-doc')
  useWorkbenchStore.getState().hydrateStoryboardDesigns({})
})

describe('real character reference at the shared storyboard write boundary', () => {
  it('loopback: real catalog + one anchor saves 8/8 consuming modes and bound slots', async () => {
    const input = fixture()
    const plan = await write(input)
    if (process.env.ANCHOR_REAL_CAPTURE) writeFileSync(`docs/plan/anchor-real-evidence/${process.env.ANCHOR_REAL_CAPTURE}.json`, JSON.stringify(plan, null, 2) + '\n')
    for (const shot of plan.shots) {
      const archetype = resolveArchetypeForModel({ modelKey: shot.modelKey!, vendorKey: shot.modelVendor })!
      const mode = archetype.modes.find(mode => mode.id === shot.modeId)!
      expect(anchorsConsumedBy(mode), `shot ${shot.index}`).not.toContain('none')
      expect(shot.referenceBindings?.image_ref).toEqual([{ url: anchor.referenceUrl, name: anchor.name, anchorId: anchor.id }])
      expect(Object.values(shotReferenceMetaPatch(mode, shot)).flat()).toContain(anchor.referenceUrl)
    }
    expect(input.shots.every(shot => shot.modeId === 't2v')).toBe(true)
  })
  it('uses the selected vendor only and rejects absent catalog identity', () => {
    const input = fixture()
    const entries = buildAgentModelEntries([{ value: 'MiniMax-H3', vendor: 'apimart', label: 'H3', kind: 'video' }])
    input.shots[0].modelVendor = 'another-vendor'
    expect(() => normalizeStoryboardAnchorDefaults(input, entries)).toThrow()
  })
  it('preserves no-image models and exposes the existing inline warning', async () => {
    const input = fixture()
    input.shots = [{ ...input.shots[0], shotKind: 'image', durationSec: 0, modelKey: 'imagen-4', modelVendor: 'google', modeId: 't2i' }]
    const plan = await write(input)
    expect(plan.shots[0].modeId).toBe('t2i')
    expect(plan.shots[0].referenceBindings).toBeUndefined()
    expect(validateAnchorModelFit(plan)[0].ignoredAnchors[0].anchorId).toBe('hero')
  })
  it('does not replace text anchors, unreferenced images, or a keyframe chain', async () => {
    for (const variant of ['text', 'unreferenced', 'keyframe'] as const) {
      const input = fixture()
      if (variant === 'text') input.anchors[0].carrier = 'text'
      if (variant === 'unreferenced') input.shots.forEach(shot => { shot.anchorIds = [] })
      if (variant === 'keyframe') input.shots.forEach(shot => { shot.keyframe = { enabled: true, prompt: '河边首帧' } })
      expect(await write(input)).toEqual(input)
    }
  })
  it('rejects a mode switch that would strand an authored opening frame', async () => {
    const input = fixture()
    input.shots[0].modeId = 'first'
    input.shots[0].referenceBindings = { first_frame: [{ url: 'https://example.com/opening.png' }] }
    await expect(write(input)).rejects.toThrow()
    expect(input.shots[0].referenceBindings.first_frame[0].url).toBe('https://example.com/opening.png')
  })
  it('does not silently drop a tenth character when the model can bind only nine', async () => {
    const input = fixture()
    input.anchors = Array.from({ length: 10 }, (_, i) => ({ ...anchor, id: `hero-${i}`, referenceUrl: `https://example.com/hero-${i}.png` }))
    input.shots[0].anchorIds = input.anchors.map(anchor => anchor.id)
    await expect(write(input)).rejects.toThrow()
  })
  it('a bound external image is ready without waiting for a nonexistent generated anchor', async () => {
    const plan = await write(fixture())
    const input = { plan, designId: 'd', nodes: [], imageModelOptions: [], videoModelOptions: [{ value: 'MiniMax-H3', modelKey: 'MiniMax-H3', vendor: 'apimart', label: 'H3' }] }
    const rows = deriveStoryboardRowRuntimes(input)
    expect(rows.every(row => row.exec.status === 'ready')).toBe(true)
    const nodeBacked = structuredClone(plan)
    nodeBacked.anchors[0].referenceSourceNodeId = 'missing-source-node'
    expect(deriveStoryboardRowRuntimes({ ...input, plan: nodeBacked })[0].exec.status).toBe('waiting-refs')
    const unbound = structuredClone(plan)
    unbound.shots.forEach(shot => { shot.referenceBindings = undefined })
    expect(deriveStoryboardRowRuntimes({ ...input, plan: unbound })[0].exec.status).toBe('waiting-refs')
  })
  it('retains the existing project storyboard default identity when model is omitted', () => {
    const input = fixture()
    input.shots.forEach(shot => { shot.modelKey = undefined; shot.modelVendor = undefined; shot.modeId = undefined })
    const entries = buildAgentModelEntries([
      { value: 'MiniMax-H3', vendor: 'apimart', label: 'H3', kind: 'video' },
      { value: 'seedance-2', vendor: 'apimart', label: 'Seedance 2', kind: 'video' },
    ])
    expect(entries).toHaveLength(2)
    expect(normalizeStoryboardAnchorDefaults(input, entries).shots.every(shot => shot.modelKey === 'seedance-2')).toBe(true)
  })
  it('binds a real single-frame-only catalog mode and refuses an unfilled required tail', () => {
    const input = fixture()
    const entry = buildAgentModelEntries([{ value: 'MiniMax-H3', vendor: 'apimart', label: 'H3', kind: 'video' }])[0]
    const firstOnly = { ...entry, modes: entry.modes.filter(mode => mode.modeId === 'first') }
    const plan = normalizeStoryboardAnchorDefaults(input, [firstOnly])
    expect(plan.shots.every(shot => shot.modeId === 'first' && shot.referenceBindings?.first_frame?.[0].anchorId === 'hero')).toBe(true)
    const firstLastOnly = { ...entry, modes: entry.modes.filter(mode => mode.modeId === 'firstlast') }
    expect(() => normalizeStoryboardAnchorDefaults(input, [firstLastOnly])).toThrow()
  })
  it('replays the unmodified official response with a proven anchor in an undeclared slot', async () => {
    const raw = JSON.parse(readFileSync('docs/plan/anchor-real-evidence/official-raw-plan.json', 'utf8'))
    const plan = await write(raw)
    for (const shot of plan.shots) {
      expect(shot.modeId).toBe('ref')
      expect(shot.referenceBindings?.image_ref?.[0]).toMatchObject({ anchorId: 'anchor-xiaohe', url: raw.anchors[0].referenceUrl })
      expect(shot.referenceBindings).not.toHaveProperty('character_ref')
    }
    expect(raw.shots[0].referenceBindings).toHaveProperty('character_ref')
  })
  it('refuses unknown-slot data unless both anchor identity and URL prove it is the same reference', async () => {
    const input = fixture()
    input.shots[0].referenceBindings = { unknown_slot: [{ anchorId: 'hero', url: 'https://example.com/another.png' }] }
    await expect(write(input)).rejects.toThrow()
  })
  it('keeps anchor provenance through parsing and repeated writes', async () => {
    const once = await write(fixture())
    expect(parseStoryboardPlan(once).shots[0].referenceBindings?.image_ref?.[0].anchorId).toBe('hero')
    expect(await write(once)).toEqual(once)
  })
})
