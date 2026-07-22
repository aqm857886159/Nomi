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
import { cameraAimBindingId } from './scene3dBindingIds'
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

// 相机操控（运镜）录制结果：被操控相机的飞行样本（位置）+ 注视点样本（每帧相机看向哪，
// position + forward×dist）。无角色——运镜本身就是主内容。两条样本同长同时戳。
export type RecordedCameraTake = {
  possessedCameraId: string
  cameraSamples: TakeSample[]
  targetSamples: TakeSample[]
  durationSeconds: number
}

/**
 * 继承 base 中已应用到该相机的运镜（E：右横移跟拍等 = applyCameraMovePreset 落的 trajectory+binding），
 * 按录制时长等比重定时到 [0,duration]，让预选运镜与人物动作同步跑、在最终 take 保留，
 * 不被重采样「机位路径」覆盖。没有已有运镜 → null（调用方走采样机位老路）。
 * 位置绑定认 objectId===cameraId；朝向（aim）绑定认合成 id `${cameraId}:aim`，两者一并继承。
 */
function inheritCameraMove(
  cameraId: string,
  baseTrajectories: readonly Scene3DTrajectory[],
  baseBindings: readonly Scene3DTrajectoryBinding[],
  durationSeconds: number,
): { trajectories: Scene3DTrajectory[]; bindings: Scene3DTrajectoryBinding[] } | null {
  const aimId = cameraAimBindingId(cameraId)
  const cameraBindings = baseBindings.filter((binding) =>
    binding.objects.some((entry) => entry.objectId === cameraId || entry.objectId === aimId),
  )
  if (cameraBindings.length === 0) return null
  const trajectoryIds = new Set(cameraBindings.map((binding) => binding.trajectoryId))
  const trajectories = baseTrajectories.filter((trajectory) => trajectoryIds.has(trajectory.id))
  if (trajectories.length === 0) return null
  // base 相机时间线跨度 → 等比映射到 [0,duration]，保留多段编排顺序（单预设 [0,d] 即整段铺满录制时长）。
  const camMin = Math.min(...cameraBindings.map((binding) => binding.startTime))
  const camMax = Math.max(...cameraBindings.map((binding) => binding.endTime))
  const span = camMax - camMin
  const remap = (time: number): number => (span > 0 ? ((time - camMin) / span) * durationSeconds : 0)
  const bindings = cameraBindings.map((binding) => ({
    ...binding,
    startTime: remap(binding.startTime),
    endTime: remap(binding.endTime),
  }))
  return { trajectories, bindings }
}

/**
 * 录制结果 → 一个可被现有离屏捕获管线（Scene3DTrajectoryCapture / CameraMoveCaptureHost）回放的
 * Scene3DState：
 * - 复制基础场景（保留所有物体/环境）；
 * - 被操控角色 → 录制位移轨迹 + binding（整段 [0,duration] 正向）；
 * - cameras[0]：**若 base 已有该相机的运镜预设（右横移跟拍等）→ 继承保留**（E，不覆盖、不重采样）；
 *   否则退回老行为——采样用户绕拍的机位轨迹 + followTargetId 指向被操控角色（相机轨迹只带位置，朝向由 follow 求）；
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

  // 离屏捕获器固定取 cameras[0]。
  const camera = next.cameras[0]
  if (camera) {
    const inherited = inheritCameraMove(camera.id, next.trajectories, next.trajectoryBindings, take.durationSeconds)
    if (inherited) {
      // E：继承已有运镜（右横移跟拍等），保留其轨迹与绑定，不覆盖 followTargetId、不再重采样机位路径。
      trajectories.push(...inherited.trajectories)
      bindings.push(...inherited.bindings)
    } else {
      // 无预选运镜：老行为——相机跟拍被操控角色 + 采样用户绕拍的机位路径。
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
  }

  return {
    ...next,
    trajectories,
    trajectoryBindings: bindings,
    trajectoryGroups: [],
    sceneTimeline: { totalDuration: take.durationSeconds },
  }
}

// 退化兜底：纯转朝向（相机在原地 pan/tilt，不平移）时 samplesToTrajectory 会因点全重合返回 null。
// 但运镜内容在「朝向」上是真实的——此时仍需一条 ≥2 点的相机位置轨迹来驱动播放头/binding。
// 用首尾样本造一条「原地静止」位置轨迹（两点几乎相同，曲线退化成一点 → 相机不动、只转头，正是所求）。
function staticPositionTrajectory(samples: TakeSample[], color: string, name: string): Scene3DTrajectory | null {
  if (samples.length < 2) return null
  const first = samples[0]
  const last = samples[samples.length - 1]
  return {
    id: createScene3DTrajectoryId(),
    name,
    points: [
      { id: createScene3DTrajectoryPointId(), position: [...first.position] as Scene3DVector3, timeRatio: 0 },
      { id: createScene3DTrajectoryPointId(), position: [...last.position] as Scene3DVector3, timeRatio: 1 },
    ],
    tension: 0.5,
    closed: false,
    color,
  }
}

/**
 * 相机运镜 take → 可被现有离屏捕获管线回放的 Scene3DState（与角色 take 同一条出片链路，P1 无并行版）：
 * - 复制基础场景；被操控相机搬到 cameras[0]（离屏固定取 cameras[0]）；
 * - 相机位置轨迹（用户飞镜头的平移路径）+ binding [0,duration]；纯转朝向（没平移）则造一条原地静止位置轨迹；
 * - 相机注视点轨迹（aimTrajectory，每帧看向哪）+ 以合成 id `${camId}:aim` 绑定；相机 aimTrajectoryId 指向它，
 *   cameraWithPlaybackPosition 据此忠实还原 free-look 转头（不靠 follow 物体、不靠运动切线）；
 * - 清掉相机原 followTargetId（aim 轨迹接管朝向，单源），sceneTimeline = 录制时长。
 * 位置与朝向都没动（全程静止）→ 无可回放运镜，返回 null（调用方提示）。
 */
export function buildRecordedCameraTakeScene(base: Scene3DState, take: RecordedCameraTake): Scene3DState | null {
  const next = cloneScene3DState(base)
  const cameraIndex = next.cameras.findIndex((camera) => camera.id === take.possessedCameraId)
  if (cameraIndex < 0) return null
  // 离屏捕获器固定取 cameras[0]：把被操控相机提到首位（其余顺序不变）。
  if (cameraIndex > 0) {
    const [possessed] = next.cameras.splice(cameraIndex, 1)
    next.cameras.unshift(possessed)
  }
  const camera = next.cameras[0]

  const aimTrajectory = samplesToTrajectory(take.targetSamples, ROLE_COLOR_SEQUENCE[1] ?? '#888', '镜头朝向')
  const positionTrajectory =
    samplesToTrajectory(take.cameraSamples, ROLE_COLOR_SEQUENCE[2] ?? '#888', '运镜路径') ??
    (aimTrajectory ? staticPositionTrajectory(take.cameraSamples, ROLE_COLOR_SEQUENCE[2] ?? '#888', '运镜路径') : null)
  // 位置与朝向都没动 → 没有可回放的运镜。
  if (!positionTrajectory && !aimTrajectory) return null
  if (!positionTrajectory) return null

  const trajectories: Scene3DTrajectory[] = [positionTrajectory]
  const bindings: Scene3DTrajectoryBinding[] = [
    buildTakeBinding(positionTrajectory.id, camera.id, 0, take.durationSeconds),
  ]
  camera.followTargetId = undefined
  camera.aimTrajectoryId = undefined
  if (aimTrajectory) {
    trajectories.push(aimTrajectory)
    // aim 轨迹绑到合成 id `${camId}:aim`，cameraWithPlaybackPosition 按此采样取每帧注视点。
    bindings.push(buildTakeBinding(aimTrajectory.id, cameraAimBindingId(camera.id), 0, take.durationSeconds))
    camera.aimTrajectoryId = aimTrajectory.id
  }

  return {
    ...next,
    trajectories,
    trajectoryBindings: bindings,
    trajectoryGroups: [],
    sceneTimeline: { totalDuration: take.durationSeconds },
  }
}
