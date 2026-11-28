// @vitest-environment jsdom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { notifications } from '@mantine/notifications'
import { NomiAppProviders } from '../../NomiAppProviders'
import { NomiColorSchemeProvider } from '../../theme/NomiColorSchemeProvider'
import { useToastStore } from '../toast'
import {
  AGENT_DOCK_INSET_CSS_VAR,
  AGENT_DOCK_INSET_DEFAULT_CSS_VAR,
  DEFAULT_AGENT_DOCK_RIGHT_INSET,
  findActiveDockedAgentPane,
  measureDockedAgentRightInset,
  syncDockedAgentRightInset,
} from './toastRightOffset'

function setRect(element: HTMLElement, rect: { left: number; width: number; height: number; top?: number }): void {
  const top = rect.top ?? 40
  const domRect = {
    x: rect.left,
    y: top,
    left: rect.left,
    top,
    width: rect.width,
    height: rect.height,
    right: rect.left + rect.width,
    bottom: top + rect.height,
    toJSON: () => ({}),
  } as DOMRect
  vi.spyOn(element, 'getBoundingClientRect').mockReturnValue(domRect)
}

function mountDockDom(options: {
  form: 'dock' | 'float' | 'collapsed'
  paneRect?: { left: number; width: number; height: number }
  includeHiddenSibling?: boolean
}): { layer: HTMLDivElement; pane: HTMLElement | null } {
  const layer = document.createElement('div')
  layer.setAttribute('data-shell-agent-layer', '')
  layer.setAttribute('data-agent-form', options.form)
  document.body.appendChild(layer)

  if (options.includeHiddenSibling) {
    const hiddenPane = document.createElement('aside')
    hiddenPane.setAttribute('data-assistant-pane', 'true')
    setRect(hiddenPane, { left: 0, width: 0, height: 0 })
    document.body.appendChild(hiddenPane)
  }

  if (!options.paneRect) return { layer, pane: null }

  const pane = document.createElement('aside')
  pane.setAttribute('data-assistant-pane', 'true')
  setRect(pane, options.paneRect)
  const portal = document.createElement('div')
  portal.setAttribute('data-agent-portal', 'true')
  const resident = document.createElement('div')
  resident.id = 'project-agent-resident'
  portal.appendChild(resident)
  pane.appendChild(portal)
  document.body.appendChild(pane)
  return { layer, pane }
}

describe('toastRightOffset — docked resident Agent avoidance', () => {
  let host: HTMLDivElement
  let root: Root | null = null

  beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    vi.restoreAllMocks()
    notifications.clean()
    document.body.innerHTML = ''
    document.documentElement.style.removeProperty(AGENT_DOCK_INSET_CSS_VAR)
    if (!window.matchMedia) {
      Object.defineProperty(window, 'matchMedia', {
        writable: true,
        value: vi.fn().mockImplementation((query: string) => ({
          matches: false,
          media: query,
          onchange: null,
          addListener: vi.fn(),
          removeListener: vi.fn(),
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
          dispatchEvent: vi.fn(),
        })),
      })
    }
    host = document.createElement('div')
    document.body.appendChild(host)
  })

  afterEach(async () => {
    if (root) {
      await act(async () => {
        notifications.clean()
        root?.unmount()
      })
      root = null
    } else {
      notifications.clean()
    }
    document.body.innerHTML = ''
    document.documentElement.style.removeProperty(AGENT_DOCK_INSET_CSS_VAR)
  })

  it('measures the active visible docked pane and ignores hidden workspace panes', () => {
    mountDockDom({
      form: 'dock',
      paneRect: { left: 874, width: 398, height: 752 },
      includeHiddenSibling: true,
    })

    const pane = findActiveDockedAgentPane(document)
    expect(pane).not.toBeNull()
    expect(measureDockedAgentRightInset(document, 1280)).toBe(406)

    syncDockedAgentRightInset(document, 1280)
    expect(document.documentElement.style.getPropertyValue(AGENT_DOCK_INSET_CSS_VAR)).toBe('406px')
  })

  it('tracks CSS-grid-narrowed and user-resized dock widths accurately', () => {
    const { pane } = mountDockDom({ form: 'dock', paneRect: { left: 744, width: 348, height: 642 } })
    expect(measureDockedAgentRightInset(document, 1100)).toBe(356)

    setRect(pane!, { left: 764, width: 508, height: 752 })
    expect(measureDockedAgentRightInset(document, 1280)).toBe(516)
  })

  it('returns null and clears CSS variable when Agent is collapsed, floating, or absent', () => {
    const { layer } = mountDockDom({ form: 'dock', paneRect: { left: 874, width: 398, height: 752 } })
    syncDockedAgentRightInset(document, 1280)
    expect(document.documentElement.style.getPropertyValue(AGENT_DOCK_INSET_CSS_VAR)).toBe('406px')

    for (const form of ['collapsed', 'float'] as const) {
      layer.setAttribute('data-agent-form', form)
      expect(findActiveDockedAgentPane(document)).toBeNull()
      expect(measureDockedAgentRightInset(document, 1280)).toBeNull()
      syncDockedAgentRightInset(document, 1280)
      expect(document.documentElement.style.getPropertyValue(AGENT_DOCK_INSET_CSS_VAR)).toBe('')
    }
  })

  it('wires NomiAppProviders container classes and syncs inset only while notifications are active', async () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1280 })
    mountDockDom({ form: 'dock', paneRect: { left: 764, width: 508, height: 752 } })

    root = createRoot(host)
    await act(async () => {
      root!.render(
        <NomiColorSchemeProvider>
          <NomiAppProviders>
            <div>stage</div>
          </NomiAppProviders>
        </NomiColorSchemeProvider>,
      )
    })

    const container = document.querySelector<HTMLElement>('.mantine-Notifications-root')
    expect(container).not.toBeNull()
    expect(container!.className).toContain('[body:has([data-shell-agent-layer][data-agent-form=dock])_&]')
    expect(container!.className).toContain('max(12px,var(--nomi-toast-right-agent,0px),var(--nomi-toast-right-panel,0px))')
    expect(container!.style.getPropertyValue(AGENT_DOCK_INSET_DEFAULT_CSS_VAR)).toBe(`${DEFAULT_AGENT_DOCK_RIGHT_INSET}px`)

    // Zero active notifications → inset variable stays unset (no idle observation).
    expect(document.documentElement.style.getPropertyValue(AGENT_DOCK_INSET_CSS_VAR)).toBe('')

    // Push a notification → inset syncs immediately to measured docked pane right distance.
    await act(async () => {
      useToastStore.getState().push({ id: 'dock-test', message: 'Saved' })
    })
    expect(document.documentElement.style.getPropertyValue(AGENT_DOCK_INSET_CSS_VAR)).toBe('516px')

    // Clearing notifications removes the CSS variable and tears down observers.
    await act(async () => {
      notifications.clean()
    })
    expect(document.documentElement.style.getPropertyValue(AGENT_DOCK_INSET_CSS_VAR)).toBe('')
  })
})
