// 录 take（S2）的纯转换层：把「实时操控时按时间戳采的位姿样本」→「现有 trajectory + binding 数据结构」，
// 然后整条出 mp4 走现有离屏捕获管线（Scene3DTrajectoryCapture → cameraMoveVideo → framesToVideo），
// 不另起炉灶（P1 无并行版）。
//
// 关键设计：每个采样点的 timeRatio = 它的真实时间戳在录制时段里的归一化位置。这样回放时
// objectWithPlaybackPose / cameraWithPlaybackPosition 用 remapTrajectoryTimeRatio 按 t 求位姿，
// 录制中走快走慢都被忠实还原（匀速段与停顿段不会被均匀重采样抹平）。
//
// 配单测 takeRecording.test.ts（时间戳→timeRatio、去重、退化、duration/frameCount 换算）。
import {
  createScene3DTrajectoryId,
  createScene3DTrajectoryPointId,
  createScene3DTrajectoryBindingId,
  cloneScene3DState,
} from './scene3dSerializer'
import { ROLE_COLOR_SEQUENCE, LOCOMOTION_CLIP_WALK } from './scene3dConstants'
import { buildPoseTrack, type Scene3DPoseEvent } from './scene3dPoseTrack'
import type {
  Scene3DState,
  Scene3DTrajectory,
  Scene3DTrajectoryBinding,
  Scene3DTrajectoryPoint,
  Scene3DVector3,
} from './scene3dTypes'

// 一条采样：某时刻（毫秒 wall-clock）+ 世界坐标位置。相机额外带注视点（见 TakeCameraSample）。
export type TakeSample = {
  time: number
  position: Scene3DVector3
}

// 相邻两点距离小于此值（米²）视为「没动」→ 合并，避免静止时生成退化曲线（点全挤一起，
// Catmull-Rom 切线发散 → 朝向乱跳）。0.01 → ~10cm 阈值。
const MIN_POINT_DISTANCE_SQ = 0.01

const MIN_DURATION_SECONDS = 0.25 // tap 一下就停 → 仍给一个最小正时长，避免 duration=0
const MIN_FRAME_COUNT = 2
const MAX_FRAME_COUNT = 240

function distanceSq(a: Scene3DVector3, b: Scene3DVector3): number {
  const dx = a[0] - b[0]
  const dy = a[1] - b[1]
  const dz = a[2] - b[2]
  return dx * dx + dy * dy + dz * dz
}

/**
 * 把按时间戳采的样本压成一条 trajectory：去掉与上一个保留点几乎重合的样本（静止段塌成一点），
 * 每个保留点写真实时间归一化的 timeRatio。两端强制 0/1。距离不足 2 个有效点 → 返回 null
 * （物体全程没动，不该建轨迹）。
 */
export function samplesToTrajectory(
  samples: TakeSample[],
  color: string,
  name: string,
): Scene3DTrajectory | null {
  if (samples.length < 2) return null
  const t0 = samples[0].time
  const tN = samples[samples.length - 1].time
  const span = tN - t0

  // 1) 去重：相邻几乎重合的点合并（保留首个；末样本特殊处理见下）。
  const kept: TakeSample[] = []
  for (const s of samples) {
    const prev = kept[kept.length - 1]
    if (!prev || distanceSq(prev.position, s.position) >= MIN_POINT_DISTANCE_SQ) {
      kept.push(s)
    }
  }
  // 确保末样本在内（最后一段若被去重吞掉，补回真实终点，让轨迹覆盖完整路径）。
  const last = samples[samples.length - 1]
  if (kept[kept.length - 1] !== last && distanceSq(kept[kept.length - 1].position, last.position) >= MIN_POINT_DISTANCE_SQ) {
    kept.push(last)
  }
  if (kept.length < 2) return null

  const points: Scene3DTrajectoryPoint[] = kept.map((s, index) => {
    let timeRatio: number
    if (index === 0) timeRatio = 0
    else if (index === kept.length - 1) timeRatio = 1
    else timeRatio = span > 0 ? (s.time - t0) / span : index / (kept.length - 1)
    return {
      id: createScene3DTrajectoryPointId(),
      position: [...s.position] as Scene3DVector3,
      timeRatio,
    }
  })

  return {
    id: createScene3DTrajectoryId(),
    name,
    points,
    tension: 0.5,
    closed: false,
    color,
  }
}

/** 把一个物体绑到录制轨迹上，整段 [startTime, endTime] 正向播放、无偏移。 */
export function buildTakeBinding(
  trajectoryId: string,
  objectId: string,
  startTime: number,
  endTime: number,
): Scene3DTrajectoryBinding {
  return {
    id: createScene3DTrajectoryBindingId(),
    trajectoryId,
    objects: [{ objectId, offsetRatio: 0 }],
    startTime,
    endTime,
    direction: 'forward',
  }
}

/** 录制 ms 时长 → 秒（带最小正时长地板，tap-record 不会得到 0 时长）。 */
export function recordingDurationSeconds(startMs: number, endMs: number): number {
  return Math.max(MIN_DURATION_SECONDS, (endMs - startMs) / 1000)
}

/** 离屏采样帧数 = round(duration * fps)，并夹到捕获器可承受区间。 */
export function frameCountForDuration(durationSeconds: number, fps: number): number {
  const raw = Math.round(durationSeconds * fps)
  if (!Number.isFinite(raw)) return MIN_FRAME_COUNT
  return Math.min(MAX_FRAME_COUNT, Math.max(MIN_FRAME_COUNT, raw))
}

export type RecordedTake = {
  possessedObjectId: string
  characterSamples: TakeSample[]
  cameraSamples: TakeSample[]
  // 动作切换事件（time 已归一为录制起点起算的秒，与 binding/播放头同时钟）。缺省/单帧 = 全程同一姿势。
  poseEvents?: Scene3DPoseEvent[]
  durationSeconds: number
}

/**
 * 录制结果 → 一个可被现有离屏捕获管线（Scene3DTrajectoryCapture / CameraMoveCaptureHost）回放的
 * Scene3DState：
 * - 复制基础场景（保留所有物体/环境）；
 * - 被操控角色 → 录制位移轨迹 + binding（整段 [0,duration] 正向）；
 * - cameras[0] → 录制机位轨迹 + binding（若用户绕看过），并把 followTargetId 指向被操控角色，
 *   让回放时相机朝向忠实跟住主体（相机轨迹只带位置，朝向由 follow 求出；用户没动相机时相机静止但仍跟拍）；
 * - sceneTimeline.totalDuration = 录制时长。
 * 角色全程没动 → 无角色轨迹（samplesToTrajectory 返回 null），返回 null（无可回放内容，调用方提示）。
 */
export function buildRecordedTakeScene(base: Scene3DState, take: RecordedTake): Scene3DState | null {
  const next = cloneScene3DState(base)
  const character = next.objects.find((object) => object.id === take.possessedObjectId)
  if (!character) return null

  const characterTrajectory = samplesToTrajectory(
    take.characterSamples,
    ROLE_COLOR_SEQUENCE[0],
    `${character.name} 走位`,
  )
  if (!characterTrajectory) return null

  // 动作随时间变化：把录制的切动作事件压成 pose 轨道挂到角色（≥2 个关键帧才挂——单帧=全程同姿势=老行为）。
  // 离屏 stepper 据此在每个关键帧边界把假人骨架重摆到该时刻动作（pose-over-time），与位移轨迹同一时间线。
  const poseTrack = buildPoseTrack(take.poseEvents ?? [])
  character.poseTrack = poseTrack.length >= 2 ? poseTrack : undefined

  // 录的就是「走位 take」→ 标记被操控角色离屏确定性播 walk clip（腿迈）。整段 walk 而非按轨迹速度派生：
  // 走位 take 本就是「走路」语义；按帧速度分桶易在轨迹近静止段 idle↔walk 抖动（曲线切线噪声），整段 walk
  // 最简且可靠地满足「腿在迈」。中途切静态动作的那几帧由 frameMotionSource 判 static-pose 自动打断走路（静态优先）。
  character.locomotionClip = LOCOMOTION_CLIP_WALK

  const trajectories: Scene3DTrajectory[] = [characterTrajectory]
  const bindings: Scene3DTrajectoryBinding[] = [
    buildTakeBinding(characterTrajectory.id, character.id, 0, take.durationSeconds),
  ]

  // 离屏捕获器固定取 cameras[0]，故把录制机位落到 cameras[0]。
  const camera = next.cameras[0]
  if (camera) {
    camera.followTargetId = character.id
    const cameraTrajectory = samplesToTrajectory(
      take.cameraSamples,
      ROLE_COLOR_SEQUENCE[2] ?? characterTrajectory.color,
      '机位路径',
    )
    if (cameraTrajectory) {
      trajectories.push(cameraTrajectory)
      bindings.push(buildTakeBinding(cameraTrajectory.id, camera.id, 0, take.durationSeconds))
    }
  }

  return {
    ...next,
    trajectories,
    trajectoryBindings: bindings,
    trajectoryGroups: [],
    sceneTimeline: { totalDuration: take.durationSeconds },
  }
}
