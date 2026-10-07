/**
 * [INPUT]: 依赖 ./directorEvalMeasurement 的 sampleDirectorProject / recognizeCameraMotion / EvalShotSize、./directorTypes 的 DirectorProject
 * [OUTPUT]: 对外提供 DirectorShotSummary、summarizeDirectorShots（工程 → 逐镜实测摘要）、activeShotIndexAt（播放头落在第几镜）、formatPlayheadSeconds
 * [POS]: 导演视图（3D-BOX）镜头条与预览小窗的唯一数据口：景别 / 运镜 / 时间窗都是测量模块对工程的实测，不读计划值；
 *        「这镜在做什么」只取工程里真实存在的动作片段（编译器从计划 blocking 落下来的那份），没有就留空由界面说明缺什么，不编。
 *        纯函数、零 React，镜头条、顶栏标题、小窗标题三处消费同一份结果。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { recognizeCameraMotion, sampleDirectorProject, type EvalShotSize, type FrameSample } from './directorEvalMeasurement'
import type { DirectorProject } from './directorTypes'

export type DirectorShotAction = { objectId: string; objectName: string; actionPose: string; clipName: string }

export type DirectorShotSummary = {
  start: number
  end: number
  cameraId: string | null
  /** 画面主体（这一镜里画得最大的非场景件物体）的实测景别；没有可测主体 = null。 */
  shotSize: EvalShotSize | null
  /** 测量模块识别出的运镜 id（push_in / static / follow …），显示文案由界面按语言取。 */
  move: string
  /** 镜头中点时刻正在播的角色动作片段；空数组 = 这一镜工程里没有动作片段。 */
  actions: DirectorShotAction[]
}

const SAMPLE_FPS = 4

function subjectAt(project: DirectorProject, frame: FrameSample | undefined): string | null {
  if (!frame) return null
  const scene = project.scenes.find((item) => item.id === project.activeSceneId) ?? project.scenes[0]
  // 场景件（地面 / 墙 / 门，编译器标 isAuxiliary）不是「这一镜拍谁」：只在角色与道具里挑画得最大的那个。
  // 先认关键点（人物的头）在画内的；特写手部这类头出画的镜头，再退到「包围盒与画面相交」的物体。
  const pick = (accept: (box: NonNullable<FrameSample['objects'][string]['projection']>) => boolean): string | null => {
    let best: { id: string; ratio: number } | null = null
    for (const object of scene?.objects ?? []) {
      if (object.isAuxiliary || !object.visible) continue
      const sample = frame.objects[object.id]
      if (!sample?.projection || !sample.shotSize || !accept(sample.projection)) continue
      if (!best || sample.projection.heightRatio > best.ratio) best = { id: object.id, ratio: sample.projection.heightRatio }
    }
    return best?.id ?? null
  }
  return pick((box) => box.inFrame)
    ?? pick((box) => box.depth > 0 && box.x < 1 && box.x + box.width > 0 && box.y < 1 && box.y + box.height > 0)
}

export function summarizeDirectorShots(project: DirectorProject): DirectorShotSummary[] {
  const measurements = sampleDirectorProject(project, { fps: SAMPLE_FPS })
  const boundaries = [0, ...measurements.cuts, measurements.duration]
    .filter((value, index, values) => value >= 0 && value <= measurements.duration && values.indexOf(value) === index)
    .sort((a, b) => a - b)
  if (boundaries.length < 2) return []
  const scene = project.scenes.find((item) => item.id === project.activeSceneId) ?? project.scenes[0]
  return boundaries.slice(0, -1).map((start, index) => {
    const end = boundaries[index + 1]
    const middle = (start + end) / 2
    const frame = measurements.frames.find((candidate) => candidate.time >= middle) ?? measurements.frames.at(-1)
    const subjectId = subjectAt(project, frame)
    const shotSize = subjectId ? frame?.objects[subjectId]?.shotSize ?? null : null
    const move = subjectId ? recognizeCameraMotion(measurements, subjectId, { start, end }).move : 'static'
    const actions: DirectorShotAction[] = []
    for (const object of scene?.objects ?? []) {
      if (object.type !== 'character' || object.actionTrackEnabled === false) continue
      const clip = (object.actionClips ?? []).find((item) => item.clipType === 'action' && item.actionPose && item.startTime <= middle && item.endTime > middle)
      if (clip?.actionPose) actions.push({ objectId: object.id, objectName: object.name, actionPose: clip.actionPose, clipName: clip.name })
    }
    return { start, end, cameraId: frame?.cameraId ?? null, shotSize, move, actions }
  })
}

// 播放头按帧量化（seekTo 落到 30fps 网格），镜头边界是 4fps 测量的时刻：两张网格不重合，
// 「点第 N 镜 → 播放头 = 该镜开头」量化后可能差出半帧，判「在哪一镜」时容半帧。
const BOUNDARY_TOLERANCE_SECONDS = 1 / 60

/** 播放头所在的那一镜 = 开头不晚于播放头的最后一镜（超过末尾仍算最后一镜）。没有镜头 = -1。 */
export function activeShotIndexAt(shots: readonly DirectorShotSummary[], time: number): number {
  if (shots.length === 0) return -1
  let index = 0
  for (let candidate = 0; candidate < shots.length; candidate += 1) {
    if (shots[candidate].start <= time + BOUNDARY_TOLERANCE_SECONDS) index = candidate
  }
  return index
}

/** 播放行的秒数读数：两位整数 + 一位小数（04.9），与样张一致，宽度不随数字跳。 */
export function formatPlayheadSeconds(seconds: number): string {
  return Math.max(0, seconds).toFixed(1).padStart(4, '0')
}
