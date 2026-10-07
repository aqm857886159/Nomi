import { describe, expect, it } from 'vitest'
import type { DirectorPlan } from '../../../../../../../electron/shared/director/directorPlanSchema'
import { S1_ORACLE_PLANS } from '../../../../../../../evals/director/s1OraclePlans'
import regressions from './directorPlanCompiler.regressions.json'
import { compileDirectorPlan } from './directorPlanCompiler'
import { buildS1Template } from './s1SceneTemplates'
import { scaledBounds } from '../directorSpace'
import { evaluateSceneObjectPose } from '../evaluatedSceneObject'
import type { DirectorScene } from '../directorTypes'
import { normalizeDirectorProject } from '../directorProject'

const shot = (subject: string): DirectorPlan['shots'][number] => ({ id: 's', window: [0, 4], transitionIn: 'cut', subject, size: '中景', angle: 'front', height: 'eye', move: { kind: 'static', speed: 'medium', easing: 'linear' } })
const compile = (plan: Omit<DirectorPlan, 'version' | 'shots'> & { shots?: DirectorPlan['shots'] }) => {
  const result = compileDirectorPlan({ version: 2, shots: [shot(plan.actors[0].id)], ...plan })
  if (!result.ok) throw new Error(result.errors.join('; '))
  return result.project.scenes[0]
}
const pose = (scene: DirectorScene, id: string, time = 0) => evaluateSceneObjectPose(scene.objects, id, time)!
const angleBetween = (a: number, b: number) => Math.abs(((a - b + 540) % 360) - 180)

describe('关系词 → 站位与朝向（一类东西一条规则）', () => {
  it('「at 院门」= 院门里侧的命名站位；第二个人也 at 院门 = 在站位旁错开一个身位，不叠在一起', () => {
    const scene = compile({ scene: { tags: [], environment: 'day', template: 'courtyard', setPieces: [] }, actors: [
      { id: 'guard', kind: 'person', desc: 'guard', placement: { relation: 'at', ref: 's1-courtyard-gate' } },
      { id: 'guard2', kind: 'person', desc: 'guard2', placement: { relation: 'at', ref: 's1-courtyard-gate' } },
    ], blocking: [] })
    const mark = buildS1Template('courtyard').marks.find((item) => item.id === 's1-courtyard-gate#front')!
    const a = pose(scene, 'actor:guard'), b = pose(scene, 'actor:guard2')
    expect(a.position.x).toBeCloseTo(mark.at.x)
    expect(a.position.z).toBeCloseTo(mark.at.z)
    expect(Math.hypot(a.position.x - b.position.x, a.position.z - b.position.z)).toBeGreaterThanOrEqual(1.2 - 1e-6)
    expect(angleBetween(a.yaw, 0)).toBeLessThan(1) // 面向院内
  })

  it('「站在某人面前」= 面对他，中心距离不小于人际距离', () => {
    const scene = compile({ scene: { tags: [], environment: 'day', template: 'room', setPieces: [] }, actors: [
      { id: 'a', kind: 'person', desc: 'a', placement: { relation: 'at', ref: 's1-room-floor' } },
      { id: 'b', kind: 'person', desc: 'b', placement: { relation: 'in_front_of', ref: 'a' } },
    ], blocking: [] })
    const a = pose(scene, 'actor:a'), b = pose(scene, 'actor:b')
    expect(Math.hypot(a.position.x - b.position.x, a.position.z - b.position.z)).toBeGreaterThanOrEqual(1.2)
    const toward = (Math.atan2(a.position.x - b.position.x, a.position.z - b.position.z) * 180) / Math.PI
    expect(angleBetween(b.yaw, toward)).toBeLessThan(1)
  })

  it('同一条距离公式管车：前车在后车朝向前方，车身不重叠', () => {
    const scene = compile({ scene: { tags: [], environment: 'night', template: 'street', setPieces: [] }, actors: [
      { id: 'police', kind: 'vehicle', desc: 'police', placement: { relation: 'at', ref: 's1-street-ground' } },
      { id: 'suspect', kind: 'vehicle', desc: 'suspect', placement: { relation: 'in_front_of', ref: 'police' } },
    ], blocking: [] })
    const police = scene.objects.find((o) => o.id === 'actor:police')!, suspect = scene.objects.find((o) => o.id === 'actor:suspect')!
    const length = scaledBounds(police).size.z
    expect(suspect.position.z - police.position.z).toBeGreaterThanOrEqual(length)
  })

  it('「走到院门」而守门人站在门里侧站位 = 停在守门人跟前、面对他（不钻进门、不叠到人身上）', () => {
    const scene = compile({ scene: { tags: [], environment: 'day', template: 'courtyard', setPieces: [] }, actors: [
      { id: 'woman', kind: 'person', desc: 'woman', placement: { relation: 'at', ref: 's1-courtyard-ground' } },
      { id: 'guard', kind: 'person', desc: 'guard', placement: { relation: 'at', ref: 's1-courtyard-gate' } },
    ], blocking: [{ actor: 'woman', verb: 'walk_to', target: 'gate', window: [0, 4] }] })
    const woman = pose(scene, 'actor:woman', 4), guard = pose(scene, 'actor:guard', 4)
    const gap = Math.hypot(woman.position.x - guard.position.x, woman.position.z - guard.position.z)
    expect(gap).toBeGreaterThanOrEqual(1.2 - 1e-6)
    expect(gap).toBeLessThan(1.6)
    const toward = (Math.atan2(guard.position.x - woman.position.x, guard.position.z - woman.position.z) * 180) / Math.PI
    expect(angleBetween(woman.yaw, toward)).toBeLessThan(1)
  })

  it('全部语料（oracle + 真实规划器回归计划）：演员全程站在模板的可站区域里（院墙外 / 楼里不算）', () => {
    const plans = [...Object.values(S1_ORACLE_PLANS), ...(regressions as unknown as { plan: DirectorPlan }[]).map((item) => item.plan)]
    const outside: string[] = []
    for (const plan of plans) {
      const result = compileDirectorPlan(plan)
      if (!result.ok || !plan.scene.template) continue
      const area = buildS1Template(plan.scene.template).interior
      const scene = result.project.scenes[0]
      for (const object of scene.objects.filter((item) => item.id.startsWith('actor:') && !item.parentId))
        for (const time of [0, 2, 4, 6, 8, 10, 12]) {
          const p = pose(scene, object.id, time).position
          if (p.x < area.minX - 1e-6 || p.x > area.maxX + 1e-6 || p.z < area.minZ - 1e-6 || p.z > area.maxZ + 1e-6) outside.push(`${plan.scene.tags.join('/')} ${object.id}@${time}`)
        }
    }
    expect(outside).toEqual([])
  })

  it('拿在手里 = 人和东西挂在同一个携带分组下（编辑器父子关系），东西全程跟手；经编辑器规整往返父子关系不丢', () => {
    const plan = (regressions as unknown as { source: string; plan: DirectorPlan }[]).find((item) => item.plan.actors.some((actor) => actor.placement.relation === 'on' && actor.placement.ref === 'qingyi_woman'))!.plan
    const result = compileDirectorPlan(plan)
    if (!result.ok) throw new Error(result.errors.join('; '))
    const roundTrip = normalizeDirectorProject(JSON.parse(JSON.stringify(result.project)))
    for (const project of [result.project, roundTrip]) {
      const scene = project.scenes[0]
      const letter = scene.objects.find((o) => o.id === 'actor:letter')!, woman = scene.objects.find((o) => o.id === 'actor:qingyi_woman')!
      expect(letter.parentId).toBe('carry:actor:qingyi_woman')
      expect(woman.parentId).toBe('carry:actor:qingyi_woman')
      expect(scene.objects.find((o) => o.id === letter.parentId)?.type).toBe('group')
      const gaps = [0, 3, 6, 9, 12].map((time) => {
        const a = pose(scene, letter.id, time).position, b = pose(scene, woman.id, time).position
        return Math.hypot(a.x - b.x, a.z - b.z)
      })
      expect(Math.max(...gaps) - Math.min(...gaps)).toBeLessThan(1e-6)
      expect(Math.hypot(pose(scene, woman.id, 12).position.z - pose(scene, woman.id, 0).position.z)).toBeGreaterThan(1) // 她确实走了
    }
    expect(result.spatial.carried).toEqual([['actor:letter', 'carry:actor:qingyi_woman']])
  })

  it('手持物 near 一个人 = 他拿着（不是掉在他脚边的地上）', () => {
    const scene = compile({ scene: { tags: [], environment: 'day', template: 'courtyard', setPieces: [] }, actors: [
      { id: 'woman', kind: 'person', desc: 'woman', placement: { relation: 'at', ref: 's1-courtyard-ground' } },
      { id: 'letter', kind: 'prop', desc: 'letter', placement: { relation: 'near', ref: 'woman' } },
    ], blocking: [] })
    expect(scene.objects.find((o) => o.id === 'actor:letter')?.parentId).toBe('carry:actor:woman')
  })
})
