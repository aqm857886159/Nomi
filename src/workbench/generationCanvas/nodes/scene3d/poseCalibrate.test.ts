// 姿势参数网格求解器（POSE_SOLVE=1 才跑，不进常规 CI）——「诊断→受约束调参」的确定性执行器。
// 对指定预设，在少数关键自由度上网格扫描，目标函数 = Σ目标部位离地 + 重心出界罚 + 穿插罚，
// 打印最优参数组合；人再把数值固化进 scene3dConstants 预设（预设保持静态数据，求解器只做校准工具）。
import { readFileSync } from 'node:fs'
import { beforeAll, describe, it } from 'vitest'
import * as THREE from 'three'
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js'
import {
  calibrateRigGround,
  createPoseMetricsRig,
  measurePose,
  type PoseMetricsReport,
  type PoseMetricsRig,
} from './poseMetrics'
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

interface SolveAxis {
  bone: string
  axis: 0 | 1 | 2
  /** 扫描值（度）。mirror 时对右侧骨取相反数（y/z 轴镜像姿势用）。 */
  values: number[]
  mirrorBone?: string
  mirrorNegate?: boolean
}

interface SolveTask {
  presetId: string
  axes: SolveAxis[]
  /** 这些部位的离地量计入目标（希望贴地）。 */
  wantGrounded: string[]
  /** 重心须在支撑面内的最小边距（身高分数）；不适用则 0。 */
  comMarginMin: number
  /** 计入穿插罚的部位对前缀（poseMetrics CAPSULE_PAIRS 子集），空=全部。 */
  intersectWeight: number
  /** 躯干前倾至少达到的度数（意图窗下界），未达按 0.005/度 计罚。 */
  preferTorsoMin?: number
}

function range(from: number, to: number, step: number): number[] {
  const out: number[] = []
  for (let v = from; v <= to + 1e-9; v += step) out.push(Number(v.toFixed(3)))
  return out
}

const TASKS: SolveTask[] = [
  {
    presetId: 'single-knee',
    axes: [
      { bone: 'mixamorigRightLeg', axis: 0, values: range(96, 132, 4) },
      { bone: 'mixamorigRightFoot', axis: 0, values: range(-12, 8, 4) },
      { bone: 'mixamorigRightUpLeg', axis: 0, values: [0, 6, 12] },
      { bone: 'mixamorigLeftUpLeg', axis: 0, values: range(64, 84, 4) },
      { bone: 'mixamorigLeftLeg', axis: 0, values: range(88, 108, 4) },
    ],
    wantGrounded: ['right-shank', 'right-toe', 'left-foot', 'left-toe'],
    comMarginMin: 0.01,
    intersectWeight: 0.3,
  },
  {
    presetId: 'double-knee',
    axes: [
      { bone: 'mixamorigLeftLeg', axis: 0, values: range(100, 132, 4), mirrorBone: 'mixamorigRightLeg' },
      { bone: 'mixamorigLeftFoot', axis: 0, values: range(-12, 8, 4), mirrorBone: 'mixamorigRightFoot' },
      { bone: 'mixamorigLeftUpLeg', axis: 0, values: [0, 6, 12], mirrorBone: 'mixamorigRightUpLeg' },
      { bone: 'mixamorigSpine', axis: 0, values: [2, 6, 10] },
    ],
    wantGrounded: ['left-shank', 'right-shank', 'left-toe', 'right-toe'],
    comMarginMin: 0.012,
    intersectWeight: 0.3,
  },
  {
    presetId: 'squat',
    axes: [
      { bone: 'mixamorigHips', axis: 0, values: [-10, -6, -2] },
      { bone: 'mixamorigSpine', axis: 0, values: range(8, 26, 2) },
      { bone: 'mixamorigLeftArm', axis: 1, values: range(8, 28, 4), mirrorBone: 'mixamorigRightArm', mirrorNegate: true },
      { bone: 'mixamorigLeftForeArm', axis: 0, values: range(24, 44, 4), mirrorBone: 'mixamorigRightForeArm' },
    ],
    wantGrounded: ['left-foot', 'left-toe', 'right-foot', 'right-toe'],
    comMarginMin: 0.015,
    intersectWeight: 1,
    preferTorsoMin: 8,
  },
  {
    presetId: 'crouch',
    axes: [
      { bone: 'mixamorigLeftFoot', axis: 0, values: range(-26, -18, 2), mirrorBone: 'mixamorigRightFoot' },
      { bone: 'mixamorigSpine', axis: 0, values: range(10, 22, 2) },
      { bone: 'mixamorigHips', axis: 0, values: [-4, 0, 4] },
    ],
    wantGrounded: ['left-foot', 'left-toe', 'right-foot', 'right-toe'],
    comMarginMin: 0.015,
    intersectWeight: 1,
    preferTorsoMin: 4,
  },
  {
    presetId: 'run',
    axes: [
      { bone: 'mixamorigLeftArm', axis: 1, values: range(-48, -16, 4) },
      { bone: 'mixamorigLeftForeArm', axis: 1, values: range(-32, 0, 4) },
      { bone: 'mixamorigLeftForeArm', axis: 0, values: [28, 36, 42] },
    ],
    wantGrounded: [],
    comMarginMin: 0,
    intersectWeight: 1,
  },
]

function scoreReport(report: PoseMetricsReport, task: SolveTask): number {
  let score = 0
  for (const part of task.wantGrounded) {
    score += Math.max(0, report.clearanceByPart[part] ?? 0.5)
  }
  if (task.comMarginMin > 0 && report.comMarginH !== null) {
    score += Math.max(0, task.comMarginMin - report.comMarginH) * 2
  }
  for (const hit of report.selfIntersections) {
    score += hit.depthRatio * 0.1 * task.intersectWeight
  }
  if (task.preferTorsoMin !== undefined) {
    score += Math.max(0, task.preferTorsoMin - report.angles.torsoLeanFwd) * 0.005
  }
  return score
}

describe.skipIf(process.env.POSE_SOLVE !== '1')('姿势参数网格求解（POSE_SOLVE=1）', () => {
  let root: THREE.Group
  let rig: PoseMetricsRig

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

  it('逐任务扫描并打印最优参数', () => {
    for (const task of TASKS) {
      const preset = MANNEQUIN_POSE_PRESETS.find((p) => p.id === task.presetId)
      if (!preset?.pose) continue
      const combos: number[][] = task.axes.reduce<number[][]>(
        (acc, axisSpec) => acc.flatMap((combo) => axisSpec.values.map((v) => [...combo, v])),
        [[]],
      )
      let best: { combo: number[]; score: number; report: PoseMetricsReport } | null = null
      for (const combo of combos) {
        const pose: Record<string, Scene3DVector3> = Object.fromEntries(
          Object.entries(preset.pose).map(([bone, rot]) => [bone, [...rot] as Scene3DVector3]),
        )
        combo.forEach((valueDeg, i) => {
          const spec = task.axes[i]
          const target = (pose[spec.bone] ?? [0, 0, 0]) as Scene3DVector3
          target[spec.axis] = deg(valueDeg)
          pose[spec.bone] = target
          if (spec.mirrorBone) {
            const mirror = (pose[spec.mirrorBone] ?? [0, 0, 0]) as Scene3DVector3
            mirror[spec.axis] = deg(spec.mirrorNegate ? -valueDeg : valueDeg)
            pose[spec.mirrorBone] = mirror
          }
        })
        applyMannequinSkeletonPose(root, pose)
        groundMannequinModel(root)
        const report = measurePose(rig)
        const score = scoreReport(report, task)
        if (!best || score < best.score) best = { combo, score, report }
      }
      if (!best) continue
      const labels = task.axes.map((a, i) => `${a.bone}[${a.axis}]=${best.combo[i]}`).join(' ')
      const clear = task.wantGrounded
        .map((p) => `${p}=${((best.report.clearanceByPart[p] ?? 0) * 100).toFixed(1)}%`)
        .join(' ')
      console.log(
        `\n◆ ${task.presetId}: score=${best.score.toFixed(4)}\n  ${labels}\n  clearance: ${clear}\n  comMargin=${best.report.comMarginH?.toFixed(3)} torso=${best.report.angles.torsoLeanFwd.toFixed(1)} intersects=${best.report.selfIntersections.map((s) => `${s.parts.join('x')}:${(s.depthRatio * 100).toFixed(0)}%`).join(',') || 'none'}`,
      )
    }
  }, 600000)
})
