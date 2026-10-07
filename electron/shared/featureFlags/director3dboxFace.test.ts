import { afterEach, describe, expect, it } from 'vitest'
import { director3dBoxFaceEnabled, installDirector3DBoxFace, resetDirector3DBoxFaceForTests } from './director3dboxFace'

afterEach(() => resetDirector3DBoxFaceForTests())

describe('director3dbox shared face', () => {
  it('is off when nothing installed it and no preload proof exists', () => {
    expect(director3dBoxFaceEnabled()).toBe(false)
  })

  it('reads the value the bootstrap installed', () => {
    installDirector3DBoxFace(true)
    expect(director3dBoxFaceEnabled()).toBe(true)
  })

  it('refuses a bootstrap that runs after someone already assembled the other face', () => {
    expect(director3dBoxFaceEnabled()).toBe(false)
    expect(() => installDirector3DBoxFace(true)).toThrow(/read before the bootstrap/)
  })

  it('refuses to be re-installed with a different value', () => {
    installDirector3DBoxFace(false)
    expect(() => installDirector3DBoxFace(true)).toThrow(/already installed/)
    expect(() => installDirector3DBoxFace(false)).not.toThrow()
  })

  it('reads the preload-verified proof in the renderer', () => {
    const target = globalThis as { nomiDesktop?: unknown }
    target.nomiDesktop = { featureFlags: { director3dbox: { enabled: true } } }
    try {
      expect(director3dBoxFaceEnabled()).toBe(true)
    } finally {
      delete target.nomiDesktop
    }
  })
})
