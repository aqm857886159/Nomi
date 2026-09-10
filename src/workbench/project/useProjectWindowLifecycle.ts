import { useCallback, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { confirmDialog } from '../../design'
import { getDesktopBridge } from '../../desktop/bridge'
import { toast } from '../../ui/toast'

/** Repeated library exits share the entire pending save/release operation. */
export function useProjectLeaveAction(leave: () => Promise<void>): () => Promise<void> {
  const pending = useRef<Promise<void> | null>(null)
  return useCallback(() => {
    if (pending.current) return pending.current
    const operation = Promise.resolve().then(leave)
    pending.current = operation
    const clear = () => { if (pending.current === operation) pending.current = null }
    void operation.then(clear, clear)
    return operation
  }, [leave])
}

/** Close/reload acknowledges the active project's save before releasing its renderer. */
export function useProjectWindowLifecycle(): void {
  const { t } = useTranslation()
  const pendingClose = useRef<string | null>(null)
  const reloading = useRef(false)
  useEffect(() => {
    const windowBridge = getDesktopBridge()?.window
    if (!windowBridge?.onCloseRequest) return
    return windowBridge.onCloseRequest((payload) => {
      const requestId = typeof payload?.requestId === 'string' ? payload.requestId.trim() : ''
      if (!requestId) return
      if (pendingClose.current) { windowBridge.cancelClose?.(requestId); return }
      pendingClose.current = requestId
      void confirmDialog({ title: t('studio.closeTitle'), message: t('studio.closeMessage'), confirmLabel: t('common.close'), cancelLabel: t('common.cancel'), tone: 'info' })
        .then(async (confirmed) => {
          if (!confirmed) { getDesktopBridge()?.window?.cancelClose?.(requestId); return }
          const { persistActiveWorkbenchProjectNow } = await import('./workbenchProjectSession')
          await persistActiveWorkbenchProjectNow()
          getDesktopBridge()?.window?.confirmClose?.(requestId)
        })
        .catch((error: unknown) => {
          console.error('window close save error', error)
          toast(t('studio.projectSaveFailed'), 'error')
          getDesktopBridge()?.window?.cancelClose?.(requestId)
        })
        .finally(() => { if (pendingClose.current === requestId) pendingClose.current = null })
    })
  }, [t])
  useEffect(() => {
    const reload = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase()
      if (key !== 'f5' && !((event.ctrlKey || event.metaKey) && key === 'r')) return
      const app = getDesktopBridge()?.app
      if (!app?.hardReloadWindow) return
      event.preventDefault(); event.stopPropagation()
      if (reloading.current) return
      reloading.current = true
      void import('./workbenchProjectSession')
        .then(({ persistActiveWorkbenchProjectNow }) => persistActiveWorkbenchProjectNow())
        .then(() => { app.hardReloadWindow?.() })
        .catch((error: unknown) => {
          console.error('hard reload save error', error)
          toast(t('studio.projectSaveFailed'), 'error')
          reloading.current = false
        })
    }
    window.addEventListener('keydown', reload, { capture: true })
    return () => window.removeEventListener('keydown', reload, { capture: true })
  }, [t])
}
