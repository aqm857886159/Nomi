import { describe, expect, it } from 'vitest'
import {
  migrateGenerationCanvasSnapshot,
  migrateNodeToCategoryId,
  migrateProjectPayload,
} from './projectCategoryMigration'
import { createDefaultWorkbenchProjectPayload, workbenchProjectPayloadSchema } from './projectRecordSchema'
import { normalizeCategories } from './projectCategories'
import type {
  CategoryId,
  GenerationCanvasNode,
  GenerationNodeKind,
  NodeGroup,
} from '../generationCanvas/model/generationCanvasTypes'

function makeNode(overrides: Partial<Omit<GenerationCanvasNode, 'categoryId'>> & {
  kind: GenerationNodeKind
  id?: string
  categoryId?: string
}): GenerationCanvasNode {
  const node = {
    id: overrides.id || 'n1',
    kind: overrides.kind,
    title: overrides.title || 'Node',
    position: overrides.position || { x: 0, y: 0 },
    size: overrides.size,
    prompt: overrides.prompt,
    references: overrides.references,
    result: overrides.result,
    history: overrides.history,
    progress: overrides.progress,
    runs: overrides.runs,
    status: overrides.status,
    error: overrides.error,
    meta: overrides.meta,
    categoryId: overrides.categoryId,
    groupId: overrides.groupId,
    derivedFrom: overrides.derivedFrom,
  }
  return node as GenerationCanvasNode
}

function makeGroup(overrides: Partial<Omit<NodeGroup, 'categoryId'>> & { categoryId: string }): NodeGroup {
  return {
    id: overrides.id || 'group-1',
    name: overrides.name || 'Group',
    categoryId: overrides.categoryId as CategoryId,
    nodeIds: overrides.nodeIds || [],
    createdAt: overrides.createdAt || 100,
    updatedAt: overrides.updatedAt || 200,
  }
}

describe('migrateNodeToCategoryId', () => {
  it('maps legacy kept category ids to v0.6 category ids', () => {
    expect(migrateNodeToCategoryId(makeNode({ kind: 'image', categoryId: 'shots' }), [])).toBe('shots')
    expect(migrateNodeToCategoryId(makeNode({ kind: 'character', categoryId: 'characters' }), [])).toBe('cast')
    expect(migrateNodeToCategoryId(makeNode({ kind: 'scene', categoryId: 'scenes' }), [])).toBe('scene')
    expect(migrateNodeToCategoryId(makeNode({ kind: 'image', categoryId: 'audio' }), [])).toBe('audio')
  })

  it('returns null for legacy removed category ids instead of casting them', () => {
    expect(migrateNodeToCategoryId(makeNode({ kind: 'text', categoryId: 'story' }), [])).toBeNull()
    expect(migrateNodeToCategoryId(makeNode({ kind: 'image', categoryId: 'style' }), [])).toBeNull()
    expect(migrateNodeToCategoryId(makeNode({ kind: 'image', categoryId: 'inbox' }), [])).toBeNull()
    expect(migrateNodeToCategoryId(makeNode({ kind: 'output', categoryId: 'exports' }), [])).toBeNull()
  })

  it('preserves custom (non-legacy, non-builtin) category ids so user-created categories survive migration', () => {
    // 自定义顶层分类启用后，未知 id 不再一律丢弃——只有显式 legacy-removed id 才删。
    expect(migrateNodeToCategoryId(makeNode({ kind: 'text', categoryId: 'cat-6' }), [])).toBe('cat-6')
    expect(migrateNodeToCategoryId(makeNode({ kind: 'image', categoryId: 'my-custom' }), [])).toBe('my-custom')
  })

  it('infers uncategorized nodes via the shared kind→category map and never removes them', () => {
    // 与创建路径共用 getDefaultCategoryForNodeKind（单一真相源，审计 A4）：
    // kind 可推断 → 永不返回 null。此前 text/output 被判 null 删除，导致
    // 新建空白项目的默认 text 节点被迁移静默吞掉。
    expect(migrateNodeToCategoryId(makeNode({ kind: 'character' }), [])).toBe('cast')
    expect(migrateNodeToCategoryId(makeNode({ kind: 'scene' }), [])).toBe('scene')
    expect(migrateNodeToCategoryId(makeNode({ kind: 'panorama' }), [])).toBe('scene')
    expect(migrateNodeToCategoryId(makeNode({ kind: 'scene3d' }), [])).toBe('scene')
    expect(migrateNodeToCategoryId(makeNode({ kind: 'image' }), [])).toBe('shots')
    expect(migrateNodeToCategoryId(makeNode({ kind: 'video' }), [])).toBe('shots')
    expect(migrateNodeToCategoryId(makeNode({ kind: 'text' }), [])).toBe('shots')
    expect(migrateNodeToCategoryId(makeNode({ kind: 'output' }), [])).toBe('shots')
  })
})

describe('migrateGenerationCanvasSnapshot', () => {
  it('keeps and maps only supported v0.5 categories and deletes removed category nodes', () => {
    const snapshot = {
      nodes: [
        makeNode({ kind: 'image', id: 'shot', categoryId: 'shots' }),
        makeNode({ kind: 'character', id: 'char', categoryId: 'characters' }),
        makeNode({ kind: 'scene', id: 'scene', categoryId: 'scenes' }),
        makeNode({ kind: 'image', id: 'audio', categoryId: 'audio' }),
        makeNode({ kind: 'text', id: 'story', categoryId: 'story' }),
        makeNode({ kind: 'image', id: 'style', categoryId: 'style' }),
        makeNode({ kind: 'image', id: 'inbox', categoryId: 'inbox' }),
        makeNode({ kind: 'output', id: 'exports', categoryId: 'exports' }),
      ],
      edges: [
        { id: 'kept-edge', source: 'shot', target: 'char' },
        { id: 'removed-source', source: 'story', target: 'shot' },
        { id: 'removed-target', source: 'shot', target: 'exports' },
      ],
      selectedNodeIds: ['shot', 'story', 'exports'],
      groups: [],
    }

    const { snapshot: next, migratedCount, removedCount, removedCategoryIds } = migrateGenerationCanvasSnapshot(snapshot)

    expect(migratedCount).toBe(2)
    expect(removedCount).toBe(4)
    expect(removedCategoryIds).toEqual(['story', 'style', 'inbox', 'exports'])
    expect(next.nodes.map((node) => [node.id, node.categoryId])).toEqual([
      ['shot', 'shots'],
      ['char', 'cast'],
      ['scene', 'scene'],
      ['audio', 'audio'],
    ])
    expect(next.edges).toEqual([{ id: 'kept-edge', source: 'shot', target: 'char' }])
    expect(next.selectedNodeIds).toEqual(['shot'])
  })

  it('keeps existing v0.6 prop nodes instead of treating them as legacy removals', () => {
    const snapshot = {
      nodes: [makeNode({ kind: 'image', id: 'prop-node', categoryId: 'prop' })],
      edges: [],
      selectedNodeIds: ['prop-node'],
      groups: [makeGroup({ id: 'prop-group', categoryId: 'prop', nodeIds: ['prop-node'] })],
    }

    const { snapshot: next, removedCount } = migrateGenerationCanvasSnapshot(snapshot)

    expect(removedCount).toBe(0)
    expect(next.nodes).toHaveLength(1)
    expect(next.nodes[0]?.categoryId).toBe('prop')
    expect(next.groups[0]?.categoryId).toBe('prop')
  })

  it('defaults missing groups to [] and filters invalid groups and nodeIds', () => {
    const snapshot = {
      nodes: [
        makeNode({ kind: 'image', id: 'shot', categoryId: 'shots' }),
        makeNode({ kind: 'character', id: 'char', categoryId: 'characters' }),
        makeNode({ kind: 'text', id: 'story', categoryId: 'story' }),
      ],
      edges: [],
      selectedNodeIds: [],
      groups: [
        makeGroup({ id: 'g1', categoryId: 'characters', nodeIds: ['char', 'story', 'missing'] }),
        makeGroup({ id: 'g2', categoryId: 'story', nodeIds: ['story'] }),
      ],
    }

    const { snapshot: next } = migrateGenerationCanvasSnapshot(snapshot)
    expect(next.groups).toEqual([{ ...snapshot.groups[0], categoryId: 'cast', nodeIds: ['char'] }])

    const { snapshot: withoutGroups } = migrateGenerationCanvasSnapshot({ ...snapshot, groups: undefined } as never)
    expect(withoutGroups.groups).toEqual([])
  })
})

describe('migrateProjectPayload', () => {
  it('seeds v0.6 categories and exposes removed node diagnostics for toast logic', () => {
    const payload = createDefaultWorkbenchProjectPayload()
    payload.categories = undefined
    payload.generationCanvas = {
      nodes: [
        makeNode({ kind: 'image', id: 'shot', categoryId: 'shots' }),
        makeNode({ kind: 'text', id: 'story', categoryId: 'story' }),
      ],
      edges: [{ id: 'edge', source: 'story', target: 'shot' }],
      selectedNodeIds: ['story', 'shot'],
      groups: [],
    }

    const { payload: next, diagnostic } = migrateProjectPayload(payload)

    expect(next.categories?.map((category) => category.id)).toEqual(['shots', 'cast', 'scene', 'prop', 'audio'])
    expect(next.generationCanvas.nodes.map((node) => node.id)).toEqual(['shot'])
    expect(next.generationCanvas.edges).toEqual([])
    expect(diagnostic.removedNodes).toBe(1)
    expect(diagnostic.removedCategoryIds).toEqual(['story'])
    expect(diagnostic.alreadyMigrated).toBe(false)
  })

  it('allows project payload parsing before migration when legacy category ids are present', () => {
    const payload = createDefaultWorkbenchProjectPayload()
    payload.generationCanvas = {
      nodes: [makeNode({ kind: 'text', id: 'legacy-story', categoryId: 'story' })],
      edges: [],
      selectedNodeIds: ['legacy-story'],
      groups: [],
    }

    expect(workbenchProjectPayloadSchema.safeParse(payload).success).toBe(true)
  })

  it('treats a freshly created default project payload as already migrated (creation↔migration contract)', () => {
    // 创建/迁移契约（审计 A4 的结构保证）：任何创建路径的产物必须是「已迁移形态」。
    // 该不变量破掉的症状链：新建空白项目 → 打开即弹「项目已升级到目录树」toast →
    // 默认节点被静默删除。新增创建入口若漏写 categoryId，本测试直接红。
    const { payload: next, diagnostic } = migrateProjectPayload(createDefaultWorkbenchProjectPayload())

    expect(diagnostic.alreadyMigrated).toBe(true)
    expect(diagnostic.migratedNodes).toBe(0)
    expect(diagnostic.removedNodes).toBe(0)
    expect(diagnostic.categoriesSeeded).toBe(false)
    // 默认空画布（删了预设两卡，用户拍板 2026-06-15）：无节点可迁移，契约仍 no-op。
    expect(next.generationCanvas.nodes).toHaveLength(0)
  })

  it('treats a content-equal but newly-referenced canvas as already migrated (语义相等，不靠引用)', () => {
    // 幂等判定改语义相等（P2）：即便上游迁移返回了「内容一致但引用不同」的画布，
    // migrateProjectPayload 也应判 alreadyMigrated=true，不再因引用变化触发 re-save+revision++。
    const base = createDefaultWorkbenchProjectPayload()
    // 深拷贝 → 全新引用、内容完全一致。
    const cloned = {
      ...base,
      generationCanvas: JSON.parse(JSON.stringify(base.generationCanvas)) as typeof base.generationCanvas,
      categories: base.categories ? [...base.categories] : base.categories,
    }
    expect(cloned.generationCanvas).not.toBe(base.generationCanvas)

    const { diagnostic } = migrateProjectPayload(cloned)
    expect(diagnostic.alreadyMigrated).toBe(true)
    expect(diagnostic.migratedNodes).toBe(0)
    expect(diagnostic.removedNodes).toBe(0)
  })

  it('does not merge legacy category ids back into normalized project categories', () => {
    const categories = normalizeCategories([
      { id: 'shots', name: 'Shots', icon: '🎬', order: 0 },
      { id: 'story', name: 'Story', icon: '📝', order: 1 },
      { id: 'characters', name: 'Characters', icon: '🧑', order: 2 },
    ])

    expect(categories.map((category) => category.id)).toEqual(['shots', 'cast', 'scene', 'prop', 'audio'])
  })
})
