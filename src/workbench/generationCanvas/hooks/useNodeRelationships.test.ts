import { describe, expect, it } from 'vitest'
import { countShotUsage } from './useNodeRelationships'
import type { GenerationCanvasNode, GenerationCanvasEdge } from '../model/generationCanvasTypes'

function node(id: string, categoryId: string, title = ''): GenerationCanvasNode {
  return { id, kind: 'image', title, position: { x: 0, y: 0 }, categoryId } as GenerationCanvasNode
}
function edge(source: string, target: string): GenerationCanvasEdge {
  return { id: `${source}->${target}`, source, target }
}

describe('countShotUsage — 结构化引用计数（替代 prompt.includes(title) 子串匹配）', () => {
  it('统计「以本节点为 source、指向 shots 节点」的边数', () => {
    const nodes = [
      node('char', 'character', '人物'),
      node('s1', 'shots'),
      node('s2', 'shots'),
      node('s3', 'shots'),
    ]
    const edges = [edge('char', 's1'), edge('char', 's2')]
    expect(countShotUsage('char', nodes, edges)).toBe(2)
  })

  it('子串重名不再假阳性：title「人物」⊂「人物特写」prompt 也只按边计', () => {
    // 旧实现：s1.prompt 含 "人物" 字样会被两张卡(人物/人物特写)同时记 → 误计。
    // 现按边：只有真正连了边的才计数，与文本无关。
    const nodes = [
      node('a', 'character', '人物'),
      node('b', 'character', '人物特写'),
      node('s1', 'shots'),
    ]
    // s1 只引用了 b（人物特写），没引用 a（人物）
    const edges = [edge('b', 's1')]
    expect(countShotUsage('a', nodes, edges)).toBe(0)
    expect(countShotUsage('b', nodes, edges)).toBe(1)
  })

  it('只数 shots 分类目标：连到非 shots 节点不计入「被分镜引用」', () => {
    const nodes = [
      node('char', 'character'),
      node('s1', 'shots'),
      node('other', 'scene'),
    ]
    const edges = [edge('char', 's1'), edge('char', 'other')]
    expect(countShotUsage('char', nodes, edges)).toBe(1)
  })

  it('同一对 source→shot 多条边只算一次（去重，防 36/26 类虚高）', () => {
    const nodes = [node('char', 'character'), node('s1', 'shots')]
    const edges = [edge('char', 's1'), edge('char', 's1')]
    expect(countShotUsage('char', nodes, edges)).toBe(1)
  })

  it('无 categoryId 的目标按默认 shots 处理（legacy 节点回退）', () => {
    const legacyShot = { id: 's1', kind: 'image', title: '', position: { x: 0, y: 0 } } as GenerationCanvasNode
    const nodes = [node('char', 'character'), legacyShot]
    const edges = [edge('char', 's1')]
    expect(countShotUsage('char', nodes, edges)).toBe(1)
  })

  it('反向边不计：本节点作为 target（被别人引用）不算它「引用了分镜」', () => {
    const nodes = [node('char', 'character'), node('s1', 'shots')]
    const edges = [edge('s1', 'char')] // s1 -> char（方向反了）
    expect(countShotUsage('char', nodes, edges)).toBe(0)
  })
})
