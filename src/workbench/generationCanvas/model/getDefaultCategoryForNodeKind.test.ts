import { describe, expect, it } from 'vitest'
import { getDefaultCategoryForNodeKind } from './generationNodeKinds'

// 回归：agent 建节点按 kind 归类——镜头进分镜（拿镜头编号）、角色/场景各归各家。
describe('getDefaultCategoryForNodeKind', () => {
  it('character → cast（角色）', () => {
    expect(getDefaultCategoryForNodeKind('character')).toBe('cast')
  })
  it('scene → scene（场景）', () => {
    expect(getDefaultCategoryForNodeKind('scene')).toBe('scene')
  })
  it('镜头类 kind 都归分镜 shots（拿到「镜头 N」编号）', () => {
    for (const kind of ['image', 'video', 'keyframe', 'shot', 'output', 'panorama', 'text'] as const) {
      expect(getDefaultCategoryForNodeKind(kind)).toBe('shots')
    }
  })
})
