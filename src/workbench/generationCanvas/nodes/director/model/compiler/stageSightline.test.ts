import { describe, expect, it } from 'vitest'
import type { DirectorPlan } from '../../../../../../../electron/shared/director/directorPlanSchema'
import { compileDirectorPlan } from './directorPlanCompiler'
import { auditDirectorSpace } from '../directorSpatialAudit'

type Element = { type: 'cube'; name: string; position: [number, number, number]; scale: [number, number, number] }
const plan = (dressing: Element[], shot: Partial<DirectorPlan['shots'][number]> = {}): DirectorPlan => ({
  version: 2,
  scene: { tags: [], environment: 'day', template: 'room', setPieces: [], dressing: { sceneName: 'probe', groups: [{ name: 'g', elements: dressing }] } },
  actors: [{ id: 'hero', kind: 'person', desc: 'hero', placement: { relation: 'at', ref: 's1-room-floor' } }],
  blocking: [],
  shots: [{ id: 'shot', window: [0, 4], transitionIn: 'cut', subject: 'hero', size: '中景', angle: 'front', height: 'eye', move: { kind: 'static', speed: 'medium', easing: 'linear' }, ...shot }],
})
const occluded = (result: ReturnType<typeof compileDirectorPlan>) => (result.ok ? auditDirectorSpace(result.project, result.spatial).filter((item) => item.criterion === 'occluded') : [])

describe('机位视线：看得见主体（一条规则管墙、布景、别的人）', () => {
  it('一块布景正好挡在正面机位和主体之间：换一个看得见的机位，运镜形状不变（静止仍静止）', () => {
    const result = compileDirectorPlan(plan([{ type: 'cube', name: 'screen', position: [0, 1.25, 1.8], scale: [1.6, 2.5, 0.2] }]))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(occluded(result)).toEqual([])
    const path = result.project.scenes[0].cameras[0].motionTrajectory!
    expect(Math.hypot(path[0].x - path.at(-1)!.x, path[0].z - path.at(-1)!.z)).toBeLessThan(1e-6)
    expect(result.issues.some((issue) => issue.kind === 'occluded')).toBe(false)
  })

  it('推镜穿过布景也一样：整条推镜路径都看得见', () => {
    const result = compileDirectorPlan(plan([{ type: 'cube', name: 'screen', position: [0, 1.25, 2.4], scale: [1.6, 2.5, 0.2] }], { move: { kind: 'push_in', speed: 'medium', easing: 'linear' } }))
    expect(result.ok && occluded(result)).toEqual([])
  })

  it('主体被围死、换遍候选都看不见：照原样出，并在编译问题清单里报 occluded（不藏）', () => {
    const walls: Element[] = [
      // 贴身的箱子：里面只容得下人，机位进不去
      { type: 'cube', name: 'n', position: [0, 2, -0.3], scale: [1, 4, 0.1] }, { type: 'cube', name: 's', position: [0, 2, 0.3], scale: [1, 4, 0.1] },
      { type: 'cube', name: 'e', position: [0.4, 2, 0], scale: [0.1, 4, 0.7] }, { type: 'cube', name: 'w', position: [-0.4, 2, 0], scale: [0.1, 4, 0.7] },
      { type: 'cube', name: 'roof', position: [0, 4.05, 0], scale: [1, 0.1, 0.7] },
    ]
    const result = compileDirectorPlan(plan(walls))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.issues.some((issue) => issue.kind === 'occluded' && issue.objectId === 'shot:shot/camera')).toBe(true)
  })
})
