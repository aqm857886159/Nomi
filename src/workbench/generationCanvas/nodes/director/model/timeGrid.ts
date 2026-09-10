/**
 * [INPUT]: 依赖 ./directorTypes 的 TimelineEntity / DirectorScene 形状
 * [OUTPUT]: 对外提供 DIRECTOR_FPS / DIRECTOR_MAX_DURATION_SECONDS / FRAME_EPSILON、quantizeToFrame、secondsToFrame、laneClips、
 *           sameFrameTime、entityClips、entityContentEnd、sceneContentEndSeconds、ensureDurationSeconds
 * [POS]: director/model 的时间格单一真相：整个导演台只认 30fps 帧格与「内容终点 = 所有片段末尾」（对齐 2026-07-30 拍板
 *        「时间轴 = 成片长度」），时间轴/求值/出片都从这里取时间，不各自换算。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import type { DirectorScene, TimelineEntity } from './directorTypes'

// 固定 30fps 帧格；最长 60s；帧内容差 = 半帧
export const DIRECTOR_FPS = 30
export const DIRECTOR_MAX_DURATION_SECONDS = 60
export const FRAME_SECONDS = 1 / DIRECTOR_FPS
export const FRAME_EPSILON = FRAME_SECONDS / 2

// 把任意秒数量化到帧格
export function quantizeToFrame(seconds: number, fps: number = DIRECTOR_FPS): number {
  return Math.round(seconds * fps) / fps
}

export function secondsToFrame(seconds: number, fps: number = DIRECTOR_FPS): number {
  return Math.round(seconds * fps)
}

export function frameToSeconds(frame: number, fps: number = DIRECTOR_FPS): number {
  return frame / fps
}

// 两个时刻落在同一帧格内
export function sameFrameTime(a: number, b: number): boolean {
  return Math.abs(quantizeToFrame(a) - quantizeToFrame(b)) < FRAME_EPSILON
}

export function clampToTimeline(seconds: number, maxSeconds: number = DIRECTOR_MAX_DURATION_SECONDS): number {
  return Math.max(0, Math.min(maxSeconds, seconds))
}

// 四类片段都带 id：吸附排除「正在拖的那一段」、重叠检测排除自己都靠它
type ClipLike = { id: string; startTime: number; endTime: number }

// 一个实体在时间轴上的全部片段（路径 + 动作 + 特写 + 视线），供重叠检测与内容终点计算
/**
 * 单泳道规则：机位只有一条泳道，路径片段与特写片段争同一段时间；角色的路径 / 动作 / 视线各在自己的副轨里只跟同家族争。
 * 争位置、找空位、拖移、粘贴都用这一份集合。
 */
export function laneClips(entity: TimelineEntity, family: 'trajectory' | 'closeup' | 'action' | 'lookat'): ClipLike[] {
  const isCamera = 'closeupClips' in entity && !('actionClips' in entity)
  if (isCamera && (family === 'trajectory' || family === 'closeup')) return [...(entity.trajectoryClips ?? []), ...(entity.closeupClips ?? [])]
  if (family === 'trajectory') return [...(entity.trajectoryClips ?? [])]
  if (family === 'closeup') return 'closeupClips' in entity ? [...(entity.closeupClips ?? [])] : []
  if (family === 'action') return 'actionClips' in entity ? [...(entity.actionClips ?? [])] : []
  return 'lookAtClips' in entity ? [...(entity.lookAtClips ?? [])] : []
}

export function entityClips(entity: TimelineEntity): ClipLike[] {
  const clips: ClipLike[] = [...(entity.trajectoryClips ?? [])]
  if ('actionClips' in entity && entity.actionClips) clips.push(...entity.actionClips)
  if ('lookAtClips' in entity && entity.lookAtClips) clips.push(...entity.lookAtClips)
  if ('closeupClips' in entity && entity.closeupClips) clips.push(...entity.closeupClips)
  return clips
}

export function entityContentEnd(entity: TimelineEntity): number {
  return entityClips(entity).reduce((max, clip) => Math.max(max, clip.endTime), 0)
}

// 场景内容终点 = 所有实体片段的最大 endTime（单一真相源；无内容为 0）
export function sceneContentEndSeconds(scene: Pick<DirectorScene, 'objects' | 'cameras'>): number {
  const entities: TimelineEntity[] = [...scene.objects, ...scene.cameras]
  return entities.reduce((max, entity) => Math.max(max, entityContentEnd(entity)), 0)
}

// 录制/追加片段时把可视时长扩到 t + 余量，封顶 60s
export function ensureDurationSeconds(current: number, needed: number, margin: number = 2): number {
  const target = Math.min(DIRECTOR_MAX_DURATION_SECONDS, Number((needed + margin).toFixed(2)))
  return target > current ? target : current
}
