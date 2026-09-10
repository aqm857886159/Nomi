/**
 * [INPUT]: 无依赖（纯数据 + 纯函数）
 * [OUTPUT]: 对外提供 DirectorHotkeyId / DIRECTOR_HOTKEYS（默认键位单一真相）/ matchesHotkey / formatHotkey
 * [POS]: director/model 的快捷键表：视口、时间轴、全局三个作用域；帮助对话框、注册器、tooltip 都从这里读，
 *        键位固定（app 级自定义不在导演台页面范围内，见 docs/plan/2026-09-02-director-console-v2.md §0.1）。
 *        「meta」在 macOS 是 ⌘、其它平台是 Ctrl；额外的另一平台修饰键不得命中无修饰动作。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

export type DirectorHotkeyScope = 'viewport' | 'timeline' | 'global'

export type DirectorHotkeyBinding = {
  key: string
  meta?: boolean
  shift?: boolean
  alt?: boolean
  scope: DirectorHotkeyScope
}

export const DIRECTOR_HOTKEYS = {
  select: { key: 'Escape', scope: 'global' },
  translate: { key: '1', scope: 'viewport' },
  rotate: { key: '2', scope: 'viewport' },
  scale: { key: '3', scope: 'viewport' },
  drawPencil: { key: '4', scope: 'viewport' },
  waypoint: { key: '5', scope: 'viewport' },
  resetCamera: { key: '0', scope: 'viewport' },
  focusEntity: { key: 'f', scope: 'viewport' },
  insertKeyframe: { key: 'i', scope: 'global' },
  screenshot: { key: 'p', meta: true, shift: true, scope: 'global' },
  captureCamera: { key: 'a', shift: true, scope: 'viewport' },
  recordMotion: { key: 'r', scope: 'viewport' },
  // 骨骼页聚焦时 W / E = IK 平移求解 / FK 旋转欧拉角（此时视口飞行让出这两个键）
  ikMode: { key: 'w', scope: 'viewport' },
  fkMode: { key: 'e', scope: 'viewport' },
  group: { key: 'g', meta: true, scope: 'viewport' },
  ungroup: { key: 'g', meta: true, shift: true, scope: 'viewport' },
  undo: { key: 'z', meta: true, scope: 'global' },
  redo: { key: 'z', meta: true, shift: true, scope: 'global' },
  copy: { key: 'c', meta: true, scope: 'timeline' },
  paste: { key: 'v', meta: true, scope: 'timeline' },
  pasteBackward: { key: 'd', meta: true, scope: 'global' },
  deleteSelection: { key: 'Backspace', scope: 'global' },
  cutLeft: { key: 'q', scope: 'timeline' },
  cutRight: { key: 'w', scope: 'timeline' },
  splitClip: { key: 'b', meta: true, scope: 'timeline' },
  prevFrame: { key: 'ArrowLeft', scope: 'timeline' },
  nextFrame: { key: 'ArrowRight', scope: 'timeline' },
  prev10Frames: { key: 'ArrowLeft', shift: true, scope: 'timeline' },
  next10Frames: { key: 'ArrowRight', shift: true, scope: 'timeline' },
  prevSplitPoint: { key: 'ArrowUp', scope: 'timeline' },
  nextSplitPoint: { key: 'ArrowDown', scope: 'timeline' },
  togglePlay: { key: ' ', scope: 'global' },
} as const satisfies Record<string, DirectorHotkeyBinding>

export type DirectorHotkeyId = keyof typeof DIRECTOR_HOTKEYS

export type HotkeyEventLike = {
  key: string
  metaKey: boolean
  ctrlKey: boolean
  shiftKey: boolean
  altKey: boolean
}

// 是否 macOS（决定 meta 落在 ⌘ 还是 Ctrl）；可注入便于单测
export function isMacPlatform(platform: string = typeof navigator === 'undefined' ? '' : navigator.platform): boolean {
  return /mac/i.test(platform)
}

export function matchesHotkey(event: HotkeyEventLike, binding: DirectorHotkeyBinding, mac: boolean = isMacPlatform()): boolean {
  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key
  if (key !== binding.key) return false
  const metaPressed = mac ? event.metaKey : event.ctrlKey
  if (mac ? event.ctrlKey : event.metaKey) return false
  if (Boolean(binding.meta) !== metaPressed) return false
  if (Boolean(binding.shift) !== event.shiftKey) return false
  if (Boolean(binding.alt) !== event.altKey) return false
  return true
}

// 帮助对话框/tooltip 展示用：⌘⇧P / Ctrl+Shift+P
// 徽标里用短名：顶栏 kbd 只有一格宽，「Escape」会把分段项撑成两倍宽
const KEY_LABELS: Record<string, string> = { ' ': 'Space', Escape: 'Esc', Delete: 'Del', Backspace: '⌫', ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→' }

export function formatHotkey(binding: DirectorHotkeyBinding, mac: boolean = isMacPlatform()): string {
  const keyLabel = KEY_LABELS[binding.key] ?? (binding.key.length === 1 ? binding.key.toUpperCase() : binding.key)
  if (mac) {
    return `${binding.meta ? '⌘' : ''}${binding.alt ? '⌥' : ''}${binding.shift ? '⇧' : ''}${keyLabel}`
  }
  const parts = [binding.meta ? 'Ctrl' : '', binding.alt ? 'Alt' : '', binding.shift ? 'Shift' : '', keyLabel].filter(Boolean)
  return parts.join('+')
}
