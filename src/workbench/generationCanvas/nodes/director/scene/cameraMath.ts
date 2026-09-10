/**
 * [INPUT]: 依赖 three 的 Quaternion / Euler、../model/vec3 的 DEG_TO_RAD
 * [OUTPUT]: 对外提供 cameraQuaternion（pitch/yaw/roll 度 → 机位朝向四元数，YXZ）、THREE_CAMERA_FLIP（three 相机看 −Z 的 180° 翻转）
 * [POS]: director/scene 的机位朝向数学：机位模型/视锥沿 +Z 建，真正的 three 相机进 POV 时再乘翻转。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import * as THREE from 'three'
import { DEG_TO_RAD } from '../model/vec3'

export const THREE_CAMERA_FLIP = new THREE.Quaternion(0, 1, 0, 0)

export function cameraQuaternion(pitchDeg: number, yawDeg: number, rollDeg: number): THREE.Quaternion {
  return new THREE.Quaternion().setFromEuler(new THREE.Euler(pitchDeg * DEG_TO_RAD, yawDeg * DEG_TO_RAD, rollDeg * DEG_TO_RAD, 'YXZ'))
}
