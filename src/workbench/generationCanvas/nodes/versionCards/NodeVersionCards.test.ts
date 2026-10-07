import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

vi.mock('react-i18next', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-i18next')>()),
  useTranslation: () => ({ t: (key: string, options?: Record<string, unknown>) => (options && 'n' in options ? `${key}:${options.n}` : key) }),
}))

const { NodeVersionCountBadge, NodeVersionGrid } = await import('./NodeVersionCards')
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

describe('NodeVersionCountBadge · 入口是右上角内侧的数字角标（用户 10-07 拍板）', () => {
  const badge = (props: Partial<Parameters<typeof NodeVersionCountBadge>[0]> = {}): string =>
    renderToStaticMarkup(React.createElement(NodeVersionCountBadge, { count: 4, expanded: false, onToggle: () => undefined, ...props }))

  it('只有 1 版没有角标；2 版以上只写数字——不加图标、不写「版」字', () => {
    expect(badge({ count: 1 })).toBe('')
    const html = badge({ count: 12 })
    expect(/<button[^>]*data-version-badge[^>]*>12<\/button>/.test(html)).toBe(true)
    expect(html).not.toContain('<svg')
  })

  it('钉在图片右上角内侧：不伸出节点（左右正中是连线把手、上方是标题和浮条、下方是提示词框）', () => {
    const button = /<button[^>]*data-version-badge[^>]*>/.exec(badge())?.[0] ?? ''
    expect(button).toContain('right-2')
    expect(button).toContain('top-2')
    expect(button).not.toMatch(/(?:right|left|top|bottom)-\[-|-(?:right|left|top|bottom)-/)
  })

  it('铺开时是按下态、名字换成「收起」；只读画布收着时只显示数字、点不开', () => {
    const closed = /<button[^>]*data-version-badge[^>]*>/.exec(badge())?.[0] ?? ''
    expect(closed).toContain('aria-pressed="false"')
    expect(closed).toContain('aria-label="generationCommon.versionCards.expandAria"')
    const open = /<button[^>]*data-version-badge[^>]*>/.exec(badge({ expanded: true }))?.[0] ?? ''
    expect(open).toContain('aria-pressed="true"')
    expect(open).toContain('aria-label="generationCommon.versionCards.collapseAria"')
    const readOnly = badge({ readOnly: true })
    expect(readOnly).not.toContain('<button')
    expect(readOnly).toContain('data-version-badge')
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
  it('悬停条、视频进度条、数字角标、「+N」都带 nodrag；卡身本身不带（按住拖 = 拖整组）', () => {
    const video = [2, 1].map((versionNo) => ({ identity: `m${versionNo}`, versionNo, type: 'video' as const, previewUrl: `m${versionNo}.png`, url: `m${versionNo}.mp4` }))
    const html = renderToStaticMarkup(React.createElement(NodeVersionGrid, {
      nodeId: 'n1', layout: layoutVersionGrid(versionGridItems(video), NODE, 'right'), node: NODE, primaryIdentity: 'm2', hoveredIdentity: 'm1',
    }))
    expect(/<div role="toolbar"[^>]*class="nodrag /.test(html)).toBe(true)
    expect(/<div class="nodrag [^"]*"[^>]*role="slider"/.test(html)).toBe(true)
    expect(/<button[^>]*aria-label="generationCommon\.versionCards\.previewAria[^>]*>/.exec(html)?.[0]).not.toContain('nodrag')
    const entry = renderToStaticMarkup(React.createElement(NodeVersionCountBadge, { count: 3, expanded: false, onToggle: () => undefined }))
    expect(/<button[^>]*data-version-badge[^>]*>/.exec(entry)?.[0]).toContain('nodrag')
    expect(grid().includes('data-version-card="more"')).toBe(false)
    const many = Array.from({ length: 12 }, (_, index) => ({ identity: `x${12 - index}`, versionNo: 12 - index, type: 'image' as const, previewUrl: 'x.png' }))
    const more = renderToStaticMarkup(React.createElement(NodeVersionGrid, { nodeId: 'n1', layout: layoutVersionGrid(versionGridItems(many), NODE, 'right'), node: NODE, primaryIdentity: 'x12' }))
    expect(/data-version-card="more"><button[^>]*class="nodrag /.test(more)).toBe(true)
  })
})
