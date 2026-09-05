import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (relative: string): string =>
  fs.readFileSync(path.join(process.cwd(), relative), 'utf8')
const stripComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

const row = stripComments(read('src/workbench/creation/storyboard/shotRow/StoryboardShotRow.tsx'))
const zone = stripComments(read('src/workbench/creation/storyboard/shotRow/ShotReferenceZone.tsx'))

describe('分镜行：生成内容只有一个入口', () => {
  it('没有展开按钮、展开组件或台词转场投影', () => {
    expect(fs.existsSync(path.join(process.cwd(), 'src/workbench/creation/storyboard/shotRow/StoryboardShotRowExpand.tsx'))).toBe(false)
    for (const oldPath of ['data-storyboard-subline', 'data-storyboard-expand', 'dialogueWillGenerate', 'shot.dialogue', 'shot.subtitle']) expect(row).not.toContain(oldPath)
  })
})

describe('分镜行：参考区复用画布那套参考槽（不许再造一套）', () => {
  it('行内不自己画槽 tile —— 渲染交给 ShotReferenceZone', () => {
    expect(row).toContain('<ShotReferenceZone')
    expect(row).not.toContain('data-storyboard-ref-tile="named-slot"')
  })

  /**
   * v6 §4.1：参考列的**排布**变了（一个槽一个格、固定单行三格、多张叠放），所以它不再消费画布节点那套
   * `AssetReference`（那份把数组槽的每一张素材摊成一个 tile）。但**选择器不许另造**——上传/素材库/
   * 引用四条入口仍走现役 `AssetPicker` + `AssetPickerPopover`。
   */
  it('选择器复用现役 AssetPicker，不另造一套', () => {
    const popover = stripComments(read('src/workbench/creation/storyboard/shotRow/ShotReferenceSlotPopover.tsx'))
    expect(popover).toContain("from '../../../assets/AssetPicker'")
    expect(popover).toContain("from '../../../assets/AssetPickerPopover'")
    expect(popover).toContain('<AssetPicker')
  })

  it('槽形态由档案 derive（shotReferenceCells），不在渲染层写"哪个模型有哪些槽"', () => {
    expect(zone).toContain("from './shotReferenceCells'")
  })

  it('槽的容量/类型判定不在渲染层就地写，走 shotReferenceSlots 的纯函数', () => {
    expect(zone).toContain("from './shotReferenceSlots'")
    // 供应商名字不该出现在分镜行的任何一层（P4：按声明渲染，不为具体模型写 if）。
    for (const source of [row, zone]) {
      expect(source.toLowerCase()).not.toContain('seedance')
      expect(source.toLowerCase()).not.toContain('veo')
    }
  })
})

describe('分镜行 v6：不许退回 v5 的三处形态（合同 §2.3/§2.4）', () => {
  const frame = stripComments(read('src/workbench/creation/storyboard/shotRow/StoryboardShotFrame.tsx'))
  const composerBar = stripComments(read('src/workbench/creation/storyboard/shotRow/ShotComposerBar.tsx'))

  it('行 grid 的两个固定列宽从几何 derive，且只有一个 owner（锚展开行与镜头行共用同一份解剖）', () => {
    const shell = stripComments(read('src/workbench/creation/storyboard/shotRow/StoryboardRowShell.tsx'))
    expect(shell).toContain('STORYBOARD_ROW_GRID_TEMPLATE')
    expect(shell).toContain('FRAME_COLUMN_WIDTH')
    expect(shell).toContain('REFERENCE_COLUMN_WIDTH')
    // 写死列宽的代价 2026-09-06 见过一次：盒子变了、`200px` 没跟着变，参考列当场横向溢出。
    expect(shell).not.toContain('grid-cols-[')
    expect(row).toContain('<StoryboardRowShell')
    // 行自己不许再写一份 grid——写了就是同一个几何两份定义（R14.1）。
    expect(row).not.toContain('grid-cols-[')
  })

  it('画面格不自己按画幅算盒：盒由整张表 derive，行只收 box（否则混排又不齐）', () => {
    expect(frame).toContain("from './shotFrameGeometry'")
    expect(frame).not.toContain('w-[76px] h-[132px]')
    // 行/格都不许调 frameMediaBox——那是"每行按自己的画幅算"的入口。
    expect(frame).not.toContain('frameMediaBox(')
    expect(row).not.toContain('frameMediaBox(')
    const table = stripComments(read('src/workbench/creation/storyboard/StoryboardShotTable.tsx'))
    expect(table).toContain('tableFrameMediaBox')
    // 盒固定、画面 letterbox 居中：混排时不拉伸也不裁切。
    expect(frame).toContain('object-contain')
    expect(frame).not.toContain('object-cover')
  })

  it('动作条在图下方常驻，不是压在图上的悬停浮层（设计系统 §1.5.3 反例）', () => {
    expect(frame).not.toContain('group-hover/frame:grid')
    const actions = stripComments(read('src/workbench/creation/storyboard/shotRow/StoryboardFrameActions.tsx'))
    expect(actions).toContain('data-storyboard-actbar')
    expect(actions).not.toContain('absolute inset-0')
  })

  it('模型/模式/参数胶囊住 composer 底栏内部，行上沿不再有它们', () => {
    expect(composerBar).toContain('data-storyboard-composer-bar')
    // 底栏必须长在提示词块内部——放回行上沿就是退回 v5 的位置（合同 §7.3 第三条）。
    const promptBlockAt = row.indexOf('data-storyboard-prompt-block')
    const composerBarAt = row.indexOf('<ShotComposerBar')
    expect(promptBlockAt).toBeGreaterThan(-1)
    expect(composerBarAt).toBeGreaterThan(promptBlockAt)
  })

  it('底栏控件从档案 derive，不写"模型 → 控件"的映射表', () => {
    expect(composerBar).toContain("from './composerBarModel'")
    expect(composerBar).toContain('composerBarPlan')
  })

  /**
   * 2026-09-06 返工三（用户逐字）：「参数框为啥那么多？……能不能变成一行、再简洁些，
   * 最右边就是生成。」上一版的解法是"装不下就整表换两行"——把一枚胶囊的溢出换成了全表行高抖动，
   * 而真正的问题是胶囊本来就太多。所以这三条钉死：永远一行、只缩文字、生成钉最右。
   */
  it('底栏永远一行：换行/网格那一整套（含全表断点作用域）已删除，不许复活', () => {
    expect(composerBar).toContain('flex-nowrap')
    expect(composerBar).not.toContain('composerGridLayout')
    expect(composerBar).not.toContain('useComposerGridPlan')
    expect(composerBar).not.toContain('gridTemplateColumns')
    expect(composerBar).not.toMatch(/grid-cols-\[/)
    const table = stripComments(read('src/workbench/creation/storyboard/StoryboardShotTable.tsx'))
    expect(table).not.toContain('ComposerGridScope')
  })

  it('「生成」钉在最右（ml-auto），开关收进行尾 ⋯ 不摆在行上', () => {
    expect(composerBar).toContain('ml-auto')
    expect(composerBar).toContain('data-storyboard-composer-switches')
  })

  it('参考槽用**固定盒**占位（= 扇面全开的包围盒）：按张数动态占位就一槽一个高度', () => {
    expect(zone).toContain('REFERENCE_SLOT_BOX')
    expect(zone).toContain('referenceStackBox')
    expect(zone).not.toContain('referenceSlotHeight')
    expect(zone).not.toContain('referenceSlotWidth')
    // 参考列与画面格共用同一条顶线：垂直居中会让 16:9 的行两列错开（2026-09-06 用户反馈四）。
    expect(zone).not.toContain('justify-center')
    expect(zone).not.toContain('h-14 w-20')
    expect(zone).not.toContain('className="absolute inset-0 overflow-hidden rounded-nomi-sm')
  })
})
