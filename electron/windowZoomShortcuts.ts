import type { Input, WebContents } from 'electron'

export type WindowZoomShortcut = 'in' | 'out' | 'reset' | null

export function resolveWindowZoomShortcut(
  input: Pick<Input, 'type' | 'key' | 'code' | 'control' | 'meta' | 'alt'>,
): WindowZoomShortcut {
  if (input.type !== 'keyDown' || (!input.control && !input.meta) || input.alt) return null
  if (input.code === 'Digit0' || input.code === 'Numpad0' || input.key === '0') return 'reset'
  if (input.code === 'Equal' || input.code === 'NumpadAdd' || input.key === '+' || input.key === '=') return 'in'
  if (input.code === 'Minus' || input.code === 'NumpadSubtract' || input.key === '-' || input.key === '_') return 'out'
  return null
}

/** 拦截 Chromium 整页缩放：+/- 转发给画布，Ctrl/Cmd+0 保留为应用 100% 恢复保险。 */
export function installWindowZoomShortcuts(contents: WebContents): void {
  // Chromium 会按 origin 记住上次页面缩放；窗口首次加载强制回 100%，避免用户卡在极小界面。
  contents.once('did-finish-load', () => contents.setZoomLevel(0))
  contents.on('before-input-event', (event, input) => {
    const shortcut = resolveWindowZoomShortcut(input)
    if (!shortcut) return
    event.preventDefault()
    if (shortcut === 'reset') {
      contents.setZoomLevel(0)
      return
    }
    contents.send('nomi:canvas:zoom-shortcut', shortcut === 'in' ? 1 : -1)
  })
}
