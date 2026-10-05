import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (relative: string): string =>
  fs.readFileSync(path.join(process.cwd(), relative), 'utf8')
const stripComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
const exists = (relative: string): boolean => fs.existsSync(path.join(process.cwd(), relative))

const row = stripComments(read('src/workbench/creation/storyboard/shotRow/StoryboardShotRow.tsx'))
const strip = stripComments(read('src/workbench/creation/storyboard/shotRow/ShotReferenceStrip.tsx'))
const shell = stripComments(read('src/workbench/creation/storyboard/shotRow/StoryboardRowShell.tsx'))
const frame = stripComments(read('src/workbench/creation/storyboard/shotRow/StoryboardShotFrame.tsx'))
const composerBar = stripComments(read('src/workbench/creation/storyboard/shotRow/ShotComposerBar.tsx'))
const composerParams = stripComments(read('src/workbench/creation/storyboard/shotRow/StoryboardComposerParams.tsx'))

describe('分镜行：生成内容只有一个入口', () => {
  it('没有展开按钮、展开组件或台词转场投影', () => {
    expect(exists('src/workbench/creation/storyboard/shotRow/StoryboardShotRowExpand.tsx')).toBe(false)
    for (const oldPath of ['data-storyboard-subline', 'data-storyboard-expand', 'dialogueWillGenerate', 'shot.dialogue', 'shot.subtitle']) expect(row).not.toContain(oldPath)
  })
})

/**
 * 2026-10-05 用户：「大部分是要利用我们目前的交互，复用」「选择参数要复用画布那个地方的方式」。
 * 2026-10-06 第二 / 三轮：版面 = 行首 / 视觉列（预览框 + 参考缩略图）/ 内容列（提示词 + 底栏）。
 */
describe('分镜行：参数与参考复用画布那一套，不许再造第二套', () => {
  it('参数区就是画布节点底栏 InlineParameterBar（模型按钮 + 参数汇总按钮 + 平铺面板）', () => {
    expect(composerBar).toContain('<StoryboardComposerParams')
    expect(composerParams).toContain("from '../../../generationCanvas/nodes/InlineParameterBar'")
    expect(composerParams).toContain('<InlineParameterBar')
    // 旧底栏那排手写胶囊（模式 / 时长 / 清晰度 / ⋯）不许复活：底栏里不再直接摆 NomiSelect。
    expect(composerBar).not.toContain('NomiSelect')
    expect(composerBar).not.toContain('data-storyboard-composer-switches')
  })

  it('参数的显示值走落画布同一个构造器（buildPlannedNodeMeta），界面 = 请求', () => {
    const model = stripComments(read('src/workbench/creation/storyboard/shotRow/storyboardComposerModel.ts'))
    expect(model).toContain('buildPlannedNodeMeta(')
    expect(model).toContain('resolveRenderedControls(')
  })

  it('参考缩略图是画布同款 AssetTile（自带 ×），选择器复用 AssetPicker', () => {
    expect(strip).toContain("from '../../../assets/AssetTile'")
    expect(strip).toContain('<AssetTile')
    expect(strip).toContain('onRemove=')
    expect(strip).toContain("from '../../../assets/AssetPicker'")
    expect(strip).toContain("from '../../../assets/AssetPickerPopover'")
  })

  it('参考在视觉列（预览框下面 / 竖版时右边），内容列里没有参考区', () => {
    const visualAt = row.indexOf('const visual = (')
    const promptAt = row.indexOf('const prompt = (')
    const stripAt = row.indexOf('<ShotReferenceStrip')
    expect(visualAt).toBeGreaterThan(-1)
    expect(stripAt).toBeGreaterThan(visualAt)
    expect(stripAt).toBeLessThan(promptAt)
    expect(row.indexOf('<ShotReferenceStrip', promptAt)).toBe(-1)
  })

  it('旧的参考列 / 让位表 / 宽窄参考列整套已删，不许复活', () => {
    for (const gone of [
      'ShotReferenceZone.tsx', 'ShotReferenceSlotPopover.tsx', 'shotReferenceStackGeometry.ts',
      'composerBarModel.ts', 'composerBarGeometry.ts',
    ]) expect(exists(`src/workbench/creation/storyboard/shotRow/${gone}`)).toBe(false)
  })

  it('分镜行任何一层都不点名供应商 / 模型（按档案声明渲染）', () => {
    for (const source of [row, strip, composerBar, composerParams]) {
      expect(source).not.toMatch(/\bseedance(?:[-\d.]|\b)/i)
      expect(source).not.toMatch(/\bveo(?:[-\d.]|\b)/i)
    }
  })
})

describe('分镜行：对齐（预览框全表同一只、「生成」每行同一位置）', () => {
  it('行网格只有一个 owner（RowShell），镜头行与参考卡共用', () => {
    expect(row).toContain('<StoryboardRowShell')
    expect(row).not.toContain('grid-cols-[')
    expect(shell).toContain('data-storyboard-visual-column')
    expect(shell).toContain('data-storyboard-content-column')
  })

  it('预览框由整张表 derive（tableFrameMediaBox），行和画面格不按自己的画幅算框', () => {
    expect(frame).toContain("from './shotFrameGeometry'")
    expect(frame).not.toContain('frameMediaBox(')
    expect(row).not.toContain('frameMediaBox(')
    const table = stripComments(read('src/workbench/creation/storyboard/StoryboardShotTable.tsx'))
    expect(table).toContain('tableFrameMediaBox')
    // 单镜画幅 ≠ 框：在框里完整显示（contain），不拉伸不裁切。
    expect(frame).toContain('object-contain')
    expect(frame).not.toContain('object-cover')
  })

  it('画面格里只有一颗「生成」的家——底栏右端（不再在框里放一颗重复的）', () => {
    expect(frame).not.toContain("t('storyboardEditor.frame.generate')")
    expect(composerBar).toContain('ml-auto')
    expect(composerBar).toContain('data-storyboard-generate-state')
  })

  it('底栏永远一行', () => {
    expect(composerBar).toContain('flex-nowrap')
    expect(composerBar).not.toMatch(/grid-cols-\[/)
  })

  it('动作条在图下方常驻，不是压在图上的悬停浮层（设计系统 §1.5.3 反例）', () => {
    expect(frame).not.toContain('group-hover/frame:grid')
    const actions = stripComments(read('src/workbench/creation/storyboard/shotRow/StoryboardFrameActions.tsx'))
    expect(actions).toContain('data-storyboard-actbar')
    expect(actions).not.toContain('absolute inset-0')
  })
})
