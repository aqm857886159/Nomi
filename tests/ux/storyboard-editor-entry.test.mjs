// 静态门：走查不许自己「点左栏分镜方案行」去进编辑器——唯一入口是 tests/ux/_creationResourceTree.mjs 的 openStoryboardEditor()。
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
