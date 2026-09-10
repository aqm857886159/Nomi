import { describe, expect, it } from 'vitest'
import { AI_SCENE_FIXTURE, buildAiScenePrompt, normalizeAiScene, parseAiSceneText, primitiveTypeFromName, rotationLooksLikeRadians } from './aiScene'

describe('parseAiSceneText', () => {
  it('剥 Markdown 围栏与前后废话，抓第一段 JSON', () => {
    const text = '好的，这是场景：\n```json\n' + JSON.stringify(AI_SCENE_FIXTURE) + '\n```\n希望有帮助。'
    const parsed = parseAiSceneText(text)
    expect(parsed?.sceneName).toBe('街角咖啡馆')
    expect(parsed?.groups).toHaveLength(3)
  })
  it('不合 schema（没有 groups）返回 null', () => {
    expect(parseAiSceneText('{"sceneName":"x"}')).toBeNull()
    expect(parseAiSceneText('not json')).toBeNull()
  })
})

describe('normalizeAiScene', () => {
  it('类型名映射到 V2 八种几何体', () => {
    expect(primitiveTypeFromName('Box')).toBe('cube')
    expect(primitiveTypeFromName('torus_knot')).toBe('torus')
    expect(primitiveTypeFromName('capsule')).toBe('cylinder')
    expect(primitiveTypeFromName('unknown')).toBe('cube')
  })
  it('全部 |r| ≤ 2π 时当弧度转成度；有明显大角度时按度', () => {
    const radians = { groups: [{ elements: [{ type: 'cube', rotation: [0, Math.PI / 2, 0] as [number, number, number] }] }] }
    expect(rotationLooksLikeRadians(radians.groups)).toBe(true)
    const normalized = normalizeAiScene(radians, 'S')
    expect(normalized.groups[0].elements[0].rotation.y).toBeCloseTo(90, 1)
    expect(rotationLooksLikeRadians(AI_SCENE_FIXTURE.groups)).toBe(false)
    expect(normalizeAiScene(AI_SCENE_FIXTURE, 'S').groups[2].elements[3].rotation.y).toBe(180)
  })
  it('颜色兜底、名字兜底、天空与地面透明度夹紧', () => {
    const normalized = normalizeAiScene({ sceneConfig: { skyColor: 'blue', groundOpacity: 3 }, groups: [{ elements: [{ type: 'sphere', color: 'red' }] }] }, '默认场景')
    expect(normalized.sceneName).toBe('默认场景')
    expect(normalized.skyColor).toBeUndefined()
    expect(normalized.groundOpacity).toBe(1)
    expect(normalized.groups[0].name).toBe('默认场景 1')
    expect(normalized.groups[0].elements[0]).toMatchObject({ type: 'sphere', color: '#e2e8f0', name: 'sphere 1' })
  })
})

describe('buildAiScenePrompt', () => {
  it('提示词带 schema、坐标约定与描述，附图数进提示', () => {
    const prompt = buildAiScenePrompt('雨夜街角', 2)
    expect(prompt).toContain('"groups"')
    expect(prompt).toContain('y up')
    expect(prompt).toContain('2 reference image(s)')
    expect(prompt.trim().endsWith('雨夜街角')).toBe(true)
  })
})
