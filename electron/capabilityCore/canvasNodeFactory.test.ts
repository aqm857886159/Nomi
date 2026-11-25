import { describe, expect, it } from 'vitest'

import {
  buildCanvasNode,
  buildCanvasNodes,
  type NodeFactoryDeps,
} from '../shared/canvas/canvasNodeFactory'
import {
  layoutBatchWith,
  type NodeBox,
} from '../shared/canvas/canvasNodeLayout'
import {
  nodeKindDefaultCategory,
  nodeKindDefaultSize,
  nodeKindDefaultTitle,
  nodeKindFootprint,
  nodeKindIsShotNumbered,
  nodeKindNextShotIndex,
} from './nodeKindDomain'

// 工厂等价性的结构保证：MCP 路径与 UI 路径**必须**产出字段级等价的节点记录（除 id/落点）。
// 两路都用同一份工厂 + 同一份注入依赖 → 平行版**回不来**（回来了这些断言立刻红）。
// 说明：这里用 nodeKindDomain（electron 侧注入源）代表两路；nodeKindDomain === src registry
// 另由 nodeKindDomain.equivalence.test.ts 钉死，故用它即等价于用 src 真函数。

// 确定性 id（测试可对账）：用固定序号，剥离「id 不同」这个允许的差异。
function makeDeps(idPrefix: string): NodeFactoryDeps {
  let counter = 0
  return {
    createId: () => `${idPrefix}-${(counter += 1)}`,
    resolveSize: nodeKindDefaultSize,
    resolveDefaultTitle: nodeKindDefaultTitle,
    resolveCategory: nodeKindDefaultCategory,
    isShotNumbered: nodeKindIsShotNumbered,
    nextShotIndex: nodeKindNextShotIndex,
  }
}

const ALL_KINDS = ['text', 'image', 'video', 'audio', 'shot', 'character', 'scene'] as const

describe('canvasNodeFactory · 工厂等价性（结构保证：平行版回不来）', () => {
  it.each(ALL_KINDS)('kind=%s：两路记录逐字段等价（除 id/落点）', (kind) => {
    // 「UI 路径」与「MCP 路径」同 spec、同依赖构造——差异只应落在 id 与落点上。
    const uiDeps = makeDeps('ui')
    const mcpDeps = makeDeps('mcp')
    const spec = { kind, title: '一个标题', prompt: '一段提示' }

    const ui = buildCanvasNode({ ...spec, x: 10, y: 20 }, [], uiDeps)
    const mcp = buildCanvasNode({ ...spec, x: 999, y: 888 }, [], mcpDeps)

    // 剥离 id 与 position 后必须完全相等。
    const strip = (n: Record<string, unknown>) => {
      const { id: _id, position: _pos, ...rest } = n
      return rest
    }
    expect(strip(mcp as unknown as Record<string, unknown>)).toEqual(strip(ui as unknown as Record<string, unknown>))
  })

  it('image/video/shot（shots 分类镜头节点）出生即领镜号；text/character/scene 不领', () => {
    const deps = makeDeps('x')
    const shotNumbered = ['image', 'video', 'shot']
    for (const kind of shotNumbered) {
      const node = buildCanvasNode({ kind }, [], deps)
      expect(typeof node.shotIndex).toBe('number')
    }
    for (const kind of ['text', 'character', 'scene', 'audio']) {
      const node = buildCanvasNode({ kind }, [], deps)
      expect(node.shotIndex).toBeUndefined()
    }
  })

  it('每个节点都带 UI 同款字段：meta 容器 + categoryId + size + history + status（不再缺字段）', () => {
    const node = buildCanvasNode({ kind: 'image' }, [], makeDeps('x'))
    expect(node.meta).toEqual({})
    expect(node.categoryId).toBe('shots')
    expect(node.size).toEqual(nodeKindDefaultSize('image'))
    expect(node.history).toEqual([])
    expect(node.status).toBe('idle')
    expect(node.prompt).toBe('')
    expect(node.references).toEqual([])
    // renderKind 不写（UI 也不写，渲染时现推）。
    expect('renderKind' in node).toBe(false)
  })

  it('character/scene 落对分类（cast / scene），不占镜号', () => {
    const character = buildCanvasNode({ kind: 'character' }, [], makeDeps('x'))
    expect(character.categoryId).toBe('cast')
    expect(character.shotIndex).toBeUndefined()
    const scene = buildCanvasNode({ kind: 'scene' }, [], makeDeps('x'))
    expect(scene.categoryId).toBe('scene')
    expect(scene.shotIndex).toBeUndefined()
  })
})

describe('canvasNodeFactory · 模型身份绑定（vendor/modelKey）', () => {
  it('给 vendor+modelKey → 绑成解析器可见四件（modelKey/modelAlias/modelVendor/vendor）', () => {
    const node = buildCanvasNode({ kind: 'image', vendor: 'apimart', modelKey: 'seedream-4' }, [], makeDeps('x'))
    expect(node.meta).toEqual({
      modelKey: 'seedream-4',
      modelAlias: 'seedream-4',
      modelVendor: 'apimart',
      vendor: 'apimart',
    })
  })

  it('不给 → meta {}（触发渲染层 auto-select 填默认模型）', () => {
    const node = buildCanvasNode({ kind: 'image' }, [], makeDeps('x'))
    expect(node.meta).toEqual({})
  })

  it('非法/未知值原样存（校验留在 UI，不建第二个校验器）', () => {
    const node = buildCanvasNode({ kind: 'image', vendor: '不存在的家', modelKey: 'ghost-model' }, [], makeDeps('x'))
    expect(node.meta.vendor).toBe('不存在的家')
    expect(node.meta.modelKey).toBe('ghost-model')
  })

  it('已备好的 meta（如 UI 从目录组装）原样并入，vendor/modelKey 叠加不丢原字段', () => {
    const node = buildCanvasNode(
      { kind: 'image', meta: { archetype: { id: 'seedream' }, imageModel: 'seedream-4' }, vendor: 'apimart', modelKey: 'seedream-4' },
      [],
      makeDeps('x'),
    )
    expect(node.meta.archetype).toEqual({ id: 'seedream' })
    expect(node.meta.imageModel).toBe('seedream-4')
    expect(node.meta.vendor).toBe('apimart')
  })

  it('只给 modelKey（缺 vendor）→ 只写 modelKey/modelAlias，不写空 vendor', () => {
    const node = buildCanvasNode({ kind: 'image', modelKey: 'seedream-4' }, [], makeDeps('x'))
    expect(node.meta).toEqual({ modelKey: 'seedream-4', modelAlias: 'seedream-4' })
  })
})

describe('canvasNodeFactory · 批量镜号累进', () => {
  it('同批多个镜头节点领到连续、不重复的镜号（不再全领同一个号）', () => {
    const specs = [{ kind: 'image' }, { kind: 'image' }, { kind: 'video' }]
    const positions = specs.map(() => ({ x: 0, y: 0 }))
    const built = buildCanvasNodes(specs, positions, [], makeDeps('x'))
    const indexes = built.map((n) => n.shotIndex)
    expect(indexes).toEqual([1, 2, 3])
  })

  it('已有镜号时从 max+1 续（编号是身份，不复用留空号）', () => {
    const existing = [{ shotIndex: 5 }]
    const specs = [{ kind: 'image' }, { kind: 'image' }]
    const built = buildCanvasNodes(specs, specs.map(() => ({ x: 0, y: 0 })), existing, makeDeps('x'))
    expect(built.map((n) => n.shotIndex)).toEqual([6, 7])
  })
})

describe('canvasNodeLayout · 批量布局（MCP 真布局，非单列竖排）', () => {
  const footprint = nodeKindFootprint

  it('2 锚 + 12 镜：无重叠 AABB，且不止一列 x（不再单列竖排），确定性', () => {
    // 分镜方案落画布用 storyboard 布局（锚行 + 镜头折行网格）；这里验通用 layoutPlannedNodes 分层。
    // 2 个 image 锚不足以形成「参考+关键帧+视频」多层，故用「character 锚 + image 镜头」触发分层。
    const kinds = ['character', 'character', ...Array.from({ length: 12 }, () => 'image')]
    const positions = layoutBatchWith(footprint, kinds, [])

    // 确定性：同输入同输出。
    const positions2 = layoutBatchWith(footprint, kinds, [])
    expect(positions2).toEqual(positions)

    // 不止一列 x（分层：参考列 vs 关键帧列）。
    const xs = new Set(positions.map((p) => Math.round(p.x)))
    expect(xs.size).toBeGreaterThan(1)

    // 任意两卡的 AABB（含足迹余量）不重叠。
    const boxes = kinds.map((kind, i) => ({ kind, x: positions[i].x, y: positions[i].y, size: footprint(kind) }))
    for (let a = 0; a < boxes.length; a += 1) {
      for (let b = a + 1; b < boxes.length; b += 1) {
        const A = boxes[a]
        const B = boxes[b]
        const overlap =
          A.x < B.x + B.size.width &&
          A.x + A.size.width > B.x &&
          A.y < B.y + B.size.height &&
          A.y + A.size.height > B.y
        expect(overlap).toBe(false)
      }
    }
  })

  it('单节点：对已有节点默认落点做碰撞避让（不压在既有卡上）', () => {
    // 已有一张 image 卡占住 trajectoryOrigin 附近；新单节点必须避让开。
    const origin = layoutBatchWith(footprint, ['image'], [])[0]
    const existing: NodeBox[] = [{ kind: 'image', position: { x: origin.x, y: origin.y }, size: { width: 340, height: 280 } }]
    const placed = layoutBatchWith(footprint, ['image'], existing)[0]
    const fp = footprint('image')
    const overlap =
      placed.x < existing[0].position.x + fp.width &&
      placed.x + fp.width > existing[0].position.x &&
      placed.y < existing[0].position.y + fp.height &&
      placed.y + fp.height > existing[0].position.y
    expect(overlap).toBe(false)
  })

  it('显式 x/y 由工厂优先（布局只补缺省落点）', () => {
    // buildCanvasNodes：spec 带 x/y 时用 spec 值，不用 positions。
    const specs = [{ kind: 'image', x: 1234, y: 5678 }]
    const built = buildCanvasNodes(specs, [{ x: 0, y: 0 }], [], makeDeps('x'))
    expect(built[0].position).toEqual({ x: 1234, y: 5678 })
  })
})
