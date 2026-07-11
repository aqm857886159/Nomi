// 度量核单测：①纯几何工具 ②GLB 直载冒烟（t-pose 应「站得正」）③**合成坏姿势灵敏度**——
// 人为制造后仰/踮脚/悬空/穿插，断言观察器必报（这是「观察测试真正观察得到问题」的结构保证，
// 与预设当前值无关，修好预设后依然常绿）。真实预设的逐个体检走 POSE_METRICS_REPORT=1 报告路径。
import { readFileSync } from 'node:fs'
import { beforeAll, describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js'
import {
  calibrateRigGround,
  convexHullXZ,
  createPoseMetricsRig,
  describePoseFindings,
  evaluatePoseAgainstSpec,
  measurePose,
  segmentDistance3D,
  signedDistanceToHullXZ,
  type PoseMetricsRig,
} from './poseMetrics'
import { POSE_INTENT_SPECS } from './poseIntentSpecs'
import { MANNEQUIN_POSE_PRESETS } from './scene3dConstants'
import type { Scene3DVector3 } from './scene3dTypes'
import {
  applyMannequinSkeletonPose,
  captureMannequinGroundReference,
  groundMannequinModel,
  normalizeMannequinModel,
  rememberMannequinRestPose,
} from './scene3dMath'

const deg = (value: number): number => THREE.MathUtils.degToRad(value)

describe('几何工具', () => {
  it('凸包 + 带符号距离：点在内为正、在外为负', () => {
    const hull = convexHullXZ([
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
      [0.5, 0.5],
    ])
    expect(hull).toHaveLength(4)
    expect(signedDistanceToHullXZ([0.5, 0.5], hull)).toBeCloseTo(0.5, 5)
    expect(signedDistanceToHullXZ([2, 0.5], hull)).toBeCloseTo(-1, 5)
  })

  it('线段最近距离', () => {
    const d = segmentDistance3D(
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(1, 0, 0),
      new THREE.Vector3(0.5, 1, 0),
      new THREE.Vector3(0.5, 2, 0),
    )
    expect(d).toBeCloseTo(1, 5)
  })
})

describe('假人度量（GLB 直载，零渲染）', () => {
  let root: THREE.Group
  let rig: PoseMetricsRig

  const applyPreset = (id: string) => {
    const preset = MANNEQUIN_POSE_PRESETS.find((p) => p.id === id)
    if (!preset) throw new Error(`preset not found: ${id}`)
    applyMannequinSkeletonPose(root, preset.pose)
    groundMannequinModel(root)
  }
  const applyRawPose = (pose: Record<string, Scene3DVector3>) => {
    applyMannequinSkeletonPose(root, pose)
    groundMannequinModel(root)
  }

  beforeAll(async () => {
    const url = new URL('../../../../assets/x-bot.glb', import.meta.url)
    const buffer = readFileSync(url)
    const gltf = await new Promise<GLTF>((resolve, reject) => {
      new GLTFLoader().parse(
        buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength),
        '',
        resolve,
        reject,
      )
    })
    root = normalizeMannequinModel(gltf.scene)
    rememberMannequinRestPose(root)
    captureMannequinGroundReference(root)
    applyMannequinSkeletonPose(root, undefined)
    groundMannequinModel(root)
    rig = createPoseMetricsRig(root, 0)
    calibrateRigGround(rig)
  }, 30000)

  it('t-pose 冒烟：双脚踩平、重心在支撑面内、躯干直立', () => {
    applyPreset('t-pose')
    const report = measurePose(rig)
    for (const part of ['left-foot', 'left-toe', 'right-foot', 'right-toe']) {
      expect(report.contacts, `${part} 应触地`).toContain(part)
    }
    expect(report.comMarginH).not.toBeNull()
    expect(report.comMarginH ?? -1).toBeGreaterThan(0)
    expect(Math.abs(report.angles.torsoLeanFwd)).toBeLessThan(14)
    expect(report.angles.kneeFlexL).toBeLessThan(14)
    expect(report.angles.kneeFlexR).toBeLessThan(14)
  })

  it('灵敏度·后仰：躯干猛向后 → 必报（后仰角/重心异常至少一项）', () => {
    applyRawPose({ mixamorigSpine: [deg(-42), 0, 0] })
    const findings = evaluatePoseAgainstSpec(measurePose(rig), POSE_INTENT_SPECS.standing)
    const hit = findings.some(
      (f) => f.code === 'angle:torsoLeanFwd' || f.code === 'com-outside-support',
    )
    expect(hit, describePoseFindings(findings)).toBe(true)
  })

  it('灵敏度·脚失去全掌接触（踮脚/翘尖任一方向）必报', () => {
    // 实测本 rig mixamorigFoot 的 x 轴：+ = 脚尖上翘（与部分预设注释宣称的「+=跖屈」相反，见报告）。
    applyRawPose({ mixamorigLeftFoot: [deg(-48), 0, 0], mixamorigRightFoot: [deg(-48), 0, 0] })
    const findings = evaluatePoseAgainstSpec(measurePose(rig), POSE_INTENT_SPECS.standing)
    const hit = findings.some((f) => /^missing-contact:(left|right)-(foot|toe)$/.test(f.code))
    expect(hit, describePoseFindings(findings)).toBe(true)
  })

  it('灵敏度·悬空：整体抬离地面 → 全部必需触地缺失', () => {
    applyPreset('standing')
    const inner = root.children[0]
    inner.position.y += 0.06
    root.updateMatrixWorld(true)
    const findings = evaluatePoseAgainstSpec(measurePose(rig), POSE_INTENT_SPECS.standing)
    const missing = findings.filter((f) => f.code.startsWith('missing-contact:'))
    expect(missing.length, describePoseFindings(findings)).toBeGreaterThanOrEqual(4)
    applyPreset('standing')
  })

  it('灵敏度·双腿交叉内收 → 穿插或外展硬闸必报', () => {
    applyRawPose({
      mixamorigLeftUpLeg: [0, 0, deg(-26)],
      mixamorigRightUpLeg: [0, 0, deg(26)],
    })
    const report = measurePose(rig)
    const findings = evaluatePoseAgainstSpec(report, POSE_INTENT_SPECS.standing)
    const hit = findings.some(
      (f) => f.code.startsWith('self-intersect:') || f.code === 'angle:hipAbdL' || f.code === 'angle:hipAbdR',
    )
    expect(
      hit,
      `abdL=${report.angles.hipAbdL.toFixed(1)} abdR=${report.angles.hipAbdR.toFixed(1)}\n${describePoseFindings(findings)}`,
    ).toBe(true)
  })

  it('外展角方向约定：双腿对称外劈 → 左右 abd 同为正且近似相等', () => {
    applyRawPose({
      mixamorigLeftUpLeg: [0, 0, deg(26)],
      mixamorigRightUpLeg: [0, 0, deg(-26)],
    })
    const report = measurePose(rig)
    const { hipAbdL, hipAbdR } = report.angles
    const msg = `abdL=${hipAbdL.toFixed(1)} abdR=${hipAbdR.toFixed(1)}`
    expect(Math.abs(hipAbdL - hipAbdR), msg).toBeLessThan(8)
    expect(Math.min(hipAbdL, hipAbdR), msg).toBeGreaterThan(12)
  })

  it('规格覆盖：每个预设都有意图规格', () => {
    for (const preset of MANNEQUIN_POSE_PRESETS) {
      expect(POSE_INTENT_SPECS[preset.id], `缺规格: ${preset.id}`).toBeTruthy()
    }
  })

  it('全预设体检报告（POSE_METRICS_REPORT=1 时打印，供闭环用）', () => {
    if (process.env.POSE_METRICS_REPORT !== '1') return
    const rows: Array<Record<string, unknown>> = []
    for (const preset of MANNEQUIN_POSE_PRESETS) {
      applyPreset(preset.id)
      const report = measurePose(rig)
      const findings = evaluatePoseAgainstSpec(report, POSE_INTENT_SPECS[preset.id])
      rows.push({
        id: preset.id,
        p0: findings.filter((f) => f.severity === 'P0').length,
        p1: findings.filter((f) => f.severity === 'P1').length,
        comMarginH: report.comMarginH?.toFixed(3),
        torso: report.angles.torsoLeanFwd.toFixed(1),
        neck: report.angles.neckPitchFwd.toFixed(1),
        contacts: report.contacts.join('|'),
      })
      console.log(`\n── ${preset.id}(${preset.label})`)
      console.log(describePoseFindings(findings))
    }
    console.table(rows)
  })
})
