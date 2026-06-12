import { describe, expect, it } from 'vitest'
import { getDefaultCategoryForNodeKind } from './generationNodeKinds'

// 回归：节点按 kind 归类的唯一真相源——创建（默认画布/手动/agent）与
// projectCategoryMigration 共用本函数（审计 A4：两份映射漂移会让迁移删创建产物）。
describe('getDefaultCategoryForNodeKind', () => {
  it('character → cast（角色）', () => {
    expect(getDefaultCategoryForNodeKind('character')).toBe('cast')
  })
  it('场景资产类 kind 归 scene（scene/panorama/scene3d）', () => {
    for (const kind of ['scene', 'panorama', 'scene3d'] as const) {
      expect(getDefaultCategoryForNodeKind(kind)).toBe('scene')
    }
  })
  it('镜头类 kind 都归分镜 shots（拿到「镜头 N」编号）', () => {
    for (const kind of ['image', 'video', 'keyframe', 'shot', 'output', 'text'] as const) {
      expect(getDefaultCategoryForNodeKind(kind)).toBe('shots')
    }
  })
})
