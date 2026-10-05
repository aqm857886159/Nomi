// Real NomiAppProviders (the production Notifications container), the real toast store, the real failure
// catalog and the real i18n strings. Only the page around them is a stub: the layout question is "does the
// production container keep a generation-failure toast inside the window", which jsdom cannot answer.
import React from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/inter/wght.css'
import '@mantine/notifications/styles.css'
import '../../../../src/styles/index.css'
import i18n from '../../../../src/i18n'
import { NomiAppProviders } from '../../../../src/NomiAppProviders'
import { NomiColorSchemeProvider } from '../../../../src/theme/NomiColorSchemeProvider'
import { notifications } from '@mantine/notifications'
import { useToastStore } from '../../../../src/ui/toast'
import { TOAST_MIN_BODY_WIDTH } from '../../../../src/ui/toastConstants'
import { providerFailedValues } from '../../../../src/workbench/generationCanvas/nodes/nodeRecoveryNotice'
import { classifyGenerationError } from '../../../../src/workbench/observability/classifyError'
import { GENERATION_ERROR_KINDS, narrateGenerationError, narrateIsVendorSideFailure } from '../../../../src/workbench/observability/narrate'

type ToastInput = Parameters<ReturnType<typeof useToastStore.getState>['push']>[0]

/** The exact failure payload the full-walk fixture vendor answers with (a model-retired 400), as it crosses IPC. */
const walkFailure = (upstreamMsg: string) => `Error invoking remote method 'nomi:tasks:run': Error: NOMI_VENDOR_ERR_B64::${
  btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify({
    vendorKey: 'agent-runtime-loopback', method: 'POST', url: 'http://127.0.0.1:1/v1/images/generations',
    httpStatus: 400, upstreamMsg, category: 'input', retryable: false, upstreamCode: 'model_not_found',
  }))))
}:: Provider request failed (HTTP 400) at agent-runtime-loopback POST http://127.0.0.1:1/v1/images/generations: ${upstreamMsg}`

Object.assign(window, { __toastFixture: {
  /** The generation-failure toast, built the way useNodeModelAutoSelect builds it (same catalog, same strings). */
  showFailure: (input: { id?: string; occurrence?: string; vendor?: string; upstreamMsg?: string; actionLabel?: string } = {}) => {
    const report = classifyGenerationError(walkFailure(input.upstreamMsg ?? 'This model has been deprecated and is no longer available. Please switch to another model or provider.'))
    // The toast names the vendor's display name (what Model Access shows), never its id — same as useNodeModelAutoSelect.
    const vendor = input.vendor ?? 'Agent Runtime Loopback'
    return useToastStore.getState().push({
      id: input.id ?? 'node-recovery:probe',
      ...(input.occurrence ? { occurrence: input.occurrence } : {}),
      reason: report.kind,
      type: 'warning',
      ttl: false,
      message: i18n.t('generationCommon.node.providerFailed', providerFailedValues(vendor, report)),
      actionLabel: input.actionLabel ?? i18n.t('generationCommon.node.switchProvider', { model: 'Fixture Image B', vendor: 'Agent Runtime Loopback B' }),
      onAction: () => {},
    })
  },
  /**
   * The longest message the failure catalog can put in this toast in the current language (reason + hint of every
   * kind, straight from the shipped i18n bundle) — the worst case the container has to hold without clipping.
   */
  showLongestCatalogMessage: () => {
    // Only the kinds that can actually reach this toast (the catalog says which ones are the vendor's side).
    const params = { model: 'model', registered: 'text', requested: 'image' }
    const copies = GENERATION_ERROR_KINDS.filter((kind) => narrateIsVendorSideFailure(kind)).map((kind) => ({ kind, ...narrateGenerationError(kind, params) }))
    const longest = copies.reduce((best, copy) => (copy.reason.length + copy.hint.length > best.reason.length + best.hint.length ? copy : best))
    useToastStore.getState().push({
      id: 'node-recovery:longest', reason: longest.kind, type: 'warning', ttl: false,
      message: i18n.t('generationCommon.node.providerFailed', providerFailedValues('Agent Runtime Loopback', longest)),
      actionLabel: i18n.t('generationCommon.node.switchProvider', { model: 'Fixture Image B', vendor: 'Agent Runtime Loopback B' }),
      onAction: () => {},
    })
    return { kind: longest.kind, length: longest.reason.length + longest.hint.length }
  },
  /**
   * A message longer than anything the catalog can say today (the longest entry, three times over): it has to scroll inside
   * its own area while the action button stays whole and the toast stays inside the window.
   */
  showOverlongMessage: () => {
    const params = { model: 'model', registered: 'text', requested: 'image' }
    const copies = GENERATION_ERROR_KINDS.filter((kind) => narrateIsVendorSideFailure(kind)).map((kind) => ({ kind, ...narrateGenerationError(kind, params) }))
    const longest = copies.reduce((best, copy) => (copy.reason.length + copy.hint.length > best.reason.length + best.hint.length ? copy : best))
    useToastStore.getState().push({
      id: 'node-recovery:overlong', reason: longest.kind, type: 'warning', ttl: false,
      message: i18n.t('generationCommon.node.providerFailed', providerFailedValues('Agent Runtime Loopback', { reason: longest.reason, hint: Array.from({ length: 3 }, () => longest.hint).join(' ') })),
      actionLabel: i18n.t('generationCommon.node.switchProvider', { model: 'Fixture Image B', vendor: 'Agent Runtime Loopback B' }),
      onAction: () => {},
    })
  },
  show: (input: ToastInput) => useToastStore.getState().push(input),
  /** The owner's minimum body width (src/ui/toast.tsx TOAST_MIN_BODY_WIDTH), converted to px by the browser itself. */
  minBodyWidthPx: () => {
    const probe = document.createElement('div')
    probe.style.cssText = `position:absolute;visibility:hidden;width:${TOAST_MIN_BODY_WIDTH}`
    document.body.appendChild(probe)
    const width = probe.getBoundingClientRect().width
    probe.remove()
    return width
  },
  clear: () => notifications.clean(),
  /** What the shell does when a right panel is open: it marks the panel, and the container steps left of it. */
  openPanel: (name: 'model' | 'tasks' | 'director') => {
    const marker = document.createElement('div')
    marker.setAttribute('data-nomi-right-panel', name)
    document.body.appendChild(marker)
  },
  closePanels: () => { document.querySelectorAll('[data-nomi-right-panel]').forEach((marker) => marker.remove()) },
} })

createRoot(document.getElementById('root')!).render(
  <NomiColorSchemeProvider>
    <NomiAppProviders>
      <main className="min-h-screen bg-nomi-bg p-8 text-nomi-ink">stage</main>
    </NomiAppProviders>
  </NomiColorSchemeProvider>,
)
