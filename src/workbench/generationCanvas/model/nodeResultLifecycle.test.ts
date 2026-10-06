import { describe, expect, it } from 'vitest'
import type { GenerationCanvasNode, GenerationNodeResult } from './generationCanvasTypes'
import {
  appendNodeResultVersion,
  backfillNodeResultVersionNumbers,
  listNodeMediaResults,
  listNodeResultVersions,
  listStableNodeMediaResults,
  normalizeNodeResultVersionNumbers,
  removeNodeResult,
  resultIdentity,
  setNodeMainResultPatch,
} from './nodeResultLifecycle'

const image = (id: string, url: string): GenerationNodeResult => ({
  id,
  type: 'image',
  url,
  createdAt: 1,
})

const node = (result: GenerationNodeResult, history: GenerationNodeResult[]): GenerationCanvasNode => ({
  id: 'node-1',
  kind: 'image',
  title: '结果',
  position: { x: 0, y: 0 },
  status: 'success',
  result,
  history,
})

describe('node result lifecycle', () => {
  it('deduplicates primary and history while preserving their display order', () => {
    const a = image('a', 'a.png')
    const b = image('b', 'b.png')
    expect(listNodeMediaResults(node(a, [a, b])).map(resultIdentity)).toEqual(['a', 'b'])
  })

  it('publishes audio and 3D results to assets without adding them to the visual version tray', () => {
    const audio = { id: 'audio', type: 'audio', url: 'audio.mp3', createdAt: 1 } as GenerationNodeResult
    const model = { id: 'mesh', type: 'model3d', url: 'mesh.glb', createdAt: 2 } as GenerationNodeResult
    const mixed = node(model, [audio, model])

    expect(listNodeMediaResults(mixed).map(resultIdentity)).toEqual(['mesh', 'audio'])
    expect(listStableNodeMediaResults(mixed)).toEqual([])
  })

  it('keeps the tray order stable when the current result pointer changes', () => {
    const a = image('a', 'a.png')
    const b = image('b', 'b.png')
    const c = image('c', 'c.png')
    const original = node(c, [c, b, a])
    const switched = { ...original, result: a }

    expect(listStableNodeMediaResults(original).map(resultIdentity)).toEqual(['c', 'b', 'a'])
    expect(listStableNodeMediaResults(switched).map(resultIdentity)).toEqual(['c', 'b', 'a'])
  })

  it('removes only the requested result and promotes the next result when needed', () => {
    const a = image('a', 'a.png')
    const b = image('b', 'b.png')
    const patch = removeNodeResult(node(a, [a, b]), 'a')
    expect(patch?.result?.id).toBe('b')
    expect(patch?.history?.map(resultIdentity)).toEqual(['b'])
    expect(patch?.status).toBe('success')
  })

  it('preserves non-media history and the durable order when removing one image', () => {
    const a = image('a', 'a.png')
    const b = image('b', 'b.png')
    const text = { id: 'text-1', type: 'text', text: '保留这段历史' } as GenerationNodeResult
    const patch = removeNodeResult(node(a, [a, text, b]), 'a')

    expect(patch?.result).toBe(b)
    // 删一版只把它拿掉：剩下的顺序不因「谁顶成主图」而重排（旧实现把新主图挪到最前）。
    expect(patch?.history).toEqual([text, b])
    expect(patch?.status).toBe('success')
  })

  it('keeps non-media history instead of resetting the node when deleting its last image', () => {
    const a = image('a', 'a.png')
    const text = { id: 'text-1', type: 'text', text: '保留这段历史' } as GenerationNodeResult
    const patch = removeNodeResult(node(a, [a, text]), 'a')

    expect(patch).toMatchObject({ result: undefined, history: [text], status: 'idle', error: undefined })
  })

  it('returns the node to idle after its last result is removed', () => {
    const a = image('a', 'a.png')
    const patch = removeNodeResult(node(a, [a]), 'a')
    expect(patch).toMatchObject({ result: undefined, history: [], status: 'idle', error: undefined })
  })

  it('backfills legacy result numbers once in newest-first history order', () => {
    const a = image('a', 'a.png')
    const b = image('b', 'b.png')
    const c = image('c', 'c.png')
    const normalized = normalizeNodeResultVersionNumbers(node(c, [c, b, a]))
    expect(normalized.result?.versionNo).toBe(3)
    expect(normalized.history?.map((entry) => entry.versionNo)).toEqual([3, 2, 1])
  })

  it('uses durable history order when the current pointer refers to an older version', () => {
    const newest = image('newest', 'newest.png')
    const older = image('older', 'older.png')
    const normalized = normalizeNodeResultVersionNumbers(node(older, [newest, older]))

    expect(normalized.result?.id).toBe('older')
    expect(normalized.history?.map((entry) => [entry.id, entry.versionNo])).toEqual([
      ['newest', 2],
      ['older', 1],
    ])
    expect(normalizeNodeResultVersionNumbers(normalized)).toEqual(normalized)
  })

  it('returns the same object when every version already has a unique number (no write on open)', () => {
    const a = { ...image('a', 'a.png'), versionNo: 1 }
    const b = { ...image('b', 'b.png'), versionNo: 3 }
    const numbered = node(b, [b, a])
    expect(normalizeNodeResultVersionNumbers(numbered)).toBe(numbered)
    expect(backfillNodeResultVersionNumbers([numbered])).toEqual({ nodes: [numbered], changed: false })
  })

  it('never renumbers an existing version; only missing numbers are appended after the max', () => {
    const kept = { ...image('kept', 'kept.png'), versionNo: 7 }
    const stray = image('stray', 'stray.png')
    const normalized = normalizeNodeResultVersionNumbers(node(kept, [stray, kept]))
    expect(normalized.history?.map((entry) => [entry.id, entry.versionNo])).toEqual([['stray', 8], ['kept', 7]])
  })

  it('appends a new version at the front with max + 1 and keeps the rest in durable order', () => {
    const v1 = { ...image('v1', 'v1.png'), versionNo: 1 }
    const v2 = { ...image('v2', 'v2.png'), versionNo: 2 }
    const v3 = { ...image('v3', 'v3.png'), versionNo: 3 }
    // 用户把第 1 版设成主图：result 指向旧版。旧实现把它挪到最前，顺序就乱了。
    const landed = appendNodeResultVersion(node(v1, [v3, v2, v1]), image('v4', 'v4.png'))
    expect(landed.result).toMatchObject({ id: 'v4', versionNo: 4 })
    expect(landed.history.map((entry) => [entry.id, entry.versionNo])).toEqual([['v4', 4], ['v3', 3], ['v2', 2], ['v1', 1]])
  })

  it('numbers past a deleted gap: deleting 2 of 3 then generating gives 4, not 3', () => {
    const v1 = { ...image('v1', 'v1.png'), versionNo: 1 }
    const v3 = { ...image('v3', 'v3.png'), versionNo: 3 }
    const landed = appendNodeResultVersion(node(v3, [v3, v1]), image('v4', 'v4.png'))
    expect(landed.history.map((entry) => entry.versionNo)).toEqual([4, 3, 1])
  })

  it('a re-landed result with the same identity keeps its number and is not duplicated', () => {
    const asset = { id: '', type: 'image' as const, assetId: 'asset-1', createdAt: 1, url: undefined }
    const first = appendNodeResultVersion({ history: [] }, asset as GenerationNodeResult)
    const again = appendNodeResultVersion(first, { ...asset, createdAt: 2 } as GenerationNodeResult)
    expect(again.history).toHaveLength(1)
    expect(again.history[0].versionNo).toBe(1)
  })

  it('backfills a legacy node before appending, so the newcomer is legacy max + 1', () => {
    const older = image('older', 'older.png')
    const newest = image('newest', 'newest.png')
    const landed = appendNodeResultVersion(node(older, [newest, older]), image('next', 'next.png'))
    expect(landed.history.map((entry) => [entry.id, entry.versionNo])).toEqual([['next', 3], ['newest', 2], ['older', 1]])
  })

  it('setting the main result only moves the pointer', () => {
    const v1 = { ...image('v1', 'v1.png'), versionNo: 1 }
    const v2 = { ...image('v2', 'v2.png'), versionNo: 2 }
    expect(setNodeMainResultPatch(node(v2, [v2, v1]), 'v1')).toEqual({ result: v1, status: 'success', error: undefined })
    expect(setNodeMainResultPatch(node(v2, [v2, v1]), 'missing')).toBeNull()
  })

  it('deleting the main result promotes the highest-numbered remaining version', () => {
    const v1 = { ...image('v1', 'v1.png'), versionNo: 1 }
    const v2 = { ...image('v2', 'v2.png'), versionNo: 2 }
    const v3 = { ...image('v3', 'v3.png'), versionNo: 3 }
    // 主图是第 1 版，删掉它：顶上来的是最新的第 3 版，不是列表里排在它后面的那张。
    const patch = removeNodeResult(node(v1, [v1, v2, v3]), 'v1')
    expect(patch?.result?.id).toBe('v3')
    expect(patch?.history?.map(resultIdentity)).toEqual(['v2', 'v3'])
  })

  it('lists version cards newest number first, regardless of history order', () => {
    const v1 = { ...image('v1', 'v1.png'), versionNo: 1 }
    const v5 = { ...image('v5', 'v5.png'), versionNo: 5 }
    const v3 = { ...image('v3', 'v3.png'), versionNo: 3 }
    expect(listNodeResultVersions(node(v1, [v1, v5, v3])).map((entry) => entry.versionNo)).toEqual([5, 3, 1])
  })
})
