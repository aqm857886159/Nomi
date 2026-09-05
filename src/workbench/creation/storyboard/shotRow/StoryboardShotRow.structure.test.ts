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

  it('行 grid 是 14px 136px 200px 1fr，且只有一个 owner（锚展开行与镜头行共用同一份解剖）', () => {
    const shell = stripComments(read('src/workbench/creation/storyboard/shotRow/StoryboardRowShell.tsx'))
    expect(shell).toContain('grid-cols-[14px_136px_200px_minmax(0,1fr)]')
    expect(shell).not.toContain('grid-cols-[14px_84px_136px_minmax(0,1fr)]')
    expect(row).toContain('<StoryboardRowShell')
    // 行自己不许再写一份 grid——写了就是同一个几何两份定义（R14.1）。
    expect(row).not.toContain('grid-cols-[')
  })

  it('画面格不再写死 76×132：媒体框尺寸由 frameMediaBox 按画幅算', () => {
    expect(frame).toContain("from './shotFrameGeometry'")
    expect(frame).not.toContain('w-[76px] h-[132px]')
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
    expect(composerBar).toContain('composerBarParams')
  })
})
