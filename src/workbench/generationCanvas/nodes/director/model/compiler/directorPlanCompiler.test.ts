import { describe, expect, it } from 'vitest'
import { compileDirectorPlan } from './directorPlanCompiler'
import { measureContinuity, recognizeCameraMotion, sampleDirectorProject, distanceForShotSize } from '../directorEvalMeasurement'
import { S1_ORACLE_PLANS } from '../../../../../../../evals/director/s1OraclePlans'

describe('S1 director compiler', () => {
  it('compiles all hand-written oracle plans', () => {
    for (const plan of Object.values(S1_ORACLE_PLANS)) { const result = compileDirectorPlan(plan); expect(result.ok).toBe(true); if (result.ok) expect(result.project.scenes[0].cameras.length).toBe(plan.shots.length) }
  })
  it('is deterministic and uses the measurement distance owner', () => {
    const plan = S1_ORACLE_PLANS['perfume-orbit']; const a = compileDirectorPlan(plan), b = compileDirectorPlan(plan); expect(a).toEqual(b)
    if (a.ok) { const scene = a.project.scenes[0], camera = scene.cameras[0], product = scene.objects.find(o => o.id === a.actorMap.bottle)!; const distance = Math.hypot(camera.position.x - product.position.x, camera.position.z - product.position.z); expect(distance).toBeCloseTo(distanceForShotSize('特写', product.scale.y, 45, 'object'), 4); expect(sampleDirectorProject(a.project, { duration: a.duration }).frames.length).toBeGreaterThan(1) }
  })
  it('returns structured errors without a half-built project', () => {
    const result = compileDirectorPlan({ version: 2, scene: { tags: [], environment: 'day' }, actors: [], shots: [] }); expect(result.ok).toBe(false); if (!result.ok) expect(result.errors.length).toBeGreaterThan(0)
  })
  it('measurement catches a deliberately bad camera placement', () => {
    const result = compileDirectorPlan(S1_ORACLE_PLANS['perfume-orbit']); expect(result.ok).toBe(true); if (!result.ok) return
    const scene = result.project.scenes[0], actor = scene.objects.find(o => o.id === result.actorMap.bottle)!, camera = scene.cameras[0]
    camera.position = { ...actor.position }
    camera.motionTrajectory = camera.motionTrajectory?.map(point => ({ ...point, x: actor.position.x, y: actor.position.y, z: actor.position.z }))
    const measurements = sampleDirectorProject(result.project, { duration: result.duration })
    expect(measureContinuity(measurements, scene).some(issue => issue.kind === 'camera-inside')).toBe(true)
  })
  it('compiles orbit and follow into measurable camera motion', () => {
    const orbit = compileDirectorPlan(S1_ORACLE_PLANS['perfume-orbit']); expect(orbit.ok).toBe(true); if (orbit.ok) { const m = sampleDirectorProject(orbit.project, { duration: orbit.duration }); expect(recognizeCameraMotion(m, orbit.actorMap.bottle, { start: 0, end: 5 }).move).toBe('orbit_right') }
    const followPlan = { ...S1_ORACLE_PLANS['police-chase'], shots: S1_ORACLE_PLANS['police-chase'].shots.map(shot => shot.id === 'follow' ? { ...shot, transitionIn: 'cut' as const } : shot) }
    const chase = compileDirectorPlan(followPlan); expect(chase.ok).toBe(true); if (chase.ok) { const m = sampleDirectorProject(chase.project, { duration: chase.duration }); expect(['follow', 'track_right', 'track_left', 'pull_out']).toContain(recognizeCameraMotion(m, chase.actorMap.suspect_car, { start: 2, end: 6 }).move) }
  })
})
