import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { CREATION_RESOURCE_TREE_MODES, workspaceModeCarriesCreationResourceTree } from './creationResourceTreeModes'

const stripComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
const read = (file: string): string => stripComments(readFileSync(resolve(process.cwd(), file), 'utf8'))

// 2026-09-06 回归（805096d41）：侧栏点分镜方案会切进 storyboard 模式，而资源树当时
// 只住在 CreationWorkspace 里 —— 用户被钉死在单个方案上，点不到别的剧本/别的分镜。
// 这里钉的是类不变量：**编辑原稿或它的分镜方案时，资源树必须在场且只有一个家**。
describe('creation resource tree reachability', () => {
  it('covers both surfaces that edit a document or its storyboard plans', () => {
    expect(workspaceModeCarriesCreationResourceTree('creation')).toBe(true)
    expect(workspaceModeCarriesCreationResourceTree('storyboard')).toBe(true)
    // 生成 / 预览有各自的资源面（画布文件树 / 时间轴），不挂创作资源树。
    expect(workspaceModeCarriesCreationResourceTree('generation')).toBe(false)
    expect(workspaceModeCarriesCreationResourceTree('preview')).toBe(false)
    expect([...CREATION_RESOURCE_TREE_MODES]).toEqual(['creation', 'storyboard'])
  })

  it('mounts the tree once, at the shell, for exactly those modes', () => {
    const shell = read('src/workbench/WorkbenchShell.tsx')
    expect(shell).toContain('workspaceModeCarriesCreationResourceTree(workspaceMode) ? <DocumentListSidebar />')
    // 一个家：两个工作区都不许自己再挂一棵（挂两棵 = 又能各自漂）。
    for (const file of [
      'src/workbench/creation/CreationWorkspace.tsx',
      'src/workbench/creation/storyboard/StoryboardWorkspace.tsx',
    ]) {
      expect(read(file)).not.toContain('DocumentListSidebar')
    }
  })

  it('sends the user back to the script surface when a document row is picked', () => {
    // 只清 activeStoryboardId 不切模式的话，StoryboardWorkspace 的「自动选第一个方案」
    // 会立刻把刚点回原稿的用户弹回分镜表——「点回剧本」必须同时切回 creation。
    const sidebar = read('src/workbench/creation/DocumentListSidebar.tsx')
    const selectDocument = sidebar.slice(sidebar.indexOf('const selectDocument'))
    const body = selectDocument.slice(0, selectDocument.indexOf('}') + 1)
    expect(body).toContain('setActiveStoryboardId(null)')
    expect(body).toContain("setWorkspaceMode('creation')")
  })
})
