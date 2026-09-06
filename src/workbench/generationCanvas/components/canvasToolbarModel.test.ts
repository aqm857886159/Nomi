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

describe('canvas add-intent model（第三档：5 常驻 + 更多）', () => {
  it('常驻恰好 5 个，顺序是 图片/视频/声音/剪辑/导入', () => {
    expect(canvasResidentAddIntents().map((intent) => intent.id)).toEqual([
      'image',
      'video',
      'audio',
      'clip',
      'import-file',
    ])
  })

  it('「更多」里恰好 5 个，分两段带名字：更多 · 空间 · 草图', () => {
    const sections = canvasMoreAddSections()
    expect(sections.flatMap((section) => section.intents).map((intent) => intent.id)).toEqual([
      'text',
      'scene3d',
      'model3d',
      'panorama',
      'whiteboard',
    ])
    expect(sections.map((section) => [section.id, section.labelKey])).toEqual([
      ['generate', 'canvas.addSections.more'],
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
      'clip',
      'text',
      'import-file',
      'scene3d',
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
