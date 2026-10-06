import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (relative: string): string => fs.readFileSync(path.join(process.cwd(), relative), 'utf8')
const stripComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

const row = stripComments(read('src/workbench/creation/storyboard/anchorZone/StoryboardAnchorRow.tsx'))
const zone = stripComments(read('src/workbench/creation/storyboard/anchorZone/StoryboardAnchorZone.tsx'))

describe('参考卡区：与镜头行同一套网格与同一套交互', () => {
  it('展开态用镜头行那一份 RowShell，不另画网格', () => {
    expect(row).toContain('<StoryboardRowShell')
    expect(row).not.toContain('grid-cols-[')
  })

  it('参考缩略图复用镜头行那一条（ShotReferenceStrip），不为参考卡另造一份', () => {
    expect(row).toContain('<ShotReferenceStrip')
  })

  it('参数 = 画布同款底栏（StoryboardComposerParams），按模型出全部参数（反馈 #3 #11 / 审计 U2）', () => {
    expect(row).toContain('<StoryboardComposerParams')
    // 旧的「参考卡生成模型」单下拉不许复活。
    expect(row).not.toContain('NomiSelect')
  })

  it('类型 / 出图方式 / 删除收进行首 ⋯（设计系统 WorkbenchMenu），不再常驻一整排按钮', () => {
    expect(row).toContain('<WorkbenchMenu')
    expect(row).not.toContain('ANCHOR_KINDS.map((kind) => {')
  })

  it('预览框几何与镜头行同一份（shotFrameGeometry），参考卡按自己的画幅 contain', () => {
    expect(row).toContain("from '../shotRow/shotFrameGeometry'")
    expect(row).toContain('object-contain')
    expect(row).not.toContain('w-[108px] h-[144px]')
  })

  it('收起态与展开态各有挂点，且只有「全部展开/全部收起」一个开关（不做逐张展开）', () => {
    const strip = stripComments(read('src/workbench/creation/storyboard/anchorZone/StoryboardAnchorStrip.tsx'))
    expect(strip).toContain('data-storyboard-anchor-strip')
    expect(row).toContain('data-storyboard-anchor-row')
    expect(zone).toContain('data-storyboard-anchors-toggle')
  })

  it('区头不再挂一句说明（「生成参考图=锁长相…」随第二套控件一起删）', () => {
    expect(zone).not.toContain('consistencyHint')
  })
})
