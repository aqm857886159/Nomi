import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { WINDOWS_WINDOWBAR_HEIGHT, fullscreenOverlayTopOffset, workbenchFloatingTopOffset } from './windowChrome'

const read = (relativePath: string): string => readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), 'utf8')

describe('workbench floating surface top offset', () => {
  it('leaves the Windows self-drawn windowbar and app bar clear', () => {
    expect(workbenchFloatingTopOffset('win32')).toBe(96)
    expect(workbenchFloatingTopOffset('win32', 12)).toBe(100)
  })

  it('keeps the existing topbar baseline on native-chrome platforms', () => {
    expect(workbenchFloatingTopOffset('darwin')).toBe(64)
    expect(workbenchFloatingTopOffset(undefined, 12)).toBe(68)
  })

  it('keeps drag semantics on the dedicated windowbar and routes top floating surfaces through one offset', () => {
    const appBar = read('./NomiAppBar.tsx')
    expect(appBar).not.toContain("isWindows && 'app-drag'")
    expect(appBar).not.toContain('handleWindowTitlebarDoubleClick')

    for (const source of [
      read('../../NomiAppProviders.tsx'),
      read('../../workbench/taskCenter/TaskCenterPanel.tsx'),
      read('../../workbench/onboarding/OnboardingChecklist.tsx'),
    ]) {
      expect(source).toContain('currentWorkbenchFloatingTopOffset')
    }
  })
})

// issue #58（Windows v0.19.0）：Portal 浮卡右上角的 × 点中心没反应，偏上下才灵。
// 根因是 Windows frame:false + 自绘窗口栏，拖拽区靠 -webkit-app-region 命中测试划出来，
// 而命中测试**看几何、不看 DOM 层级**：Portal 到 body 的浮层不是窗口栏的后代，
// 拿不到窗口栏内那条 `.app-drag button` 豁免，压在拖拽带上的按钮点击就被系统当成拖窗口吃掉。
const PORTAL_FLOATING_SURFACES = [
  ['任务中心浮卡', '../../workbench/taskCenter/TaskCenterPanel.tsx'],
] as const

describe('Portal 浮层不被 Windows 拖拽区吃掉点击（issue #58）', () => {
  it.each(PORTAL_FLOATING_SURFACES)('%s 整体退出拖拽区', (_name, file) => {
    // 挂在根上即可：tailwind 的 `.app-no-drag *` 覆盖全部后代，关闭按钮不必单独标。
    expect(read(file)).toContain('app-no-drag')
  })

  it.each(PORTAL_FLOATING_SURFACES)('%s 的顶部偏移在渲染时现算，不在模块作用域定死', (_name, file) => {
    // 模块常量在 import 求值那一刻定死：那时若 window.nomiDesktop 还没挂上，platform 是
    // undefined → 悄悄回落成 mac 的 64px，Windows 上整张浮卡上移 32px 贴进窗口栏。
    // 这类「拿运行时输入却在模块作用域算一次」的写法，别处再犯也会以同样方式静默错位。
    expect(read(file)).not.toMatch(/^const\s+TOP_OFFSET\s*=/m)
  })
})

// 2026-09-04（导演台）：整条顶部工具栏一个按钮都点不动，且最小化/最大化/关闭够不着。
// 与 issue #58 同根、同机制，只是换了一族入口：Windows frame:false 下那条 32px 自绘窗口栏
// 是系统级拖拽带，命中测试**看几何、不看 DOM 层级**——盖在它上面的全屏浮层，顶部一条的点击
// 被系统当成拖窗口吃掉，同时把唯一那份窗口控件埋在下面。#58 当时只把浮卡标了 app-no-drag，
// 没扫这一族「铺满整窗、自带顶部操作行」的浮层，于是同一个洞从导演台又回来了。
// 类不变量：全屏浮层不覆盖窗口栏——顶偏移由 windowChrome 单口给出，各浮层不得自己写 32。
const FULLSCREEN_OVERLAYS = [
  ['导演台全屏壳', '../../workbench/generationCanvas/nodes/director/DirectorEditor.tsx'],
  ['白板全屏壳', '../../workbench/generationCanvas/nodes/whiteboard/WhiteboardModal.tsx'],
  ['ComfyUI 工作流设置整页', '../../ui/onboarding/workflowPage/ComfyuiWorkflowSettingsPage.tsx'],
  ['全景查看器', '../../workbench/generationCanvas/nodes/PanoramaViewer.tsx'],
  ['素材预览', '../../workbench/assets/AssetPreviewDialog.tsx'],
] as const

describe('全屏浮层不盖住 Windows 自绘窗口栏（导演台顶栏点不动）', () => {
  it('窗口栏高度是全屏浮层顶偏移的唯一来源', () => {
    expect(fullscreenOverlayTopOffset('win32')).toBe(WINDOWS_WINDOWBAR_HEIGHT)
    expect(fullscreenOverlayTopOffset('darwin')).toBe(0)
    expect(fullscreenOverlayTopOffset(undefined)).toBe(0)
  })

  it.each(FULLSCREEN_OVERLAYS)('%s 让开窗口栏而不是 inset-0 铺满', (_name, file) => {
    const source = read(file)
    expect(source).toContain('currentFullscreenOverlayTopOffset')
    expect(source).not.toContain('fixed inset-0')
  })

  it.each(FULLSCREEN_OVERLAYS)('%s 的顶偏移在渲染时现算，不在模块作用域定死', (_name, file) => {
    // 同 #58 的第二个坑：模块常量在 import 那一刻求值，那时 window.nomiDesktop 可能还没挂上，
    // platform 读成 undefined → 悄悄回落成 0，Windows 上又贴回拖拽带。
    expect(read(file)).not.toMatch(/^const\s+[A-Z_]+\s*=\s*currentFullscreenOverlayTopOffset/m)
  })
})
