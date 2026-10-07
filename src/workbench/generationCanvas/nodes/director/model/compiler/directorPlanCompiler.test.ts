import { describe, expect, it } from 'vitest'
import regressionPlans from './directorPlanCompiler.regressions.json'
import { compileDirectorPlan } from './directorPlanCompiler'
import {
  measureContinuity,
  recognizeCameraMotion,
  sampleDirectorProject,
  distanceForShotSize,
} from '../directorEvalMeasurement'
import { forwardFromAngles, normalize, sub } from '../vec3'
import { S1_ORACLE_PLANS } from '../../../../../../../evals/director/s1OraclePlans'

describe('S1 director compiler', () => {
  it('compiles all hand-written oracle plans', () => {
    for (const plan of Object.values(S1_ORACLE_PLANS)) {
      const result = compileDirectorPlan(plan)
      expect(result.ok).toBe(true)
      if (result.ok) expect(result.project.scenes[0].cameras.length).toBe(plan.shots.length)
    }
  })
  it('is deterministic and uses the measurement distance owner', () => {
    const plan = S1_ORACLE_PLANS['perfume-orbit']
    const a = compileDirectorPlan(plan),
      b = compileDirectorPlan(plan)
    expect(a).toEqual(b)
    if (a.ok) {
      const scene = a.project.scenes[0],
        camera = scene.cameras[0],
        product = scene.objects.find((o) => o.id === a.actorMap.bottle)!
      const distance = Math.hypot(camera.position.x - product.position.x, camera.position.z - product.position.z)
      expect(distance).toBeCloseTo(distanceForShotSize('特写', product.scale.y, 45, 'object'), 4)
      expect(sampleDirectorProject(a.project, { duration: a.duration }).frames.length).toBeGreaterThan(1)
    }
  })
  it('derives entity ids from plan names and isolates a renamed shot', () => {
    const plan = S1_ORACLE_PLANS['perfume-orbit']
    const first = compileDirectorPlan(plan)
    const second = compileDirectorPlan(plan)
    expect(first.ok).toBe(true)
    expect(second.ok).toBe(true)
    if (!first.ok || !second.ok) return
    const scene = first.project.scenes[0]
    expect(scene.objects.map((object) => object.id)).toEqual(second.project.scenes[0].objects.map((object) => object.id))
    expect(scene.cameras.map((camera) => camera.id)).toEqual(second.project.scenes[0].cameras.map((camera) => camera.id))
    expect(scene.objects.some((object) => object.id === 'actor:bottle')).toBe(true)
    expect(scene.cameras[0].id).toBe('shot:orbit/camera')
    const changed = compileDirectorPlan({
      ...plan,
      shots: plan.shots.map((shot, index) => (index === 0 ? { ...shot, id: 'orbit-renamed' } : shot)),
    })
    expect(changed.ok).toBe(true)
    if (!changed.ok) return
    expect(changed.project.scenes[0].objects.map((object) => object.id)).toEqual(scene.objects.map((object) => object.id))
    expect(changed.project.scenes[0].cameras.map((camera) => camera.id)).toEqual(['shot:orbit-renamed/camera', 'shot:push/camera'])
  })
  it('returns structured errors without a half-built project', () => {
    const result = compileDirectorPlan({ version: 2, scene: { tags: [], environment: 'day' }, actors: [], shots: [] })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors.length).toBeGreaterThan(0)
  })
  it('measurement catches a deliberately bad camera placement', () => {
    const result = compileDirectorPlan(S1_ORACLE_PLANS['perfume-orbit'])
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const scene = result.project.scenes[0],
      actor = scene.objects.find((o) => o.id === result.actorMap.bottle)!,
      camera = scene.cameras[0]
    camera.position = { ...actor.position }
    camera.motionTrajectory = camera.motionTrajectory?.map((point) => ({
      ...point,
      x: actor.position.x,
      y: actor.position.y,
      z: actor.position.z,
    }))
    const measurements = sampleDirectorProject(result.project, { duration: result.duration })
    expect(measureContinuity(measurements, scene).some((issue) => issue.kind === 'camera-inside')).toBe(true)
  })
  it('compiles orbit and follow into measurable camera motion', () => {
    const orbit = compileDirectorPlan(S1_ORACLE_PLANS['perfume-orbit'])
    expect(orbit.ok).toBe(true)
    if (orbit.ok) {
      const m = sampleDirectorProject(orbit.project, { duration: orbit.duration })
      expect(recognizeCameraMotion(m, orbit.actorMap.bottle, { start: 0, end: 5 }).move).toBe('orbit_right')
    }
    const followPlan = {
      ...S1_ORACLE_PLANS['police-chase'],
      shots: S1_ORACLE_PLANS['police-chase'].shots.map((shot) =>
        shot.id === 'follow' ? { ...shot, transitionIn: 'cut' as const } : shot,
      ),
    }
    const chase = compileDirectorPlan(followPlan)
    expect(chase.ok).toBe(true)
    if (chase.ok) {
      const m = sampleDirectorProject(chase.project, { duration: chase.duration })
      expect(['follow', 'track_right', 'track_left', 'pull_out']).toContain(
        recognizeCameraMotion(m, chase.actorMap.suspect_car, { start: 2, end: 6 }).move,
      )
    }
  })
  it('keeps vehicle close shots outside the vehicle footprint and resolves template aliases', () => {
    const plan = {
      version: 2 as const,
      scene: { tags: ['street'], environment: 'day' as const, template: 'street' as const, setPieces: [] },
      actors: [
        {
          id: 'van',
          kind: 'vehicle' as const,
          desc: 'delivery van',
          placement: { relation: 'at' as const, ref: 's1-street-floor' },
        },
      ],
      blocking: [{ actor: 'van', verb: 'drive_along' as const, window: [0, 4] as [number, number] }],
      shots: [
        {
          id: 'close',
          window: [0, 4] as [number, number],
          transitionIn: 'cut' as const,
          subject: 'van',
          size: '近景' as const,
          angle: 'front' as const,
          height: 'eye' as const,
          move: { kind: 'follow' as const, speed: 'fast' as const, easing: 'linear' as const },
        },
      ],
    }
    const result = compileDirectorPlan(plan)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.issues.some((issue) => issue.kind === 'unknown-ref')).toBe(false)
    expect(result.project.scenes[0].cameras).toHaveLength(1)
  })
  it('materializes only action-library ids for blocking', () => {
    const result = compileDirectorPlan(S1_ORACLE_PLANS['courtyard-standoff'])
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const woman = result.project.scenes[0].objects.find((object) => object.id === result.actorMap.woman)!
    expect([...new Set(woman.actionClips?.map((clip) => clip.actionPose))]).toEqual(['Walk_Loop', 'Idle_Loop'])
    expect(woman.actionClips?.some((clip) => clip.actionPose === 'hide_object_behind_back')).toBe(false)
    expect(result.issues.some((issue) => issue.kind === 'missing_asset')).toBe(true)
  })
  it('regression: benchmark roles have action evidence at t=0 and no L0 geometry failure', () => {
    for (const plan of [S1_ORACLE_PLANS['courtyard-standoff'], S1_ORACLE_PLANS['perfume-orbit']]) {
      const result = compileDirectorPlan(plan)
      expect(result.ok).toBe(true)
      if (!result.ok) continue
      const scene = result.project.scenes[0]
      const measurements = sampleDirectorProject(result.project, { duration: result.duration, anchors: result.anchors })
      const continuity = measureContinuity(measurements, scene)
      expect(continuity).toEqual([])
      for (const actor of plan.actors.filter((item) => item.kind === 'person')) {
        const object = scene.objects.find((item) => item.id === result.actorMap[actor.id])
        expect(object?.actionClips?.some((clip) => clip.clipType === 'action' && clip.startTime <= 1e-4)).toBe(true)
      }
      if (plan.scene.template === 'product_stage') {
        expect(scene.objects.find((object) => object.id === 's1-product-ground')).toMatchObject({ visible: true, isAuxiliary: false })
        expect(continuity.some((issue) => issue.kind === 'camera-inside')).toBe(false)
      }
    }
  })
  it.each(regressionPlans)('replays R3 regression $source without L0 failures', ({ plan }) => {
    const result = compileDirectorPlan(plan)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(measureContinuity(sampleDirectorProject(result.project, { duration: result.duration, anchors: result.anchors }), result.project.scenes[0])).toEqual([])
  })
  it('stands on one ground height and never inside a solid: the gate scene', () => {
    const result = compileDirectorPlan(S1_ORACLE_PLANS['courtyard-standoff'])
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const scene = result.project.scenes[0]
    const byId = (id: string) => scene.objects.find((object) => object.id === id)!
    const gate = byId('s1-courtyard-gate'), ground = byId('s1-courtyard-ground')
    // 地面板顶面 = 0；墙 / 门 / 树的底也在 0（模板按底声明，不再手写中心坐标）
    expect(ground.position.y).toBeCloseTo(-0.05, 5) // 板厚 5cm，顶面正好在 y 0
    expect(gate.position.y).toBeCloseTo(0, 5)
    const gateFront = gate.position.z + gate.scale.z / 2
    const woman = byId(result.actorMap.woman), guard = byId(result.actorMap.guard)
    // 守卫「在院门」= 站在门前，不在门体里；女子走向门也停在门前、留在地面高度（以前终点取门原点：悬在 1.2m、钻进门里）
    expect(guard.position.z).toBeGreaterThan(gateFront)
    const walkEnd = woman.motionTrajectory!.filter((point) => point.clipId?.startsWith(`${woman.id}-walk_to`)).at(-1)!
    expect(walkEnd.y).toBe(0)
    expect(walkEnd.z).toBeGreaterThan(gateFront)
  })
  it('fills idle gaps and keeps adjacent movement clips continuous in playback', () => {
    const plan = structuredClone(S1_ORACLE_PLANS['courtyard-standoff'])
    plan.blocking = [
      { actor: 'guard', verb: 'hold_pose', window: [0, 6], action: 'standing_idle' },
      { actor: 'guard', verb: 'sidestep', window: [6, 7] },
      { actor: 'guard', verb: 'hold_pose', window: [8, 10], action: 'standing_idle' },
    ]
    const result = compileDirectorPlan(plan)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const scene = result.project.scenes[0]
    // 旧 Mixamo 动作 id（规划器 / 旧回归里还写着 standing_idle）经别名表解析成 UAL 动作，不报缺资产
    const guard = scene.objects.find((object) => object.id === result.actorMap.guard)!
    expect(guard.actionClips?.some((clip) => clip.actionPose === 'Idle_Loop' && clip.startTime === 0)).toBe(true)
    expect(guard.actionClips?.some((clip) => clip.actionPose === 'standing_idle')).toBe(false)
    const frames = sampleDirectorProject(result.project, { duration: result.duration }).frames
    const before = frames.find((frame) => frame.time === 6)!.objects[result.actorMap.guard].position
    const after = frames.find((frame) => frame.time > 6)!.objects[result.actorMap.guard].position
    expect(Math.hypot(after.x - before.x, after.z - before.z)).toBeLessThan(0.1)
    for (const object of scene.objects.filter((item) => item.type === 'character')) {
      for (const time of [0, 1, 6, 7.5, 11]) expect(object.actionClips?.some((clip) => clip.startTime <= time && clip.endTime >= time)).toBe(true)
    }
    expect(scene.objects.filter((object) => object.id.startsWith('s1-')).every((object) => !object.isAuxiliary)).toBe(true)
  })
  it('locks the camera pose convention to lookAtAngles', () => {
    const result = compileDirectorPlan(S1_ORACLE_PLANS['t1-13-static'])
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const camera = result.project.scenes[0].cameras[0]
    const subject = result.project.scenes[0].objects.find((object) => object.id === result.actorMap.subject)!
    const target = { x: subject.position.x, y: subject.position.y + 1.5, z: subject.position.z }
    const direction = normalize(sub(target, camera.position))
    const forward = forwardFromAngles(
      camera.motionTrajectory?.[0]?.yaw ?? camera.yaw,
      camera.motionTrajectory?.[0]?.pitch ?? camera.pitch,
    )
    expect(forward.x * direction.x + forward.y * direction.y + forward.z * direction.z).toBeGreaterThan(0.999)
  })
})
