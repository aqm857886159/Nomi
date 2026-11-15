import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// 「新节点连底栏落在看得见的地方」只有一个来源：底栏占多高取 composerFocusFootprint，底部停靠条由外壳登记、宿主现量后发布空地。
// store 层不许再抄一份停靠条名单、停靠条 / 底栏高度数字，也不许在落点算式里按节点种类写分支。
const STORE = fileURLToPath(new URL('./', import.meta.url))
const stripComments = (text: string): string => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
const files = readdirSync(STORE).filter((name) => /\.ts$/.test(name) && !/\.test\.ts$/.test(name))

describe('store has no second copy of dock / composer sizes', () => {
  it('no dock selector, no dock or composer height numbers, in any store source file', () => {
    for (const name of files) {
      const code = stripComments(readFileSync(path.join(STORE, name), 'utf8'))
      expect(code, `${name} 里不许出现停靠条标记`).not.toMatch(/data-canvas-bottom-dock|BOTTOM_DOCK/)
      expect(code, `${name} 里不许写死停靠条 / 底栏高度`).not.toMatch(/\b(?:dock|composer)\w*(?:height|footprint|size)\w*\s*[:=]\s*\d{2,}/i)
      expect(code, `${name} 里不许自带 composerMaxHeight`).not.toMatch(/composerMaxHeight/)
    }
  })

  it('the landing formula has no per-kind branch', () => {
    const code = stripComments(readFileSync(path.join(STORE, 'canvasVisibleArea.ts'), 'utf8'))
    expect(code).not.toMatch(/kind\s*[!=]==|switch\s*\(\s*kind|\.has\(\s*kind/)
  })
})
