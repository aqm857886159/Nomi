import fs from 'node:fs'
import path from 'node:path'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { ReactFlowProvider } from '@xyflow/react'
import { describe, expect, it, vi } from 'vitest'
import { FloatingToolbarShell, ToolbarDuplicateVariantButton } from './NodeFloatingToolbar'

// 浮条只活在画布里：反向缩放读 React Flow 的 transform，所以外壳必须挂在 ReactFlowProvider 下面。
const inCanvas = (element: React.ReactElement) => renderToStaticMarkup(React.createElement(ReactFlowProvider, null, element))

vi.mock('react-i18next', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-i18next')>()),
  useTranslation: () => ({ t: () => '复制为新变体' }),
}))

describe('ToolbarDuplicateVariantButton', () => {
  it('exposes the shared duplicate-as-variant action as one toolbar button', () => {
    const html = renderToStaticMarkup(React.createElement(ToolbarDuplicateVariantButton, { nodeId: 'shot-1' }))
    expect(html).toContain('<button')
    expect(html).toContain('aria-label="复制为新变体"')
    expect(html).toContain('title="复制为新变体"')
    expect(html.match(/<button/g)).toHaveLength(1)
  })
})

// 节点锁已撤掉：浮条上没有锁按钮，浮条最左就是第一颗动作按钮。
// 这里只断结构；「没有 [data-node-lock]」也由 tests/ux 的浮条走查在真窗口里量。
describe('FloatingToolbarShell', () => {
  it('isolates toolbar gestures from XYFlow native node drag and canvas pan', () => {
    const html = inCanvas(React.createElement(FloatingToolbarShell, {
      ariaLabel: '节点动作', nodeId: null, children: React.createElement('button', { draggable: true }, 'drag'),
    }))
    const shellClass = html.match(/class="([^"]+)"/)?.[1].split(/\s+/)
    expect(shellClass).toContain('nodrag')
    expect(shellClass).toContain('generation-canvas-react-flow__no-pan')
  })

  it('浮条里没有锁按钮，第一颗就是动作按钮，前面没有分隔线', () => {
    const html = inCanvas(React.createElement(FloatingToolbarShell, {
      ariaLabel: '节点动作',
      nodeId: 'shot-1',
      children: React.createElement(ToolbarDuplicateVariantButton, { nodeId: 'shot-1' }),
    }))
    expect(html).not.toContain('data-node-lock')
    expect(html).not.toContain('tabler-icon-lock')
    expect(html.indexOf('w-px h-5 bg-nomi-line')).toBe(-1)
  })
})

// 画布缩放只有一个来源（2026-10-06 #185 整块画布崩）：贴在 DOM 上的是 React Flow 的 transform，
// 按屏幕几何摆放的浮层（节点浮条 / 生成浮框）反向缩放就只能读它。workbenchStore 的 categoryViewports
// 是「记住的视角」——只在手势 / 动画结束时写，中途和屏幕差一截；浮条拿它做测量环，store 1、屏幕 2.1 时就无限更新。
// renderToStaticMarkup 走 zustand 的 getServerSnapshot，渲不出「两个来源不一致」那一刻，所以这一条钉在源码上；
// 那一刻的真机复现是 tests/ux/canvas-toolbar-open-select.walk.mjs --instant。
describe('按屏幕几何摆放的画布浮层只读 React Flow 的缩放', () => {
  const read = (file: string) => fs.readFileSync(path.join(__dirname, file), 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '')
  for (const file of ['NodeFloatingToolbar.tsx', 'NodeGenerationComposer.tsx']) {
    it(`${file} 不读记住的视角`, () => {
      expect(read(file)).not.toContain('categoryViewports')
    })
  }
  it('生成浮框只随缩放变（钉在节点下沿、不量屏幕）：订 useCanvasLiveZoom', () => {
    // 定位锚（图片 / 视频卡与文本加工框共用）住在 composerAnchor.tsx。
    expect(read('composerAnchor.tsx')).toContain('useCanvasLiveZoom()')
  })
  // 浮条要「量屏幕 → 夹进舞台」，屏幕位置随平移也会变：只订缩放的话平移完不重渲、不重量，
  // 贴边时停在旧位置被裁（2026-10-07 CI 画布验收 canvas-card-stack「节点贴左边」box.x=38 < 舞台 60）。
  // 这一条只能钉在源码上（SSR 走 getServerSnapshot 渲不出平移）；真机判据是那条画布验收。
  it('节点浮条订整个视口（平移 + 缩放），平移完会重量', () => {
    const source = read('NodeFloatingToolbar.tsx')
    expect(source).toContain('useViewport()')
    expect(source).not.toContain('useCanvasLiveZoom()')
  })
})
