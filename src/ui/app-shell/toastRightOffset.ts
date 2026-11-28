import React from 'react'
import { notificationsStore } from '@mantine/notifications'
import { SHELL_GUTTER } from './shellGeometry'
import { ASSISTANT_PANE_GUTTER } from '../../workbench/assistantWidthBounds'
import { EDITING_PANEL_DEFAULTS } from '../../workbench/preview/panelLayout'

/**
 * 全局右上 Toast 避让常驻 Agent 停靠栏的几何契约（唯一出处，与同目录 windowChrome.ts 顶偏移并列）。
 *
 * 停靠栏的真实宽度会随用户拖拽（300–600px）、窗口窄到 1060–1280px 时 CSS Grid 让位、
 * 以及生成页弹簧动画变化；硬写死一个像素数会在拖宽时重新盖住 Agent 顶栏、或在窄窗时偏移过多。
 * 因此容器走纯 CSS `:has([data-shell-agent-layer][data-agent-form=dock])` 兜底（默认宽度源自
 * `EDITING_PANEL_DEFAULTS.assistantWidth + ASSISTANT_PANE_GUTTER + SHELL_GUTTER`），同时仅在
 * 屏上真有通知时量取当前可见停靠栏到窗口右沿的距离写进 `--nomi-agent-dock-inset`——
 * 没有通知时零观察器、零常驻开销。
 */
export const AGENT_DOCK_INSET_CSS_VAR = '--nomi-agent-dock-inset'
export const AGENT_DOCK_INSET_DEFAULT_CSS_VAR = '--nomi-agent-dock-inset-default'

/** 默认停靠栏占据的右缘距离 = 默认面板宽（390）+ 停靠栏左缝（8）+ 外壳右缝（8）。 */
export const DEFAULT_AGENT_DOCK_RIGHT_INSET =
  EDITING_PANEL_DEFAULTS.assistantWidth + ASSISTANT_PANE_GUTTER + SHELL_GUTTER

function hasVisibleBox(element: HTMLElement): boolean {
  const rect = element.getBoundingClientRect()
  return rect.width > 0 && rect.height > 0
}

/**
 * 找出此刻唯一可见的常驻 Agent 停靠栏（多个工作区并存时非当前工作区 `hidden`，不量到隐藏那份）。
 * 仅在外壳显式处于 `dock` 形态时返回；收起 / 浮窗 / 未挂载（如项目库）一律返回 null。
 */
export function findActiveDockedAgentPane(doc: Document): HTMLElement | null {
  const layer = doc.querySelector('[data-shell-agent-layer]')
  if (!layer || layer.getAttribute('data-agent-form') !== 'dock') return null

  const resident = doc.querySelector<HTMLElement>('#project-agent-resident')
  const residentPane = resident?.closest<HTMLElement>('[data-assistant-pane="true"]')
  if (residentPane && hasVisibleBox(residentPane)) return residentPane

  const portalPane = doc.querySelector<HTMLElement>('[data-agent-portal="true"]')?.closest<HTMLElement>('[data-assistant-pane="true"]')
  if (portalPane && hasVisibleBox(portalPane)) return portalPane

  for (const pane of Array.from(doc.querySelectorAll<HTMLElement>('[data-assistant-pane="true"]'))) {
    if (hasVisibleBox(pane)) return pane
  }
  return null
}

/** 量取当前停靠栏左沿到窗口右沿的像素距离（含停靠栏左缝与外壳右缝）；不可见或未停靠返回 null。 */
export function measureDockedAgentRightInset(doc: Document, viewportWidth: number): number | null {
  if (!Number.isFinite(viewportWidth) || viewportWidth <= 0) return null
  const pane = findActiveDockedAgentPane(doc)
  if (!pane) return null
  const rect = pane.getBoundingClientRect()
  if (rect.width <= 0 || rect.height <= 0) return null
  const inset = Math.ceil(viewportWidth - rect.left)
  return inset > 0 ? inset : null
}

/** 把实测的停靠栏右缘距离同步到 `:root`，未停靠或不可见时清除（回退到纯 CSS 默认值或 0）。 */
export function syncDockedAgentRightInset(doc: Document, viewportWidth: number): HTMLElement | null {
  const pane = findActiveDockedAgentPane(doc)
  const inset = pane ? measureDockedAgentRightInset(doc, viewportWidth) : null
  if (inset !== null) {
    doc.documentElement.style.setProperty(AGENT_DOCK_INSET_CSS_VAR, `${inset}px`)
    return pane
  }
  doc.documentElement.style.removeProperty(AGENT_DOCK_INSET_CSS_VAR)
  return null
}

function hasActiveNotifications(): boolean {
  const state = notificationsStore.getState()
  return state.notifications.length > 0 || state.queue.length > 0
}

/**
 * 仅在有右上通知显示时跟踪常驻 Agent 停靠栏的实时宽度（拖拽调宽、窗口缩放、弹簧展开、切换工作区），
 * 通知清空后立即断开所有观察器，确保空闲与画布拖拽期间零额外监听。
 */
export function useDockedAgentRightInset(): void {
  React.useEffect(() => {
    if (typeof window === 'undefined' || typeof document === 'undefined') return undefined

    let active = false
    let observedPane: HTMLElement | null = null
    let observedLayer: Element | null = null
    let resizeObserver: ResizeObserver | null = null
    let formObserver: MutationObserver | null = null
    let rafId: number | null = null

    const clearRaf = () => {
      if (rafId !== null) {
        window.cancelAnimationFrame(rafId)
        rafId = null
      }
    }

    const bindObservers = (pane: HTMLElement | null) => {
      if (typeof ResizeObserver !== 'undefined') {
        if (!resizeObserver) {
          resizeObserver = new ResizeObserver(() => { refresh() })
        }
        if (observedPane !== pane) {
          resizeObserver.disconnect()
          observedPane = pane
          if (pane) resizeObserver.observe(pane)
        }
      }

      if (typeof MutationObserver !== 'undefined') {
        const layer = document.querySelector('[data-shell-agent-layer]')
        if (observedLayer !== layer) {
          formObserver?.disconnect()
          observedLayer = layer
          if (layer) {
            if (!formObserver) {
              formObserver = new MutationObserver(() => {
                refresh()
                clearRaf()
                rafId = window.requestAnimationFrame(() => {
                  rafId = null
                  refresh()
                })
              })
            }
            formObserver.observe(layer, { attributes: true, attributeFilter: ['data-agent-form'] })
          }
        }
      }
    }

    const refresh = () => {
      if (!active) return
      const pane = syncDockedAgentRightInset(document, window.innerWidth)
      bindObservers(pane)
    }

    const start = () => {
      if (active) {
        refresh()
        return
      }
      active = true
      window.addEventListener('resize', refresh)
      refresh()
    }

    const stop = () => {
      if (!active) return
      active = false
      clearRaf()
      window.removeEventListener('resize', refresh)
      resizeObserver?.disconnect()
      resizeObserver = null
      observedPane = null
      formObserver?.disconnect()
      formObserver = null
      observedLayer = null
      document.documentElement.style.removeProperty(AGENT_DOCK_INSET_CSS_VAR)
    }

    const reconcile = () => {
      if (hasActiveNotifications()) start()
      else stop()
    }

    reconcile()
    const unsubscribe = notificationsStore.subscribe(reconcile)
    return () => {
      unsubscribe()
      stop()
    }
  }, [])
}
