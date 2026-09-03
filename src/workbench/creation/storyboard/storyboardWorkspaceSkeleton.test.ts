import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 分镜页与创作页的**三栏骨架同构**。
 *
 * 为什么要钉：v5 C3 当初刻意把分镜页做成全宽孤岛（理由是分镜表要宽），代价是用户进了分镜页
 * 既回不去目录、也叫不到 Agent——而分镜表恰恰是最需要 Agent 的那一屏。2026-09-03 用户提出后
 * 改成与创作页同构。「同构」是**同一个骨架**，不是「长得像」：两页的列宽和断点必须逐字一致，
 * 否则窄屏下两页会在不同宽度塌成不同形状，用户在两页之间来回时布局会跳。
 *
 * 这条测试比较的是源码里的 grid 模板字符串——不需要起 Electron，改任一页忘了改另一页就红。
 * 真实几何由 tests/ux/storyboard-3col-layout.walk.mjs 走真机量（1440/1680 两档、Agent 开合两态）。
 */
const read = (relative: string) => fs.readFileSync(path.join(process.cwd(), relative), 'utf8')

const creation = read('src/workbench/creation/CreationWorkspace.tsx')
const storyboard = read('src/workbench/creation/storyboard/StoryboardWorkspace.tsx')

/** 抓出该文件里 grid-cols 那两条（展开态 / 收起态）模板字符串。 */
function gridTemplates(source: string): string[] {
  return [...source.matchAll(/'(grid-cols-\[[^']*)'/g)].map((match) => match[1].trim())
}

describe('分镜页三栏骨架', () => {
  it('列宽与断点与创作页逐字一致（同构 = 同一个骨架）', () => {
    const creationGrids = gridTemplates(creation)
    expect(creationGrids.length).toBeGreaterThanOrEqual(2)
    expect(gridTemplates(storyboard)).toEqual(creationGrids)
  })

  it('三栏各就各位：目录侧栏 + 分镜主列 + Agent dock', () => {
    expect(storyboard).toContain('DocumentListSidebar')
    expect(storyboard).toContain('data-storyboard-main="true"')
    expect(storyboard).toContain('agentDockRef')
  })

  it('Agent 开合状态与创作页共用同一个槽，不新增一份分镜页自己的记忆', () => {
    // 走 props（aiCollapsed）而不是自己去 store 里读一个新 key——单一语义 owner。
    expect(storyboard).toContain('aiCollapsed')
    expect(storyboard).not.toMatch(/storyboardAgentCollapsed|storyboardDockCollapsed/)
  })
})
