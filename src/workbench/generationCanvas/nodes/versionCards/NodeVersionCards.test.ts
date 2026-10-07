import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

vi.mock('react-i18next', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-i18next')>()),
  useTranslation: () => ({ t: (key: string, options?: Record<string, unknown>) => (options && 'n' in options ? `${key}:${options.n}` : key) }),
}))

const { NodeVersionGrid, NodeVersionStackHandle } = await import('./NodeVersionCards')
const { layoutVersionGrid, versionGridItems } = await import('./versionGridLayout')
const { __resetVersionGridCoverageForTests, isLabelCoveredByOtherGrids, publishVersionGridCoverage } = await import('./versionGridCoverage')

const NODE = { width: 240, height: 135 }
const entries = [4, 3, 2, 1].map((versionNo) => ({ identity: `v${versionNo}`, versionNo, type: 'image' as const, previewUrl: `v${versionNo}.png`, url: `v${versionNo}.png` }))

function grid(props: Partial<Parameters<typeof NodeVersionGrid>[0]> = {}): string {
  return renderToStaticMarkup(React.createElement(NodeVersionGrid, {
    nodeId: 'n1',
    layout: layoutVersionGrid(versionGridItems(entries), NODE, 'right'),
    node: NODE,
    primaryIdentity: 'v4',
    ...props,
  }))
}

describe('NodeVersionStackHandle · 入口就是叠卡', () => {
  it('只有 1 版没有入口；2 版一张后卡、3 版以上两张', () => {
    expect(renderToStaticMarkup(React.createElement(NodeVersionStackHandle, { count: 1, expanded: false, onToggle: () => undefined }))).toBe('')
    expect(renderToStaticMarkup(React.createElement(NodeVersionStackHandle, { count: 2, expanded: false, onToggle: () => undefined })).match(/data-version-stack-rear=/g)).toHaveLength(1)
    expect(renderToStaticMarkup(React.createElement(NodeVersionStackHandle, { count: 7, expanded: false, onToggle: () => undefined })).match(/data-version-stack-rear=/g)).toHaveLength(2)
  })

  it('没有常驻的图标和「N 版」角标：数字只在悬停叠卡时出现', () => {
    const resting = renderToStaticMarkup(React.createElement(NodeVersionStackHandle, { count: 4, expanded: false, onToggle: () => undefined }))
    expect(resting).not.toContain('data-version-stack-count')
    const hovered = renderToStaticMarkup(React.createElement(NodeVersionStackHandle, { count: 4, expanded: false, forceHover: true, onToggle: () => undefined }))
    expect(hovered).toContain('data-version-stack-count')
  })

  it('入口只在下沿：不伸出节点左右两侧（那是连线把手的地盘，方案 A）', () => {
    const html = renderToStaticMarkup(React.createElement(NodeVersionStackHandle, { count: 4, expanded: false, onToggle: () => undefined }))
    const button = /<button[^>]*data-version-stack-handle[^>]*>/.exec(html)?.[0] ?? ''
    expect(button).toContain('inset-x-3')
    expect(button).toContain('top-[calc(100%-2px)]')
    expect(button).not.toMatch(/(?:right|left)-\[-/)
  })

  it('媒体示能画在露出的下沿上、只在收着时（反馈 #11）', () => {
    const glyph = React.createElement('svg', { 'data-test-glyph': 'video' })
    expect(renderToStaticMarkup(React.createElement(NodeVersionStackHandle, { count: 4, expanded: false, mediaGlyph: glyph, onToggle: () => undefined })).match(/data-version-stack-glyph/g)).toHaveLength(1)
    expect(renderToStaticMarkup(React.createElement(NodeVersionStackHandle, { count: 4, expanded: true, mediaGlyph: glyph, onToggle: () => undefined }))).not.toContain('data-version-stack-glyph')
  })
})

describe('NodeVersionGrid · 卡就是那张图', () => {
  it('不悬停时一张动作条都没有；主图卡角有「主图」状态标', () => {
    const html = grid()
    expect(html).not.toContain('data-version-card-bar')
    expect(html.match(/data-version-card-primary/g)).toHaveLength(1)
  })

  it('悬停条：「设为主图」是纯文字（✓ 只表示状态），删除在最右', () => {
    const html = grid({ hoveredIdentity: 'v3' })
    const bar = /<div role="toolbar"[^>]*data-version-card-bar[\s\S]*?<\/div>/.exec(html)?.[0] ?? ''
    const actions = [...bar.matchAll(/data-version-action="([^"]+)"/g)].map((match) => match[1])
    expect(actions).toEqual(['set-primary', 'download', 'delete'])
    const setPrimary = /<button[^>]*data-version-action="set-primary"[^>]*>([\s\S]*?)<\/button>/.exec(bar)?.[1] ?? ''
    expect(setPrimary).not.toContain('<svg')
  })

  it('悬停的是主图：没有「设为主图」；只读画布：只剩下载', () => {
    expect(grid({ hoveredIdentity: 'v4' })).not.toContain('data-version-action="set-primary"')
    const readOnly = grid({ hoveredIdentity: 'v3', readOnly: true })
    expect([...readOnly.matchAll(/data-version-action="([^"]+)"/g)].map((match) => match[1])).toEqual(['download'])
  })

  it('只有按着 Alt 时版本卡才可被 HTML5 拖出去（不按 Alt 拖 = 拖整组）', () => {
    expect(grid()).not.toContain('draggable="true"')
    expect(grid({ altHeld: true })).toContain('draggable="true"')
  })
})

describe('versionGridCoverage · 被压住的邻居藏标题', () => {
  it('别的节点铺开的格子压住了标题条才算；自己的格子不算；撤销登记后恢复', () => {
    __resetVersionGridCoverageForTests()
    const layout = layoutVersionGrid(versionGridItems(entries), NODE, 'right')
    publishVersionGridCoverage('owner', { origin: { x: 80, y: 120 }, cells: layout.cells.map((cell) => ({ ...cell, ...NODE })) })
    expect(isLabelCoveredByOtherGrids('neighbour', { x: 440, y: 120, ...NODE })).toBe(true)
    expect(isLabelCoveredByOtherGrids('owner', { x: 440, y: 120, ...NODE })).toBe(false)
    expect(isLabelCoveredByOtherGrids('far', { x: 1400, y: 900, ...NODE })).toBe(false)
    publishVersionGridCoverage('owner', null)
    expect(isLabelCoveredByOtherGrids('neighbour', { x: 440, y: 120, ...NODE })).toBe(false)
  })
})

describe('卡上能点 / 能拖的部件不触发画布内核拖节点', () => {
  // 画布内核拖节点挂的是节点元素上的原生 mousedown，React 的 stopPropagation 截不住，只认 nodrag 类。
  it('悬停条、视频进度条、叠卡入口、「+N」都带 nodrag；卡身本身不带（按住拖 = 拖整组）', () => {
    const video = [2, 1].map((versionNo) => ({ identity: `m${versionNo}`, versionNo, type: 'video' as const, previewUrl: `m${versionNo}.png`, url: `m${versionNo}.mp4` }))
    const html = renderToStaticMarkup(React.createElement(NodeVersionGrid, {
      nodeId: 'n1', layout: layoutVersionGrid(versionGridItems(video), NODE, 'right'), node: NODE, primaryIdentity: 'm2', hoveredIdentity: 'm1',
    }))
    expect(/<div role="toolbar"[^>]*class="nodrag /.test(html)).toBe(true)
    expect(/<div class="nodrag [^"]*"[^>]*role="slider"/.test(html)).toBe(true)
    expect(/<button[^>]*aria-label="generationCommon\.versionCards\.previewAria[^>]*>/.exec(html)?.[0]).not.toContain('nodrag')
    const stack = renderToStaticMarkup(React.createElement(NodeVersionStackHandle, { count: 3, expanded: false, onToggle: () => undefined }))
    expect(/<button[^>]*data-version-stack-handle[^>]*>/.exec(stack)?.[0]).toContain('nodrag')
    expect(grid().includes('data-version-card="more"')).toBe(false)
    const many = Array.from({ length: 12 }, (_, index) => ({ identity: `x${12 - index}`, versionNo: 12 - index, type: 'image' as const, previewUrl: 'x.png' }))
    const more = renderToStaticMarkup(React.createElement(NodeVersionGrid, { nodeId: 'n1', layout: layoutVersionGrid(versionGridItems(many), NODE, 'right'), node: NODE, primaryIdentity: 'x12' }))
    expect(/data-version-card="more"><button[^>]*class="nodrag /.test(more)).toBe(true)
  })
})
