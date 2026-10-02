import React from 'react'
import { renderToString } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DirectorStoreContext } from './DirectorEditorContext'
import { AI_SCENE_FIXTURE, type AiSceneSpec } from './model/aiScene'
import { createDirectorStore } from './model/directorStore'
import { createDefaultScene } from './model/directorProject'
import { useAiSceneBuilder } from './useAiSceneBuilder'
import { importWorkbenchLocalAssetFile } from '../../../api/assetUploadApi'
import { createProjectCanvasReadSurfaceCoordinator, registerProjectCanvasReadSurfaceCoordinator } from '../../../project/projectCanvasReadSurface'
import type { CanvasReadSurfaceBridge } from '../../../../../electron/shared/surfacePortBinding'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('../../../../ui/toast', () => ({ toast: vi.fn() }))
vi.mock('../../../api/assetUploadApi', () => ({ hostedAssetUrl: () => 'nomi-local://scene.json', importWorkbenchLocalAssetFile: vi.fn(async () => ({})) }))
vi.mock('../../../api/promptLibraryApi', () => ({ getTextBrain: vi.fn() }))
vi.mock('../../../api/taskApi', () => ({ runWorkbenchTextTaskStream: vi.fn() }))
vi.mock('../../../ai/agentLoopMode', () => ({
  runSingleShotAgent: vi.fn(async () => ({ status: 'finished', text: '{"prompt":"Shot 1: orbit around the character for 2s"}' })),
}))

function deferred<T = AiSceneSpec>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

function setup(e2e = true) {
  const pending = [deferred(), deferred()]
  const mock = vi.fn().mockReturnValueOnce(pending[0].promise).mockReturnValueOnce(pending[1].promise)
  vi.stubGlobal('window', { localStorage: { getItem: () => e2e ? '1' : '0' }, __nomiDirectorAiMock: mock, setInterval: () => 1, clearInterval: () => {} })
  const store = createDirectorStore({ defaultSceneName: 'S1' })
  let builder!: ReturnType<typeof useAiSceneBuilder>
  function Host() { builder = useAiSceneBuilder(); return null }
  renderToString(React.createElement(DirectorStoreContext.Provider, { value: store }, React.createElement(Host)))
  return { builder, store, pending, mock }
}

let coordinator: ReturnType<typeof createProjectCanvasReadSurfaceCoordinator>
let unregister: () => void = () => undefined
async function openProject(projectId: string) { await coordinator.beginHydration().commitCanvasRead(projectId) }
beforeEach(async () => {
  vi.mocked(importWorkbenchLocalAssetFile).mockClear()
  coordinator = createProjectCanvasReadSurfaceCoordinator({
    createSurfaceInstanceId: () => 'director-window',
    getSurfaceBridge: () => ({ suspend: async () => ({ suspension: {} }), release: async () => ({ released: true }),
      commitCanvasRead: async ({ projectId }: { projectId: string }) => ({ binding: { binding: {
        projectId, immutableProjectUuid: '11111111-1111-4111-8111-111111111111', projectGeneration: 1,
      } } }),
    } as unknown as CanvasReadSurfaceBridge),
  })
  unregister = registerProjectCanvasReadSurfaceCoordinator(coordinator)
  await openProject('project-a')
})
afterEach(() => { unregister(); vi.unstubAllGlobals() })

describe('AI scene request ownership (real hook callbacks)', () => {
  it('routes explicit camera language through the typed Director plan path', async () => {
    const { builder, store, mock } = setup()
    expect(await builder.run('A character pushes in for 2s', [], 'current_layer')).toBe(true)
    expect(mock).not.toHaveBeenCalled()
    expect(store.getState().activeScene().cameras[0]?.trajectoryClips).toHaveLength(1)
    expect(store.getState().activeScene().cameras[0]?.motionTrajectory?.length).toBeGreaterThan(1)
  })

  it('routes the production director path through the Agent Lane Skill and hands off POV', async () => {
    const { builder, store } = setup(false)
    const runtime = await import('../../../ai/agentLoopMode')
    expect(await builder.run('orbit around the character', [], 'current_layer')).toBe(true)
    expect(vi.mocked(runtime.runSingleShotAgent)).toHaveBeenCalledWith(expect.objectContaining({ skillKey: 'director-cinematography', featureKey: 'director.preview-plan' }))
    expect(store.getState().activeCameraId).toMatch(/^dplan-camera-/)
    expect(store.getState().timeline.currentTime).toBe(0)
  })

  it('result stays in the scene selected when the request started', async () => {
    const { builder, store, pending } = setup()
    const originalId = store.getState().project.activeSceneId
    const running = builder.run('cafe', [], 'current_layer')
    const next = createDefaultScene('S2')
    store.setState((state) => ({ project: { ...state.project, scenes: [...state.project.scenes, next], activeSceneId: next.id } }))
    pending[0].resolve(AI_SCENE_FIXTURE)
    expect(await running).toBe(true)
    expect(store.getState().project.scenes.find((scene) => scene.id === originalId)?.objects.length).toBeGreaterThan(0)
    expect(store.getState().activeScene().objects).toHaveLength(0)
  })

  it('reset invalidates a pending result and leaves no scene or library asset', async () => {
    const { builder, store, pending } = setup()
    const running = builder.run('cafe', [], 'new_layer')
    builder.reset()
    pending[0].resolve(AI_SCENE_FIXTURE)
    expect(await running).toBe(false)
    expect(store.getState().project.scenes).toHaveLength(1)
    expect(store.getState().project.assets.items).toHaveLength(0)
  })

  it('cancel releases admission immediately; an old finally cannot clear the new request', async () => {
    const { builder, store, pending, mock } = setup()
    const first = builder.run('old', [], 'new_layer')
    builder.cancel()
    const second = builder.run('new', [], 'new_layer')
    expect(mock).toHaveBeenCalledTimes(2)
    pending[0].resolve(AI_SCENE_FIXTURE)
    expect(await first).toBe(false)
    expect(await builder.run('third', [], 'new_layer')).toBe(false)
    pending[1].resolve(AI_SCENE_FIXTURE)
    expect(await second).toBe(true)
    expect(store.getState().project.scenes).toHaveLength(2)
  })

  it('cancel while the exported file is being saved cannot leave partial geometry or a library entry', async () => {
    const { builder, store, pending } = setup()
    const uploadStarted = deferred<void>()
    const upload = deferred<Awaited<ReturnType<typeof importWorkbenchLocalAssetFile>>>()
    vi.mocked(importWorkbenchLocalAssetFile).mockImplementationOnce(() => {
      uploadStarted.resolve()
      return upload.promise
    })
    const running = builder.run('cafe', [], 'new_layer')
    pending[0].resolve(AI_SCENE_FIXTURE)
    await uploadStarted.promise
    builder.cancel()
    upload.resolve({} as Awaited<ReturnType<typeof importWorkbenchLocalAssetFile>>)
    expect(await running).toBe(false)
    expect(store.getState().project.scenes).toHaveLength(1)
    expect(store.getState().project.assets.items).toHaveLength(0)
  })

  it('saves the generated scene into the project the request started in', async () => {
    const { builder, pending } = setup()
    const running = builder.run('cafe', [], 'new_layer')
    pending[0].resolve(AI_SCENE_FIXTURE)
    expect(await running).toBe(true)
    expect(vi.mocked(importWorkbenchLocalAssetFile).mock.calls[0][2]).toMatchObject({ projectBinding: { projectId: 'project-a' } })
  })

  it('a project switch while the model is answering saves nothing into any project library', async () => {
    const { builder, store, pending } = setup()
    const running = builder.run('cafe', [], 'new_layer')
    await openProject('project-b')
    pending[0].resolve(AI_SCENE_FIXTURE)
    expect(await running).toBe(false)
    expect(importWorkbenchLocalAssetFile).not.toHaveBeenCalled()
    expect(store.getState().project.scenes).toHaveLength(1)
    expect(store.getState().project.assets.items).toHaveLength(0)
  })

  it('one undo removes both the generated layer and its saved library entry', async () => {
    const { builder, store, pending } = setup()
    const running = builder.run('cafe', [], 'new_layer')
    pending[0].resolve(AI_SCENE_FIXTURE)
    expect(await running).toBe(true)
    expect(store.getState().project.scenes).toHaveLength(2)
    expect(store.getState().project.assets.items).toHaveLength(1)
    store.getState().undo()
    expect(store.getState().project.scenes).toHaveLength(1)
    expect(store.getState().project.assets.items).toHaveLength(0)
  })
})
