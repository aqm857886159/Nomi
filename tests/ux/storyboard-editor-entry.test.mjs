// 静态门：走查不许再「点左栏分镜方案行」去进编辑器。
// 2026-10-08 起点方案行 = 生成页列表（只看这份分镜）；编辑器只从 ⋯ 菜单「编辑分镜方案」进，
// 唯一的走查入口是 tests/ux/_creationResourceTree.mjs 的 openStoryboardEditor()。
// 点方案行进列表的那一条也只在同一个文件里（openStoryboardInList）。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const UX = path.dirname(fileURLToPath(import.meta.url))
const OWNER = '_creationResourceTree.mjs'
// 一条语句里同时出现方案行选择器和一次点击（.click( / clickOrFail(）。`:not([data-storyboard-id])` 是在点原稿行，不算。
const ROW_CLICK = /(clickOrFail\([^;\n]*(?<!:not\(\[)data-storyboard-id|(?<!:not\(\[)data-storyboard-id[^;\n]*\.click\()/

function walkFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) return entry.name === 'shots' || entry.name === 'node_modules' ? [] : walkFiles(full)
    return /\.m?js$/.test(entry.name) ? [full] : []
  })
}

describe('storyboard editor entry in walkthroughs', () => {
  it('no walk clicks a plan row; the editor opens only through openStoryboardEditor()', () => {
    const offenders = walkFiles(UX)
      .filter((file) => path.basename(file) !== OWNER && !file.endsWith('storyboard-editor-entry.test.mjs'))
      .flatMap((file) => fs.readFileSync(file, 'utf8').split('\n')
        .map((line, index) => ({ line, index }))
        .filter(({ line }) => ROW_CLICK.test(line) && !line.trim().startsWith('//'))
        .map(({ index }) => `${path.relative(UX, file)}:${index + 1}`))
    expect(offenders).toEqual([])
  })
})
