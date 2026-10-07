/**
 * [INPUT]: 依赖 three（AnimationMixer / AnimationClip / Object3D）、three/examples/jsm/loaders/GLTFLoader、./mannequinAssets 的 MANNEQUIN_MODEL_URL、
 *          ../../model/actionLibrary（ACTION_LIBRARY / findActionEntry / T_POSE_ACTION_ID）、./poseSnapshot（indexBonesByBaseName / snapshotBones / PoseSnapshot / HIPS_BASE_NAME）
 * [OUTPUT]: 对外提供 ACTION_CLIP_SOURCE_URL、loadPoseClipsFrom、preloadPoseClips、poseClipStatus、poseClipInfo、samplePoseClip、poseClipSourceBind、actionSampleTime
 * [POS]: director/scene/character 的动作库加载与采样：默认人偶 glb 自带全部动作，整个编辑器只加载这一个文件，
 *        每个动作按需克隆一副源骨架 + 一个 three AnimationMixer + 常驻的 AnimationAction；采样 = 定到时刻 t（循环取模 / 单次与单姿势夹在末帧）
 *        后把每根骨的四元数 / 位置抄成快照；套到角色是 poseSnapshot 的事。模块级单例缓存，多个角色共享；未加载完返回 null，调用方退回静止姿态。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { ACTION_LIBRARY, findActionEntry, T_POSE_ACTION_ID, type ActionLibraryEntry } from '../../model/actionLibrary'
import { MANNEQUIN_MODEL_URL } from './mannequinAssets'
import { HIPS_BASE_NAME, indexBonesByBaseName, snapshotBones, type PoseSnapshot } from './poseSnapshot'
import { logRendererError, logRendererWarn } from '../../../../../../desktop/rendererLog'

/** 动作数据来源：就是默认人偶本身 */
export const ACTION_CLIP_SOURCE_URL = MANNEQUIN_MODEL_URL

/** 每个动作一副源骨架（同一 glb 场景的克隆，只求值不渲染）+ 一个 mixer + 常驻播放的 action：采样不用在动作之间切换（切换会让 mixer 复原 / 重绑全部轨道） */
type ActionSource = {
  root: THREE.Object3D
  mixer: THREE.AnimationMixer
  action: THREE.AnimationAction
  duration: number
  /** 上一次采样的动作内时刻与结果：群众同一动作同一时刻，一帧里 100 个人只真采一次（施工计划 §6 治法 1） */
  lastTime: number
  lastSnapshot: PoseSnapshot | null
}

type Source = {
  scene: THREE.Object3D
  clips: Map<string, THREE.AnimationClip>
  actions: Map<string, ActionSource>
  /** 源骨架 bind（未播动画时）快照：套骨时取相对它的增量；所有动作同一副骨架，只有一份 */
  bind: PoseSnapshot
  restHips: THREE.Vector3 | null
}

let source: Source | null = null
let pending: Promise<void> | null = null
let failed = false

function buildSource(scene: THREE.Object3D, animations: THREE.AnimationClip[]): Source {
  const restHips = indexBonesByBaseName(scene).get(HIPS_BASE_NAME)?.position.clone() ?? null
  const clips = new Map<string, THREE.AnimationClip>()
  for (const entry of ACTION_LIBRARY) {
    if (!entry.clip) continue
    const clip = THREE.AnimationClip.findByName(animations, entry.clip)
    if (clip) clips.set(entry.id, clip)
    else logRendererWarn('pose-clip-missing-animation', { actionId: entry.id })
  }
  return { scene, clips, actions: new Map(), bind: snapshotBones(scene), restHips }
}

function actionSource(actionId: string): ActionSource | null {
  if (!source) return null
  const existing = source.actions.get(actionId)
  if (existing) return existing
  const clip = source.clips.get(actionId)
  if (!clip) return null
  const root = source.scene.clone(true)
  const mixer = new THREE.AnimationMixer(root)
  const action = mixer.clipAction(clip)
  action.play()
  const created: ActionSource = { root, mixer, action, duration: clip.duration, lastTime: Number.NaN, lastSnapshot: null }
  source.actions.set(actionId, created)
  return created
}

/** 从一份已解析的 glTF 建源（测试与基准直接喂真 glb；运行时由 preloadPoseClips 走 URL） */
export function loadPoseClipsFrom(gltf: { scene: THREE.Object3D; animations: THREE.AnimationClip[] }): void {
  source = buildSource(gltf.scene, gltf.animations)
  failed = false
}

/** 一次把整个动作库拉起来（编辑器挂载时调；幂等） */
export function preloadPoseClips(): Promise<void> {
  if (source) return Promise.resolve()
  pending ??= new GLTFLoader()
    .loadAsync(ACTION_CLIP_SOURCE_URL)
    .then((gltf) => loadPoseClipsFrom(gltf))
    .catch((error) => {
      logRendererError('pose-clip-load-failed', error, { url: ACTION_CLIP_SOURCE_URL })
      failed = true
    })
  return pending
}

export function poseClipStatus(actionId: string): 'ready' | 'loading' | 'missing' {
  if (source?.clips.has(actionId)) return 'ready'
  if (failed || source || actionId === T_POSE_ACTION_ID || !findActionEntry(actionId)?.clip) return 'missing'
  return 'loading'
}

/** 片段内时刻 → 动作自身时刻：循环按时长取模，单次 / 单姿势夹在 [0, 时长]（播完停在末帧，不循环抖动） */
export function actionSampleTime(entry: Pick<ActionLibraryEntry, 'kind'>, duration: number, time: number): number {
  if (duration <= 0.001) return 0
  if (entry.kind === 'loop') return ((time % duration) + duration) % duration
  return Math.min(Math.max(time, 0), duration)
}

/** 走查取证：clip 时长 / 是否循环 / 源 rest 骨盆 / 第 0 帧骨盆 */
export function poseClipInfo(actionId: string): { duration: number; isStatic: boolean; restHips: number[] | null; frame0Hips: number[] | null } | null {
  const clip = source?.clips.get(actionId)
  const entry = findActionEntry(actionId)
  if (!source || !clip || !entry) return null
  const frame0 = samplePoseClip(actionId, 0)?.get(HIPS_BASE_NAME)?.position
  return { duration: clip.duration, isStatic: entry.kind !== 'loop', restHips: source.restHips ? source.restHips.toArray() : null, frame0Hips: frame0 ? frame0.toArray() : null }
}

/** 源骨架 bind 快照（套骨取增量用）；未加载或不是库里的动作 → null */
export function poseClipSourceBind(actionId: string): PoseSnapshot | null {
  return source?.clips.has(actionId) ? source.bind : null
}

/**
 * 时刻 t 的快照：循环动作取模，单次 / 单姿势夹在末帧；未加载 → 触发加载并返回 null；T-Pose / 未知 id → null（= 绑定姿态）。
 * 同一动作同一动作内时刻返回同一个对象（缓存上一次）：返回值只读，别改。
 */
export function samplePoseClip(actionId: string, time: number): PoseSnapshot | null {
  if (actionId === T_POSE_ACTION_ID) return null
  if (!source) {
    if (!failed) void preloadPoseClips()
    return null
  }
  const sampler = actionSource(actionId)
  const entry = findActionEntry(actionId)
  if (!sampler || !entry) return null
  const local = actionSampleTime(entry, sampler.duration, time)
  // 同一动作同一时刻：直接给上次那份（快照只读，调用方不改它）；时刻一变就重采
  if (sampler.lastSnapshot && sampler.lastTime === local) return sampler.lastSnapshot
  // update(0) 不推进时间，只按 action.time 求值（单次动作的夹持由 actionSampleTime 做，不依赖 mixer 的 LoopOnce / finished 状态）
  sampler.action.time = local
  sampler.mixer.update(0)
  sampler.lastTime = local
  sampler.lastSnapshot = snapshotBones(sampler.root)
  return sampler.lastSnapshot
}
