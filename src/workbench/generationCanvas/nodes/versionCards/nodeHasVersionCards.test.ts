import { describe, expect, it } from 'vitest'
import type { GenerationCanvasNode, GenerationNodeResult } from '../../model/generationCanvasTypes'
import { nodeHasVersionCards } from './nodeVersionEntries'

const image = (id: string): GenerationNodeResult => ({ id, type: 'image', url: `nomi-local://asset/${id}.png`, createdAt: 1 })
const node = (versions: number, production = false): GenerationCanvasNode => {
  const results = Array.from({ length: versions }, (_, index) => image(`r${index + 1}`))
  return {
    id: 'n1', kind: 'image', title: 'shot', position: { x: 0, y: 0 }, prompt: '', categoryId: 'shots',
    ...(results.length ? { result: results[0], history: results } : {}),
    ...(production ? { meta: { productionRunId: 'run-1', productionShotId: 'shot-1' } } : {}),
  } as GenerationCanvasNode
}

// 版本卡片入口（节点身后的叠卡，10-06 起替换「N 版」角标）的显示规则：只在 ≥2 版时出现，与是不是制作流程的镜头无关。
// 制作流程的单版镜头以前借它当「重拍」入口，所以 1 版也冒出「1 版」（英文是 "1 versions"）；重拍搬进节点浮条之后这个例外删掉。
describe('nodeHasVersionCards · 版本入口显示规则', () => {
  it('没有结果、1 版、2 版及以上', () => {
    expect(nodeHasVersionCards(node(0))).toBe(false)
    expect(nodeHasVersionCards(node(1))).toBe(false)
    expect(nodeHasVersionCards(node(2))).toBe(true)
    expect(nodeHasVersionCards(node(5))).toBe(true)
  })

  it('reported case: 制作流程的镜头只有 1 版也不显示角标；2 版显示', () => {
    expect(nodeHasVersionCards(node(1, true))).toBe(false)
    expect(nodeHasVersionCards(node(2, true))).toBe(true)
  })
})
