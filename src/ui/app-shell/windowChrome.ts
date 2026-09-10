/**
 * [INPUT]: 依赖 window.nomiDesktop?.platform（运行时读，判断是不是自绘窗口栏那面）
 * [OUTPUT]: 对外提供 WORKBENCH_TOPBAR_HEIGHT / WINDOWS_WINDOWBAR_HEIGHT、
 *           workbenchFloatingTopOffset / currentWorkbenchFloatingTopOffset（浮卡让开窗口栏 + 应用栏）、
 *           fullscreenOverlayTopOffset / currentFullscreenOverlayTopOffset（全屏浮层让开窗口栏）
 * [POS]: app-shell 的窗口几何单一真相：Windows frame:false 下那条自绘窗口栏占多高、谁必须让开它。
 *        窗口栏是系统级拖拽带（-webkit-app-region 的命中测试看几何不看 DOM 层级），压上去的东西
 *        点击会被当成拖窗口吃掉，所以「让开多少」必须只有一个来源，不许各处自己写 32。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
export const WORKBENCH_TOPBAR_HEIGHT = 56
export const WINDOWS_WINDOWBAR_HEIGHT = 32

export function workbenchFloatingTopOffset(platform: string | undefined, gap = 8): number {
  const windowbarHeight = platform === 'win32' ? WINDOWS_WINDOWBAR_HEIGHT : 0
  return windowbarHeight + WORKBENCH_TOPBAR_HEIGHT + gap
}

export function currentWorkbenchFloatingTopOffset(gap = 8): number {
  const platform = typeof window === 'undefined' ? undefined : window.nomiDesktop?.platform
  return workbenchFloatingTopOffset(platform, gap)
}

/**
 * 全屏浮层（导演台 / 白板 / 整页设置 / 全景 / 素材预览这类铺满整窗的壳）的顶偏移。
 * 只让开窗口栏，不让开应用栏：全屏浮层本就取代应用栏那一层，但**不能**取代窗口栏——
 * 窗口控件（最小化 / 最大化 / 关闭）只有窗口栏那一份，盖住它用户就没法收起或关掉应用了。
 */
export function fullscreenOverlayTopOffset(platform: string | undefined): number {
  return platform === 'win32' ? WINDOWS_WINDOWBAR_HEIGHT : 0
}

export function currentFullscreenOverlayTopOffset(): number {
  const platform = typeof window === 'undefined' ? undefined : window.nomiDesktop?.platform
  return fullscreenOverlayTopOffset(platform)
}
