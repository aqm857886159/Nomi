// 一个分镜镜头只有一个名字（2026-10-08 用户：「只留分镜里的号」）：项目里有两份分镜时，
// 画布、列表、Agent、时间轴都叫它「<分镜名> · 镜 03」；全局 shotIndex（「镜头 7」）哪一处都不再露给人或模型。
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import i18n from '../../../i18n'
import type { GenerationCanvasNode } from '../../generationCanvas/model/generationCanvasTypes'
import type { StoryboardDesign } from '../../workbenchTypes'
import { useWorkbenchStore } from '../../workbenchStore'
import { projectCanvasRead } from '../../../../electron/shared/agentCapabilities/canvasRead'
import { formatCanvasForAgent } from '../../../../electron/shared/agentCapabilities/canvasReadCompact'
import { storyboardLabelSourceFromDesigns } from '../../../../electron/shared/canvas/storyboardShotLabel'
import { deriveGenerationList, shotLabel } from './generationListModel'
import { NodeShotLabel } from './CanvasListLinks'
import { timelineClipDisplayName } from './storyboardLabels'

// i18n 实例自己 import react-i18next：mock 工厂里不能再 import 它（循环等待会挂死 worker），改成调用时再取。
const holder = vi.hoisted(() => ({ t: null as null | ((key: string, options?: Record<string, unknown>) => string) }))
vi.mock('react-i18next', async (original) => ({
  ...await original<typeof import('react-i18next')>(),
  useTranslation: () => ({ t: (key: string, options?: Record<string, unknown>) => holder.t!(key, options) }),
}))
holder.t = i18n.t.bind(i18n)
beforeAll(async () => { await i18n.changeLanguage('zh-CN') })

const design = (id: string, title: string, shots: number): StoryboardDesign => ({
  id, documentId: 'doc', title, committed: true, status: 'draft', createdAt: 1, updatedAt: 1, sourceDocumentUpdatedAt: 1,
  plan: { title, anchors: [], shots: Array.from({ length: shots }, (_, index) => ({ shotId: `${id}-s${index + 1}`, index: index + 1, shotKind: 'image', durationSec: 3, anchorIds: [], prompt: `p${index + 1}` })) },
})
const designs = { doc: [design('rain', '雨夜', 3), design('sun', '晴天', 2)] }
// 全局镜号故意和分镜镜序对不上：雨夜第 3 镜在画布上是第 7 个镜头。
const shot: GenerationCanvasNode = {
  id: 'n-rain-3', kind: 'image', title: '镜头 3', prompt: 'p3', position: { x: 0, y: 0 }, status: 'success', categoryId: 'shots', shotIndex: 7,
  meta: { storyboardDesignId: 'rain', shotId: 'rain-s3' },
  result: { id: 'r', type: 'image', url: 'https://example.test/a.png', createdAt: 1 },
} as GenerationCanvasNode

describe('one storyboard shot, one label everywhere (two storyboards in the project)', () => {
  it('canvas: the node shows 「雨夜 · 镜 03」 and never the global 「镜头 7」', () => {
    const server = useWorkbenchStore.getInitialState() as unknown as Record<string, unknown>
    const saved = server.storyboardDesignsByDocumentId
    server.storyboardDesignsByDocumentId = designs
    const html = renderToStaticMarkup(React.createElement(NodeShotLabel, { node: shot, shotIndex: 7, shotRole: 'image' }))
    server.storyboardDesignsByDocumentId = saved
    expect(html).toContain('雨夜 · 镜 03')
    expect(html).not.toContain('镜头 7')
  })

  it('list: the card is 「雨夜 · 镜 03」', () => {
    const model = deriveGenerationList({ nodes: [shot], edges: [], groups: [], designsByDocumentId: designs, imageModelOptions: [], videoModelOptions: [] })
    const card = model.sections[0].cards.find((candidate) => candidate.nodeId === shot.id)!
    expect(shotLabel((key, options) => (key === 'generationList.shotScoped' ? `${options?.storyboard} · 镜 ${options?.index}` : `镜 ${options?.index}`), card)).toBe('雨夜 · 镜 03')
  })

  it('Agent: canvas.read carries the storyboard label and hides shotIndex for storyboard shots', () => {
    const read = projectCanvasRead({ nodes: [shot], edges: [], selectedNodeIds: [], groups: [], storyboards: storyboardLabelSourceFromDesigns(designs) })
    const node = read.nodes[0] as typeof read.nodes[0] & { shotLabel?: string }
    expect(node.shotLabel).toBe('雨夜 · 镜 03')
    expect(node.shotIndex).toBeUndefined()
    const text = formatCanvasForAgent(read)
    expect(text).toContain('雨夜 · 镜 03')
    expect(text).not.toMatch(/镜\s?7\b/)
  })

  it('timeline: the clip of that node is named 「雨夜 · 镜 03」', () => {
    const name = timelineClipDisplayName({ label: '镜头 3', sourceNodeId: shot.id }, shot, storyboardLabelSourceFromDesigns(designs), (key, options) => (key === 'generationList.shotScoped' ? `${options?.storyboard} · 镜 ${options?.index}` : `镜 ${options?.index}`))
    expect(name).toBe('雨夜 · 镜 03')
  })

  it('a project with ONE storyboard drops the storyboard name: 「镜 03」', () => {
    const one = { doc: [design('rain', '雨夜', 3)] }
    const read = projectCanvasRead({ nodes: [shot], edges: [], selectedNodeIds: [], groups: [], storyboards: storyboardLabelSourceFromDesigns(one) })
    expect((read.nodes[0] as { shotLabel?: string }).shotLabel).toBe('镜 03')
  })
})

// 用户定的是「只留分镜号」：没挂在分镜上的节点**不显示镜号**（只显示节点名），不是退回显示全局号。
// 三种负例 × 四个面：没有分镜元数据、元数据错配（分镜 / 镜头都不存在）、时间轴里持久化的旧「镜头 N」文字。
describe('no global shot number on any surface when the node is not on a storyboard', () => {
  const t = (key: string, options?: Record<string, unknown>) => (key === 'generationList.shotScoped' ? `${options?.storyboard} · 镜 ${options?.index}` : `镜 ${options?.index}`)
  const source = storyboardLabelSourceFromDesigns(designs)
  const base = { id: 'plain', kind: 'image', title: '雨棚草图', prompt: 'p', position: { x: 0, y: 0 }, status: 'success', categoryId: 'shots', shotIndex: 7, result: { id: 'r', type: 'image', url: 'https://example.test/a.png', createdAt: 1 } }
  const cases: Array<[string, GenerationCanvasNode]> = [
    ['no storyboard metadata', { ...base } as GenerationCanvasNode],
    ['mismatched metadata (unknown storyboard)', { ...base, meta: { storyboardDesignId: 'gone', shotId: 'rain-s3' } } as GenerationCanvasNode],
    ['mismatched metadata (unknown shot)', { ...base, meta: { storyboardDesignId: 'rain', shotId: 'nope' } } as GenerationCanvasNode],
  ]
  const globalNumber = /镜头\s?7|镜\s?0?7\b|Shot\s?7\b/

  it.each(cases)('canvas: %s → title row has no number', (_name, node) => {
    const server = useWorkbenchStore.getInitialState() as unknown as Record<string, unknown>
    const saved = server.storyboardDesignsByDocumentId
    server.storyboardDesignsByDocumentId = designs
    const html = renderToStaticMarkup(React.createElement(NodeShotLabel, { node, shotRole: 'image' }))
    server.storyboardDesignsByDocumentId = saved
    expect(html).not.toMatch(globalNumber)
    expect(html).not.toContain('data-shot-number')
  })

  it.each(cases)('list: %s → the card is named by the node, not a number', (_name, node) => {
    const model = deriveGenerationList({ nodes: [node], edges: [], groups: [], designsByDocumentId: designs, imageModelOptions: [], videoModelOptions: [] })
    const card = model.sections.flatMap((section) => section.cards).find((candidate) => candidate.nodeId === node.id)!
    expect(card.storyboardShotNumber).toBeNull()
    expect(shotLabel(t, card)).toBe('雨棚草图')
  })

  it.each(cases)('Agent: %s → canvas.read carries no shotIndex and the compact text has no number', (_name, node) => {
    const read = projectCanvasRead({ nodes: [node], edges: [], selectedNodeIds: [], groups: [], storyboards: source })
    expect((read.nodes[0] as { shotIndex?: number }).shotIndex).toBeUndefined()
    expect((read.nodes[0] as { shotLabel?: string }).shotLabel).toBeUndefined()
    expect(formatCanvasForAgent(read)).not.toMatch(globalNumber)
  })

  it.each(cases)('timeline: %s with a persisted old 「镜头 7」 label → only the node name', (_name, node) => {
    expect(timelineClipDisplayName({ label: '镜头 7', sourceNodeId: node.id }, node, source, t)).toBe('雨棚草图')
    const untitled = { ...node, title: '' } as GenerationCanvasNode
    expect(timelineClipDisplayName({ label: '镜头 7', sourceNodeId: node.id }, untitled, source, t)).toBe('')
  })

  it('timeline: the node is gone → the old 「镜头 7」 / 「Shot 7」 text is not shown, an ordinary name is', () => {
    expect(timelineClipDisplayName({ label: '镜头 7', sourceNodeId: 'deleted' }, undefined, source, t)).toBe('')
    expect(timelineClipDisplayName({ label: 'Shot 7', sourceNodeId: 'deleted' }, undefined, source, t)).toBe('')
    expect(timelineClipDisplayName({ label: '雨棚草图', sourceNodeId: 'deleted' }, undefined, source, t)).toBe('雨棚草图')
    expect(timelineClipDisplayName({ label: '导入的配乐' }, undefined, source, t)).toBe('导入的配乐')
  })
})
