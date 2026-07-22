import { describe, it, expect } from 'vitest'
import { SCENE_TEMPLATES, SCENE_TEMPLATE_LABEL, buildSceneTemplateObjects } from './scene3dSceneTemplates'
import { normalizeScene3DState } from './scene3dSerializer'

describe('场景模板 builder', () => {
  it('每个模板产出的对象都合法（可整组过 serializer 归一而不丢件）', () => {
    for (const template of SCENE_TEMPLATES) {
      const objects = buildSceneTemplateObjects(template)
      expect(objects.length, template).toBeGreaterThan(3)
      const normalized = normalizeScene3DState({ objects })
      expect(normalized.objects.length, template).toBe(objects.length)
      // id 全局唯一（追加进现有场景不能撞）。
      expect(new Set(objects.map((o) => o.id)).size).toBe(objects.length)
    }
  })

  it('街道模板含马路/楼/树/路灯/车，全部贴地不悬空', () => {
    const objects = buildSceneTemplateObjects('street')
    const names = objects.map((o) => o.name).join(',')
    for (const expected of ['马路', '楼', '行道树', '路灯', '车辆', '车道线', '人行道']) {
      expect(names).toContain(expected)
    }
    // 道具 origin 在地面中心：y 不应大于人行道面高（0.15）。
    objects.filter((o) => o.type === 'prop').forEach((o) => {
      expect(o.position[1], o.name).toBeLessThanOrEqual(0.15)
      expect(o.position[1], o.name).toBeGreaterThanOrEqual(0)
    })
  })

  it('房间模板三面墙留正面给相机 + 有顶灯', () => {
    const objects = buildSceneTemplateObjects('room')
    const walls = objects.filter((o) => o.propKind === 'wall')
    expect(walls).toHaveLength(3)
    // 没有一面墙挡在 +z 正面（正面 z>1 区域留空给机位）。
    walls.forEach((wall) => expect(wall.position[2]).toBeLessThanOrEqual(0.001))
    expect(objects.some((o) => o.type === 'light')).toBe(true)
  })
})

// ——— 任务优先重构（2026-07-22）：模板对象整组打标，场景树按组折叠 ———
describe('buildSceneTemplateObjects templateGroup', () => {
  it('街道/房间模板每个对象都带模板组标', () => {
    for (const template of ['street', 'room'] as const) {
      const objects = buildSceneTemplateObjects(template)
      expect(objects.length).toBeGreaterThan(0)
      for (const object of objects) expect(object.templateGroup).toBe(SCENE_TEMPLATE_LABEL[template])
    }
  })
})

describe('templateGroup 序列化往返', () => {
  it('normalizeScene3DState 保留 templateGroup（组折叠跨保存/加载存活）', () => {
    const objects = buildSceneTemplateObjects('street')
    const normalized = normalizeScene3DState({ objects, cameras: [], trajectories: [], trajectoryBindings: [] })
    expect(normalized.objects.length).toBe(objects.length)
    for (const object of normalized.objects) expect(object.templateGroup).toBe(SCENE_TEMPLATE_LABEL.street)
  })
})
