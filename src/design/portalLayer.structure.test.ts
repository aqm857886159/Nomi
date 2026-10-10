import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// 10-09 回归（#1136 复核实测）：文稿树搬进左栏抽屉后，它的右键菜单（portal 到 body、`fixed z-50`）被抽屉
// （Mantine Drawer，z 200）压在下面——菜单在、点不到，「删除原稿」这一行看着有、实际用不了。
// 类根因：portal 到 body 的浮层谁在上面只看 z-index，而层级合同（overlayLayers.ts：popover 9200 / dialog 9100…）
// 只管了用合同的那些；手写 `fixed z-50` 的 portal 浮层一碰到新的外壳浮层就沉底。
// 合同：createPortal 出去的 fixed 浮层只许用合同层级（z-popover / z-dialog / z-floating-panel …），不许手写小数字。
// 存量两处冻结在下面（画布框选保存条），只减不增。
const stripComments = (source: string): string => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '')

const FROZEN = new Set([
  'src/workbench/generationCanvas/components/SelectionPromptSaveController.tsx',
])

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (full.endsWith('.tsx') && !full.endsWith('.test.tsx')) out.push(full)
  }
  return out
}

describe('portal 浮层只用层级合同里的 z（不手写小数字）', () => {
  it('createPortal 的文件里没有手写 z-数字 的 fixed 浮层（存量冻结）', () => {
    const root = resolve(process.cwd(), 'src')
    const offenders = walk(root)
      .filter((file) => !file.includes(`${join('src', 'devlab')}`))
      .filter((file) => {
        const code = stripComments(readFileSync(file, 'utf8'))
        if (!code.includes('createPortal(')) return false
        return /(?:fixed[^"'`\n]*\bz-(?:\d{1,3}|\[\d{1,4}\])\b)|(?:\bz-(?:\d{1,3}|\[\d{1,4}\])[^"'`\n]*\bfixed\b)/.test(code)
      })
      .map((file) => relative(process.cwd(), file).split('\\').join('/'))
      .filter((file) => !FROZEN.has(file))
    expect(offenders).toEqual([])
  })
})
