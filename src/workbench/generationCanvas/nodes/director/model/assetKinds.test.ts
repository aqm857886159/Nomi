import { describe, expect, it } from 'vitest'
import { assetKindOfFileName } from './assetKinds'

describe('assetKindOfFileName', () => {
  it('按后缀分模型 / 泼溅 / 场景，忽略 query 与大小写', () => {
    expect(assetKindOfFileName('Hero.GLB')).toBe('model')
    expect(assetKindOfFileName('rig.fbx?v=2')).toBe('model')
    expect(assetKindOfFileName('valley.spz')).toBe('splat')
    expect(assetKindOfFileName('scan.ply#x')).toBe('splat')
    expect(assetKindOfFileName('scene.json')).toBe('scene')
  })
  it('图片按 MIME 或后缀判全景，其余不支持', () => {
    expect(assetKindOfFileName('blob-name', 'image/png')).toBe('panorama')
    expect(assetKindOfFileName('sky.jpg')).toBe('panorama')
    expect(assetKindOfFileName('notes.txt')).toBeNull()
  })
})
