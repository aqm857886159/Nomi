// WorkbenchMenu 的锚点：按钮点开的菜单给矩形（anchorRect），只有「没有触发元素」的菜单（右键、连线落空）给点（point）。
//
// 2026-10-06 那一类：调用方拿按钮的 getBoundingClientRect() 算出一个点（按钮上沿往上 6px / 下沿往下 4px）当 point 传进来。
// 有空间时看不出问题；放不下要翻边时，Radix 翻的是一个 0×0 的点，菜单整块压回按钮（「改图」盖住浮条那一排）。
// 判据：同一个文件里既给 WorkbenchMenu 传 point、又在量 getBoundingClientRect——那就是拿按钮位置冒充点位，红。
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) return walk(full)
    return /\.tsx$/.test(entry.name) && !/\.test\.tsx$/.test(entry.name) ? [full] : []
  })
}
const stripComments = (source: string): string => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

const menuFiles = walk(path.join(process.cwd(), 'src'))
  .map((file) => ({ file: path.relative(process.cwd(), file).split(path.sep).join('/'), source: stripComments(fs.readFileSync(file, 'utf8')) }))
  .filter(({ source }) => /<WorkbenchMenu\b/.test(source))

describe('WorkbenchMenu 的锚点来源', () => {
  it('普查对象非空', () => {
    expect(menuFiles.map(({ file }) => file)).toContain('src/workbench/generationCanvas/nodes/ToolbarActionMenu.tsx')
  })

  it('给 point 的调用点不量按钮位置（按钮点开的菜单必须给 anchorRect）', () => {
    const offenders = menuFiles
      .filter(({ source }) => /<WorkbenchMenu\b[\s\S]*?\bpoint=\{/.test(source) && /getBoundingClientRect\(\)/.test(source))
      .map(({ file }) => file)
    expect(offenders).toEqual([])
  })
})
