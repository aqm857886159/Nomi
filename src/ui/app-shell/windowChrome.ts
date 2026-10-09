/**
 * [INPUT]: 外壳几何（shellGeometry：40px 合一顶栏）
 * [OUTPUT]: workbenchFloatingTopOffset / currentWorkbenchFloatingTopOffset（浮卡让开顶栏）、
 *           fullscreenOverlayTopOffset / currentFullscreenOverlayTopOffset（全屏浮层让开顶栏）
 * [POS]: 「谁必须让开顶栏、让多少」的单一来源。
 *        10-08 外壳重设计起，窗口栏与应用栏合成一条 40px 顶栏，两平台同高：Windows 的原生窗口按钮
 *        （titleBarOverlay）和 macOS 的红绿灯都住在这条栏里，它同时是系统拖拽带——命中测试看几何、
 *        不看 DOM 层级，压上去的东西点击会被当成拖窗口吃掉、也会把窗口按钮埋住。
 *        所以全屏浮层（导演台 / 白板 / 整页设置 / 全景 / 素材预览）一律从顶栏下方开始，各浮层不许自己写数。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { SHELL_TOPBAR_HEIGHT } from './shellGeometry'

/** 浮卡（任务中心、通知）贴顶栏下沿再空 gap。两平台同值。 */
export function workbenchFloatingTopOffset(gap = 8): number {
  return SHELL_TOPBAR_HEIGHT + gap
}

/** 渲染时现算（不在模块作用域定死：#58 那一类「import 那一刻读到的平台不对」的坑）。 */
export function currentWorkbenchFloatingTopOffset(gap = 8): number {
  return workbenchFloatingTopOffset(gap)
}

/**
 * 全屏浮层的顶偏移：只让开顶栏（它同时是窗口栏），浮层本身取代顶栏以下的整块。
 * 窗口控件（Windows 原生三键 / macOS 红绿灯）只有顶栏那一份，盖住它用户就没法收起或关掉应用了。
 */
export function fullscreenOverlayTopOffset(): number {
  return SHELL_TOPBAR_HEIGHT
}

export function currentFullscreenOverlayTopOffset(): number {
  return fullscreenOverlayTopOffset()
}
