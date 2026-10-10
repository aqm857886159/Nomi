import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { IconTypography } from '@tabler/icons-react'
import { getGenerationNodeIcon } from './renderRegistry'

// 文字节点的图标只有一个来源：节点类型登记（renderRegistry 的 NODE_ICONS.text）。
// 拍板稿（Main 板底部条、TextNode 板文本节点）用的是「A」字形 = Tabler IconTypography。
describe('文字节点图标的唯一来源', () => {
  it('登记里的 text 就是拍板稿的「A」字形（IconTypography）', () => {
    expect(getGenerationNodeIcon('text')).toBe(IconTypography)
  })

  it('画布节点目录里没有别处直接引用另一颗文字图标（IconWriting）', () => {
    const root = path.resolve(__dirname, '..')
    const offenders: string[] = []
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name)
        if (entry.isDirectory()) walk(full)
        else if (/\.(tsx?|jsx?)$/.test(entry.name) && !/\.test\./.test(entry.name)) {
          if (/\bIconWriting\b/.test(fs.readFileSync(full, 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, ''))) offenders.push(path.relative(root, full))
        }
      }
    }
    walk(root)
    expect(offenders, '文字节点图标要从 getGenerationNodeIcon("text") 取').toEqual([])
  })
})
