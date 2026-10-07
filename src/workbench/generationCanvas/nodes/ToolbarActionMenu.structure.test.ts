// 节点浮条上「带 ▾ 的按钮 + 点开的东西」只有一个 owner：ToolbarActionMenu（2026-10-06 收口）。
//
// 立这条的原因：以前浮条上有三种写法——ToolbarActionMenu（菜单）、GridSplitPicker 自己拼「触发钮 + AnchoredPopover」、
// 分体按钮在调用方手画竖线。三份写法三套定位：菜单那一套把锚点算成一个点，节点贴画布上沿时翻下来压住整条浮条
// （用户截图「改图盖住宫格」），点阵那一套没事——同一条浮条上两种行为，就是因为写法不止一份。
// 规则：凡是用到浮条零件（NodeFloatingToolbar）的文件，自己不许画 ▾、不许声明 aria-haspopup、不许直接挂 WorkbenchMenu /
// AnchoredPopover；要下拉就用 ToolbarActionMenu。
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const SRC = path.join(process.cwd(), 'src')
const OWNER = 'src/workbench/generationCanvas/nodes/ToolbarActionMenu.tsx'

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) return walk(full)
    return /\.tsx$/.test(entry.name) && !/\.test\.tsx$/.test(entry.name) ? [full] : []
  })
}

const stripComments = (source: string): string => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
const rel = (file: string): string => path.relative(process.cwd(), file).split(path.sep).join('/')

/** 用浮条零件的文件 = 从 NodeFloatingToolbar 引东西的文件（浮条外壳、按钮原子都住那里）。 */
const toolbarFiles = walk(SRC)
  .filter((file) => /from '[^']*\/?NodeFloatingToolbar'/.test(fs.readFileSync(file, 'utf8')))
  .map(rel)

const FORBIDDEN: ReadonlyArray<[RegExp, string]> = [
  [/aria-haspopup/, 'aria-haspopup（自己声明一个弹层）'],
  [/IconChevronDown/, 'IconChevronDown（自己画 ▾）'],
  [/<WorkbenchMenu\b/, '<WorkbenchMenu（自己挂菜单）'],
  [/<AnchoredPopover\b/, '<AnchoredPopover（自己挂浮层）'],
]

describe('节点浮条的下拉只有一个 owner', () => {
  it('普查对象非空（防止过滤条件失效后变成空转的绿）', () => {
    expect(toolbarFiles).toContain('src/workbench/generationCanvas/quickActions/ImageQuickActionsToolbar.tsx')
    expect(toolbarFiles).toContain('src/workbench/generationCanvas/nodes/GridSplitPicker.tsx')
    expect(toolbarFiles).toContain(OWNER)
  })

  it('除了 ToolbarActionMenu，用浮条零件的文件都不自己写下拉', () => {
    const offenders = toolbarFiles
      .filter((file) => file !== OWNER)
      .flatMap((file) => {
        const source = stripComments(fs.readFileSync(path.join(process.cwd(), file), 'utf8'))
        return FORBIDDEN.filter(([pattern]) => pattern.test(source)).map(([, what]) => `${file}: ${what}`)
      })
    expect(offenders).toEqual([])
  })

  it('浮条零件里不再导出第二个触发钮（触发钮长什么样只在 ToolbarActionMenu 里）', () => {
    const shell = stripComments(fs.readFileSync(path.join(SRC, 'workbench/generationCanvas/nodes/NodeFloatingToolbar.tsx'), 'utf8'))
    expect(shell).not.toMatch(/ToolbarMenuTrigger/)
    expect(shell).not.toMatch(/IconChevronDown/)
  })

  it('分体按钮中间不画竖线（用户 2026-10-06：和「宫格 ▾」一个样子）', () => {
    const owner = stripComments(fs.readFileSync(path.join(process.cwd(), OWNER), 'utf8'))
    const split = owner.slice(owner.indexOf('data-toolbar-split'))
    expect(split.slice(0, 600)).not.toMatch(/w-px/)
  })

  it('点开的东西贴的是「触发钮 × 整条浮条」这块矩形，不是一个点', () => {
    const owner = stripComments(fs.readFileSync(path.join(process.cwd(), OWNER), 'utf8'))
    expect(owner).toMatch(/closest\('\[data-node-floating-toolbar\]'\)/)
    expect(owner).toMatch(/anchorRect=\{anchorRect\}/)
    expect(owner).not.toMatch(/point=\{/)
  })
})
