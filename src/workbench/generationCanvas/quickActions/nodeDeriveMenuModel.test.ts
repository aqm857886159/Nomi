// 两侧菜单一个原语、一套置灰 + 原因：右「用这个节点生成」、左「给它加输入」（2026-10-08 拍板 ②）。
import { describe, expect, it, vi } from 'vitest'
import type { WorkbenchMenuNode } from '../../../design/menu'
import type { GenerationCanvasNode } from '../model/generationCanvasTypes'
import { connectionCreateVerdictsForTarget } from '../agent/referenceEdgeCapability'
import { buildNodeAddInputMenuItems, NODE_DERIVE_KINDS } from './nodeDeriveMenuModel'

const t = ((key: string, options?: Record<string, unknown>) => (options ? `${key}:${JSON.stringify(options)}` : key)) as never
const image: GenerationCanvasNode = { id: 'i', kind: 'image', title: 'i', position: { x: 0, y: 0 }, categoryId: 'shots', meta: {} }

type Item = Extract<WorkbenchMenuNode, { id: string; label: string }> & { disabled?: boolean; description?: string }

describe('「给它加输入」 menu items', () => {
  const handlers = { onPick: vi.fn(), onFromAssets: vi.fn(), onPickOnCanvas: vi.fn() }
  const items = buildNodeAddInputMenuItems(connectionCreateVerdictsForTarget(image, NODE_DERIVE_KINDS), image, t, handlers)
  const group = items[0] as { kind: 'group'; label: string; items: Item[] }

  it('titles the group 「给它加输入」 and lists the four kinds in the right-menu order', () => {
    expect(group.label).toBe('generationCommon.quickActions.addInput.title')
    expect(group.items.map((item) => item.id)).toEqual(['add-input-image', 'add-input-video', 'add-input-audio', 'add-input-text'])
  })

  it('greys what this card cannot take, with the shared reason copy on the second line', () => {
    const video = group.items.find((item) => item.id === 'add-input-video')!
    expect(video.disabled).toBe(true)
    expect(video.description).toContain('generationCommon.quickActions.derive.noModelAccepts')
    expect(group.items.find((item) => item.id === 'add-input-image')!.disabled).toBe(false)
  })

  it('ends with a divider, 「从素材库添加…」 and 「在画布上点选」', () => {
    expect(items.slice(1).map((item) => ('id' in item ? item.id : ''))).toEqual(['add-input-sep', 'add-input-assets', 'add-input-pick'])
  })
})
