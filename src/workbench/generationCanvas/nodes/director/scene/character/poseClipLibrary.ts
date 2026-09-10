/**
 * [INPUT]: 依赖 three（AnimationMixer / Object3D）、three/examples/jsm/loaders/FBXLoader、./mannequinAssets 的 poseClipAssetFor、
 *          ../../model/actionLibrary（ACTION_LIBRARY / T_POSE_ACTION_ID）、./poseSnapshot（snapshotBones / PoseSnapshot / HIPS_BASE_NAME）
 * [OUTPUT]: 对外提供 STATIC_CLIP_SECONDS、preloadPoseClips、poseClipStatus、poseClipInfo、samplePoseClip、poseClipSourceBind
 * [POS]: director/scene/character 的姿态库加载与采样：每个 Mixamo FBX 自带骨架，各挂一个 mixer，
 *        采样 = mixer 定到时刻 t（循环按时长取模、静态 clip 恒取 0）后把每根骨的四元数 / 位置抄成快照；套到角色是 poseSnapshot 的事。
 *        模块级单例缓存：整个编辑器只加载一次，多个角色共享；未加载完时返回 null，调用方退回静止姿态。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import * as THREE from 'three'
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js'
import { ACTION_LIBRARY, T_POSE_ACTION_ID } from '../../model/actionLibrary'
import { poseClipAssetFor } from './mannequinAssets'
import { HIPS_BASE_NAME, snapshotBones, type PoseSnapshot } from './poseSnapshot'

/** 时长不超过这个值的 clip 当静态姿态 */
export const STATIC_CLIP_SECONDS = 0.05

type LoadedClip = {
  root: THREE.Object3D
  mixer: THREE.AnimationMixer
  duration: number
  isStatic: boolean
  /** 源骨架 bind（未播动画时）快照：套骨时取相对它的增量 */
  bind: PoseSnapshot
  /** 源骨架 rest 的骨盆位置（取证用） */
  restHips: THREE.Vector3 | null
  /** 静态 clip 采一次就够 */
  staticSnapshot: PoseSnapshot | null
}

const loaded = new Map<string, LoadedClip>()
const pending = new Map<string, Promise<void>>()
const failed = new Set<string>()

function loadOne(actionId: string): Promise<void> {
  const existing = pending.get(actionId)
  if (existing) return existing
  const asset = poseClipAssetFor(actionId)
  if (!asset) return Promise.resolve()
  const task = new FBXLoader()
    .loadAsync(asset.fbx)
    .then((root) => {
      const clip = root.animations[0]
      if (!clip) {
        console.warn(`[director] 姿态 FBX 没有动画轨道: ${actionId}`)
        failed.add(actionId)
        return
      }
      const restHips = (() => {
        let hips: THREE.Vector3 | null = null
        root.traverse((object) => {
          if (!hips && (object as THREE.Bone).isBone && object.name.toLowerCase().includes(HIPS_BASE_NAME)) hips = object.position.clone()
        })
        return hips
      })()
      const bind = snapshotBones(root)
      const mixer = new THREE.AnimationMixer(root)
      mixer.clipAction(clip).play()
      const duration = clip.duration || 0
      const isStatic = duration <= STATIC_CLIP_SECONDS
      const entry: LoadedClip = { root, mixer, duration, isStatic, bind, restHips, staticSnapshot: null }
      if (isStatic) {
        mixer.setTime(0)
        mixer.update(0)
        entry.staticSnapshot = snapshotBones(root)
      }
      loaded.set(actionId, entry)
    })
    .catch((error) => {
      console.error(`[director] 加载姿态 FBX 失败: ${actionId}`, error)
      failed.add(actionId)
    })
  pending.set(actionId, task)
  return task
}

/** 一次把整个姿态库拉起来（编辑器挂载时调；幂等） */
export function preloadPoseClips(): Promise<void> {
  return Promise.all(ACTION_LIBRARY.filter((entry) => entry.file).map((entry) => loadOne(entry.id))).then(() => undefined)
}

export function poseClipStatus(actionId: string): 'ready' | 'loading' | 'missing' {
  if (loaded.has(actionId)) return 'ready'
  if (failed.has(actionId) || actionId === T_POSE_ACTION_ID || !poseClipAssetFor(actionId)) return 'missing'
  return 'loading'
}

/** 走查取证：clip 时长 / 静态与否 / 源 rest 骨盆 / 第 0 帧骨盆 */
export function poseClipInfo(actionId: string): { duration: number; isStatic: boolean; restHips: number[] | null; frame0Hips: number[] | null } | null {
  const entry = loaded.get(actionId)
  if (!entry) return null
  const frame0 = samplePoseClip(actionId, 0)?.get(HIPS_BASE_NAME)?.position
  return { duration: entry.duration, isStatic: entry.isStatic, restHips: entry.restHips ? entry.restHips.toArray() : null, frame0Hips: frame0 ? frame0.toArray() : null }
}

/** 源骨架 bind 快照（套骨取增量用）；未加载 → null */
export function poseClipSourceBind(actionId: string): PoseSnapshot | null {
  return loaded.get(actionId)?.bind ?? null
}

/**
 * 时刻 t 的快照：循环动作按时长取模，静态姿态恒取第 0 帧；未加载 → 触发加载并返回 null；T-Pose → null（= 绑定姿态）。
 * 返回的快照被 mixer 复用，调用方只读、别改。
 */
export function samplePoseClip(actionId: string, time: number): PoseSnapshot | null {
  if (actionId === T_POSE_ACTION_ID) return null
  const entry = loaded.get(actionId)
  if (!entry) {
    if (!failed.has(actionId)) void loadOne(actionId)
    return null
  }
  if (entry.isStatic || entry.duration <= 0.001) return entry.staticSnapshot
  const local = ((time % entry.duration) + entry.duration) % entry.duration
  entry.mixer.setTime(local)
  entry.mixer.update(0)
  return snapshotBones(entry.root)
}
