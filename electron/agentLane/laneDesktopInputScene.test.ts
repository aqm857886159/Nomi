import { describe, expect, it } from 'vitest'
import { parseLaneComposerContext } from './laneDesktopInput'

const approvalPolicy = { mode: 'safe-auto', spend: 'confirm' }

// 导演台是否开着是渲染端的事实：只决定 3D 导演台的工具进不进模型清单，不授予任何权限。
describe('composer context: directorOpen', () => {
  it('accepts only the literal true, and keeps it', () => {
    expect(parseLaneComposerContext({ approvalPolicy, directorOpen: true })).toEqual({ approvalPolicy, directorOpen: true })
    expect(parseLaneComposerContext({ approvalPolicy })).toEqual({ approvalPolicy })
    expect(() => parseLaneComposerContext({ approvalPolicy, directorOpen: false })).toThrow()
    expect(() => parseLaneComposerContext({ approvalPolicy, directorOpen: 'yes' })).toThrow()
  })

  it('is not accepted inside a restored draft intent (historical value cannot open the scene)', () => {
    expect(() => parseLaneComposerContext({ approvalPolicy, restoredIntent: { directorOpen: true } })).toThrow()
  })
})
