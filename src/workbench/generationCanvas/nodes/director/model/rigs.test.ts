import { describe, expect, it } from 'vitest'
import { resolveIkChain } from './ikChains'
import { BODY_TYPE_PRESETS, boneName, jointAxisLabelKey, mirrorBoneRotations, semanticBoneOf } from './rigs'

describe('rigs', () => {
  it('maps semantic bones per rig and back', () => {
    expect(boneName('mixamo', 'leftHand')).toBe('mixamorigLeftHand')
    expect(boneName('ue4', 'leftHand')).toBe('hand_l')
    expect(semanticBoneOf('mixamo', 'Armature:mixamorigRightFoot')).toBe('rightFoot')
    expect(semanticBoneOf('ue4', 'nope')).toBeNull()
  })

  it('IK chains resolve to rig bone names with the fixed iteration limits', () => {
    expect(resolveIkChain('mixamo', 'leftFoot')).toEqual({
      effectorBoneName: 'mixamorigLeftFoot',
      linkBoneNames: ['mixamorigLeftLeg', 'mixamorigLeftUpLeg'],
      iteration: 30,
      minAngle: 0,
      maxAngle: 0.7,
    })
    expect(resolveIkChain('ue4', 'head').linkBoneNames).toEqual(['neck_01', 'spine_03'])
  })

  it('ships the 8 body types and mirrors limb rotations across sides', () => {
    expect(BODY_TYPE_PRESETS).toHaveLength(8)
    const mirrored = mirrorBoneRotations({ mixamorigLeftArm: { x: 10, y: 20, z: 30 } }, 'mixamo', 'left')
    expect(mirrored.mixamorigRightArm).toEqual({ x: 10, y: -20, z: -30 })
    expect(jointAxisLabelKey('leftForeArm', 'x')).toBe('director.joint.foreArm.x')
    expect(jointAxisLabelKey('head', 'z')).toBe('director.joint.head.z')
  })
})
