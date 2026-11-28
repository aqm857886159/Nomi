import fs from 'node:fs'
import os from 'node:os'
import { appendEvents, readEvents, resetEventLogStateForTests, setEventLogProjectDirResolverForTests } from '../../../electron/events/eventLogRepository'
import { ensureLocalAssetPreview } from '../../../electron/assets/localFileImport'
import { applyCanvasNodePatch } from '../../../electron/projects/projectCanvasWrite'
import { setCanvasEventProjectIdProvider } from '../generationCanvas/events/canvasEventEmitter'
import { initResultMediaBackfillBridge } from '../generationCanvas/resultMediaBackfillBridge'
import { createProjectCanvasReadSurfaceCoordinator, registerProjectCanvasReadSurfaceCoordinator } from './projectCanvasReadSurface'
import type { CanvasReadSurfaceBridge } from '../../../electron/shared/surfacePortBinding'
import type { WorkbenchProjectRecordV1 } from './projectRecordSchema'
import { openFixtureWorld } from '../../../tests/fixtures/readonlyOpenProjects'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { readWorkspaceProject, saveWorkspaceProject } from '../../../electron/workspace/workspaceRepository'
import { useGenerationCanvasStore } from '../generationCanvas/store/generationCanvasStore'
import { useWorkbenchStore } from '../workbenchStore'
import { createWorkbenchProjectPersistenceService } from './projectPersistenceService'
import { flushPendingWorkbenchProjectSaves, persistActiveWorkbenchProjectNow } from './workbenchProjectSession'

vi.mock('electron', () => ({ app: { getPath: () => os.tmpdir(), getAppPath: () => process.cwd() } }))

const canvas = useGenerationCanvasStore.getState
const workbench = useWorkbenchStore.getState
let dispose: (() => Promise<void>) | undefined
let cleanup: (() => void) | undefined

async function open(letter: 'A' | 'B' | 'C', beforeBind?: () => void, prepare?: (record: WorkbenchProjectRecordV1) => void) {
  const { world, projects } = openFixtureWorld()
  cleanup = world.cleanup
  const project = projects.find(entry => entry.name.startsWith('项目' + letter))!
  const deps = { settingsRoot: world.settingsDir, defaultProjectsRoot: world.projectsDir }
  const bytes = () => fs.readFileSync(project.file, 'utf8')
  vi.stubEnv('NOMI_SETTINGS_DIR', world.settingsDir)
  vi.stubEnv('NOMI_PROJECTS_DIR', world.projectsDir)
  if (prepare) {
    const record = project.read()
    prepare(record)
    await saveWorkspaceProject(project.id, { payload: record.payload }, deps)
  }
  const originalBytes = bytes()
  const readDisk = project.read
  const original = readDisk()
  const { id } = original
  const save = vi.fn(async (projectId: string, input: Record<string, unknown>) => ({
    ok: true, value: await saveWorkspaceProject(projectId, input, deps),
  }))
  const events = {
    read: vi.fn(async (owner: string, fromSeq: number) => ({ events: readEvents(owner, { fromSeq }) })),
    append: vi.fn(async (owner: string, batch: Parameters<typeof appendEvents>[1]) => ({
      lastSeq: appendEvents(owner, batch).at(-1)?.seq ?? 0,
    })),
  }
  setEventLogProjectDirResolverForTests(owner => projects.find(entry => entry.id === owner)?.rootPath ?? null)
  setCanvasEventProjectIdProvider(() => id)
  vi.stubGlobal('window', {
    addEventListener: vi.fn(), removeEventListener: vi.fn(),
    localStorage: { getItem: () => null, setItem: vi.fn() },
    nomiDesktop: { events, projects: {
      readAsync: async (projectId: string) => readWorkspaceProject(projectId, deps),
      save, listAsync: async () => [],
    } },
  })
  const service = createWorkbenchProjectPersistenceService({ setActiveProject: vi.fn(), isActiveProject: () => true })
  const guard = { signal: new AbortController().signal, assertCurrent: () => {} }
  const hydrated = await service.hydrateProject(id, guard)
  if (!hydrated) throw new Error('fixture failed to open')
  const bind = () => service.bindProjectPersistence({
    project: hydrated, isHydrating: () => false, canPersist: () => true, onSaved: vi.fn(), onSaveError: vi.fn(),
  })
  beforeBind?.()
  dispose = bind()
  return { original, originalBytes, readDisk, bytes, save, bind, events, reopen: () => service.hydrateProject(id, guard) }
}

afterEach(async () => {
  try { await dispose?.() } finally {
    dispose = undefined
    setCanvasEventProjectIdProvider(() => null)
    resetEventLogStateForTests()
    vi.useRealTimers()
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
    cleanup?.()
  }
})

describe('v0.24.1 project persistence', () => {
  it.each(['A', 'B', 'C'] as const)('%s migrates the editable projection without saving the manifest', async letter => {
    const { originalBytes, bytes, save } = await open(letter)
    expect(canvas().nodes[0]?.renderKind).toBe('shot-frame')
    if (letter === 'B') expect(canvas().nodes.some(node => node.status === 'recoverable')).toBe(true)
    expect(save.mock.calls.length).toBe(0)
    expect(bytes() === originalBytes).toBe(true)
  })

  it('auto fit and clean close return the durable receipt without rewriting scale', async () => {
    const { original, originalBytes, bytes, save } = await open('A')
    save.mockClear()
    workbench().setTimelineZoom(4, 'viewport')
    expect(workbench().timeline.scale).toBe(4)
    const receipt = await persistActiveWorkbenchProjectNow()
    expect(save.mock.calls.length).toBe(0)
    expect(receipt?.revision).toBe(original.revision)
    expect(receipt?.payload.generationCanvas.nodes[0]?.renderKind).toBeUndefined()
    expect(bytes() === originalBytes).toBe(true)
  })

  it('first prompt edit saves the migrated shot and the original scale in one revision', async () => {
    const { original, readDisk, save } = await open('A')
    save.mockClear()
    workbench().setTimelineZoom(4, 'viewport')
    const id = canvas().nodes[0]!.id
    canvas().updateNodePrompt(id, '雨停后推近窗边')
    await flushPendingWorkbenchProjectSaves()
    expect(save.mock.calls.length).toBe(1)
    const record = readDisk()
    expect(record.payload.generationCanvas.nodes.find(node => node.id === id)).toMatchObject({
      prompt: '雨停后推近窗边', renderKind: 'shot-frame',
    })
    expect(record.payload.timeline.scale).toBe(original.payload.timeline.scale)
    expect(record.revision).toBe((original.revision ?? 0) + 1)
  })

  it('manual Fit at the displayed scale is a single durable edit even after resize', async () => {
    const { original, readDisk, save } = await open('C')
    save.mockClear()
    workbench().setTimelineZoom(6, 'viewport')
    const before = workbench().persistRevision
    workbench().setTimelineZoom(6)
    expect(workbench().persistRevision).toBe(before + 1)
    workbench().setTimelineZoom(3, 'viewport')
    await flushPendingWorkbenchProjectSaves()
    expect(save.mock.calls.length).toBe(1)
    expect(readDisk().payload.timeline.scale).toBe(6)
    expect(readDisk().revision).toBe((original.revision ?? 0) + 1)
    canvas().updateNodePrompt(canvas().nodes[0]!.id, 'later edit after resize')
    await flushPendingWorkbenchProjectSaves()
    expect(readDisk().payload.timeline.scale).toBe(6)
  })

  it('keeps an edit made after hydrate and before the persistence subscription mounts', async () => {
    const { readDisk, original } = await open('A', () => {
      canvas().updateNodePrompt(canvas().nodes[0]!.id, 'edited before binding')
    })
    await flushPendingWorkbenchProjectSaves()
    expect(readDisk().payload.generationCanvas.nodes[0]?.prompt).toBe('edited before binding')
    expect(readDisk().revision).toBe((original.revision ?? 0) + 1)
  })

  it('reopens a success written to a closed project after its first edit', async () => {
    const { original, readDisk, events, reopen } = await open('B')
    const live = canvas().nodes.find(node => node.status === 'recoverable')!
    const run = live.runs!.find(entry => entry.taskId === 's-walk-video-8')!
    canvas().updateNodePrompt(live.id, 'edited before close')
    await dispose!()
    await vi.waitFor(() => expect(events.append).toHaveBeenCalledOnce())
    const result = { id: 'paid-result', type: 'video', url: 'nomi-local://asset/' + original.id + '/paid.mp4', createdAt: 1 }
    const patch = { result, status: 'success', runs: [{ ...run, status: 'success', resultId: result.id }] }
    expect(await applyCanvasNodePatch({ projectId: original.id, nodeId: live.id, patch })).toEqual({ applied: true })
    expect(readDisk().payload.generationCanvas.nodes.find(node => node.id === live.id)?.result).toMatchObject(result)
    await reopen()
    expect(canvas().nodes.find(node => node.id === live.id)).toMatchObject({ result, status: 'success', runs: [expect.objectContaining({ id: run.id, taskId: run.taskId, resultId: result.id, status: 'success' })], prompt: 'edited before close' })
    expect(events.read.mock.lastCall?.[1]).toBe(readEvents(original.id).at(-1)?.seq)
  })

  it('replays only the unsaved second edit of a project opened without a cursor', async () => {
    const { original, readDisk, events, reopen, save } = await open('A', undefined, record => {
      delete record.payload.generationCanvasLastSeq
    })
    vi.useFakeTimers()
    const id = canvas().nodes[0].id
    canvas().updateNodePrompt(id, 'first edit saved')
    await vi.advanceTimersByTimeAsync(700)
    await flushPendingWorkbenchProjectSaves()
    const firstSeq = readDisk().payload.generationCanvasLastSeq
    canvas().updateNodePrompt(id, 'second edit in the log')
    await vi.advanceTimersByTimeAsync(50)
    expect(save).toHaveBeenCalledOnce()
    expect(readDisk().payload.generationCanvas.nodes[0].prompt).toBe('first edit saved')
    expect(readEvents(original.id).at(-1)?.payload).toMatchObject({ nodeId: id, prompt: 'second edit in the log' })
    await reopen()
    expect(canvas().nodes[0].prompt).toBe('second edit in the log')
    expect(firstSeq).toBeGreaterThan(0)
    expect(events.read.mock.lastCall?.[1]).toBe(firstSeq)
    canvas().updateNodePrompt(id, 'after restart')
    canvas().undo()
    expect(canvas().nodes[0].prompt).toBe('second edit in the log')
  })

  it('keeps a suffix from the same append outside an earlier manifest snapshot', async () => {
    const { original, readDisk, reopen } = await open('A')
    const id = canvas().nodes[0].id
    canvas().updateNodePrompt(id, 'snapshot prefix')
    canvas().updateNode(id, { prompt: 'journal suffix' }, { persist: false })
    await flushPendingWorkbenchProjectSaves()
    const saved = readDisk().payload
    expect(saved.generationCanvas.nodes[0].prompt).toBe('snapshot prefix')
    const tail = readEvents(original.id, { fromSeq: saved.generationCanvasLastSeq })
    expect(tail.map(event => event.payload)).toEqual([expect.objectContaining({ nodeId: id, patch: expect.objectContaining({ prompt: 'journal suffix' }) })])
    await reopen()
    expect(canvas().nodes[0].prompt).toBe('journal suffix')
  })

  it('still saves the manifest with its confirmed cursor on append failure', async () => {
    const { readDisk, events, original } = await open('B')
    const confirmed = events.read.mock.lastCall?.[1] ?? original.payload.generationCanvasLastSeq
    events.append.mockRejectedValueOnce(new Error('append failed'))
    canvas().updateNodePrompt(canvas().nodes[0].id, 'saved without append')
    await flushPendingWorkbenchProjectSaves()
    expect(readDisk().payload).toMatchObject({
      generationCanvasLastSeq: confirmed,
      generationCanvas: { nodes: expect.arrayContaining([expect.objectContaining({ prompt: 'saved without append' })]) },
    })
  })

  it('selects and seeks on A without a save, then persists one changed clip position', async () => {
    const { readDisk, save } = await open('A')
    const clip = workbench().timeline.tracks.flatMap(track => track.clips)[0]
    const revision = workbench().persistRevision
    const history = workbench().timelineHistory.entries.pastStates.length
    workbench().selectTimelineClip(clip.id)
    workbench().setTimelinePlayhead(clip.startFrame + 1)
    workbench().moveTimelineClip(clip.id, clip.startFrame, { commit: true })
    await persistActiveWorkbenchProjectNow()
    expect(workbench().persistRevision).toBe(revision)
    expect(workbench().timelineHistory.entries.pastStates).toHaveLength(history)
    expect(save).not.toHaveBeenCalled()
    workbench().moveTimelineClip(clip.id, clip.startFrame + 5, { commit: true })
    await persistActiveWorkbenchProjectNow()
    expect(workbench().persistRevision).toBe(revision + 1)
    expect(save).toHaveBeenCalledOnce()
    expect(readDisk().payload.timeline.tracks.flatMap(track => track.clips).find(entry => entry.id === clip.id)?.startFrame).toBe(clip.startFrame + 5)
  })

  it('keeps backfilled local preview facts in memory until the first prompt edit', async () => {
    const { original, originalBytes, bytes, readDisk, save } = await open('A', undefined, record => {
      const result = record.payload.generationCanvas.nodes[0].result!
      delete result.previewState
      delete result.thumbnailUrl
      // Isolate the old manifest from any later event already present in the frozen log.
      delete record.payload.generationCanvasLastSeq
    })
    const id = canvas().nodes[0].id
    const revision = canvas().persistRevision
    const coordinator = createProjectCanvasReadSurfaceCoordinator({
      createSurfaceInstanceId: () => 'window',
      getSurfaceBridge: () => ({
        suspend: async () => ({ suspension: {} }),
        commitCanvasRead: async () => ({ binding: { binding: {
          projectId: original.id, immutableProjectUuid: '11111111-1111-4111-8111-111111111111', projectGeneration: 1,
        } } }),
      } as unknown as CanvasReadSurfaceBridge),
    })
    const unregister = registerProjectCanvasReadSurfaceCoordinator(coordinator)
    const stop = initResultMediaBackfillBridge({
      ensurePreview: ensureLocalAssetPreview,
      decodePreview: async () => true, yieldToForeground: async () => {},
    })
    try {
      await coordinator.beginHydration().commitCanvasRead(original.id)
      await vi.waitFor(() => expect(canvas().nodes[0].result?.previewState).toBe('source'))
      await persistActiveWorkbenchProjectNow()
      expect(canvas().persistRevision).toBe(revision)
      expect(save).not.toHaveBeenCalled()
      expect(bytes()).toBe(originalBytes)
      canvas().updateNodePrompt(id, 'with preview')
      await persistActiveWorkbenchProjectNow()
      expect(save).toHaveBeenCalledOnce()
      expect(readDisk().payload.generationCanvas.nodes[0]).toMatchObject({ prompt: 'with preview', result: { previewState: 'source' } })
    } finally { stop(); unregister() }
  })

  it('B saves the real run outcome against its existing task and run', async () => {
    const { original, readDisk, save } = await open('B')
    save.mockClear()
    const live = canvas().nodes.find(node => node.status === 'recoverable')!
    const run = live.runs!.find(entry => entry.taskId === 's-walk-video-8')!
    canvas().applyRunOutcome(live.id, { kind: 'status', runId: run.id, status: 'error', error: 'supplier confirmed failure' })
    await flushPendingWorkbenchProjectSaves()
    expect(save.mock.calls.length).toBe(1)
    const node = readDisk().payload.generationCanvas.nodes.find(entry => entry.id === live.id)!
    expect(node.runs?.find(entry => entry.id === run.id)).toMatchObject({ status: 'error', taskId: run.taskId })
    expect(node.renderKind).toBe('shot-frame')
    expect(readDisk().revision).toBe((original.revision ?? 0) + 1)
  })
})
