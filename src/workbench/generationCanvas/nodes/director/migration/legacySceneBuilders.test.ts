import { describe, expect, it } from 'vitest'
import { normalizeLegacyScene3D } from './legacyScene3dTypes'
import { buildPlacedProps, buildSceneTemplateObjects, SCENE_TEMPLATE_LABEL, SCENE_TEMPLATES } from './legacySceneBuilders'
import { migrateScene3DState } from './migrateScene3d'

describe('场景模板 builder', () => {
  it('每个模板产出的对象都合法（容错读取不丢件、id 唯一）且整组带模板标', () => {
    for (const template of SCENE_TEMPLATES) {
      const objects = buildSceneTemplateObjects(template)
      expect(objects.length, template).toBeGreaterThan(3)
      expect(normalizeLegacyScene3D({ objects }).objects.length, template).toBe(objects.length)
      expect(new Set(objects.map((o) => o.id)).size).toBe(objects.length)
      for (const object of objects) expect(object.templateGroup).toBe(SCENE_TEMPLATE_LABEL[template])
    }
  })

  it('街道模板含马路 / 楼 / 树 / 路灯 / 车，道具全部贴地不悬空', () => {
    const objects = buildSceneTemplateObjects('street')
    const names = objects.map((o) => o.name).join(',')
    for (const expected of ['马路', '楼', '行道树', '路灯', '车辆', '车道线', '人行道']) expect(names).toContain(expected)
    objects.filter((o) => o.type === 'prop').forEach((o) => {
      expect(o.position[1], o.name).toBeLessThanOrEqual(0.15)
      expect(o.position[1], o.name).toBeGreaterThanOrEqual(0)
    })
  })

  it('房间模板三面墙留正面给相机 + 有顶灯', () => {
    const objects = buildSceneTemplateObjects('room')
    const walls = objects.filter((o) => o.propKind === 'wall')
    expect(walls).toHaveLength(3)
    walls.forEach((wall) => expect(wall.position[2]).toBeLessThanOrEqual(0.001))
    expect(objects.some((o) => o.type === 'light')).toBe(true)
  })

  it('模板整套能迁成 director 工程：道具展开成组 + 图元、灯成顶层灯', () => {
    const { project, report } = migrateScene3DState({ objects: buildSceneTemplateObjects('room') }, { sceneName: 'room' })
    const scene = project.scenes[0]
    expect(scene.lights).toHaveLength(1)
    expect(scene.objects.filter((o) => o.type === 'group')).toHaveLength(3)
    expect(scene.objects.filter((o) => o.type === 'cube').length).toBeGreaterThan(3)
    expect(report.dropped).toHaveLength(0)
  })
})

describe('buildPlacedProps', () => {
  it('省略位置沿 +X 铺开，未知 kind 丢弃', () => {
    // @ts-expect-error 故意传非法 kind
    const props = buildPlacedProps([{ kind: 'tree' }, { kind: 'tree' }, { kind: 'ufo' }])
    expect(props).toHaveLength(2)
    expect(props[0].position[0]).not.toBe(props[1].position[0])
  })
})
