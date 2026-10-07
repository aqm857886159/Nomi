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

// 锁的家（2026-09-11 v1.1 拍板）：从生成浮框底栏搬回节点浮条。搬进**外壳**而不是逐条浮条各挂一份，
// 是因为浮条有六条（图片编辑 / 视频抽帧 / 全景 / 下载 / 空节点变体 / 手艺产物）——挂六份就是六个
// 并行版，下一条浮条忘了挂就静默少一把锁。`lockNodeId` 因此是**必填**：`null` 是显式的一档
// （手艺产物浮条挂的不是可锁的生成节点），忘了传是编译错（R28 让编译器拦，别留给走查）。
//
// 这里只断结构（挂没挂、在不在最左、null 时挂不挂）。**锁开/关那两种外观断不了**：
// 锁态由 NodeLockBadge 自己从 store 读，而 renderToStaticMarkup 走的是 zustand 的
// getServerSnapshot（恒等于初始 state），怎么 setState 都渲不出「已锁」——那种绿是假的。
// 已锁形态归真机走查（tests/ux/node-composer-placement.walk.mjs 量 [data-node-lock] 在哪）。
describe('FloatingToolbarShell 的锁', () => {
  it('给了 nodeId 就在浮条最左渲出锁，并用分隔线和后面的动作族分开', () => {
    const html = inCanvas(React.createElement(FloatingToolbarShell, {
      ariaLabel: '节点动作',
      lockNodeId: 'shot-1',
      children: React.createElement(ToolbarDuplicateVariantButton, { nodeId: 'shot-1' }),
    }))
    expect(html).toContain('data-node-lock=')
    expect(html.match(/data-node-lock=/g)).toHaveLength(1)
    // 锁在最左：它出现在第一颗动作按钮（复制变体）之前，中间隔着一根 ToolbarDivider。
    expect(html.indexOf('data-node-lock=')).toBeLessThan(html.indexOf('tabler-icon-copy'))
    expect(html.indexOf('w-px h-5 bg-nomi-line')).toBeGreaterThan(html.indexOf('data-node-lock='))
  })

  it('lockNodeId=null 的浮条一把锁都不挂（手艺产物那一条）', () => {
    const html = inCanvas(React.createElement(FloatingToolbarShell, {
      ariaLabel: '产物动作',
      lockNodeId: null,
      children: React.createElement(ToolbarDuplicateVariantButton, { nodeId: 'shot-1' }),
    }))
    expect(html).not.toContain('data-node-lock')
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
    expect(read('NodeGenerationComposer.tsx')).toContain('useCanvasLiveZoom()')
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
