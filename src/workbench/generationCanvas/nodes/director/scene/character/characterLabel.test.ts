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
import { buildCaptureCamera, drawLabels, type CaptureLabel } from '../capture/directorCapture'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { ViewportLabels } from '../../panels/viewport/ViewportOverlays'
import type { ProjectedLabel } from '../LabelProjector'
import { evaluateCameraPose } from '../../model/cameraPoseEval'
import { transformCameraPose } from '../../model/cameraCoordinateSpace'
import { sceneFrame } from '../../model/sceneObjectGraph'
import type { DirectorScene } from '../../model/directorTypes'
import { isDirector3DBoxEnabled } from '../../../../../../featureFlags/director3dbox'

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
 * 接线 + 类级普查（逃逸账本的 classCheck）。两处画名牌的地方都走**真组件 / 真函数**，不 mock：
 *   · 视口 DOM 名牌（ViewportLabels，renderToStaticMarkup 出真 DOM，读每张名牌的 left / top）；
 *   · 出片烧进画面的名牌（directorCapture.drawLabels，交给一个记账的 2D 画布上下文，读每张名牌画在哪个框里）。
 * 任一处改回「框底贴锚点」的旧放法，下面的接线用例和普查都会红。
 * 这两处都不看 3D-BOX 开关：开关关着的老导演台同样走它们（本文件不装任何开关桥，isDirector3DBoxEnabled() 为 false）。
 *
 * 普查遍历评测题库里每一道 oracle 计划（S1_ORACLE_PLANS 登记表）：
 *   · 视口：导演视图进场的总览机位（directorOverviewPose）× 全片每 0.25 秒；
 *   · 出片：每一镜自己的机位（出片用的就是它，evaluateCameraPose 取位姿、buildCaptureCamera 建相机）× 这一镜窗口内每 0.25 秒。
 */
const VIEW = { width: 858, height: 812 }
const CAPTURE = { width: 1280, height: 720 }
const STEP_SECONDS = 0.25
const matrix = Object.entries(S1_ORACLE_PLANS)
/** 普查真的画过「同一画面里两个以上名牌」的帧数（不是空转）。 */
const crowded = { viewport: 0, capture: 0 }

type Box = { id: string; left: number; top: number; width: number; height: number }
const pairwiseClear = (placed: readonly Box[], where: string) => {
  for (let i = 0; i < placed.length; i += 1) for (let j = i + 1; j < placed.length; j += 1) expect(overlaps(placed[i], placed[j]), `${where} ${placed[i].id} × ${placed[j].id}`).toBe(false)
}

/** 视口：真 ViewportLabels 渲染出来的名牌框（宽按组件同一个估计，left 是中心、组件自己 -translate-x-1/2）。 */
function viewportBoxes(labels: ProjectedLabel[]): Box[] {
  const html = renderToStaticMarkup(createElement(ViewportLabels, { labels }))
  const found = [...html.matchAll(/style="left:([\d.-]+)px;top:([\d.-]+)px"[^>]*>([^<]*)</g)]
  expect(found).toHaveLength(labels.length)
  return found.map(([, left, top, text], index) => {
    const width = estimateLabelWidth(text, VIEWPORT_LABEL_METRICS.fontPx, VIEWPORT_LABEL_METRICS.paddingX)
    return { id: `${labels[index].id}`, left: Number(left) - width / 2, top: Number(top), width, height: VIEWPORT_LABEL_METRICS.height }
  })
}

/** 出片：真 drawLabels 在一张记账画布上画了哪些框（roundRect 的参数）。 */
function capturedBoxes(labels: CaptureLabel[], width: number, height: number): Box[] {
  const rects: Box[] = []
  let fontPx = 12
  const context = {
    textAlign: 'left', textBaseline: 'alphabetic', fillStyle: '',
    set font(value: string) { fontPx = Number(/(\d+)px/.exec(value)?.[1] ?? 12) },
    measureText: (text: string) => ({ width: estimateLabelWidth(text, fontPx, 0) }),
    beginPath: () => undefined,
    roundRect: (x: number, y: number, w: number, h: number) => { rects.push({ id: String(rects.length), left: x, top: y, width: w, height: h }) },
    fill: () => undefined,
    fillText: () => undefined,
  }
  drawLabels(context as unknown as CanvasRenderingContext2D, labels, width, height)
  return rects
}

function compiledScene(plan: unknown) {
  const compiled = compileDirectorPlan(plan)
  if (!compiled.ok) throw new Error(compiled.errors.join('; '))
  return { scene: compiled.project.scenes[0], duration: compiled.duration }
}

function projectHeads(scene: DirectorScene, camera: THREE.PerspectiveCamera, time: number, size: { width: number; height: number }) {
  const heads: { id: string; name: string; x: number; y: number }[] = []
  for (const object of scene.objects.filter((item) => item.type === 'character' && item.visible)) {
    const world = evaluateSceneObjectPose(scene.objects, object.id, time)?.position
    if (!world) continue
    const ndc = new THREE.Vector3(world.x, world.y + CHARACTER_HEIGHT * 1.05, world.z).project(camera)
    if (ndc.z > 1 || ndc.z < -1) continue
    heads.push({ id: object.id, name: object.name, x: (ndc.x * 0.5 + 0.5) * size.width, y: (-ndc.y * 0.5 + 0.5) * size.height })
  }
  return heads
}

describe('接线：两处画名牌的地方都走共享排版（开关关着也一样）', () => {
  it('这一组用例跑在开关关着的环境里', () => expect(isDirector3DBoxEnabled()).toBe(false))

  it('视口 ViewportLabels：两个角色投影到同一点，两张名牌上下错开、都在锚点之上', () => {
    const placed = viewportBoxes([{ id: 'a', name: '青衣女子', x: 380, y: 500 }, { id: 'b', name: '黑衣侍卫', x: 380, y: 500 }])
    pairwiseClear(placed, 'viewport')
    for (const box of placed) expect(box.top + box.height).toBeLessThanOrEqual(500 - VIEWPORT_LABEL_METRICS.lift + 1e-6)
  })

  it('出片 drawLabels：两个角色投影到同一点，烧进画面的两个名牌框上下错开、都在锚点之上', () => {
    const placed = capturedBoxes([{ text: '青衣女子', x: 640, y: 400 }, { text: '黑衣侍卫', x: 640, y: 400 }], CAPTURE.width, CAPTURE.height)
    expect(placed).toHaveLength(2)
    pairwiseClear(placed, 'capture')
    for (const box of placed) expect(box.top + box.height).toBeLessThanOrEqual(400 + 1e-6)
  })
})

describe('普查：每道 oracle 计划，视口（总览机位）与出片（每一镜机位）的名牌两两不覆盖', () => {
  it('清单不是空的（普查真的跑了）', () => expect(matrix.length).toBeGreaterThan(10))

  it.each(matrix)('视口 · 总览机位 · %s', (_planId, plan) => {
    const { scene, duration } = compiledScene(plan)
    const pose = directorOverviewPose(scene)
    if (!pose) return
    // 与视口 / 出片同一套朝向约定（buildCaptureCamera = cameraQuaternion × 翻转）
    const camera = buildCaptureCamera(pose.position, { x: pose.pitch, y: pose.yaw, z: pose.roll }, pose.fov, VIEW.width / VIEW.height)
    for (let time = 0; time <= duration + 1e-6; time += STEP_SECONDS) {
      const heads = projectHeads(scene, camera, time, VIEW)
      if (heads.length >= 2) crowded.viewport += 1
      pairwiseClear(viewportBoxes(heads), `viewport ${time.toFixed(2)}s`)
    }
  })

  it.each(matrix)('出片 · 每一镜机位 · %s', (_planId, plan) => {
    const { scene } = compiledScene(plan)
    const frame = sceneFrame(scene.sceneConfig)
    for (const shotCamera of scene.cameras) {
      const window = shotCamera.trajectoryClips?.[0]
      if (!window) continue
      for (let time = window.startTime; time <= window.endTime + 1e-6; time += STEP_SECONDS) {
        const pose = evaluateCameraPose(shotCamera, scene, time)
        const world = transformCameraPose({ position: pose.position, pitch: pose.rotation.x, yaw: pose.rotation.y, roll: pose.rotation.z, fov: pose.fov ?? shotCamera.fov }, frame)
        const camera = buildCaptureCamera(world.position, { x: world.pitch, y: world.yaw, z: world.roll }, world.fov, CAPTURE.width / CAPTURE.height)
        const heads = projectHeads(scene, camera, time, CAPTURE)
        if (heads.length >= 2) crowded.capture += 1
        pairwiseClear(capturedBoxes(heads.map((head) => ({ text: head.name, x: head.x, y: head.y })), CAPTURE.width, CAPTURE.height), `capture ${shotCamera.id} ${time.toFixed(2)}s`)
      }
    }
  })

  it('普查不是空转：视口与出片都画过多人同框的帧', () => {
    expect(crowded.viewport).toBeGreaterThan(50)
    expect(crowded.capture).toBeGreaterThan(50)
  })
})
