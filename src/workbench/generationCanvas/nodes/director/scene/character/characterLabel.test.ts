/**
 * 名牌避让（外包卡 20，walkthrough 发现）：任意两个投影后重合的名牌都要错开——不是只对某两个角色特判。
 * 视口 DOM 名牌与截图 / 录像烧进画面的名牌用同一个排版函数（所见即所得）。
 */
import { describe, expect, it } from 'vitest'
import { estimateLabelWidth, layoutCharacterLabels, VIEWPORT_LABEL_METRICS, type LabelBox } from './characterLabel'
import * as THREE from 'three'
import { compileDirectorPlan } from '../../model/compiler/directorPlanCompiler'
import { directorOverviewPose } from '../../model/directorOverviewPose'
import { evaluateSceneObjectPose } from '../../model/evaluatedSceneObject'
import { S1_ORACLE_PLANS } from '../../../../../../../evals/director/s1OraclePlans'
import { CHARACTER_HEIGHT } from '../../model/directorSpace'
import { buildCaptureCamera } from '../capture/directorCapture'

const overlaps = (a: { left: number; top: number; width: number; height: number }, b: typeof a) =>
  a.left < b.left + b.width && b.left < a.left + a.width && a.top < b.top + b.height && b.top < a.top + a.height

function boxes(labels: LabelBox[]) {
  return layoutCharacterLabels(labels, 2).map((label) => ({ id: label.id, left: label.x - label.width / 2, top: label.top, width: label.width, height: label.height }))
}

describe('layoutCharacterLabels', () => {
  it('两个角色投影到同一个屏幕点：两个名牌都完整可见、互不覆盖，且都在锚点之上', () => {
    const placed = boxes([
      { id: 'actor:woman', x: 380, y: 500, width: 60, height: 20 },
      { id: 'actor:guard', x: 380, y: 500, width: 60, height: 20 },
    ])
    expect(placed).toHaveLength(2)
    expect(overlaps(placed[0], placed[1])).toBe(false)
    for (const box of placed) expect(box.top + box.height).toBeLessThanOrEqual(500)
  })

  it('三个挤在一起的名牌（庭院镜 2 的形状：横向只差几像素、纵向差 10 像素）层层错开，彼此都不覆盖', () => {
    const placed = boxes([
      { id: 'a', x: 376, y: 494, width: 64, height: 20 },
      { id: 'b', x: 381, y: 504, width: 64, height: 20 },
      { id: 'c', x: 384, y: 499, width: 40, height: 20 },
    ])
    for (let i = 0; i < placed.length; i += 1) for (let j = i + 1; j < placed.length; j += 1) expect(overlaps(placed[i], placed[j])).toBe(false)
  })

  it('本来就不挨着的名牌原地不动（名牌底边贴锚点）；顺序与输入一致，结果确定', () => {
    const input: LabelBox[] = [
      { id: 'left', x: 100, y: 300, width: 50, height: 20 },
      { id: 'right', x: 400, y: 300, width: 50, height: 20 },
    ]
    const placed = layoutCharacterLabels(input, 2)
    expect(placed.map((label) => [label.id, label.top])).toEqual([['left', 280], ['right', 280]])
    expect(layoutCharacterLabels([...input].reverse(), 2).map((label) => label.id)).toEqual(['right', 'left'])
    expect(layoutCharacterLabels(input, 2)).toEqual(placed)
  })
})

/**
 * 类级普查（逃逸账本的 classCheck）：评测题库里每一道 oracle 计划（S1_ORACLE_PLANS 登记表）× 全片每 0.25 秒，
 * 在导演视图进场的总览机位（directorOverviewPose）下把所有角色名牌投影出来，排版后两两不覆盖、底边都不高出锚点之下。
 * 只测庭院一题的回归挡不住下一道「两人前后站成一线」的题——这里遍历整份清单。
 */
const VIEW = { width: 858, height: 812 }
const STEP_SECONDS = 0.25
const matrix = Object.entries(S1_ORACLE_PLANS)

function projectLabels(scene: ReturnType<typeof compiledScene>, camera: THREE.PerspectiveCamera, time: number): LabelBox[] {
  const labels: LabelBox[] = []
  for (const object of scene.objects.filter((item) => item.type === 'character' && item.visible)) {
    const world = evaluateSceneObjectPose(scene.objects, object.id, time)?.position
    if (!world) continue
    const ndc = new THREE.Vector3(world.x, world.y + CHARACTER_HEIGHT * 1.05, world.z).project(camera)
    if (ndc.z > 1 || ndc.z < -1) continue
    labels.push({ id: object.id, x: (ndc.x * 0.5 + 0.5) * VIEW.width, y: (-ndc.y * 0.5 + 0.5) * VIEW.height - VIEWPORT_LABEL_METRICS.lift, width: estimateLabelWidth(object.name, VIEWPORT_LABEL_METRICS.fontPx, VIEWPORT_LABEL_METRICS.paddingX), height: VIEWPORT_LABEL_METRICS.height })
  }
  return labels
}

function compiledScene(plan: unknown) {
  const compiled = compileDirectorPlan(plan)
  if (!compiled.ok) throw new Error(compiled.errors.join('; '))
  return Object.assign(compiled.project.scenes[0], { duration: compiled.duration })
}

describe('普查：每道 oracle 计划 × 全片每 0.25 秒，总览机位下的名牌排版两两不覆盖', () => {
  it('清单不是空的（普查真的跑了）', () => expect(matrix.length).toBeGreaterThan(10))
  it.each(matrix)('%s', (_planId, plan) => {
    const scene = compiledScene(plan)
    const pose = directorOverviewPose(scene)
    if (!pose) return
    // 与视口 / 出片同一套朝向约定（buildCaptureCamera = cameraQuaternion × 翻转）
    const camera = buildCaptureCamera(pose.position, { x: pose.pitch, y: pose.yaw, z: pose.roll }, pose.fov, VIEW.width / VIEW.height)
    for (let time = 0; time <= scene.duration + 1e-6; time += STEP_SECONDS) {
      const labels = projectLabels(scene, camera, time)
      const placed = boxes(labels)
      for (let i = 0; i < placed.length; i += 1) for (let j = i + 1; j < placed.length; j += 1) expect(overlaps(placed[i], placed[j]), `${time.toFixed(2)}s ${placed[i].id} × ${placed[j].id}`).toBe(false)
      for (const [index, box] of placed.entries()) expect(box.top + box.height).toBeLessThanOrEqual(labels[index].y + 1e-6)
    }
  })
})
