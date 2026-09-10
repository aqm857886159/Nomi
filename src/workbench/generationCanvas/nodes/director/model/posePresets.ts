/**
 * [INPUT]: 无依赖（零 React / 零 THREE）
 * [OUTPUT]: 对外提供 PoseVec3、MannequinPosePreset、degreesToRadians / makePoseOffset、MANNEQUIN_POSE_PRESETS、findPosePreset、presetPoseRotations（预设弧度 → 度 Vec3，供迁移把 V1 手写姿态烘进 boneRotations）
 * [POS]: director/model 的假人静态姿态单一真相（原 V1 scene3dConstants，切换门入籍）：骨名 mixamorig*、弧度三元组；
 *        （V1 的「自然站姿基线」MANNEQUIN_DEFAULT_POSE 已删：x-bot rest 就是 Mixamo bind，复位 = 纯 bind）
 *        actionLibrary（弧度 → 度）、姿态页预设按钮、迁移器（老工程 pose）都从这里取。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
export type PoseVec3 = [number, number, number]

export type MannequinPosePreset = {
  id: string
  label: string
  pose?: Record<string, PoseVec3>
}

export function degreesToRadians(value: number): number {
  return Number(((value * Math.PI) / 180).toFixed(4))
}

export function makePoseOffset(values: Record<string, PoseVec3>): Record<string, PoseVec3> {
  return Object.fromEntries(
    Object.entries(values).map(([boneName, rotation]) => [boneName, rotation.map((value) => degreesToRadians(value)) as PoseVec3]),
  )
}


export const MANNEQUIN_POSE_PRESETS: MannequinPosePreset[] = [
  {
    id: 'standing',
    label: '站立',
  },
  {
    id: 't-pose',
    label: 'T型',
    pose: makePoseOffset({
      mixamorigSpine: [-2, 0, 0],
      mixamorigHead: [2, 0, 0],
      mixamorigLeftArm: [-67.5, -11.4, 6.8],
      mixamorigRightArm: [-67.5, 11.4, -6.8],
      mixamorigLeftForeArm: [-8, 4, 0],
      mixamorigRightForeArm: [-8, -4, 0],
      mixamorigLeftHand: [-6, 0, 8],
      mixamorigRightHand: [-6, 0, -8],
    }),
  },
  {
    id: 'walk',
    label: '行走',
    pose: makePoseOffset({
      mixamorigHips: [0, -6, 0],
      mixamorigSpine: [2, 4, 0],
      mixamorigLeftArm: [22, -4, 2],
      mixamorigRightArm: [-18, 4, -2],
      mixamorigLeftForeArm: [12, -3, 0],
      mixamorigRightForeArm: [16, 3, 0],
      mixamorigLeftUpLeg: [-28, 0, 0],
      mixamorigLeftLeg: [20, 0, 0],
      mixamorigRightUpLeg: [22, 0, 0],
      mixamorigRightLeg: [8, 0, 0],
    }),
  },
  {
    id: 'run',
    label: '跑步',
    pose: makePoseOffset({
      mixamorigHips: [8, -8, 0],
      mixamorigSpine: [10, 5, 0],
      mixamorigHead: [-2, 0, 0],
      mixamorigLeftArm: [44, -16, 4],
      mixamorigRightArm: [-32, 16, -4],
      mixamorigLeftForeArm: [42, -4, 0],
      mixamorigRightForeArm: [48, 4, 0],
      mixamorigLeftUpLeg: [-44, 0, 0],
      mixamorigLeftLeg: [42, 0, 0],
      mixamorigRightUpLeg: [34, 0, 0],
      mixamorigRightLeg: [26, 0, 0],
      mixamorigLeftFoot: [-10, 0, 0],
      mixamorigRightFoot: [10, 0, 0],
    }),
  },
  {
    id: 'sit',
    label: '坐姿',
    // 椅面坐姿：大腿近水平、小腿垂直、脚掌踩平；双臂微屈落在大腿两侧。
    // 2026-07-05 用 pose-lab 多视角复核，避免坐姿看起来像深蹲或手臂空垂穿腿。
    pose: makePoseOffset({
      mixamorigSpine: [4, 0, 0],
      // 肘外张 + 前臂少屈：手落在大腿外上方而非插进大腿（度量核胶囊层曾抓出前臂×大腿穿插 85%）。
      mixamorigLeftArm: [-4, -14, 0],
      mixamorigRightArm: [-4, 14, 0],
      mixamorigLeftForeArm: [46, -6, 0],
      mixamorigRightForeArm: [46, 6, 0],
      mixamorigLeftHand: [2, 0, -4],
      mixamorigRightHand: [2, 0, 4],
      mixamorigLeftUpLeg: [86, 4, 0],
      mixamorigRightUpLeg: [86, -4, 0],
      mixamorigLeftLeg: [94, 0, 0],
      mixamorigRightLeg: [94, 0, 0],
      mixamorigLeftFoot: [-14, 0, 0],
      mixamorigRightFoot: [-14, 0, 0],
    }),
  },
  {
    id: 'squat',
    label: '蹲下',
    // 深蹲：髋/膝深屈、躯干前倾、脚掌踩平。
    // ⚠️ 脚轴向（poseMetrics 实测锚定）：mixamorigFoot +x = 背屈（脚尖上翘）/ −x = 跖屈（绷脚）。
    // 旧值 Foot −42 实为绷脚 42° → 脚跟离地 2.6% 身高、重心前出支撑面 10.5%（度量核抓出）；
    // 深蹲小腿前倾 ≈30°，鞋底踩平需要背屈 +32。肘略外张让手垂在膝前，不插进大腿。
    pose: makePoseOffset({
      mixamorigHips: [-6, 0, 0],
      mixamorigSpine: [20, 0, 0],
      mixamorigHead: [-6, 0, 0],
      mixamorigLeftArm: [12, 28, 0],
      mixamorigRightArm: [12, -28, 0],
      mixamorigLeftForeArm: [44, -8, 0],
      mixamorigRightForeArm: [44, 8, 0],
      mixamorigLeftUpLeg: [98, 8, 0],
      mixamorigRightUpLeg: [98, -8, 0],
      mixamorigLeftLeg: [124, 0, 0],
      mixamorigRightLeg: [124, 0, 0],
      mixamorigLeftFoot: [-26, 0, 0],
      mixamorigRightFoot: [-26, 0, 0],
    }),
  },
  {
    // 游戏式操控 C 键专用「半蹲」（区别于上面的点击式深蹲 squat，两者是不同动作，P1/P4 各有一份数据源）。
    // 目标：髋/膝屈到大约一半、上身**基本直立**、脚掌**踩平**、重心稳、看着「随时能走/起身」——不是压在膝上的深蹲。
    // 多视角侧视校准（pose-lab side view）得到的关键规律：
    //  ① 上身要**略前倾**(Spine +12)——肩膀落在脚上方偏前才像自然半蹲/预备姿势；后仰(负值)会变「往后坐要摔倒」(用户实测「蹲反了」)、
    //     大幅前倾(如深蹲 +26)又会折成「深鞠躬」。+12 是「直立带一点前倾」的中间态。
    //  ② 膝屈(Leg) 明显大于髋屈(UpLeg)：把重心压低而不是把臀往后坐；
    //  ③ 膝一弯小腿前倾，脚必须大幅**背屈**才能整只脚掌踩平——背屈不够就踮脚尖。
    //     ⚠️ 脚轴向（poseMetrics 实测锚定）：+x = 背屈（脚尖上翘）/ −x = 跖屈。旧值 −34 写反了方向。
    //  ④ Hips 不动（它是骨架根，动了整体歪身，蹲会变成坐/后仰）。蒙皮最低点自动落地(scene3dMath)。
    id: 'crouch',
    label: '半蹲',
    pose: makePoseOffset({
      mixamorigHips: [-4, 0, 0],
      mixamorigSpine: [16, 0, 0],
      mixamorigHead: [-5, 0, 0],
      mixamorigLeftArm: [8, -4, 0],
      mixamorigRightArm: [8, 4, 0],
      mixamorigLeftUpLeg: [58, 5, 0],
      mixamorigRightUpLeg: [58, -5, 0],
      mixamorigLeftLeg: [80, 0, 0],
      mixamorigRightLeg: [80, 0, 0],
      mixamorigLeftFoot: [-26, 0, 0],
      mixamorigRightFoot: [-26, 0, 0],
    }),
  },
  {
    id: 'single-knee',
    label: '单膝跪',
    // 前腿(左)：大腿近水平、小腿近垂直、脚掌踩平。后腿(右)：大腿近垂直略后、膝着地、小腿向后**平贴地面**、
    // 脚背贴地（= 大幅跖屈）。
    // ⚠️ 脚轴向（poseMetrics 实测锚定）：+x = 背屈（脚尖上翘）/ −x = 跖屈（脚背压平）。
    // 旧值 Foot +74 实为把脚尖朝上抬 → 后小腿离地 10.7% 身高、整条后腿悬空（度量核抓出）。
    // 后小腿要横平：膝屈 ≈ 90°+大腿后倾量（Leg 96 配 UpLeg −8）。
    pose: makePoseOffset({
      mixamorigHips: [-4, 0, 0],
      mixamorigSpine: [5, 0, 0],
      mixamorigLeftUpLeg: [76, 4, 0],
      mixamorigLeftLeg: [88, 0, 0],
      mixamorigLeftFoot: [-20, 0, 0],
      mixamorigRightUpLeg: [8, -2, 0],
      mixamorigRightLeg: [80, 0, 0],
      mixamorigRightFoot: [-54, 0, 0],
    }),
  },
  {
    id: 'double-knee',
    label: '双膝跪',
    // 直身双膝跪（非跪坐/趴伏）：大腿近垂直略后，小腿向后平贴地、脚背贴地。
    // ⚠️ 脚轴向（poseMetrics 实测锚定）：+x = 背屈 / −x = 跖屈；旧值 +66 把脚尖朝上抬
    // → 双脚背离地 35.7% 身高（度量核抓出）。小腿横平：Leg ≈ 90°+大腿后倾量。
    pose: makePoseOffset({
      mixamorigHips: [-4, 0, 0],
      mixamorigSpine: [6, 0, 0],
      mixamorigLeftUpLeg: [8, 4, 0],
      mixamorigRightUpLeg: [8, -4, 0],
      mixamorigLeftLeg: [96, 0, 0],
      mixamorigRightLeg: [96, 0, 0],
      mixamorigLeftFoot: [-54, 0, 0],
      mixamorigRightFoot: [-54, 0, 0],
    }),
  },
  {
    id: 'hands-on-hips',
    label: '叉腰',
    pose: makePoseOffset({
      mixamorigLeftArm: [-28, 0, 0],
      mixamorigRightArm: [-28, 0, 0],
      mixamorigLeftForeArm: [102, 0, 0],
      mixamorigRightForeArm: [102, 0, 0],
    }),
  },
  {
    id: 'point',
    label: '指向',
    pose: makePoseOffset({
      mixamorigRightArm: [-76, 30, -8],
      mixamorigRightForeArm: [8, 0, 0],
      mixamorigRightHand: [-4, 0, 6],
    }),
  },
  {
    id: 'wave',
    label: '举手',
    pose: makePoseOffset({
      mixamorigRightArm: [-148, 10, -4],
      mixamorigRightForeArm: [28, 0, 8],
      mixamorigRightHand: [-8, 0, 10],
    }),
  },
  {
    id: 'cheer',
    label: '举双手',
    pose: makePoseOffset({
      mixamorigLeftArm: [-138, -18, 8],
      mixamorigRightArm: [-138, 18, -8],
      mixamorigLeftForeArm: [18, 0, -4],
      mixamorigRightForeArm: [18, 0, 4],
    }),
  },
]

export function findPosePreset(id: string | undefined): MannequinPosePreset | undefined {
  return id ? MANNEQUIN_POSE_PRESETS.find((preset) => preset.id === id) : undefined
}

// V1 预设的骨骼偏移是弧度 [x,y,z]；导演台骨骼旋转统一用度 Vec3（写进 boneRotations / 骨骼关键帧）
export function presetPoseRotations(presetId: string): Record<string, { x: number; y: number; z: number }> | null {
  const preset = MANNEQUIN_POSE_PRESETS.find((item) => item.id === presetId)
  if (!preset) return null
  const toDegrees = (value: number) => Number(((value * 180) / Math.PI).toFixed(2))
  const rotations: Record<string, { x: number; y: number; z: number }> = {}
  for (const [bone, value] of Object.entries(preset.pose ?? {})) rotations[bone] = { x: toDegrees(value[0]), y: toDegrees(value[1]), z: toDegrees(value[2]) }
  return rotations
}
