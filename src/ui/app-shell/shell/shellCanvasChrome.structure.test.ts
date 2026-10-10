import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// 拍板稿 Main 板对账（2026-10-10 用户看真 App 指出三处没对齐）的结构钉子：
// ① 加节点条在内容区底部正中的横排；② 缩放簇是「⛶ | − 100% + | ⋯」；③ 顶栏分段按整窗居中、视图切换槽不参与居中。
// 真实几何（中心偏差 ≤ 1px、横排同一行、⋯ 里一个不丢）由 tests/ux/shell-redesign.walk.mjs 的 check-canvas-chrome 段在真 Electron 里量，这里只钉写法，防回潮。
const stripComments = (text: string): string => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
const source = (relative: string): string => stripComments(readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8'))

describe('外壳 / 画布底部与拍板稿 Main 板对齐', () => {
  it('加节点条：内容区底部正中的横排，不是左缘竖排', () => {
    const toolbar = source('../../../workbench/generationCanvas/components/CanvasToolbar.tsx')
    expect(toolbar).toContain('left-1/2')
    expect(toolbar).toContain('-translate-x-1/2')
    expect(toolbar).toContain("'bottom-4'")
    expect(toolbar).not.toMatch(/top-1\/2 left-4/)
    expect(toolbar).not.toContain('flex-col')
    // 常驻位与「+」的分法仍然来自意图表，不在这里另抄一份
    expect(toolbar).toContain('canvasResidentAddIntents(preference)')
    expect(toolbar).toContain('CanvasMoreAddMenu')
  })

  it('缩放簇：⛶ | − 100% + | ⋯，其余控件收进 ⋯ 的浮层一个不丢', () => {
    const stack = source('../../../workbench/generationCanvas/components/CanvasNavigationStack.tsx')
    const options = source('../../../workbench/generationCanvas/components/CanvasViewOptionsPopover.tsx')
    expect(stack.match(/<CanvasNavigationTooltipButton/g)).toHaveLength(4)
    expect(stack).toContain('data-canvas-zoom-percent')
    expect(stack).toContain('<CanvasViewOptionsPopover')
    expect(stack).not.toContain('type="range"')
    for (const option of ['reset-view', 'frame-tool', 'tidy', 'minimap', 'controls-help']) expect(options).toContain(`data-view-option="${option}"`)
    expect(options).toContain('type="range"')
  })

  it('顶栏：分段按整个窗口居中（绝对定位 left-1/2），视图切换槽挂在分段右边、绝对定位不占位', () => {
    const bar = source('./ShellTopBar.tsx')
    expect(bar).toContain('data-shell-stage-center')
    expect(bar).toMatch(/absolute left-1\/2 top-0 flex h-full -translate-x-1\/2/)
    expect(bar).toMatch(/data-shell-view-switcher-slot/)
    expect(bar).toMatch(/absolute left-full top-1\/2/)
    // 不能回到「三列 grid 中间列居中」——那是在左右两簇之间的剩余空间里居中
    expect(bar).not.toMatch(/grid-cols-\[minmax\(0,1fr\)_auto_minmax\(0,1fr\)\]/)
  })
})
