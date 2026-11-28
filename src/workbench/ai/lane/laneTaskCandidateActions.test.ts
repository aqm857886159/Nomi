import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProductionRun } from '../../../../electron/shared/contracts/productionRunTypes'
import { executeLaneTaskCandidateAdoption } from './laneTaskCandidateActions'
import { withProjectAction } from '../../project/projectCanvasReadSurface'
import { createProjectSessionTestHarness, type ProjectSessionTestHarness } from '../../project/projectSessionTestHarness'

const candidate = { projectId: 'project-a', productionRunId: 'run-a', artifactId: 'image-a',
  tag: '1', thumbnailUrl: 'nomi-local://asset/project-a/image.png', adopted: false, canAdopt: true }
const run = { projectId: 'project-a', runId: 'run-a', revision: 7,
  artifacts: [{ artifactId: 'image-a', kind: 'image', status: 'candidate', reviewStatus: 'approved' }] } as ProductionRun
const deps = () => ({ read: vi.fn().mockResolvedValue(run), command: vi.fn().mockResolvedValue({ run, events: [] }), project: withProjectAction((project) => project)! })

let projectSession: ProjectSessionTestHarness
beforeEach(async () => { projectSession = createProjectSessionTestHarness(); await projectSession.open('project-a') })
afterEach(() => projectSession.dispose())

describe('lane candidate adoption uses the existing domain command', () => {
  it('keeps artifact identity and revision; it does not manufacture review approval', async () => {
    const api = deps()
    await executeLaneTaskCandidateAdoption(candidate, api)
    expect(api.command).toHaveBeenCalledExactlyOnceWith('project-a', 'run-a', expect.objectContaining({
      type: 'artifact.adopt', expectedRevision: 7, payload: { artifactId: 'image-a' },
    }))
  })
  it('does not execute absent, unreviewed, already adopted or cross-project candidates', async () => {
    const api = deps()
    for (const value of [{ tag: '1' }, { ...candidate, canAdopt: false }, { ...candidate, adopted: true },
      { ...candidate, projectId: 'other-project' }, { ...candidate, thumbnailUrl: '' }]) {
      await executeLaneTaskCandidateAdoption(value, api)
    }
    expect(api.read).not.toHaveBeenCalled()
    expect(api.command).not.toHaveBeenCalled()
  })
  it('preserves a domain refusal and does not retry it as approval', async () => {
    const api = deps()
    api.command.mockRejectedValue(new Error('Artifact requires approved review'))
    await expect(executeLaneTaskCandidateAdoption(candidate, api)).rejects.toThrow('approved review')
    expect(api.command).toHaveBeenCalledOnce()
  })
  it('deduplicates repeated clicks and stops if the user changed projects during the read', async () => {
    const api = deps()
    let release!: (value: ProductionRun) => void
    api.read.mockImplementation(() => new Promise(resolve => { release = resolve }))
    const first = executeLaneTaskCandidateAdoption(candidate, api)
    await executeLaneTaskCandidateAdoption(candidate, api)
    expect(api.read).toHaveBeenCalledOnce()
    await projectSession.open('another-project')
    release(run)
    await first
    expect(api.command).not.toHaveBeenCalled()
  })
})
