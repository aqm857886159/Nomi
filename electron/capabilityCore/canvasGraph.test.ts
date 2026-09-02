import { describe, expect, it } from 'vitest'
import * as canvasGraph from './canvasGraph'

import {
  addNodes,
  connectNodes,
  deleteNodes,
  emptyCanvasSnapshot,
  normalizeSnapshot,
  setNodePrompt,
} from './canvasGraph'
import { nodeKindDefaultSize } from './nodeKindDomain'

describe('capabilityCore/canvasGraph', () => {
  it('addNodes 给每个节点稳定唯一 id，且经共用布局不堆成单列（不再全堆原点）', () => {
    const { snapshot, ids } = addNodes(emptyCanvasSnapshot(), [
      { kind: 'text', prompt: '一句脚本' },
      { kind: 'image', title: '镜头 1' },
    ])
    expect(ids).toHaveLength(2)
    expect(new Set(ids).size).toBe(2)
    expect(snapshot.nodes).toHaveLength(2)
    expect(snapshot.nodes[0].kind).toBe('text')
    expect(snapshot.nodes[0].prompt).toBe('一句脚本')
    expect(snapshot.nodes[1].title).toBe('镜头 1')
    // 共用布局：批量不再堆成单列（旧平行版的 x=0 竖排正是被修的病）。两节点落点不相同。
    const p0 = snapshot.nodes[0].position
    const p1 = snapshot.nodes[1].position
    expect(p0.x === p1.x && p0.y === p1.y).toBe(false)
    // 且经共用工厂补齐了 UI 同款字段：meta 容器 + categoryId（不再是缺字段的二等公民）。
    expect(snapshot.nodes[0].meta).toEqual({})
    expect(snapshot.nodes[0].categoryId).toBe('shots')
    expect(snapshot.nodes[1].categoryId).toBe('shots')
  })

  it('addNodes 不可变——原快照不被改写', () => {
    const before = emptyCanvasSnapshot()
    addNodes(before, [{ kind: 'text' }])
    expect(before.nodes).toHaveLength(0)
  })

  it('addNodes 给 vendor+modelKey → 绑进 meta 的解析器可见四件（同 UI 身份）', () => {
    const { snapshot } = addNodes(emptyCanvasSnapshot(), [
      { kind: 'video', vendor: 'apimart', modelKey: 'seedance-2' },
    ])
    expect(snapshot.nodes[0].meta).toEqual({
      modelKey: 'seedance-2',
      modelAlias: 'seedance-2',
      modelVendor: 'apimart',
      vendor: 'apimart',
    })
  })

  it('addNodes 不给模型 → meta {}（触发渲染层 auto-select）；镜头节点仍领镜号', () => {
    const { snapshot } = addNodes(emptyCanvasSnapshot(), [{ kind: 'video' }])
    expect(snapshot.nodes[0].meta).toEqual({})
    expect(typeof snapshot.nodes[0].shotIndex).toBe('number')
  })

  it('addNodes 显式 x/y 优先于自动布局', () => {
    const { snapshot } = addNodes(emptyCanvasSnapshot(), [{ kind: 'image', x: 4321, y: 8765 }])
    expect(snapshot.nodes[0].position).toEqual({ x: 4321, y: 8765 })
  })

  // 生产 addNodes 路径的注入接线守恒：resolveSize 必须真的走 nodeKindDefaultSize(kind)，不是烘死常量。
  // 钉多个「尺寸不同」的 kind——若接线漂成常量，至少一个会对不上（防 review 说的「miswired 也不红」）。
  it('addNodes 省略 size → 生产接线给到 nodeKindDefaultSize(kind)（逐 kind 真尺寸，非常量）', () => {
    const { snapshot } = addNodes(emptyCanvasSnapshot(), [
      { kind: 'text' }, // 280×200
      { kind: 'video' }, // 420×340（与 text 不同 → 常量接线接不住）
      { kind: 'audio' }, // 420×80（高度又与 video 不同）
    ])
    expect(snapshot.nodes[0].size).toEqual(nodeKindDefaultSize('text'))
    expect(snapshot.nodes[1].size).toEqual(nodeKindDefaultSize('video'))
    expect(snapshot.nodes[2].size).toEqual(nodeKindDefaultSize('audio'))
    // 三者互不相同：证明尺寸是按 kind 派生的，不是同一个烘死值。
    expect(snapshot.nodes[0].size).not.toEqual(snapshot.nodes[1].size)
    expect(snapshot.nodes[1].size).not.toEqual(snapshot.nodes[2].size)
  })

  // Fix 2：MCP 省略 title → 存空串（不烘英文标题）。空标题的本地化归**渲染时** `node.title || t(...)`
  // 兜底（BaseGenerationNode NodeInlineImageTitle / AudioStripNode getDisplayTitle / Character·Scene·Prop
  // 卡的 EditableNodeTitle placeholder），故 zh-CN 用户不会看到英文卡名。给了 title 则原样存。
  it('addNodes 省略 title → 存空串（本地化由渲染时兜底，不烘英文标题）', () => {
    const { snapshot } = addNodes(emptyCanvasSnapshot(), [{ kind: 'text' }, { kind: 'image', title: '镜头 A' }])
    expect(snapshot.nodes[0].title).toBe('')
    expect(snapshot.nodes[1].title).toBe('镜头 A')
  })

  it('addNodes character/scene 落对分类、不占镜号（同 UI）', () => {
    const { snapshot } = addNodes(emptyCanvasSnapshot(), [{ kind: 'character' }, { kind: 'scene' }])
    expect(snapshot.nodes[0].categoryId).toBe('cast')
    expect(snapshot.nodes[0].shotIndex).toBeUndefined()
    expect(snapshot.nodes[1].categoryId).toBe('scene')
    expect(snapshot.nodes[1].shotIndex).toBeUndefined()
  })

  it('connectNodes 按 target 入边数赋递增 order（保住 character1..N 顺序）', () => {
    const built = addNodes(emptyCanvasSnapshot(), [{ kind: 'image' }, { kind: 'image' }, { kind: 'video' }])
    const [a, b, target] = built.ids
    const { snapshot, edgeIds } = connectNodes(built.snapshot, [
      { source: a, target, mode: 'character_ref' },
      { source: b, target, mode: 'character_ref' },
    ])
    expect(edgeIds).toHaveLength(2)
    const edges = snapshot.edges.filter((edge) => edge.target === target)
    expect(edges.map((edge) => edge.order)).toEqual([0, 1])
  })

  it('connectNodes 跳过不存在端点 / 自连 / 重复，并给出原因', () => {
    const built = addNodes(emptyCanvasSnapshot(), [{ kind: 'image' }, { kind: 'video' }])
    const [a, b] = built.ids
    const first = connectNodes(built.snapshot, [{ source: a, target: b }])
    const second = connectNodes(first.snapshot, [
      { source: a, target: b }, // 重复
      { source: a, target: 'ghost' }, // 端点不存在
      { source: a, target: a }, // 自连
    ])
    expect(second.edgeIds).toHaveLength(0)
    expect(second.skipped.map((item) => item.reason).sort()).toEqual(['不能自连', '端点节点不存在', '重复连线'])
  })

  it('connectNodes 非法 mode 显式拒绝', () => {
    const built = addNodes(emptyCanvasSnapshot(), [{ kind: 'image' }, { kind: 'video' }])
    expect(() => connectNodes(built.snapshot, [{ source: built.ids[0], target: built.ids[1], mode: 'bogus' }])).toThrowError(/Unknown canvas edge mode/)
  })

  it('setNodePrompt 改提示词与标题；未知节点显式失败', () => {
    const built = addNodes(emptyCanvasSnapshot(), [{ kind: 'text' }])
    const ok = setNodePrompt(built.snapshot, built.ids[0], '新提示', '新标题')
    expect(ok.changed).toBe(true)
    expect(ok.snapshot.nodes[0].prompt).toBe('新提示')
    expect(ok.snapshot.nodes[0].title).toBe('新标题')
    expect(() => setNodePrompt(built.snapshot, 'ghost', 'x')).toThrowError(/Canvas node not found/)
  })

  it('deleteNodes 同时清掉关联入边出边，无悬挂边', () => {
    const built = addNodes(emptyCanvasSnapshot(), [{ kind: 'image' }, { kind: 'video' }, { kind: 'image' }])
    const [a, b, c] = built.ids
    const connected = connectNodes(built.snapshot, [
      { source: a, target: b },
      { source: c, target: b },
    ])
    const { snapshot, deleted } = deleteNodes(connected.snapshot, [b])
    expect(deleted).toEqual([b])
    expect(snapshot.nodes.map((node) => node.id).sort()).toEqual([a, c].sort())
    expect(snapshot.edges).toHaveLength(0)
  })

  it('normalizeSnapshot 对未知 kind 和坏边显式失败，不静默丢数据', () => {
    expect(normalizeSnapshot(null).nodes).toHaveLength(0)
    expect(() => normalizeSnapshot({
      nodes: [{ id: 'n1', kind: 'text', title: 't', position: { x: 0, y: 0 } }, { kind: 'broken' }],
      edges: [{ id: 'e1', source: 'n1', target: 'n2' }, { id: 'bad' }],
    })).toThrowError(/unknown node kind/i)
  })

  it('does not own a second canvas.read field projector', () => {
    expect('readCanvas' in canvasGraph).toBe(false)
  })
})
