/**
 * 画布滚轮语义二选一（需求 #832，2026-07-31 用户拍板 / 2026-08-03 补齐）。
 *
 * 为什么要开关：两拨人的肌肉记忆是**相反**的，没有一个默认能同时对——
 *   · 鼠标党（群里反复提）：滚轮就该缩放（ComfyUI / 多数节点编辑器）。
 *   · 触控板党：双指滑就该平移（Figma / Miro / tldraw），滚轮全给缩放会让双指滑变成缩放，最别扭。
 * 故 `'wheel-zoom'` 为默认（ComfyUI 习惯优先），`'modifier-zoom'` 留给笔记本 / 触控板用户。
 *
 * **只管滚轮这一个轴**：空白左键拖=平移 / Shift+左键拖=框选 / 空格+左键·中键·右键拖=平移（2026-08-08 语义），
 * 两档共用、不可配——那些手势两拨人都更好，做成可配只会变成两套平行手势世界（违 P1）且逼用户学（违 D1）。
 *
 * 不进 `workbenchStore`：它已 789/800 行（R9 上限）。`useSyncExternalStore` + 模块级 pub/sub
 * 是本仓既有轻量响应式模式（conversationPersistence / useFilmstrip / journeyTourActivity 等）。
 */
import React from 'react'

const CANVAS_GESTURE_SCHEME_KEY = 'nomi.canvasGesture.scheme'

/** `wheel-zoom`＝滚轮缩放（ComfyUI 式，默认）；`modifier-zoom`＝滚轮平移、⌘/Ctrl+滚轮才缩放（Figma 式）。 */
export type CanvasGestureScheme = 'wheel-zoom' | 'modifier-zoom'

export const DEFAULT_CANVAS_GESTURE_SCHEME: CanvasGestureScheme = 'wheel-zoom'

/** 一次滚轮该干嘛。纯函数：hook 测不了（本仓无 @testing-library/react），真值表靠它单测。 */
export function resolveWheelIntent(
  scheme: CanvasGestureScheme,
  event: { ctrlKey: boolean; metaKey: boolean },
): 'zoom' | 'pan' {
  // 捏合（浏览器合成 ctrlKey=true）与 ⌘/Ctrl+滚轮：两档都缩放——这是跨工具的通用约定，
  // 且 modifier-zoom 档下它是唯一的缩放入口，绝不能被 scheme 翻掉。
  if (event.ctrlKey || event.metaKey) return 'zoom'
  return scheme === 'wheel-zoom' ? 'zoom' : 'pan'
}

function readStoredScheme(): CanvasGestureScheme {
  try {
    return globalThis.localStorage?.getItem(CANVAS_GESTURE_SCHEME_KEY) === 'modifier-zoom'
      ? 'modifier-zoom'
      : DEFAULT_CANVAS_GESTURE_SCHEME
  } catch {
    return DEFAULT_CANVAS_GESTURE_SCHEME
  }
}

let currentScheme: CanvasGestureScheme = readStoredScheme()
const listeners = new Set<() => void>()

export function getCanvasGestureScheme(): CanvasGestureScheme {
  return currentScheme
}

export function setCanvasGestureScheme(scheme: CanvasGestureScheme): void {
  if (scheme === currentScheme) return
  currentScheme = scheme
  try {
    globalThis.localStorage?.setItem(CANVAS_GESTURE_SCHEME_KEY, scheme)
  } catch {
    /* 私有模式等存不了 → 只作用本次会话 */
  }
  for (const listener of listeners) listener()
}

export function subscribeCanvasGestureScheme(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** 订阅式读取：设置页改完，画布当场换语义，不用重开。 */
export function useCanvasGestureScheme(): CanvasGestureScheme {
  return React.useSyncExternalStore(subscribeCanvasGestureScheme, getCanvasGestureScheme, getCanvasGestureScheme)
}

/** 仅测试用：把模块级缓存拉回落盘值，避免用例之间串状态。 */
export function __resetCanvasGestureSchemeForTest(): void {
  currentScheme = readStoredScheme()
  listeners.clear()
}
