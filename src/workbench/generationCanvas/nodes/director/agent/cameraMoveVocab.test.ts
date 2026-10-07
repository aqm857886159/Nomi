import { describe, expect, it } from 'vitest'
import { CAMERA_MOVE_LABEL, CAMERA_MOVE_LABEL_EN, CAMERA_MOVES } from './cameraMoveVocab'

const DISPLAY_MOTION_KEYS = ['static', 'follow', 'pan', 'tilt', 'whip', 'rack_focus', ...CAMERA_MOVES]

describe('director motion vocabulary labels', () => {
  it('has a zh and en label for every motion vocabulary entry', () => {
    for (const key of DISPLAY_MOTION_KEYS) {
      expect(CAMERA_MOVE_LABEL[key], `missing zh label for ${key}`).toBeTruthy()
      expect(CAMERA_MOVE_LABEL_EN[key], `missing en label for ${key}`).toBeTruthy()
    }
  })
})
