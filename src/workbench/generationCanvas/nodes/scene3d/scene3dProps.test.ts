import { describe, it, expect } from 'vitest'
import { PROP_KINDS, PROP_SPECS, makePropObject, propGroundFootprint } from './scene3dProps'
import { normalizeScene3DState } from './scene3dSerializer'

describe('语义道具 spec 完整性', () => {
  it('每种道具都有部件、正的占位、非空标签与主体色', () => {
    expect(PROP_KINDS.length).toBeGreaterThanOrEqual(5)
    for (const kind of PROP_KINDS) {
      const spec = PROP_SPECS[kind]
      expect(spec.parts.length, kind).toBeGreaterThan(0)
      expect(spec.footprint.width, kind).toBeGreaterThan(0)
      expect(spec.footprint.depth, kind).toBeGreaterThan(0)
      expect(spec.label, kind).toBeTruthy()
      expect(spec.defaultColor, kind).toMatch(/^#[0-9a-f]{6}$/i)
      // origin 在地面中心：所有部件不得沉到地面以下（底面 ≥ -1mm 容差）。
      for (const part of spec.parts) {
        const halfHeight = part.geometry === 'sphere' ? part.size[0] : part.geometry === 'box' ? part.size[1] / 2 : part.size[2] / 2
        expect(part.position[1] - halfHeight, `${kind} 部件穿地`).toBeGreaterThanOrEqual(-0.001)
      }
    }
  })

  it('makePropObject 出厂即贴地（y=0）、带 kind 与主体色', () => {
    const car = makePropObject('car')
    expect(car.type).toBe('prop')
    expect(car.propKind).toBe('car')
    expect(car.position[1]).toBe(0)
    expect(car.color).toBe(PROP_SPECS.car.defaultColor)
    expect(propGroundFootprint('car').depth).toBeGreaterThan(propGroundFootprint('car').width)
  })
})

describe('道具序列化往返', () => {
  it('prop 对象带 propKind 往返；未知 kind 降级 mesh 不丢对象', () => {
    const state = normalizeScene3DState({
      objects: [
        { id: 'p1', type: 'prop', propKind: 'streetlamp', position: [1, 0, 2] },
        { id: 'p2', type: 'prop', propKind: 'spaceship' },
      ],
    })
    expect(state.objects[0].type).toBe('prop')
    expect(state.objects[0].propKind).toBe('streetlamp')
    expect(state.objects[1].type).toBe('mesh')
    expect(state.objects[1].propKind).toBeUndefined()
  })
})
