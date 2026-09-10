import React from 'react'
import { renderToString } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DirectorStoreContext } from './DirectorEditorContext'
import { AI_SCENE_FIXTURE, type AiSceneSpec } from './model/aiScene'
import { createDirectorStore } from './model/directorStore'
import { createDefaultScene } from './model/directorProject'
import { useAiSceneBuilder } from './useAiSceneBuilder'
import { importWorkbenchLocalAssetFile } from '../../../api/assetUploadApi'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('../../../../ui/toast', () => ({ toast: vi.fn() }))
vi.mock('../../../api/assetUploadApi', () => ({ hostedAssetUrl: () => 'nomi-local://scene.json', importWorkbenchLocalAssetFile: vi.fn(async () => ({})) }))
vi.mock('../../../api/promptLibraryApi', () => ({ getTextBrain: vi.fn() }))
vi.mock('../../../api/taskApi', () => ({ runWorkbenchTextTaskStream: vi.fn() }))

function deferred<T = AiSceneSpec>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

function setup() {
  const pending = [deferred(), deferred()]
  const mock = vi.fn().mockReturnValueOnce(pending[0].promise).mockReturnValueOnce(pending[1].promise)
  vi.stubGlobal('window', { localStorage: { getItem: () => '1' }, __nomiDirectorAiMock: mock, setInterval: () => 1, clearInterval: () => {} })
  const store = createDirectorStore({ defaultSceneName: 'S1' })
  let builder!: ReturnType<typeof useAiSceneBuilder>
  function Host() { builder = useAiSceneBuilder(); return null }
  renderToString(React.createElement(DirectorStoreContext.Provider, { value: store }, React.createElement(Host)))
  return { builder, store, pending, mock }
}

afterEach(() => vi.unstubAllGlobals())

describe('AI scene request ownership (real hook callbacks)', () => {
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
