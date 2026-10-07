/**
 * [INPUT]: MIT mannequinPosePresets.ts control vocabulary from storyai-3d-director-desk
 * [OUTPUT]: additive semantic-bone pose records for the later runtime cutover
 * [POS]: director/model/assetCatalog; no runtime consumer in this PR
 * Source: https://github.com/jiguang132/storyai-3d-director-desk/blob/main/src/editor/presets/mannequinPosePresets.ts
 * License: MIT (attribution retained in third-party-assets.md)
 */
import type { SemanticBone } from '../rigs'
import type { AssetRecord } from './types'

type Rotation = [number, number, number]
export type StaticPoseAsset = AssetRecord & { rotationsDeg: Partial<Record<SemanticBone, Rotation>> }

const source = 'jiguang132/storyai-3d-director-desk mannequinPosePresets.ts'
const base = (id: string, zh: string, en: string, rotationsDeg: Partial<Record<SemanticBone, Rotation>>): StaticPoseAsset => ({
  id: `pose-${id}`,
  kind: 'pose',
  tags: ['mannequin', 'static-pose', id],
  nameZh: zh,
  nameEn: en,
  sizeClass: 'tiny',
  origin: 'rig-root',
  file: 'semantic-rotations',
  source,
  license: 'MIT',
  modified: true,
  rig: 'mixamo',
  rotationsDeg,
})

export const STORYAI_POSES: StaticPoseAsset[] = [
  base('lean', '倚靠', 'Lean', { spine: [0, 0, -10], head: [0, 0, 6], leftUpLeg: [0, -8, 0], rightUpLeg: [0, 8, 0] }),
  base('bow', '鞠躬', 'Bow', { spine: [-46, 0, 0], spine1: [-10, 0, 0], head: [20, 0, 0], leftUpLeg: [49, 0, 0], rightUpLeg: [49, 0, 0], leftArm: [5, -10, 0], rightArm: [5, 10, 0] }),
  base('think', '思考', 'Think', { head: [15, 0, 0], leftArm: [8, 40, 0], rightArm: [8, -40, 0], leftForeArm: [90, 0, 0], rightForeArm: [90, 0, 0], rightHand: [15, 0, -10] }),
  base('fight', '格斗', 'Fight', { spine: [5, 0, -10], spine1: [0, 8, 0], head: [0, 8, 0], leftArm: [48, -16, 22], rightArm: [30, 0, -22], leftForeArm: [86, 0, 0], rightForeArm: [84, 0, 0], leftUpLeg: [4, -18, 0], rightUpLeg: [-6, 22, 0] }),
  base('kick', '踢腿', 'Kick', { leftUpLeg: [-8, 0, 0], rightUpLeg: [58, 0, 0], rightLeg: [35, 0, 0], leftArm: [18, 0, 0], rightArm: [-24, 0, 0] }),
  base('throw', '投掷', 'Throw', { spine: [5, 14, 0], spine1: [0, -10, 0], head: [0, 8, 0], rightArm: [76, -14, 28], rightForeArm: [86, 0, 0], leftArm: [34, 10, 8], leftForeArm: [54, 0, 0], leftUpLeg: [24, -12, 0], rightUpLeg: [-10, 18, 0] }),
  base('push', '推进', 'Push', { spine: [5, 38, 0], spine1: [-4, 0, 0], head: [6, 0, 0], leftArm: [92, -11, 6], rightArm: [92, 11, -6], leftForeArm: [6, 0, 0], rightForeArm: [6, 0, 0], leftUpLeg: [38, -12, 0], rightUpLeg: [-20, 14, 0] }),
  base('reach', '伸手', 'Reach', { rightArm: [50, 0, 0], rightForeArm: [12, 0, 0] }),
  base('cross-arms', '抱臂', 'Cross arms', { leftArm: [50, -55, 75], leftForeArm: [50, 0, 0], rightArm: [90, 55, -45], rightForeArm: [50, 0, 0] }),
  base('phone', '看手机', 'Phone', { head: [18, 0, 0], rightArm: [20, -4, -30], rightForeArm: [82, 0, 0], rightHand: [14, 0, 60], leftArm: [-10, 8, 0], leftForeArm: [16, 0, 0] }),
]
