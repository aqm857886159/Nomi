import { describe, expect, it } from 'vitest'
import { AI_SCENE_FIXTURE, normalizeAiScene } from './aiScene'
import { createDirectorStore } from './directorStore'

describe('materializeAiScene', () => {
  it('当前图层：总成组 + 每个 AI 组一个 group，元素挂组下，天空色 / 地面透明度写进图层', () => {
    const store = createDirectorStore({ defaultSceneName: 'S1' })
    const normalized = normalizeAiScene(AI_SCENE_FIXTURE, 'AI')
    const placed = store.getState().materializeAiScene(normalized, 'current_layer')
    const scene = store.getState().activeScene()
    expect(placed.rootGroupId).not.toBeNull()
    expect(placed.objectCount).toBe(1 + 3 + 12)
    const root = scene.objects.find((object) => object.id === placed.rootGroupId)
    expect(root?.type).toBe('group')
    expect(root?.name).toBe('街角咖啡馆')
    const groups = scene.objects.filter((object) => object.parentId === placed.rootGroupId)
    expect(groups.map((group) => group.name)).toEqual(['建筑组', '街道设施', '露天座位'])
    const elements = scene.objects.filter((object) => groups.some((group) => group.id === object.parentId))
    expect(elements).toHaveLength(12)
    expect(elements.find((object) => object.name === '椅子 B')?.rotation.y).toBe(180)
    expect(scene.sceneConfig.skyColor).toBe('#1f2937')
    expect(scene.sceneConfig.groundOpacity).toBe(0.35)
    expect(store.getState().selection.objectId).toBe(placed.rootGroupId)
  })
  it('新图层：新建并激活一层，AI 组直接挂图层根；可撤销', () => {
    const store = createDirectorStore({ defaultSceneName: 'S1' })
    const before = store.getState().project.scenes.length
    const placed = store.getState().materializeAiScene(normalizeAiScene(AI_SCENE_FIXTURE, 'AI'), 'new_layer')
    expect(store.getState().project.scenes.length).toBe(before + 1)
    expect(store.getState().project.activeSceneId).toBe(placed.sceneId)
    expect(placed.rootGroupId).toBeNull()
    expect(store.getState().activeScene().objects.filter((object) => !object.parentId).map((object) => object.name)).toEqual(['建筑组', '街道设施', '露天座位'])
    store.getState().undo()
    expect(store.getState().project.scenes.length).toBe(before)
  })
})
