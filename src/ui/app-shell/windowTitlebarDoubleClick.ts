import type React from 'react'

const TITLEBAR_INTERACTIVE_SELECTOR = [
  '.app-no-drag',
  'button',
  'input',
  'textarea',
  'select',
  'a',
  'label',
  'summary',
  '[role="button"]',
  '[role="toolbar"]',
  '[role="navigation"]',
  '[contenteditable="true"]',
].join(',')

export function handleWindowTitlebarDoubleClick(event: React.MouseEvent<HTMLElement>): void {
  if (event.button !== 0) return
  if (window.nomiDesktop?.platform !== 'win32') return
  const target = event.target
  if (target instanceof Element && target.closest(TITLEBAR_INTERACTIVE_SELECTOR)) return
  event.preventDefault()
  event.stopPropagation()
  void window.nomiDesktop?.window?.maximize?.()
}
