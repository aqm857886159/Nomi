import { describe, expect, it } from 'vitest'
import type { DirectorScene } from '../model/directorTypes'
import { actionClipsLoading, isTPose, resolveHeadlessCameraId } from './DirectorHeadlessCaptureUtils'

const scene = { cameras: [{ id: 'camera-a' }, { id: 'camera-b' }] } as DirectorScene

describe('resolveHeadlessCameraId', () => {
  it('uses the first camera when no selector is provided', () => {
    expect(resolveHeadlessCameraId(scene, 0, undefined)).toBe('camera-a')
  })

  it('allows a renderer to select a camera per sample time, including black frames', () => {
    expect(resolveHeadlessCameraId(scene, 1.25, (time) => time > 1 ? 'camera-b' : null)).toBe('camera-b')
    expect(resolveHeadlessCameraId(scene, 0.5, () => null)).toBeNull()
  })

  it('does not wait for characters without action clips', () => {
    expect(actionClipsLoading({ objects: [{ type: 'character', visible: true, actionClips: [] }] } as unknown as DirectorScene)).toBe(false)
  })

  it('flags horizontal hands only when the frame has an active ready action', () => {
    expect(isTPose({ leftShoulder: { x: -0.2, y: 1.5, z: 0 }, rightShoulder: { x: 0.2, y: 1.5, z: 0 }, leftHand: { x: -0.9, y: 1.5, z: 0 }, rightHand: { x: 0.9, y: 1.5, z: 0 } })).toBe(true)
    expect(isTPose({ leftShoulder: { x: -0.2, y: 1.5, z: 0 }, rightShoulder: { x: 0.2, y: 1.5, z: 0 }, leftHand: { x: -0.9, y: 1.1, z: 0 }, rightHand: { x: 0.9, y: 1.1, z: 0 } })).toBe(false)
  })
})
