import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { stripComments } from '../../../scripts/lib/colorMixHue.mjs'

/**
 * 同一件事不许有第二个家：用受控同步账（createControlledEditorSync）的编辑器内核，
 * 「实例重建 → 灌入 + 重开账」只走 useEditorRebuildSync 这一处。
 * 以前 PromptEditor 没有这一步、useNomiRichTextEditor 自己写了一个 reset，结果提示词框在
 * 创作区被藏起来再放出来之后一直是空的（落盘里字还在）。
 */
const ROOT = path.resolve(__dirname, '../../..')

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) return sourceFiles(full)
    return /\.(ts|tsx)$/.test(entry.name) && !/\.test\./.test(entry.name) ? [full] : []
  })
}

const rel = (file: string) => path.relative(ROOT, file).split(path.sep).join('/')
const files = sourceFiles(path.join(ROOT, 'src'))
const read = (file: string) => stripComments(fs.readFileSync(file, 'utf8'))

describe('受控编辑器的实例重建只有一个家', () => {
  const users = files.filter((file) => /createControlledEditorSync\(/.test(read(file)) && !rel(file).endsWith('controlledEditorSync.ts'))

  it('用同步账的内核只有这两个，且各自都挂了 useEditorRebuildSync', () => {
    expect(users.map(rel).sort()).toEqual(['src/workbench/assets/PromptEditor.tsx', 'src/workbench/common/useNomiRichTextEditor.ts'])
    for (const file of users) expect(read(file), rel(file)).toMatch(/useEditorRebuildSync\(editor,\s*sync/)
  })

  it('内核里不再自写 sync.reset（重开账只在共享生命周期里）', () => {
    for (const file of users) expect(read(file), rel(file)).not.toMatch(/sync\.reset\(/)
  })

  it('PromptEditor 不再冻结创建时的内容', () => {
    const source = read(path.join(ROOT, 'src/workbench/assets/PromptEditor.tsx'))
    expect(source).not.toMatch(/initialContentRef/)
    expect(source).not.toMatch(/content:\s*initialContent/)
  })
})
