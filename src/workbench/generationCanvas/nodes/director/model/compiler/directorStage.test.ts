import { describe, expect, it } from 'vitest'
import { DIRECTOR_SCENE_TEMPLATES } from '../../../../../../../electron/shared/director/vocab'
import type { DirectorPlan } from '../../../../../../../electron/shared/director/directorPlanSchema'
import { scaledBounds } from '../directorSpace'
import { buildStage } from './directorStage'
import { buildS1Template } from './s1SceneTemplates'

const plan = (template: DirectorPlan['scene']['template'], setPieces: DirectorPlan['scene']['setPieces'], actors: DirectorPlan['actors'] = [{ id: 'a', kind: 'person', desc: 'a', placement: { relation: 'at', ref: 's1-courtyard-ground' } }]): DirectorPlan => ({
  version: 2, scene: { tags: [], environment: 'day', template, setPieces }, actors, blocking: [],
  shots: [{ id: 's', window: [0, 1], transitionIn: 'cut', subject: actors[0].id, size: '中景', angle: 'front', height: 'eye', move: { kind: 'static', speed: 'medium', easing: 'linear' } }],
})

describe('舞台模型：种类、尺寸、同名合并', () => {
  it('布景件与模板里同种类的件是同一个东西：不造第二个盒子，辅助分组保住 setPiece 稳定 id', () => {
    const stage = buildStage(plan('courtyard', [{ id: 'courtyard_gate', kind: '院门', relation: { type: 'at', ref: 's1-courtyard-gate' } }]))
    expect(stage.refs.get('courtyard_gate')?.objectId).toBe('s1-courtyard-gate')
    const kept = stage.objects.find((object) => object.id === 'setPiece:courtyard_gate')!
    expect(kept).toMatchObject({ type: 'group', isAuxiliary: true })
    expect(stage.objects.filter((object) => !object.isAuxiliary && object.name !== 'ground' && scaledBounds(object).size.y > 2).map((object) => object.id).sort())
      .toEqual(['s1-courtyard-gate', 's1-courtyard-wall-east', 's1-courtyard-wall-north', 's1-courtyard-tree'].sort())
  })

  it('参照的是地面也能合并：模板里只有一件同种类的（圆形展台 = 模板展台）', () => {
    const stage = buildStage(plan('product_stage', [{ id: 'stand', kind: '圆形展台', relation: { type: 'at', ref: 's1-product-ground' } }], [{ id: 'b', kind: 'product', desc: 'b', placement: { relation: 'on', ref: 'stand' } }]))
    expect(stage.refs.get('stand')?.objectId).toBe('s1-product-pedestal')
  })

  it('认得种类就取典型尺寸（桌子不是 1.4 米灰盒），认不出的照兜底方盒并报问题', () => {
    const stage = buildStage(plan('room', [
      { id: 'cafe_table', kind: 'cafe_table', relation: { type: 'at', ref: 's1-room-floor' } },
      { id: 'thing', kind: 'zorblax', relation: { type: 'at', ref: 's1-room-floor' } },
    ], [{ id: 'a', kind: 'person', desc: 'a', placement: { relation: 'at', ref: 's1-room-floor' } }]))
    const table = stage.refs.get('cafe_table')!
    expect(table).toMatchObject({ kind: 'table', role: 'furniture', sizeSource: 'typical' })
    expect(scaledBounds(table.object).size.y).toBeCloseTo(0.75)
    expect(stage.refs.get('thing')).toMatchObject({ sizeSource: 'unknown' })
    expect(stage.issues).toEqual([expect.objectContaining({ kind: 'nominal-size', objectId: 'setPiece:thing' })])
  })

  it.each(DIRECTOR_SCENE_TEMPLATES)('模板 %s 的每个站位都在可站区域里，演员站上去不进任何实心件（站位是作者验证过的点）', (template) => {
    const spec = buildS1Template(template)
    const solids = spec.parts.filter((item) => scaledBounds(item.object).size.y > 0.3)
    for (const mark of spec.marks) {
      expect(mark.at.x, mark.id).toBeGreaterThanOrEqual(spec.interior.minX)
      expect(mark.at.x, mark.id).toBeLessThanOrEqual(spec.interior.maxX)
      expect(mark.at.z, mark.id).toBeGreaterThanOrEqual(spec.interior.minZ)
      expect(mark.at.z, mark.id).toBeLessThanOrEqual(spec.interior.maxZ)
      expect(spec.parts.some((item) => item.object.id === mark.thingId), mark.id).toBe(true)
      if (mark.use !== 'stand') continue
      for (const solid of solids) {
        const box = scaledBounds(solid.object), p = solid.object.position
        const inside = mark.at.x > p.x + box.min.x - 0.3 && mark.at.x < p.x + box.max.x + 0.3 && mark.at.z > p.z + box.min.z - 0.2 && mark.at.z < p.z + box.max.z + 0.2
        expect(inside, `${mark.id} in ${solid.object.id}`).toBe(false)
      }
    }
  })
})
