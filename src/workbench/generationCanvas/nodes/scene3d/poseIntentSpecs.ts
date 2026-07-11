// 每个姿势预设的「意图规格」：这个姿势**该**长什么样，机器可查的版本。
// 窗口来源：2026-07-11 人眼逐图判读（docs/plan/2026-07-11-pose-quality-closed-loop.md §0）+ 解剖常识；
// 度量口径见 poseMetrics.ts（角度=世界坐标关节向量夹角，长度=身高分数）。
// 违反 requiredContacts/forbiddenContacts/COM/硬闸 = P0（物理不可能/破规格）；
// 违反本文件 angles 窗口 = P1（意图偏离，人眼「看着不对」）。循环收敛目标 = 零 P0 + 零 P1。
import type { PoseAngleName, PoseIntentSpec } from './poseMetrics'

const FEET_FLAT = ['left-foot', 'left-toe', 'right-foot', 'right-toe']
const NOT_ON_GROUND = ['pelvis', 'torso', 'left-shank', 'right-shank', 'left-thigh', 'right-thigh', 'left-hand', 'right-hand']

const STANDING_LEGS: Partial<Record<PoseAngleName, [number, number]>> = {
  kneeFlexL: [0, 15],
  kneeFlexR: [0, 15],
  hipFlexL: [0, 16],
  hipFlexR: [0, 16],
  hipAbdL: [-3, 14],
  hipAbdR: [-3, 14],
}

function standingSpec(extraAngles?: Partial<Record<PoseAngleName, [number, number]>>): PoseIntentSpec {
  return {
    requiredContacts: FEET_FLAT,
    forbiddenContacts: NOT_ON_GROUND,
    comInsideSupport: true,
    comMarginMinH: 0.02,
    angles: {
      torsoLeanFwd: [-6, 10],
      neckPitchFwd: [-12, 14],
      ...STANDING_LEGS,
      ...extraAngles,
    },
  }
}

export const POSE_INTENT_SPECS: Record<string, PoseIntentSpec> = {
  standing: standingSpec(),
  't-pose': standingSpec({ elbowFlexL: [0, 15], elbowFlexR: [0, 15], torsoLeanFwd: [-6, 8] }),
  // 迈步中帧：单脚支撑/腾空合法，静态平衡判据不适用（见 poseMetrics 铁律注释）。
  walk: {
    requiredContacts: [],
    forbiddenContacts: ['pelvis', 'torso', 'left-hand', 'right-hand'],
    comInsideSupport: false,
    // 摆臂扫过同侧大腿是步态解剖常态（人眼终审把关真穿模）。
    allowedIntersections: [['left-forearm', 'left-thigh'], ['right-forearm', 'right-thigh']],
    angles: {
      torsoLeanFwd: [-6, 22],
      neckPitchFwd: [-12, 16],
      hipAbdL: [-5, 18],
      hipAbdR: [-5, 18],
    },
  },
  run: {
    requiredContacts: [],
    forbiddenContacts: ['pelvis', 'torso', 'left-hand', 'right-hand'],
    comInsideSupport: false,
    // 跑步摆臂贴胸是解剖常态；胶囊近似在此对上过敏（人眼终审把关）。
    allowedIntersections: [['left-forearm', 'torso'], ['right-forearm', 'torso']],
    angles: {
      torsoLeanFwd: [0, 38],
      neckPitchFwd: [-12, 20],
    },
  },
  // 隐形椅坐姿：重心合法地落在「椅面」上而非双脚支撑面内 → comInsideSupport:false。
  sit: {
    requiredContacts: FEET_FLAT,
    forbiddenContacts: ['left-hand', 'right-hand', 'torso', 'left-shank', 'right-shank'],
    comInsideSupport: false,
    angles: {
      torsoLeanFwd: [-6, 22],
      neckPitchFwd: [-12, 16],
      kneeFlexL: [70, 115],
      kneeFlexR: [70, 115],
      hipFlexL: [65, 110],
      hipFlexR: [65, 110],
      hipAbdL: [-3, 22],
      hipAbdR: [-3, 22],
    },
  },
  squat: {
    requiredContacts: FEET_FLAT,
    forbiddenContacts: ['pelvis', 'torso', 'left-hand', 'right-hand'],
    comInsideSupport: true,
    // 深蹲重心贴支撑面前缘是常态（求解器满约束最优即 ~1.1%），1.5% 属过严猜测。
    comMarginMinH: 0.008,
    angles: {
      torsoLeanFwd: [5, 45],
      neckPitchFwd: [-12, 22],
      kneeFlexL: [95, 150],
      kneeFlexR: [95, 150],
      hipFlexL: [85, 135],
      hipFlexR: [85, 135],
      hipAbdL: [-6, 32],
      hipAbdR: [-6, 32],
    },
  },
  crouch: {
    requiredContacts: FEET_FLAT,
    forbiddenContacts: ['pelvis', 'torso', 'left-hand', 'right-hand'],
    comInsideSupport: true,
    comMarginMinH: 0.015,
    angles: {
      torsoLeanFwd: [4, 32],
      neckPitchFwd: [-12, 18],
      kneeFlexL: [38, 80],
      kneeFlexR: [38, 80],
      hipFlexL: [28, 80],
      hipFlexR: [28, 80],
      hipAbdL: [-3, 18],
      hipAbdR: [-3, 18],
    },
  },
  // 左腿前踩（脚掌平）、右膝跪地（小腿压地）。脚尖不要求触地：靴头网格厚度使其
  // 物理下限 ≈3% 身高（求解器实测），contactEpsH 放宽到跪姿承重容差。
  'single-knee': {
    requiredContacts: ['left-foot', 'left-toe', 'right-shank'],
    contactEpsH: 0.05,
    forbiddenContacts: ['pelvis', 'torso', 'left-shank', 'left-hand', 'right-hand'],
    comInsideSupport: true,
    comMarginMinH: 0.006,
    angles: {
      torsoLeanFwd: [-6, 25],
      neckPitchFwd: [-12, 16],
      kneeFlexL: [70, 110],
      kneeFlexR: [72, 112],
      hipAbdL: [-5, 18],
      hipAbdR: [-5, 18],
    },
  },
  // 双膝跪（上身立直，非趴伏、非跪坐塌腰）。
  'double-knee': {
    requiredContacts: ['left-shank', 'right-shank'],
    contactEpsH: 0.03,
    forbiddenContacts: ['pelvis', 'torso', 'left-hand', 'right-hand'],
    // 跪坐=坐在自己脚跟上（自体支撑，同 sit 的隐形椅逻辑）；地面接触凸包不含
    // 被压住的脚跟（离地 >2.5%），静态平衡判据在此结构性失真 → 不适用。
    comInsideSupport: false,
    angles: {
      torsoLeanFwd: [-10, 25],
      neckPitchFwd: [-12, 16],
      kneeFlexL: [72, 120],
      kneeFlexR: [72, 120],
      hipFlexL: [-20, 30],
      hipFlexR: [-20, 30],
    },
  },
  'hands-on-hips': standingSpec({ elbowFlexL: [50, 110], elbowFlexR: [50, 110] }),
  point: standingSpec(),
  wave: standingSpec(),
  cheer: standingSpec(),
}
