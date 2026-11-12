import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../desktop/bridge', () => ({ getDesktopBridge: vi.fn() }))
vi.mock('../../desktop/rendererLog', () => ({ logRendererWarn: vi.fn(), logRendererError: vi.fn(), logRendererInfo: vi.fn() }))

import { getDesktopBridge } from '../../desktop/bridge'
import type { DesktopBridge } from '../../desktop/bridge'
import { quarantineOfRecord } from './projectNormalize'
import { readLocalProjectAsync, saveProjectRecord } from './projectRepository'
import { createDefaultWorkbenchProjectPayload } from './projectRecordSchema'
import type { StoryboardPlan } from '../generationCanvas/agent/storyboardPlan'

/**
 * 设计卡 D-main-thread-unblock ★9 A3：一份坏分镜 + 一处画布改动 → 画布改动落盘、revision+1；
 * 被隔离的那一项原样留进隔离区文件；盘上已有坏项的项目照常打开。
 */
const SECRET = '私有标题-不许进日志'
const plan: StoryboardPlan = { title: 'p', anchors: [], shots: [{ index: 1, durationSec: 3, anchorIds: [], prompt: 'A' }] }
const design = (documentId: string, id: string, bad = false) => ({
  id, documentId, title: SECRET, committed: false, status: 'draft' as const, sourceDocumentUpdatedAt: 1, createdAt: 1, updatedAt: 1,
  plan: bad ? { ...plan, shots: [{ ...plan.shots[0], durationSec: Number.NaN }] } : plan,
})

function bridge(onDisk: unknown) {
  const save = vi.fn(async (_id: string, record: unknown) => ({ ok: true as const, value: record }))
  const quarantineWrite = vi.fn(async () => ({ written: 1 }))
  const readAsync = vi.fn(async () => onDisk)
  vi.mocked(getDesktopBridge).mockReturnValue({ projects: { save, quarantineWrite, readAsync, read: vi.fn(() => onDisk) } } as unknown as DesktopBridge)
  return { save, quarantineWrite }
}

beforeEach(() => vi.mocked(getDesktopBridge).mockReset())

describe('saveProjectRecord is item-wise', () => {
  it('saves the canvas change and revision+1 even though one design is unsavable, and leaves the raw item in the quarantine sidecar', async () => {
    const base = createDefaultWorkbenchProjectPayload(); const documentId = base.activeDocumentId!
    const onDisk = { id: 'p1', name: 'P', createdAt: 1, updatedAt: 1, revision: 4, version: 1, payload: { ...base, storyboardDesignsByDocumentId: { [documentId]: [design(documentId, 'good')] } } }
    const { save, quarantineWrite } = bridge(onDisk)
    const nodes = [{ id: 'n1', kind: 'image', title: 'new', position: { x: 0, y: 0 } }]
    const saved = await saveProjectRecord('p1', {
      ...base, generationCanvas: { ...base.generationCanvas, nodes },
      storyboardDesignsByDocumentId: { [documentId]: [design(documentId, 'good'), design(documentId, 'bad', true)] },
    } as never)
    const sent = save.mock.calls[0][1] as { revision: number; payload: { generationCanvas: { nodes: unknown[] }; storyboardDesignsByDocumentId: Record<string, Array<{ id: string }>> } }
    expect(sent.revision).toBe(5)
    expect(sent.payload.generationCanvas.nodes).toEqual(nodes)
    expect(sent.payload.storyboardDesignsByDocumentId[documentId].map(item => item.id)).toEqual(['good'])
    expect(quarantineWrite).toHaveBeenCalledWith('p1', [expect.objectContaining({ container: 'storyboardDesign', raw: expect.objectContaining({ id: 'bad', title: SECRET }) })])
    expect(quarantineOfRecord(saved)).toHaveLength(1)
  })

  it('a project with nothing wrong writes no sidecar', async () => {
    const base = createDefaultWorkbenchProjectPayload()
    const { quarantineWrite } = bridge({ id: 'p1', name: 'P', createdAt: 1, updatedAt: 1, revision: 1, version: 1, payload: base })
    const saved = await saveProjectRecord('p1', base)
    expect(quarantineWrite).not.toHaveBeenCalled()
    expect(quarantineOfRecord(saved)).toEqual([])
  })

  it('a sidecar write that fails never fails the save', async () => {
    const base = createDefaultWorkbenchProjectPayload(); const documentId = base.activeDocumentId!
    const { quarantineWrite } = bridge({ id: 'p1', name: 'P', createdAt: 1, updatedAt: 1, revision: 1, version: 1, payload: base })
    quarantineWrite.mockRejectedValue(new Error('disk full'))
    const saved = await saveProjectRecord('p1', { ...base, storyboardDesignsByDocumentId: { [documentId]: [design(documentId, 'bad', true)] } } as never)
    expect(saved).toBeTruthy()
  })
})

describe('opening a project that already holds a bad item', () => {
  it('opens it, drops only that item, and leaves the raw item in the sidecar', async () => {
    const base = createDefaultWorkbenchProjectPayload(); const documentId = base.activeDocumentId!
    const { quarantineWrite } = bridge({ id: 'p1', name: 'P', createdAt: 1, updatedAt: 1, revision: 3, version: 1,
      payload: { ...base, storyboardDesignsByDocumentId: { [documentId]: [design(documentId, 'good'), design(documentId, 'bad', true)] } } })
    const opened = await readLocalProjectAsync('p1')
    expect(opened?.payload.storyboardDesignsByDocumentId?.[documentId]?.map(item => item.id)).toEqual(['good'])
    expect(quarantineWrite).toHaveBeenCalledTimes(1)
  })
})
