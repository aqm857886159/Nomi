// 花钱红线的结构钉子：派生这一整个目录里没有任何提交 / 批准 / 派发的调用，连 import 都没有。
// 派生只准备（建节点、连参考、填模板、选模型）；花钱是用户在新节点上点 ↑ 走的现有入口。
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const FORBIDDEN = [
  'confirmAndRunNode', 'regenerateNodeInPlace', 'runGenerationNode', 'runGenerationNodesBatch',
  'mintSpendGrant', 'submitCanvasShotRun', 'createCanvasShotRuns', 'confirmGenerationSpend', 'runTask',
]

describe('quickActions 不碰花钱入口', () => {
  const dir = __dirname
  const files = readdirSync(dir).filter((name) => /\.(ts|tsx)$/.test(name) && !name.includes('.test.'))
  it('至少扫到了派生的实现文件', () => {
    expect(files).toEqual(expect.arrayContaining(['deriveFromNode.ts', 'useQuickActionHost.ts']))
  })
  it.each(FORBIDDEN)('没有 %s', (name) => {
    for (const file of files) {
      const source = readFileSync(path.join(dir, file), 'utf8')
      // 只看代码，不看写着「不碰它」的注释。
      const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
      expect(code.includes(name), `${file} 出现了 ${name}`).toBe(false)
    }
  })
})
