/**
 * 导演计划编译器 · 空间不变量特征测试（草稿，2026-10-05 类根因分析线）
 *
 * 目的：动结构之前先把「编出来的工程在物理上成不成立」写成可执行判据，并把**今天的违例账**锁住（棘轮）。
 *   - 违例数变多 = 新回归，红；
 *   - 违例数变少 = 修好了，也红——逼修复者把下面的账同步改小（棘轮只许往下拧）。
 * 判据全部用**渲染真值**量：几何体尺寸 / 网格偏移直接取自渲染组件 `PrimitiveEntity` 返回的元素树，
 * 再用 three.js 的 `Object3D` + `Box3` 按渲染同一套父子 / 欧拉角 / scale 规则求世界包围盒；
 * 不读 `OBJECT_GEOMETRY_SIZES` / `OBJECT_ORIGIN_OFFSETS` 这类手抄表（那正是被测对象之一）。
 * 角色只取高度真值（`CHARACTER_HEIGHT`、脚底原点）；宽 0.6 × 深 0.4 沿用测量模块的假设，标 unverified。
 * 报告：docs/plan/2026-10-05-director-compiler-root-cause.md
 */
import React from 'react'
import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { compileDirectorPlan } from './directorPlanCompiler'
import regressions from './directorPlanCompiler.regressions.json'
import { S1_ORACLE_PLANS } from '../../../../../../../evals/director/s1OraclePlans'
import { PrimitiveEntity, PrimitiveGeometry } from '../../scene/entities/PrimitiveEntity'
import { scaledBounds } from '../directorSpace'
import { evaluateEntityTransform } from '../trajectoryEval'
import { auditDirectorSpace, SPATIAL_CRITERIA, type SpatialAuditContext, type SpatialCriterion } from '../directorSpatialAudit'
import { entityClips } from '../timeGrid'
import { AI_SCENE_FIXTURE, normalizeAiScene } from '../aiScene'
import { exportAiScene } from '../storeAiSceneActions'
import type { DirectorObject, DirectorProject, DirectorScene } from '../directorTypes'

const CHARACTER_HEIGHT = 1.75 // = scene/entities/CharacterEntity.tsx CHARACTER_HEIGHT（该模块挂 GLTF 加载，单测不直接 import）
const CHARACTER_FOOTPRINT = { x: 0.6, z: 0.4 } // unverified：渲染按骨骼量高度，宽深没有真值
const DEG = Math.PI / 180
const EPS = 0.02 // 2cm：低于这个算贴合
const PRIMITIVES = ['cube', 'sphere', 'plane', 'cylinder', 'cone', 'torus', 'tetrahedron', 'icosahedron'] as const

// ── 渲染真值：从渲染组件本身取几何与网格偏移 ─────────────────────────────────────────
type JsxElement = { type: unknown; props: Record<string, unknown> }
function renderMeshOf(type: DirectorObject['type']): THREE.Mesh {
  const element = PrimitiveEntity({
    object: { id: 'probe', name: 'probe', type, position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 }, visible: true, locked: false },
    displayMode: 'solid',
  }) as unknown as JsxElement
  const offset = element.props.position as [number, number, number]
  const children = React.Children.toArray(element.props.children as React.ReactNode) as unknown as JsxElement[]
  const geometryElement = children.find((child) => child.type === PrimitiveGeometry)!
  const intrinsic = PrimitiveGeometry(geometryElement.props as { type: never }) as unknown as JsxElement
  const ctorName = String(intrinsic.type).replace(/^./, (c) => c.toUpperCase()) as keyof typeof THREE
  const Ctor = THREE[ctorName] as unknown as new (...args: number[]) => THREE.BufferGeometry
  const mesh = new THREE.Mesh(new Ctor(...((intrinsic.props.args as number[]) ?? [])))
  mesh.position.set(...offset)
  return mesh
}

function nodeFor(object: { type: DirectorObject['type'] }): THREE.Object3D {
  const node = new THREE.Object3D()
  if (object.type === 'character') {
    const body = new THREE.Mesh(new THREE.BoxGeometry(CHARACTER_FOOTPRINT.x, CHARACTER_HEIGHT, CHARACTER_FOOTPRINT.z))
    body.position.set(0, CHARACTER_HEIGHT / 2, 0)
    node.add(body)
  } else if ((PRIMITIVES as readonly string[]).includes(object.type)) node.add(renderMeshOf(object.type))
  return node
}

type Pose = { position: { x: number; y: number; z: number }; rotation: { x: number; y: number; z: number } }
/** 一个图层在 t 时刻的世界包围盒（按渲染的父子树、度数欧拉角、scale）。 */
function worldBoxes(scene: Pick<DirectorScene, 'objects'>, time = 0): Map<string, THREE.Box3> {
  const root = new THREE.Object3D()
  const nodes = new Map<string, THREE.Object3D>()
  for (const object of scene.objects) {
    const node = nodeFor(object)
    const pose: Pose = object.trajectoryClips?.length ? evaluateEntityTransform(object, time) : { position: object.position, rotation: object.rotation }
    node.position.set(pose.position.x, pose.position.y, pose.position.z)
    node.rotation.set(pose.rotation.x * DEG, pose.rotation.y * DEG, pose.rotation.z * DEG)
    node.scale.set(object.scale.x, object.scale.y, object.scale.z)
    nodes.set(object.id, node)
  }
  for (const object of scene.objects) (object.parentId && nodes.get(object.parentId) ? nodes.get(object.parentId)! : root).add(nodes.get(object.id)!)
  root.updateMatrixWorld(true)
  const boxes = new Map<string, THREE.Box3>()
  for (const object of scene.objects) {
    const node = nodes.get(object.id)!
    if (!node.children.some((child) => (child as THREE.Mesh).isMesh)) continue // group / model / splat：无渲染真值，跳过
    const box = new THREE.Box3()
    for (const child of node.children) if ((child as THREE.Mesh).isMesh) box.union(new THREE.Box3().setFromObject(child, true))
    boxes.set(object.id, box)
  }
  return boxes
}

describe('空间事实只有一份：共用包围盒 vs 渲染组件真值', () => {
  it('directorSpace 量出的包围盒与渲染组件元素树里的几何逐类型一致（独立读 JSX 对账，不读共用表）', () => {
    const one = { x: 1, y: 1, z: 1 }
    const mismatched = PRIMITIVES.filter((type) => {
      const rendered = new THREE.Box3().setFromObject(renderMeshOf(type), true)
      const shared = scaledBounds({ type, scale: one })
      const size = rendered.getSize(new THREE.Vector3())
      return Math.abs(size.x - shared.size.x) > 1e-6 || Math.abs(size.y - shared.size.y) > 1e-6 || Math.abs(size.z - shared.size.z) > 1e-6 || Math.abs(rendered.min.y - shared.min.y) > 1e-6
    })
    expect(mismatched).toEqual([])
  })

  it('渲染：torus / tetrahedron / icosahedron 的底不在原点（落地必须走 originYForBottom，不能假定底 = 原点）', () => {
    const bottoms = Object.fromEntries(PRIMITIVES.map((type) => [type, Number(new THREE.Box3().setFromObject(renderMeshOf(type), true).min.y.toFixed(3))]))
    expect(bottoms).toMatchObject({ cube: 0, sphere: 0, cylinder: 0, cone: 0 })
    expect(bottoms.tetrahedron).toBeGreaterThan(EPS)
    expect(bottoms.icosahedron).toBeGreaterThan(EPS)
    expect(bottoms.torus).toBeLessThan(0)
  })
})

describe('AI 搭场景（产品路径 AiSceneBar）：提示词写「中心坐标」，物化后渲染出来的几何中心就是那个坐标', () => {
  const spec = {
    sceneName: 'probe',
    groups: [{ name: 'g', elements: [
      { type: 'cube', name: '门', position: [0, 1.1, -3.05], scale: [1.2, 2.2, 0.1] },
      { type: 'cube', name: '长椅', position: [4, 0.25, 1.5], scale: [1.8, 0.5, 0.6] },
      { type: 'cylinder', name: '垃圾桶', position: [6, 0.45, 1.5], scale: [0.5, 0.9, 0.5] },
      { type: 'torus', name: '花环', position: [1, 0.55, 2], scale: [1, 1, 1] },
      { type: 'tetrahedron', name: '锥饰', position: [-2, 0.6, 2], scale: [1, 1, 1] },
    ] }],
  }
  const layer = exportAiScene(normalizeAiScene(spec as never, 'probe'))
  const boxes = worldBoxes(layer)

  it('贴地的东西底在 0（以前悬空半个身高：门 1.1m、长椅 0.25m、垃圾桶 0.45m）', () => {
    for (const name of ['门', '长椅', '垃圾桶']) {
      const object = layer.objects.find((o) => o.name === name)!
      expect(Number(boxes.get(object.id)!.min.y.toFixed(3)), name).toBe(0)
    }
  })

  it('每个元素渲染出来的几何中心 = 提示词给的中心坐标（圆环 / 四面体这类底不在原点的也一样）', () => {
    for (const element of spec.groups[0].elements) {
      const object = layer.objects.find((o) => o.name === element.name)!
      const center = boxes.get(object.id)!.getCenter(new THREE.Vector3())
      expect(center.y, element.name).toBeCloseTo(element.position[1], 1)
      expect(center.x, element.name).toBeCloseTo(element.position[0], 1)
    }
  })

  it('提示词自带夹具（街角咖啡馆）整体不悬空：每个元素的中心高度与夹具一致', () => {
    const fixture = exportAiScene(normalizeAiScene(AI_SCENE_FIXTURE, 'fx'))
    const fixtureBoxes = worldBoxes(fixture)
    for (const element of AI_SCENE_FIXTURE.groups.flatMap((group) => group.elements)) {
      const object = fixture.objects.find((o) => o.name === element.name)!
      expect(fixtureBoxes.get(object.id)!.getCenter(new THREE.Vector3()).y, element.name).toBeCloseTo(element.position![1], 1)
    }
  })
})

// ── 语料：全部 oracle 计划 + 回归计划（真实规划器产出）；判据住 model/directorSpatialAudit，评测打分也用它 ──
type Compiled = { id: string; project: DirectorProject; spatial: SpatialAuditContext }
const corpus: Compiled[] = [
  ...Object.entries(S1_ORACLE_PLANS).map(([id, plan]) => ({ id: `oracle:${id}`, plan })),
  ...(regressions as { source: string; plan: unknown }[]).map((item) => ({ id: `regression:${item.source}`, plan: item.plan })),
].flatMap(({ id, plan }) => {
  const result = compileDirectorPlan(plan)
  return result.ok ? [{ id, project: result.project, spatial: result.spatial }] : []
})

describe('编译器产物的物理不变量（棘轮账：只许变少）', () => {
  const results = corpus.map((entry) => ({ id: entry.id, violations: auditDirectorSpace(entry.project, entry.spatial) }))
  const count = (criterion: SpatialCriterion) => results.reduce((sum, item) => sum + item.violations.filter((v) => v.criterion === criterion).length, 0)
  const casesWith = (criterion: SpatialCriterion) => results.filter((item) => item.violations.some((v) => v.criterion === criterion)).length

  it('语料都编得出来', () => {
    expect(corpus.length).toBe(Object.keys(S1_ORACLE_PLANS).length + (regressions as unknown[]).length)
  })

  it('每个实体有片段就在时间轴上（编辑器同一条规则）', () => {
    const offTimeline = corpus.flatMap(({ project }) => {
      const scene = project.scenes[0]
      return [...scene.objects, ...scene.cameras].filter((entity) => entityClips(entity).length > 0 && !entity.inTimeline)
    })
    expect(offTimeline).toEqual([])
  })

  it('违例总账（棘轮：修好一类就把对应数字改小）', () => {
    const ledger = { cases: corpus.length, ...Object.fromEntries(SPATIAL_CRITERIA.map((criterion) => [criterion, [count(criterion), casesWith(criterion)]])) }
    if (process.env.DIRECTOR_INVARIANT_DUMP) console.log(JSON.stringify({ ledger, results: results.filter((r) => r.violations.length).map((r) => ({ id: r.id, violations: r.violations.map((v) => `${v.criterion}: ${v.subject} ${v.other ?? ''} ${v.value ?? ''}`) })) }, null, 2))
    expect(ledger).toEqual(LEDGER)
  })

  // 舞台模型（第二步）的目标：看得见主体、携带物跟手；其余判据不许回升（第 4 步达成，已去掉 .fails）。
  it('第二步目标：occluded 0、carriedDrift 0，其余判据不高于当前账', () => {
    expect(count('occluded')).toBe(0)
    expect(count('carriedDrift')).toBe(0)
    for (const criterion of ['floating', 'interpenetrating', 'offFloor', 'cameraInside'] as const)
      expect(count(criterion)).toBeLessThanOrEqual(LEDGER[criterion][0])
  })
})

/**
 * 违例账：[违例条数, 涉及几道计划]。起点 = origin/main（第一步开工前，08756793c）：
 *   floating 158/34、interpenetrating 17/5、offFloor 27/27、offTimeline 112/34（已改由上面「在时间轴上」一条直接断言为 0）、
 *   cameraInside 0、occluded 27/12、carriedDrift 1/1
 * ① 空间事实（模板按「底」声明 + 地面顶面 = 0 + 落地走 originYForBottom）：floating / offFloor 清零；
 *   墙和门落地后，「at 院门」「走到目标原点」把人放进了墙里（interpenetrating 一度升到 21）。
 * ② 站位不进实心物体（clearOfSolids，一条按包围盒的通用规则，不按谁和谁写特例）：初始摆位与 walk_to / chase 的落脚点
 *   都退出实心物体、留落脚间隙；落脚点高度留在出发点的地面高度 → interpenetrating 21→1、occluded 30→12。
 *   剩下的是 e 类（关系词没有空间语义：机位绕到墙外、「在门前」的门朝向），留给舞台模型一步。
 * 第二步 · 舞台模型（docs/plan/2026-10-05-director-stage-model-step2.md）：
 *   1 种类与尺寸 + 同名合并（「院门 at 模板院门」不再造第二个盒子、cafe_table 按桌子的典型尺寸、信按纸张大小）：
 *     interpenetrating 1→0、occluded 12/6→7/5。
 *   2 关系解析（关系词按舞台角色解析到命名站位与朝向；走到院门 = 走到守门人跟前面对他）：过肩镜头不再被前景人挡（7/5→5/5）；
 *     t1-05 的柜台按家具靠里放后，环绕机位穿到后墙外（新增 1，留给视线一步）。
 *   3 携带物父子（人和信挂在同一个携带分组下，编辑器父子关系）：floating 1→0、carriedDrift 1→0。
 *   4 机位视线（角度相对主体朝向；被挡就对整条路径找看得见、不越轴的候选；上面放着主体的家具算表演区）：occluded 5/5→0。
 */
const LEDGER = {
  cases: 34,
  floating: [0, 0],
  interpenetrating: [0, 0],
  offFloor: [0, 0],
  cameraInside: [0, 0], // 现有避让在渲染真值下也成立——锁住
  occluded: [0, 0],
  carriedDrift: [0, 0],
}
