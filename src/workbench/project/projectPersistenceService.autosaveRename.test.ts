import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'

// 自动保存只写渲染层拥有的字段（画布 / 时间轴 / 文档等内容）。项目名归「改名」那一个入口，
// 别的路径（项目库改名、Agent / MCP、主进程别的写口）改了名之后，下一次自动保存不能把旧名写回去。
// 走真实路径：真的 projectRepository + 真的 persistence service + 真的保存队列，只替换主进程那头的磁盘。

const deps = vi.hoisted(() => ({
  workbenchListener: null as (() => void) | null,
  generationListener: null as (() => void) | null,
  disk: new Map<string, Record<string, unknown>>(),
  sentToMain: [] as Array<Record<string, unknown>>,
  workbenchState: {
    workbenchDocuments: [], activeDocumentId: null as string | null, timeline: null, categories: [],
    storyboardDesignsByDocumentId: {}, persistRevision: 0,
  },
  generationState: {
    readDocumentSnapshot: vi.fn(() => ({ nodes: [], edges: [], groups: [] })), persistRevision: 0,
  },
}))

vi.mock('../generationCanvas/store/generationCanvasStore', () => ({
  useGenerationCanvasStore: {
    getState: () => deps.generationState,
    subscribe: (_selector: unknown, listener: () => void) => { deps.generationListener = listener; return vi.fn() },
  },
}))
vi.mock('../workbenchStore', () => ({
  useWorkbenchStore: {
    getState: () => deps.workbenchState,
    subscribe: (_selector: unknown, listener: () => void) => { deps.workbenchListener = listener; return vi.fn() },
  },
}))
vi.mock('../generationCanvas/events/canvasEventEmitter', () => ({
  emitCanvasGesture: vi.fn(), getCanvasEventLastSeq: vi.fn(() => 0), seedCanvasEventLastSeq: vi.fn(),
}))
vi.mock('../generationCanvas/agent/shotVerifyStore', () => ({ useShotVerifyStore: { getState: () => ({ activateProject: vi.fn() }) } }))
vi.mock('../../desktop/bridge', () => {
  // 主进程 saveWorkspaceProject 的合同：名字只取记录里的非空 name，否则沿用磁盘上的；
  // 其余摘要字段一律沿用磁盘；只换 payload。
  const save = async (id: string, record: Record<string, unknown>) => {
    deps.sentToMain.push(record)
    const existing = deps.disk.get(id)!
    const name = typeof record.name === 'string' && record.name.trim() ? record.name.trim() : existing.name
    const next = { ...existing, name, payload: record.payload, revision: (existing.revision as number) + 1 }
    deps.disk.set(id, next)
    return next
  }
  const read = (id: string) => deps.disk.get(id) ?? null
  return { getDesktopBridge: () => ({ projects: { read, readAsync: async (id: string) => read(id), save, list: () => [...deps.disk.values()] } }) }
})

import { createWorkbenchProjectPersistenceService } from './projectPersistenceService'
import { createProjectRecord } from './projectNormalize'

const PROJECT_ID = 'project-autosave'

function seedDisk(name: string) {
  const base = createProjectRecord(name)
  deps.disk.set(PROJECT_ID, { ...base, id: PROJECT_ID, name, thumbStyle: 'warm', seedKey: 'seed-a', revision: 1 })
  const payload = base.payload
  Object.assign(deps.workbenchState, {
    workbenchDocuments: payload.workbenchDocuments ?? [], activeDocumentId: payload.activeDocumentId ?? null,
    timeline: payload.timeline, categories: payload.categories, storyboardDesignsByDocumentId: payload.storyboardDesignsByDocumentId ?? {},
  })
  deps.generationState.readDocumentSnapshot.mockReturnValue(payload.generationCanvas as never)
}

async function openAndAutosaveAfter(otherPathRenamesTo: string | null) {
  const service = createWorkbenchProjectPersistenceService({ setActiveProject: vi.fn(), isActiveProject: () => true })
  const openedSummary = { ...(deps.disk.get(PROJECT_ID) as object) } as never
  const onSaved = vi.fn()
  const unbind = service.bindProjectPersistence({
    project: openedSummary, isHydrating: () => false, canPersist: () => true, onSaved, onSaveError: vi.fn(),
  })
  if (otherPathRenamesTo) deps.disk.set(PROJECT_ID, { ...deps.disk.get(PROJECT_ID)!, name: otherPathRenamesTo })
  deps.generationState.persistRevision += 1
  deps.generationListener?.()
  await vi.advanceTimersByTimeAsync(800)
  await unbind()
  return { onSaved }
}

describe('autosave never owns the project name', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    deps.disk.clear()
    deps.sentToMain.length = 0
    deps.workbenchListener = null
    deps.generationListener = null
    Object.assign(globalThis, { window: { addEventListener: vi.fn(), removeEventListener: vi.fn(), localStorage: { setItem: vi.fn(), getItem: vi.fn() } } })
  })
  afterEach(() => vi.useRealTimers())

  it('keeps a rename made by another path after the project was opened', async () => {
    seedDisk('Old name')
    const { onSaved } = await openAndAutosaveAfter('Renamed elsewhere')
    expect(deps.sentToMain).toHaveLength(1)
    expect(deps.disk.get(PROJECT_ID)?.name).toBe('Renamed elsewhere')
    expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ name: 'Renamed elsewhere' }))
  })

  it('still saves content and keeps the summary fields it does not own', async () => {
    seedDisk('Same name')
    await openAndAutosaveAfter(null)
    const saved = deps.disk.get(PROJECT_ID)!
    expect(saved.name).toBe('Same name')
    expect(saved.revision).toBe(2)
    expect(saved).toMatchObject({ thumbStyle: 'warm', seedKey: 'seed-a' })
  })

  it('an autosave record sent to main carries no name at all', async () => {
    seedDisk('Old name')
    await openAndAutosaveAfter(null)
    expect(deps.sentToMain[0]).not.toHaveProperty('name')
  })
})
