import { describe, expect, it } from 'vitest'
import { createDirectorStore } from './directorStore'
import { AI_SCENE_FIXTURE } from './aiScene'

describe('asset tree and scene import boundaries', () => {
  it('moves folders with descendants and rejects self/descendant/unknown destinations', () => {
    const store = createDirectorStore({ defaultSceneName: 'S1' })
    const actions = store.getState()
    const a = actions.addAssetFolder('A')
    const b = actions.addAssetFolder('B', a.id)
    const c = actions.addAssetFolder('C')
    expect(actions.moveAssetFolder(a.id, b.id)).toBe(false)
    expect(actions.moveAssetFolder(a.id, a.id)).toBe(false)
    expect(actions.moveAssetFolder(a.id, 'missing')).toBe(false)
    expect(actions.moveAssetFolder(a.id, c.id)).toBe(true)
    expect(store.getState().project.assets.folders.find((folder) => folder.id === b.id)?.parentId).toBe(a.id)
    expect(actions.moveAssetFolder(a.id, null)).toBe(true)
    actions.deleteAssetFolder(a.id)
    expect(store.getState().project.assets.folders.find((folder) => folder.id === b.id)?.parentId).toBeNull()
  })

  it('upload completing after folder deletion remains visible at the library root', () => {
    const store = createDirectorStore({ defaultSceneName: 'S1' })
    const item = store.getState().addAssetItem({ name: 'chair', kind: 'model', url: 'chair.glb', folderId: 'deleted' })
    expect(store.getState().project.assets.items.find((candidate) => candidate.id === item.id)?.folderId).toBeNull()
  })

  it('unrelated JSON is rejected without creating an empty scene', () => {
    const store = createDirectorStore({ defaultSceneName: 'S1' })
    expect(store.getState().importScene({ apiKey: 'not-a-scene' }, 'bad')).toBeNull()
    expect(store.getState().project.scenes).toHaveLength(1)
  })

  it('AI scene groups import as real geometry, while exported scene IDs are remapped', () => {
    const store = createDirectorStore({ defaultSceneName: 'S1' })
    const id = store.getState().importScene(AI_SCENE_FIXTURE, 'AI')
    expect(id).toBeTruthy()
    expect(store.getState().activeScene().objects.filter((object) => object.type !== 'group')).toHaveLength(12)
    const source = store.getState().activeScene()
    expect(store.getState().importScene(source, 'copy')).not.toBe(id)
    expect(store.getState().activeScene().objects[0].id).not.toBe(source.objects[0].id)
  })
})
