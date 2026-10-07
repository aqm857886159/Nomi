import * as THREE from 'three'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { distributeHeadAim, solveHeadAim } from '../../model/lookAtSolve'
import { prepareCharacterModel } from './characterAsset'
import { applyLookAtOffsets, findSemanticBone, headYawInCharacter, indexBones } from './characterRig'
import { loadPoseClipsFrom, poseClipSourceBind, samplePoseClip } from './poseClipLibrary'
import { applyPoseSnapshot, bindWorldQuaternionsByBaseName, indexBonesByBaseName } from './poseSnapshot'
import { loadUalMannequinForTest } from './ualMannequin.testkit'

vi.mock('../../../../../../desktop/rendererLog', () => ({ logRendererError: () => {}, logRendererWarn: () => {} }))

const signed = (deg: number) => ((((deg + 180) % 360) + 360) % 360) - 180

describe('视线（真 UAL glb + 真动作）：头最后朝向目标，不管动作本身把头转到哪', () => {
  let root: THREE.Object3D
  let apply: (actionId: string, time: number) => void
  beforeAll(async () => {
    loadPoseClipsFrom(await loadUalMannequinForTest())
    root = prepareCharacterModel((await loadUalMannequinForTest()).scene, { builtin: true, rig: 'ual' }).object
    const bones = indexBonesByBaseName(root)
    const bind = bindWorldQuaternionsByBaseName(root)
    const restHips = bones.get('hips')!.position.clone()
    apply = (actionId, time) => {
      applyPoseSnapshot(bones, samplePoseClip(actionId, time)!, { weight: 1, sourceBind: poseClipSourceBind(actionId)!, targetBindWorld: bind, root, restHips })
      root.updateMatrixWorld(true)
    }
  })

  // 跪地维修：头低 54°、偏向 +X 28°；坐着说话：头偏 11°；待机：几乎朝前
  for (const [actionId, time] of [['Idle_Loop', 1], ['Sitting_Talking_Loop', 1], ['Fixing_Kneeling', 2]] as const) {
    for (const target of [{ x: 3.5, y: 1.1, z: 3.5 }, { x: -3.5, y: 1.1, z: 3.5 }]) {
      it(`${actionId} 看 (${target.x}, ${target.z})：头的水平朝向落在目标方向 ±2°`, () => {
        apply(actionId, time)
        const index = indexBones(root)
        const head = findSemanticBone(index, 'ual', 'head')!
        const headPosition = head.getWorldPosition(new THREE.Vector3())
        const aim = solveHeadAim({ headPosition, targetPosition: target, bodyYaw: 0, clampingAngle: 80, enablePitch: false, weight: 1, currentHeadYaw: headYawInCharacter(head, root) })
        applyLookAtOffsets(index, 'ual', distributeHeadAim(aim), new THREE.Vector3(0, 1, 0))
        root.updateMatrixWorld(true)
        const want = Math.atan2(target.x - headPosition.x, target.z - headPosition.z) * (180 / Math.PI)
        expect(Math.abs(signed(headYawInCharacter(head, root) - want))).toBeLessThan(2)
      })
    }
  }
})
