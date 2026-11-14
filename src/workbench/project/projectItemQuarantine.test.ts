import { beforeEach, describe, expect, it, vi } from 'vitest'

const logs = vi.hoisted(() => ({ warn: vi.fn() }))
vi.mock('../../desktop/rendererLog', () => ({ logRendererWarn: logs.warn, logRendererError: vi.fn(), logRendererInfo: vi.fn() }))

import { normalizePayload, normalizePayloadWithQuarantine, normalizeRecord, quarantineOfRecord } from './projectNormalize'
import { createDefaultWorkbenchProjectPayload } from './projectRecordSchema'
import type { StoryboardPlan } from '../generationCanvas/agent/storyboardPlan'

/**
 * 设计卡 D-main-thread-unblock ★9：存盘 / 读盘一项一项判。一项不合格只隔离那一项，其余照存；
 * 只有结构骨架坏了才整份拒。日志只记字段路径，不记用户内容。
 */
const SECRET = '私有标题-不许进日志'
const plan: StoryboardPlan = {
  title: 'plan', anchors: [],
  shots: [{ index: 1, durationSec: 3, anchorIds: [], prompt: '少年站在雨里' }],
}
const design = (documentId: string, id: string, overrides: Record<string, unknown> = {}) => ({
  id, documentId, title: SECRET, plan, committed: false, status: 'draft' as const,
  sourceDocumentUpdatedAt: 10, createdAt: 11, updatedAt: 12, ...overrides,
})
const badPlan = { ...plan, shots: [{ ...plan.shots[0], durationSec: Number.NaN }] }

beforeEach(() => logs.warn.mockClear())

describe('item-wise save and read', () => {
  it('A3 one bad design does not stop the rest of the project from saving', () => {
    const base = createDefaultWorkbenchProjectPayload(); const documentId = base.activeDocumentId!
    const out = normalizePayloadWithQuarantine({
      ...base,
      storyboardDesignsByDocumentId: { [documentId]: [design(documentId, 'good'), design(documentId, 'bad', { plan: badPlan })] },
    })
    expect(out.payload.storyboardDesignsByDocumentId?.[documentId]?.map(item => item.id)).toEqual(['good'])
    expect(out.quarantined).toHaveLength(1)
    expect(out.quarantined[0]).toMatchObject({ container: 'storyboardDesign', title: SECRET, keptPreviousVersion: false })
    expect(out.quarantined[0].field).toContain('shots[0].durationSec')
    expect(out.quarantined[0].raw).toMatchObject({ id: 'bad' })
  })

  it('keeps the previous on-disk version of the same design instead of losing the whole item', () => {
    const base = createDefaultWorkbenchProjectPayload(); const documentId = base.activeDocumentId!
    const previous = { ...base, storyboardDesignsByDocumentId: { [documentId]: [design(documentId, 'bad', { title: 'old good' })] } }
    const out = normalizePayloadWithQuarantine(
      { ...base, storyboardDesignsByDocumentId: { [documentId]: [design(documentId, 'bad', { plan: badPlan })] } },
      { previous },
    )
    expect(out.payload.storyboardDesignsByDocumentId?.[documentId]?.[0].title).toBe('old good')
    expect(out.quarantined[0].keptPreviousVersion).toBe(true)
  })

  it('A5 reading a project that already has a bad item opens it and quarantines only that item', () => {
    const base = createDefaultWorkbenchProjectPayload(); const documentId = base.activeDocumentId!
    const summary = { id: 'p1', name: 'P', createdAt: 1, updatedAt: 1 }
    const opened = normalizeRecord(summary, { ...summary, version: 1, payload: {
      ...base, storyboardDesignsByDocumentId: { [documentId]: [design(documentId, 'good'), design(documentId, 'bad', { plan: badPlan })] },
    } })
    expect(opened.payload.storyboardDesignsByDocumentId?.[documentId]?.map(item => item.id)).toEqual(['good'])
    expect(opened.payload.generationCanvas).toEqual(base.generationCanvas)
    expect(quarantineOfRecord(opened).map(item => item.container)).toEqual(['storyboardDesign'])
  })

  it('a bad category, a bad pending deletion and a bad layout are each isolated alone', () => {
    const out = normalizePayloadWithQuarantine({
      ...createDefaultWorkbenchProjectPayload(),
      categories: [{ id: '', name: '' }],
      pendingAssetDeletions: [{ relativePath: '' }, { relativePath: 'assets/a.png' }],
    })
    expect(out.quarantined.map(item => item.container).sort()).toEqual(['category', 'pendingAssetDeletion'])
    expect(out.payload.pendingAssetDeletions).toEqual([{ relativePath: 'assets/a.png' }])
  })

  it('only a broken skeleton rejects the whole payload', () => {
    expect(() => normalizePayload({ ...createDefaultWorkbenchProjectPayload(), generationCanvas: { nodes: 'nope' } })).toThrow()
    expect(() => normalizePayload('not an object')).toThrow()
  })

  it('logs carry field paths only, never the creator\'s content', () => {
    const base = createDefaultWorkbenchProjectPayload(); const documentId = base.activeDocumentId!
    normalizePayloadWithQuarantine({
      ...base, storyboardDesignsByDocumentId: { [documentId]: [design(documentId, 'bad', { plan: badPlan })] },
    })
    const text = JSON.stringify(logs.warn.mock.calls)
    expect(text).toContain('project-item-quarantined')
    expect(text).not.toContain(SECRET)
    expect(text).not.toContain('少年站在雨里')
  })

  it('a clean project quarantines nothing and is untouched', () => {
    const base = createDefaultWorkbenchProjectPayload(); const documentId = base.activeDocumentId!
    const out = normalizePayloadWithQuarantine({ ...base, storyboardDesignsByDocumentId: { [documentId]: [design(documentId, 'good')] } })
    expect(out.quarantined).toEqual([])
    expect(out.payload.storyboardDesignsByDocumentId?.[documentId]).toHaveLength(1)
  })
})
