import { describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createArtifactProjection } from '../productionRun/artifactProjection'
import { applyProductionCommand } from '../productionRun/productionRunReducer'
import type { ProductionRun } from '../productionRun/productionRunTypes'

const domain = vi.hoisted(() => ({ readFull: vi.fn(), readArtifactProjection: vi.fn(), listener: undefined as undefined | ((run: ProductionRun) => void), unsubscribe: vi.fn() }))
vi.mock('../productionRun/productionRunRuntime', () => ({
  getProductionRunService: () => ({ readFull: domain.readFull, readArtifactProjection: domain.readArtifactProjection }),
  subscribeProductionRunChanges: (listener: (run: ProductionRun) => void) => { domain.listener = listener; return domain.unsubscribe },
}))
import { createDesktopLaneTasks } from './laneDesktopTasks'

const run = (changes: Partial<ProductionRun> = {}): ProductionRun => ({
  projectId: 'project-a', runId: 'run-a', status: 'running',
  stages: [{ status: 'completed' }, { status: 'running' }],
  budget: { currency: 'CNY', reserved: 12, actual: 3 }, artifacts: [],
  ...changes,
} as ProductionRun)

describe('lane task cards follow the ProductionRun owner', () => {
  it('does not turn brief/direction artifacts into empty media candidates', () => {
    domain.readFull.mockReturnValue(run({ artifacts: [
      { artifactId: 'brief', kind: 'brief', status: 'ready' },
      { artifactId: 'direction', kind: 'direction', status: 'ready' },
    ] as ProductionRun['artifacts'] }))
    const tasks = createDesktopLaneTasks('project-a', vi.fn())
    expect(tasks.resolve('run-a')).not.toHaveProperty('candidateIds')
    expect(tasks.resolve('run-a')?.candidates).toEqual([])
    tasks.dispose()
  })
  it('refreshes settled facts without rereading task files for every conversation delta', () => {
    vi.clearAllMocks()
    domain.readFull.mockReturnValue(run())
    const refresh = vi.fn()
    const tasks = createDesktopLaneTasks('project-a', refresh)
    expect(tasks.resolve('run-a')).toEqual({ status: 'running', stagesDone: 1, stagesTotal: 2, progress: 50, candidates: [] })
    for (let index = 0; index < 50; index += 1) tasks.resolve('run-a')
    expect(domain.readFull).toHaveBeenCalledOnce()
    domain.listener!(run({ status: 'completed', stages: [{ status: 'completed' }] as ProductionRun['stages'],
      budget: { currency: 'USD', actual: 7, reserved: 0 } as ProductionRun['budget'] }))
    expect(refresh).toHaveBeenCalledOnce()
    expect(tasks.resolve('run-a')).toEqual({ status: 'complete', stagesDone: 1, stagesTotal: 1, progress: 100, candidates: [] })
    expect(domain.readFull).toHaveBeenCalledOnce()
    tasks.dispose()
    expect(domain.unsubscribe).toHaveBeenCalledOnce()
  })

  // 任务卡不印金额（LaneTaskFacts 抬头）：账本合计只加已知价、实付从不回写，卡上印它就是印假数。
  // 判据是键集合——多出任何一个键（币种、已花、预估，或下一个读账本的字段）都红，首次读和领域变更后重投都核。
  it('projects no money: task facts carry only status, stages, progress and candidates even when the ledger has totals', () => {
    vi.clearAllMocks()
    const allowed = ['candidates', 'progress', 'stagesDone', 'stagesTotal', 'status']
    domain.readFull.mockReturnValue(run({ budget: { currency: 'CNY', reserved: 12, actual: 3, authorized: 20 } as ProductionRun['budget'] }))
    const tasks = createDesktopLaneTasks('project-a', vi.fn())
    const first = tasks.resolve('run-a')!
    expect(Object.keys(first).every((key) => allowed.includes(key)), Object.keys(first).join(',')).toBe(true)
    for (const key of ['currency', 'spent', 'estimated']) expect(first).not.toHaveProperty(key)
    domain.listener!(run({ status: 'paused', budget: { currency: 'USD', reserved: 0, actual: 7, authorized: 20 } as ProductionRun['budget'] }))
    const changed = tasks.resolve('run-a')!
    expect(changed.status).toBe('stopped')
    expect(Object.keys(changed).every((key) => allowed.includes(key)), Object.keys(changed).join(',')).toBe(true)
    for (const key of ['currency', 'spent', 'estimated']) expect(changed).not.toHaveProperty(key)
    tasks.dispose()
  })

  it('uses verified media previews and domain adoption eligibility for initial and changed tasks', async () => {
    const root = await mkdtemp(join(tmpdir(), 'nomi-lane-task-pixels-'))
    try {
      await writeFile(join(root, 'image.png'), 'fixture pixels')
      await writeFile(join(root, 'poster.png'), 'fixture poster')
      const artifacts = [
        { artifactId: 'image', kind: 'image', status: 'candidate', reviewStatus: 'approved', projectRelativePath: 'image.png' },
        { artifactId: 'adopted', kind: 'image', status: 'adopted', reviewStatus: 'approved', projectRelativePath: 'image.png' },
        { artifactId: 'unreviewed', kind: 'image', status: 'candidate', reviewStatus: 'waiting', projectRelativePath: 'image.png' },
        { artifactId: 'video', kind: 'video', status: 'ready', thumbnailRelativePath: 'poster.png' },
        { artifactId: 'missing', kind: 'image', status: 'candidate', projectRelativePath: 'missing.png' },
        { artifactId: 'outside', kind: 'image', status: 'candidate', projectRelativePath: '../outside.png' },
        { artifactId: 'video-without-poster', kind: 'video', status: 'ready', projectRelativePath: 'image.png' },
        { artifactId: 'rejected', kind: 'image', status: 'rejected', projectRelativePath: 'image.png' },
        { artifactId: 'brief', kind: 'brief', status: 'ready', projectRelativePath: 'image.png' },
      ].map(artifact => ({ ...artifact, stageId: 'generate', createdAt: '2026-09-08' })) as ProductionRun['artifacts']
      let current = run({ artifacts })
      domain.readFull.mockReturnValue(current)
      domain.readArtifactProjection.mockImplementation((_projectId, _runId, artifactId) => createArtifactProjection({
        projectRoot: root, run: current, artifact: current.artifacts.find(item => item.artifactId === artifactId)!, secret: 'fixture-secret',
      }))
      const refresh = vi.fn()
      const tasks = createDesktopLaneTasks('project-a', refresh)
      const candidates = tasks.resolve('run-a')!.candidates!
      expect(candidates.map(item => item.artifactId)).toEqual(['image', 'adopted', 'unreviewed', 'video'])
      expect(candidates.map(item => [item.canAdopt, item.adopted])).toEqual([[true, false], [false, true], [false, false], [false, false]])
      expect(candidates.every(item => item.projectId === 'project-a' && item.productionRunId === 'run-a'
        && item.thumbnailUrl.startsWith('nomi-local://production-preview/project-a/run-a/'))).toBe(true)
      const command = { commandId: 'adopt-image', expectedRevision: current.revision, type: 'artifact.adopt',
        payload: { artifactId: 'image' }, issuedAt: '2026-09-08T00:00:00Z' }
      expect(() => applyProductionCommand(current, { ...command, payload: { artifactId: 'unreviewed' } }, command.issuedAt))
        .toThrow('Artifact requires approved review')
      current = applyProductionCommand(current, command, command.issuedAt).run
      domain.listener!(current)
      expect(tasks.resolve('run-a')!.candidates![0]).toMatchObject({ adopted: true, canAdopt: false })
      expect(refresh).toHaveBeenCalledOnce()
      tasks.dispose()
    } finally { await rm(root, { recursive: true, force: true }) }
  })

  it('renews expired previews without rereading on every token delta', () => {
    vi.useFakeTimers()
    try {
      vi.clearAllMocks()
      domain.readFull.mockReturnValue(run({ artifacts: [{ artifactId: 'image', kind: 'image', status: 'candidate' }] as ProductionRun['artifacts'] }))
      domain.readArtifactProjection.mockImplementation(() => ({ projectId: 'project-a', runId: 'run-a', artifactId: 'image',
        preview: { nomiUrl: 'nomi-local://production-preview/image', expiresAt: new Date(Date.now() + 60_000).toISOString() } }))
      const tasks = createDesktopLaneTasks('project-a', vi.fn())
      for (let index = 0; index < 50; index += 1) tasks.resolve('run-a')
      expect(domain.readFull).toHaveBeenCalledOnce()
      vi.setSystemTime(Date.now() + 60_001)
      expect(tasks.resolve('run-a')!.candidates).toHaveLength(1)
      expect(domain.readFull).toHaveBeenCalledTimes(2)
      tasks.dispose()
    } finally { vi.useRealTimers() }
  })

  it('does not paint a different project task as the current project or invent missing facts', () => {
    vi.clearAllMocks()
    domain.readFull.mockImplementation(() => { throw new Error('run not found') })
    const refresh = vi.fn()
    const tasks = createDesktopLaneTasks('project-a', refresh)
    domain.listener!(run({ projectId: 'project-b' }))
    expect(refresh).not.toHaveBeenCalled()
    expect(tasks.resolve('run-a')).toBeUndefined()
    tasks.dispose()
  })
})
