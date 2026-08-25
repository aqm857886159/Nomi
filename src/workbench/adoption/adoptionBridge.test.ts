import { describe, expect, it, beforeEach } from 'vitest'
import { createDefaultTimeline } from '../timeline/timelineMath'
import type { TimelineClip, TimelineState } from '../timeline/timelineTypes'
import { applyAdoption, buildAdoptedTimeline } from './adoptionApply'
import { adoptGenerationNode } from './adoptGenerationNode'
import { adoptStoryboardBatch } from './adoptStoryboardBatch'
import { lookupAdoptionProposal, registerAdoptionProposal, resetAdoptionRegistry } from './adoptionProposalRegistry'
import type { AdoptionPlacement, AdoptionProposalKey } from './adoptionTypes'

function clip(id: string, startFrame: number, frameCount = 24): TimelineClip {
  return {
    id,
    type: 'video',
    sourceNodeId: `node-${id}`,
    label: id,
    startFrame,
    endFrame: startFrame + frameCount,
    frameCount,
    offsetStartFrame: 0,
    offsetEndFrame: 0,
    url: `https://example.test/${id}.mp4`,
  }
}

function placement(id: string, startFrame: number): AdoptionPlacement {
  return { clip: clip(id, startFrame), trackType: 'video', startFrame }
}

function key(overrides: Partial<AdoptionProposalKey> = {}): AdoptionProposalKey {
  return {
    runId: 'run-1',
    contractHash: 'contract-1',
    artifactId: 'artifact-1',
    artifactVersion: '1',
    baseRevision: 'base-1',
    destination: 'timeline:video@append',
    ...overrides,
  }
}

describe('P5 E1 adoption bridge', () => {
  beforeEach(() => resetAdoptionRegistry())

  it('builds an ordered batch without mutating the base timeline', () => {
    const base = createDefaultTimeline()
    const next = buildAdoptedTimeline(base, [placement('a', 0), placement('b', 24)])

    expect(base.tracks.find((track) => track.type === 'video')?.clips).toHaveLength(0)
    expect(next.tracks.find((track) => track.type === 'video')?.clips.map((item) => item.id)).toEqual(['a', 'b'])
  })

  it('applies a whole batch with one commit, so one undo restores the old state', () => {
    const base = createDefaultTimeline()
    let live = base
    let commits = 0
    const result = applyAdoption({
      readTimeline: () => live,
      commitTimeline: (next) => { commits += 1; live = next },
      restoreTimeline: (old) => { live = old; return true },
    }, [placement('a', 0), placement('b', 24)])

    expect(result.ok).toBe(true)
    expect(commits).toBe(1)
    expect(live.tracks.find((track) => track.type === 'video')?.clips).toHaveLength(2)
  })

  it('compensates a failed apply, and reports needs_recovery when compensation fails', () => {
    const base = createDefaultTimeline()
    let restoreCalls = 0
    const recovered = applyAdoption({
      readTimeline: () => base,
      commitTimeline: () => { throw new Error('commit interrupted') },
      restoreTimeline: () => { restoreCalls += 1; return true },
    }, [placement('a', 0)])
    expect(recovered).toMatchObject({ ok: false, recovered: true })
    expect(restoreCalls).toBe(1)

    const unrecovered = applyAdoption({
      readTimeline: () => base,
      commitTimeline: () => { throw new Error('commit interrupted') },
      restoreTimeline: () => false,
    }, [placement('a', 0)])
    expect(unrecovered).toMatchObject({ ok: false, recovered: false })
  })

  it('returns the original proposal for an exact retry, stale for an external revision, and attention for a new asset version', () => {
    const original = registerAdoptionProposal(key(), 'applied', { clipIds: ['clip-a'], placedCount: 1 })
    expect(lookupAdoptionProposal(key())).toEqual({ kind: 'replay', proposal: original })
    expect(lookupAdoptionProposal(key({ baseRevision: 'base-2' }))).toMatchObject({ kind: 'stale', proposal: original })
    expect(lookupAdoptionProposal(key({ artifactVersion: '2' }))).toMatchObject({ kind: 'needs_attention', proposal: original })
  })

  it('rejects a same-track overlap as one failed transaction', () => {
    const base = createDefaultTimeline()
    const withExisting: TimelineState = {
      ...base,
      tracks: base.tracks.map((track) => track.type === 'video' ? { ...track, clips: [clip('existing', 0)] } : track),
    }
    expect(() => buildAdoptedTimeline(withExisting, [placement('new', 12)])).toThrow(/重叠/)
  })

  it('replays a landed single artifact, but reports stale after an external timeline edit', async () => {
    let live = createDefaultTimeline()
    const node = {
      id: 'node-single', kind: 'image', title: '单产物', status: 'success',
      position: { x: 0, y: 0 }, result: { id: 'artifact-single', type: 'image', url: 'data:image/svg+xml,ok', createdAt: 1 },
    } as never
    const ports = {
      readTimeline: () => live,
      commitTimeline: (next: TimelineState) => { live = next },
      restoreTimeline: (old: TimelineState) => { live = old; return true },
    }
    const first = await adoptGenerationNode(node, { placement: { kind: 'append' }, ports })
    const replay = await adoptGenerationNode(node, { placement: { kind: 'append' }, ports })
    expect(first.status).toBe('applied')
    expect(replay).toMatchObject({ status: 'applied', replayed: true })

    live = {
      ...live,
      tracks: live.tracks.map((track) => track.type === 'video' ? { ...track, clips: [clip('external', 0)] } : track),
    }
    const stale = await adoptGenerationNode(node, { placement: { kind: 'append' }, ports })
    expect(stale.status).toBe('stale')
  })

  it('adopts a storyboard batch in supplied shot order as one proposal', async () => {
    let live = createDefaultTimeline()
    const nodes = [0, 1].map((index) => ({
      id: `batch-node-${index}`, kind: 'image', title: `镜头 ${index + 1}`, status: 'success', shotIndex: index + 1,
      position: { x: 0, y: 0 }, result: { id: `batch-artifact-${index}`, type: 'image', url: `data:image/svg+xml,${index}`, createdAt: index + 1 },
    })) as never
    const ports = {
      readTimeline: () => live,
      commitTimeline: (next: TimelineState) => { live = next },
      restoreTimeline: (old: TimelineState) => { live = old; return true },
    }
    const units = [
      { nodeId: 'batch-node-0', shotIndex: 1, role: 'still' as const },
      { nodeId: 'batch-node-1', shotIndex: 2, role: 'still' as const },
    ]
    const first = await adoptStoryboardBatch({ units, startFrame: 0, readNodes: () => nodes, ports })
    expect(first).toMatchObject({ status: 'applied', replayed: false })
    expect(first.placedItems?.map((item) => item.startFrame)).toEqual([0, 90])
    expect(first.status === 'applied' ? first.proposal.placedCount : 0).toBe(2)
    const replay = await adoptStoryboardBatch({ units, startFrame: 0, readNodes: () => nodes, ports })
    expect(replay).toMatchObject({ status: 'applied', replayed: true })
  })
})
