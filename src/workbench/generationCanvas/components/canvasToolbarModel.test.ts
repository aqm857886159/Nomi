import fs from 'node:fs'
import { describe, expect, it } from 'vitest'
import { GENERATION_NODE_PLUGIN_BY_KIND } from '../nodes/registry'
import {
  CANVAS_ADD_SECTIONS,
  canvasAddIntents,
  canvasFullAddSections,
  canvasMoreAddSections,
  canvasResidentAddIntents,
  canvasToolbarNodeKinds,
} from './canvasToolbarModel'

/** 派生节点：agent / 分镜流程 / 导入的产物，用户不会「先建一个空的」。加号里不许出现它们。 */
const DERIVED_KINDS = ['character', 'scene', 'keyframe', 'shot', 'output', 'asset'] as const

describe('canvas add-intent model（2026-09-10 拍板：文本回常驻 → 6 常驻 + 更多）', () => {
  it('常驻恰好 6 个，顺序是 图片/视频/声音/文字/剪辑/导入', () => {
    expect(canvasResidentAddIntents().map((intent) => intent.id)).toEqual([
      'image',
      'video',
      'audio',
      'text',
      'clip',
      'import-file',
    ])
  })

  it('「更多」里恰好 4 个（空间·草图），一段带名字', () => {
    const sections = canvasMoreAddSections()
    expect(sections.flatMap((section) => section.intents).map((intent) => intent.id)).toEqual([
      'director',
      'model3d',
      'panorama',
      'whiteboard',
    ])
    expect(sections.map((section) => [section.id, section.labelKey])).toEqual([
      ['space', 'canvas.addSections.space'],
    ])
  })

  it('右键菜单列全三段，每段都有名字，顺序与左缘一致', () => {
    const sections = canvasFullAddSections()
    expect(sections.map((section) => [section.id, section.labelKey])).toEqual([
      ['generate', 'canvas.addSections.generate'],
      ['import', 'canvas.addSections.import'],
      ['space', 'canvas.addSections.space'],
    ])
    expect(sections.flatMap((section) => section.intents).map((intent) => intent.id)).toEqual([
      'image',
      'video',
      'audio',
      'text',
      'clip',
      'import-file',
      'director',
      'model3d',
      'panorama',
      'whiteboard',
    ])
    // 段名齐了才算「分段有名字」——空 labelKey 会在界面上渲染成一条没头没脑的分隔。
    for (const section of sections) expect(section.labelKey).not.toBe('')
  })

  it('每个意图只出现一次（常驻与更多不重复、两个菜单不分叉）', () => {
    const ids = canvasAddIntents().map((intent) => intent.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids).toHaveLength(10)
    const kinds = canvasToolbarNodeKinds()
    expect(new Set(kinds).size).toBe(kinds.length)
    expect(kinds).toHaveLength(9)
  })

  it('表里每一种节点都是 quickAdd 的（剪辑仍在其中）', () => {
    for (const kind of canvasToolbarNodeKinds()) {
      expect(GENERATION_NODE_PLUGIN_BY_KIND[kind].quickAdd, `${kind} 必须可手动新建`).not.toBe(false)
    }
    expect(GENERATION_NODE_PLUGIN_BY_KIND.clip.quickAdd).toBe(true)
  })

  it('派生种类一个都不进菜单', () => {
    const ids = new Set<string>(canvasAddIntents().map((intent) => intent.id))
    for (const kind of DERIVED_KINDS) expect(ids.has(kind), `${kind} 是派生节点，不该出现在加号里`).toBe(false)
  })

  it('导入是唯一一个不建生成节点的意图', () => {
    const everyIntent = CANVAS_ADD_SECTIONS.flatMap((section) => [...section.intents])
    const nonNode = everyIntent.filter((intent) => intent.kind === null)
    expect(nonNode.map((intent) => intent.id)).toEqual(['import-file'])
  })
})

describe('「更多」hover 开合的结构不变量（2026-09-11 走查根因的棘轮）', () => {
  // 走查（tests/ux/pr720-ux-geometry.walk.mjs 的 #5）才是真证明：它真的把指针斜着挪进菜单。
  // 这里只钉住那个根因——**收起判据不许再挂在那颗 32×32 的按钮上**。菜单向上高出按钮 130+px，
  // 挂在按钮上就等于「指针一离开按钮那条横带就关」，用户斜着奔顶部那一项永远点不到。
  const source = fs.readFileSync(new URL('./CanvasToolbar.tsx', import.meta.url), 'utf8')

  it('收起挂在整条工具条上，8px before 伪元素桥已删（P1 不留两套）', () => {
    expect(source).not.toContain('before:-left-2')
    // 工具条根节点（带 generation-canvas-v2-toolbar 类的那一层）自己带 onPointerLeave。
    const railBlock = source.slice(source.indexOf("'generation-canvas-v2-toolbar',"), source.indexOf('<TooltipProvider'))
    expect(railBlock).toContain('onPointerLeave')
    expect(railBlock).toContain('onPointerEnter')
    // 按钮那一层只许管「开」：它的 pointerleave 只清展开计时器，不 setMoreOpen(false)。
    const buttonWrapper = source.slice(source.indexOf('onPointerLeave={clearOpenTimer}') - 600,
      source.indexOf('onPointerLeave={clearOpenTimer}') + 40)
    expect(buttonWrapper).toContain('onPointerLeave={clearOpenTimer}')
    expect(buttonWrapper).not.toContain('setMoreOpen(false)')
  })

  it('间隙桥沿菜单全高，不是只补按钮那条横带', () => {
    expect(source).toContain('data-canvas-more-hover-bridge="true"')
    const bridge = source.slice(source.indexOf('data-canvas-more-hover-bridge') - 200,
      source.indexOf('data-canvas-more-hover-bridge'))
    // 桥是菜单的**父层**（高度天然等于菜单高度），左侧只补按钮右沿到菜单左沿那 8px。
    expect(bridge).toContain('left-full')
    expect(bridge).toContain('pl-2')
  })
})
