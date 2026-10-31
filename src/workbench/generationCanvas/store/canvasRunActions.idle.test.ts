import { readFileSync } from 'node:fs'
import { doorsForTargets } from '../../../../scripts/door-map.mjs'
import { describe, expect, it } from 'vitest'
import { produce } from 'immer'
import { createCanvasRunActions } from './canvasRunActions'
import type { GenerationCanvasState } from './canvasStoreTypes'
import type { GenerationCanvasNode } from '../model/generationCanvasTypes'
import type { NodeProgressInput } from './runRecordHelpers'
import matrix from '../../../../tests/fixtures/generation-idle-progress.json'

function fixture(queued = false) {
  let state = {
    persistRevision: 0,
    nodes: [{ id: 'node', kind: 'video', status: queued ? 'queued' : 'running',
      progress: { runId: 'run-1', phase: 'generating', updatedAt: 1 },
      runs: [{ id: 'run-1', status: queued ? 'queued' : 'running', startedAt: 1, updatedAt: 1 }] } as GenerationCanvasNode],
  } as GenerationCanvasState
  let dirtySignals = 0
  const set = ((change: (draft: GenerationCanvasState) => void) => {
    const previous = state.persistRevision
    state = produce(state, change)
    if (state.persistRevision !== previous) dirtySignals++
  }) as Parameters<typeof createCanvasRunActions>[0]
  const actions = createCanvasRunActions(set, () => state, {} as Parameters<typeof createCanvasRunActions>[2])
  return { actions, read: () => state, dirtySignals: () => dirtySignals }
}

describe('progress persistence boundary across every direct door', () => {
  it('binds the matrix to the actual direct call sites', () => {
    for (const door of matrix.doors) expect(readFileSync(door, 'utf8')).toContain('setNodeProgress')
    expect(matrix.doors).toHaveLength(7)
    expect(doorsForTargets(['setNodeProgress']).map((door: { path: string }) => door.path).sort()).toEqual([...matrix.doors].sort())
  })
  for (const door of matrix.doors) {
    describe(door, () => {
      it.each(matrix.events)('$name dirty=$dirty', ({ patch, dirty, queued }) => {
        const f = fixture(queued)
        f.actions.setNodeProgress('node', { runId: 'run-1', phase: 'generating', ...patch } as NodeProgressInput)
        expect(f.dirtySignals()).toBe(dirty ? 1 : 0)
        expect(f.read().nodes[0].progress).toMatchObject(patch)
      })
    })
  }
  it('30 seconds of pure percent ticks produce zero autosave dirty signals', () => {
    const f = fixture()
    for (let second = 0; second < 30; second++) f.actions.setNodeProgress('node', { runId: 'run-1', phase: 'generating', percent: second, updatedAt: second + 2 })
    expect(f.read().nodes[0].progress?.percent).toBe(29)
    expect(f.dirtySignals()).toBe(0)
  })
  it('persists taskId once and retains it after serialization, then still persists terminal states', () => {
    const f = fixture()
    f.actions.setNodeProgress('node', { runId: 'run-1', taskId: 'provider-1', taskKind: 'video' })
    expect(f.dirtySignals()).toBe(1)
    for (let percent = 0; percent < 10; percent++) f.actions.setNodeProgress('node', { runId: 'run-1', taskId: 'provider-1', taskKind: 'video', percent })
    expect(f.dirtySignals()).toBe(1)
    expect(JSON.parse(JSON.stringify(f.read())).nodes[0].runs[0].taskId).toBe('provider-1')
    f.actions.setNodeProgress('node', { runId: 'run-1', taskId: 'provider-2', taskKind: 'video' })
    expect(f.dirtySignals()).toBe(2)
    f.actions.setNodeStatus('node', 'error', 'failed')
    f.actions.setNodeStatus('node', 'idle')
    f.actions.addNodeResult('node', { id: 'result', type: 'video', url: 'local.mp4', createdAt: 100 })
    expect(f.dirtySignals()).toBe(5)
  })
})

it.each(['success', 'error', 'idle'] as const)('terminal %s still marks dirty and survives serialization', status => {
  const f = fixture()
  f.actions.setNodeStatus('node', status, status === 'error' ? 'failed' : undefined)
  expect(f.dirtySignals()).toBe(1)
  const restored = JSON.parse(JSON.stringify(f.read())).nodes[0]
  expect(restored.status).toBe(status)
  expect(restored.runs[0].status).toBe(status === 'idle' ? 'cancelled' : status)
})

it.each([
  { name: 'taskId', before: { taskId: 'old-task' }, after: { taskId: 'new-task' } },
  { name: 'taskKind', before: { taskKind: 'image' as const }, after: { taskKind: 'video' as const } },
])('repairs legacy $name even when displayed progress already has the new identity', ({ before, after }) => {
  const f = fixture()
  Object.assign(f.read().nodes[0].progress!, after)
  Object.assign(f.read().nodes[0].runs![0], before)
  f.actions.setNodeProgress('node', { runId: 'run-1', ...after })
  expect(f.read().nodes[0].runs?.[0]).toMatchObject(after)
  expect(f.dirtySignals()).toBe(1)
})
