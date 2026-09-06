import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (relative: string): string => fs.readFileSync(path.join(process.cwd(), relative), 'utf8')
const stripComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

const row = stripComments(read('src/workbench/creation/storyboard/anchorZone/StoryboardAnchorRow.tsx'))
const zone = stripComments(read('src/workbench/creation/storyboard/anchorZone/StoryboardAnchorZone.tsx'))

describe('锚区 v6：两态 + 与镜头行同解剖（合同 §2.2）', () => {
  it('展开态用的是镜头行那一份 RowShell，不是另画一套网格', () => {
    expect(row).toContain('<StoryboardRowShell')
    expect(row).not.toContain('grid-cols-[')
  })

  it('展开态的参考列复用 ShotReferenceZone（同一套槽解剖，不为锚另造一份）', () => {
    expect(row).toContain('<ShotReferenceZone')
  })

  it('画面格几何与镜头行同一份（frameMediaBox），不写死 108×144', () => {
    expect(row).toContain("from '../shotRow/shotFrameGeometry'")
    expect(row).not.toContain('w-[108px] h-[144px]')
  })

  it('收起态与展开态各有挂点，且只有「全部展开/全部收起」一个开关（不做逐张展开）', () => {
    const strip = stripComments(read('src/workbench/creation/storyboard/anchorZone/StoryboardAnchorStrip.tsx'))
    expect(strip).toContain('data-storyboard-anchor-strip')
    expect(row).toContain('data-storyboard-anchor-row')
    expect(zone).toContain('data-storyboard-anchors-toggle')
  })

  it('模型缺失仍用共享的 warning token（沿用 v5 已拍板的这条）', () => {
    expect(row).toContain('data-anchor-model-empty="true"')
    expect(row).not.toContain(['text-workbench', 'warning'].join('-'))
  })
})
