import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { groupFrameLabel, isStoryboardGroup } from './groupFrameLabel'
import { FRAME_MENU_TOOLBAR_DUPLICATES } from './FrameContextMenu'

// 10-10 拍板：框头与分组工具条的组名 / 计数只有一个显示函数；分镜组「分镜 · 名 · N 镜」，普通组「名 · N 个」。
const ZH: Record<string, string> = {
  'generationCommon.canvas.group.storyboardPrefix': '分镜 · ',
  'generationCommon.canvas.group.countShots': '{{count}} 镜',
  'generationCommon.canvas.group.countItems': '{{count}} 个',
  'generationCommon.canvas.group.countPreview': '{{from}} → {{to}}',
}
const t = (key: string, options: Record<string, unknown> = {}): string =>
  Object.entries(options).reduce((text, [name, value]) => text.replaceAll(`{{${name}}}`, String(value)), ZH[key] ?? key)

const here = path.dirname(fileURLToPath(import.meta.url))
const toolbar = fs.readFileSync(path.join(here, 'CanvasGroupToolbar.tsx'), 'utf8')
const toolbarHook = fs.readFileSync(path.join(here, 'useCanvasGroupToolbar.ts'), 'utf8')

describe('group frame label (10-10: 框头与工具条同一显示函数)', () => {
  it('分镜组：标题带「分镜 · 」前缀，计数写「N 镜」；工具条拼成「分镜 · 名 · N 镜」', () => {
    const label = groupFrameLabel(t, { name: '雨夜便利店', storyboard: true, memberCount: 6, previewCount: null })
    expect(label).toEqual({ title: '分镜 · 雨夜便利店', count: '6 镜' })
    expect(`${label.title} · ${label.count}`).toBe('分镜 · 雨夜便利店 · 6 镜')
  })

  it('普通组：标题只有组名，计数写「N 个」；工具条拼成「海蓝组 · 3 个」', () => {
    const label = groupFrameLabel(t, { name: '海蓝组', storyboard: false, memberCount: 3, previewCount: null })
    expect(label).toEqual({ title: '海蓝组', count: '3 个' })
    expect(`${label.title} · ${label.count}`).toBe('海蓝组 · 3 个')
  })

  it('拖动中计数写「from → to」，标题不变', () => {
    const label = groupFrameLabel(t, { name: '雨夜便利店', storyboard: true, memberCount: 6, previewCount: 5 })
    expect(label).toEqual({ title: '分镜 · 雨夜便利店', count: '6 → 5' })
  })

  it('分镜判断只看归属章 materializationOperationId（不靠名字或 categoryId）', () => {
    expect(isStoryboardGroup({ materializationOperationId: 'op-1' })).toBe(true)
    expect(isStoryboardGroup({})).toBe(false)
  })

  it('工具条的组名与计数走这个函数（不另写一份）', () => {
    expect(toolbar).toContain('groupFrameLabel(t, {')
    expect(toolbar).toContain('groupLabel.title')
    expect(toolbar).toContain('groupLabel.count')
    expect(toolbar).not.toContain('<span>{group.name}</span>')
  })
})

describe('工具条「⋯」只留改名 / 折叠 / 删除（10-10 拍板）', () => {
  it('排除清单就是工具条已有的三个动作：生成整组、进时间轴、解组', () => {
    expect([...FRAME_MENU_TOOLBAR_DUPLICATES].sort()).toEqual(['dissolve', 'generate', 'timeline'])
  })

  it('工具条「⋯」传入这份排除清单，且不再复制一份菜单', () => {
    expect(toolbarHook).toContain('FRAME_MENU_TOOLBAR_DUPLICATES')
    expect(toolbar).toContain('onOpenMenu({ x: rect?.right')
  })
})
