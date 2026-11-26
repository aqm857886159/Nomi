import fs from 'node:fs'
import os from 'node:os'
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

async function open(letter: 'A' | 'B' | 'C', beforeBind?: () => void) {
  const { world, projects } = openFixtureWorld()
  cleanup = world.cleanup
  const project = projects.find(entry => entry.name.startsWith('项目' + letter))!
  const deps = { settingsRoot: world.settingsDir, defaultProjectsRoot: world.projectsDir }
  const bytes = () => fs.readFileSync(project.file, 'utf8')
  const originalBytes = bytes()
  const readDisk = project.read
  const original = readDisk()
  const { id } = original
  const save = vi.fn(async (projectId: string, input: Record<string, unknown>) => ({
    ok: true, value: await saveWorkspaceProject(projectId, input, deps),
  }))
  vi.stubGlobal('window', {
    addEventListener: vi.fn(), removeEventListener: vi.fn(),
    localStorage: { getItem: () => null, setItem: vi.fn() },
    nomiDesktop: { projects: {
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
  return { original, originalBytes, readDisk, bytes, save, bind }
}

afterEach(async () => {
  try { await dispose?.() } finally {
    dispose = undefined
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
