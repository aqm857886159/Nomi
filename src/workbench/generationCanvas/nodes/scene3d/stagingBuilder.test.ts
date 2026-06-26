import { describe, it, expect } from 'vitest'
import { buildStagingScene, resolveStagingPose, auditStagingSpec, buildStagingSceneAudited } from './stagingBuilder'
import { normalizeScene3DState } from './scene3dSerializer'

describe('buildStagingScene', () => {
  it('solo: 1 个 mannequin + 1 机位，落地高度正确，normalize 不丢', () => {
    const state = buildStagingScene({ characters: [{ pose: 'standing' }] })
    expect(state.objects).toHaveLength(1)
    expect(state.objects[0].type).toBe('mannequin')
    expect(state.objects[0].position[1]).toBeCloseTo(1.25, 5) // scale 2.5 * 0.5 落地
    expect(state.cameras).toHaveLength(1)
    const normalized = normalizeScene3DState(state)
    expect(normalized.objects).toHaveLength(1)
    expect(normalized.cameras).toHaveLength(1)
  })

  it('facing 双人：两人对向（rotation.y 反号），机位在前方', () => {
    const state = buildStagingScene({
      characters: [{ name: '甲', pose: 'single-knee' }, { name: '乙', pose: 'standing' }],
      layout: 'facing',
      camera: { angle: 'front', height: 'low', shot: 'medium' },
    })
    expect(state.objects).toHaveLength(2)
    const [a, b] = state.objects
    expect(a.name).toBe('甲')
    expect(b.name).toBe('乙')
    expect(Math.sign(a.rotation[1])).toBe(-Math.sign(b.rotation[1])) // 对向
    expect(a.pose).toBeDefined() // single-knee 有 pose 偏移
    // front 机位在 +Z 侧（相机看向 -Z 的角色群）
    expect(state.cameras[0].position[2]).toBeGreaterThan(0)
    // low 机位（仰拍）：注视点高于机位
    expect(state.cameras[0].target[1]).toBeGreaterThan(state.cameras[0].position[1])
  })

  it('景别/方位影响机位：close 比 wide 近，side 在 X 轴', () => {
    const wide = buildStagingScene({ characters: [{}], camera: { shot: 'wide', angle: 'front' } })
    const close = buildStagingScene({ characters: [{}], camera: { shot: 'close', angle: 'front' } })
    expect(close.cameras[0].position[2]).toBeLessThan(wide.cameras[0].position[2])
    const side = buildStagingScene({ characters: [{}], camera: { angle: 'side' } })
    expect(Math.abs(side.cameras[0].position[0])).toBeGreaterThan(Math.abs(side.cameras[0].position[2]))
  })

  it('群众：追加一个 mannequinCrowd 背景对象', () => {
    const state = buildStagingScene({ characters: [{}, {}], crowd: { rows: 2, columns: 4 } })
    const crowd = state.objects.find((o) => o.type === 'mannequinCrowd')
    expect(crowd).toBeDefined()
    expect(crowd?.crowdRows).toBe(2)
    expect(crowd?.crowdColumns).toBe(4)
  })

  it('环境预设：night 暗色背景、studio 关网格', () => {
    const night = buildStagingScene({ characters: [{}], environment: 'night' })
    expect(night.environment.darkMode).toBe(true)
    const studio = buildStagingScene({ characters: [{}], environment: 'studio' })
    expect(studio.environment.showGrid).toBe(false)
  })

  it('facing 标签缺省自动编号 角色A/B，facing override 生效', () => {
    const state = buildStagingScene({
      characters: [{ facing: 'camera' }, { facing: 'away' }],
      layout: 'facing',
    })
    expect(state.objects[0].name).toBe('角色A')
    expect(state.objects[1].name).toBe('角色B')
    expect(state.objects[0].rotation[1]).toBeCloseTo(0, 5) // camera = 朝 +Z
    expect(Math.abs(state.objects[1].rotation[1])).toBeCloseTo(Math.PI, 5) // away = 180°
  })
})

describe('运行时自检(F3)：姿势 id 解析', () => {
  it('词表 id 原样通过、无 pose=站立(合法,无 note)', () => {
    expect(resolveStagingPose('single-knee')).toEqual({ id: 'single-knee' })
    expect(resolveStagingPose(undefined)).toEqual({})
    expect(resolveStagingPose('')).toEqual({})
  })
  it('别名/近似归一到词表 id 并带 note(治静默落站立)', () => {
    expect(resolveStagingPose('kneel').id).toBe('single-knee')
    expect(resolveStagingPose('sitting').id).toBe('sit')
    expect(resolveStagingPose('crouch').id).toBe('squat')
    expect(resolveStagingPose('Kneeling').id).toBe('single-knee') // 大小写无关
    expect(resolveStagingPose('hands on hips').id).toBe('hands-on-hips') // 空格归一
    expect(resolveStagingPose('kneel').note).toBeTruthy()
  })
  it('完全无法识别的姿势:无 id(落站立)+ 明确 note', () => {
    const r = resolveStagingPose('moonwalk-backflip')
    expect(r.id).toBeUndefined()
    expect(r.note).toContain('不是有效姿势')
  })
  it('auditStagingSpec 汇总问题、修正 spec', () => {
    const { spec, issues } = auditStagingSpec({ characters: [{ pose: 'kneel' }, { pose: 'standing' }] })
    expect(spec.characters[0].pose).toBe('single-knee')
    expect(spec.characters[1].pose).toBe('standing')
    expect(issues).toHaveLength(1)
  })
})

describe('运行时自检(F3)：角色过近自动拉开', () => {
  it('正常间距不触发拉开(无 issue)', () => {
    const { state, issues } = buildStagingSceneAudited({ characters: [{ pose: 'standing' }, { pose: 'standing' }], layout: 'side-by-side' })
    const men = state.objects.filter((o) => o.type === 'mannequin')
    const d = Math.hypot(men[0].position[0] - men[1].position[0], men[0].position[2] - men[1].position[2])
    expect(d).toBeGreaterThanOrEqual(1.0)
    expect(issues.filter((i) => i.includes('间距'))).toHaveLength(0)
  })
  it('近景面对面也保证中心间距 ≥ 下限(必要时自动加宽)', () => {
    const { state } = buildStagingSceneAudited({
      characters: [{ pose: 'standing', facing: 'toward' }, { pose: 'standing', facing: 'toward' }],
      layout: 'facing',
      camera: { shot: 'close' },
    })
    const men = state.objects.filter((o) => o.type === 'mannequin')
    const d = Math.hypot(men[0].position[0] - men[1].position[0], men[0].position[2] - men[1].position[2])
    expect(d).toBeGreaterThanOrEqual(1.0)
  })
})
