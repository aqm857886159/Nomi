// 创作页编辑区窄时的三条拍板约束（2026-11-07 窄窗拍板 WindowNarrow）：
//   · creation.editor-grid（F1）：编辑区 section 写列模板 minmax(0,1fr)。不写就是隐式 auto 列，宽度被工具条一整排
//     按钮的 min-content 撑开，主区一窄正文和工具条一起被裁（1100 宽 + Nomi 停靠 340 实测）。
//   · narrow.never-yield：撤销 / 重做永不收进「⋯」——它们不在可收的那一排（NomiOverflowRow）里，排在它后面。
//   · narrow.one-threshold：收不收只看「量出来放不下」，这几处不许按窗口宽写断点（innerWidth / matchMedia / 响应式前缀）。
// 收起本身是真 DOM 测量，单测里没有布局引擎；真宽度下露几颗、菜单长什么样由走查 tests/ux/window-narrow-pages.walk.mjs 量。
import fs from 'node:fs'
import path from 'node:path'
import { createElement } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { toMenuItem } from './WorkbenchEditor'

const read = (file: string): string => fs.readFileSync(path.join(process.cwd(), file), 'utf8')
const stripComments = (source: string): string => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/^\s*\/\/.*$/gm, '')
const editor = stripComments(read('src/workbench/creation/WorkbenchEditor.tsx'))

function literalGroups(name: string): string[][] {
  const match = editor.match(new RegExp(`const ${name}[^=]*=\\s*(\\[[\\s\\S]*?\\n\\])`))
  if (!match) throw new Error(`${name} 不见了`)
  return JSON.parse(match[1].replace(/'/g, '"').replace(/,(\s*[\]])/g, '$1'))
}

describe('创作页编辑区：窄时不裁、撤销重做钉右端', () => {
  it('编辑区 section 写列模板 minmax(0,1fr)（F1）', () => {
    const section = editor.match(/'workbench-editor',[\s\S]*?workspacePanelFrame/)?.[0] ?? ''
    expect(section).toContain('grid-cols-[minmax(0,1fr)]')
  })

  it('可收的那一排里没有撤销 / 重做；它们在 NomiOverflowRow 之后单独画', () => {
    const collapsible = literalGroups('TOOLBAR_LEFT_GROUPS').flat()
    expect(collapsible).not.toContain('undo')
    expect(collapsible).not.toContain('redo')
    const pinned = editor.match(/const TOOLBAR_RIGHT_GROUP[^=]*=\s*(\[[^\]]*\])/)?.[1] ?? ''
    expect(JSON.parse(pinned.replace(/'/g, '"'))).toEqual(['undo', 'redo'])
    const row = editor.indexOf('<NomiOverflowRow')
    const pinnedRender = editor.indexOf('rightGroup.map(')
    expect(row).toBeGreaterThan(-1)
    expect(pinnedRender).toBeGreaterThan(row)
    expect(editor.slice(row, pinnedRender)).not.toMatch(/rightGroup|'undo'|'redo'/)
  })

  it('keeps infrequent formats in the menu and the full-document action at the right', () => {
    const row = literalGroups('TOOLBAR_LEFT_GROUPS').flat()
    for (const id of ['code', 'horizontal-rule', 'table']) expect(row).not.toContain(id)
    expect(editor).toContain('overflowItems={pick(TOOLBAR_MENU_ONLY).map(toMenuItem)}')
    expect(editor.indexOf('data-document-storyboard')).toBeGreaterThan(editor.indexOf('rightGroup.map('))
  })

  it.each([false, true])('exposes Code as a checkbox when active is %s', (active) => {
    const onClick = vi.fn()
    const item = toMenuItem({ id: 'code', label: 'Code', icon: createElement('svg'), active, onClick })
    expect(item).toMatchObject({ kind: 'checkbox', checked: active, onCheckedChange: onClick })
  })

  it.each(['horizontal-rule', 'table'])('keeps %s as an ordinary menu command', (id) => {
    const onClick = vi.fn()
    const item = toMenuItem({ id, label: id, icon: createElement('svg'), onClick })
    expect(item.kind ?? 'action').toBe('action')
    expect(item).toMatchObject({ onSelect: onClick })
    expect(item).not.toHaveProperty('checked')
  })

  it('不按窗口宽写断点：编辑区、收起组件、四个工作区根都只认量出来的放不下', () => {
    const files = [
      'src/workbench/creation/WorkbenchEditor.tsx',
      'src/design/NomiOverflowRow.tsx',
      'src/workbench/creation/CreationWorkspace.tsx',
      'src/workbench/creation/storyboard/StoryboardWorkspace.tsx',
      'src/workbench/preview/PreviewWorkspace.tsx',
    ]
    const BREAKPOINT = /\binnerWidth\b|\bmatchMedia\b|useMediaQuery|@media|(?:^|[\s'"`])(?:max-)?(?:sm|md|lg|xl|2xl):[a-z[-]/m
    const offenders = files.filter((file) => BREAKPOINT.test(stripComments(read(file))))
    expect(offenders).toEqual([])
  })
})
