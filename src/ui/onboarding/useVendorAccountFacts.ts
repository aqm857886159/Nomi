import React from 'react'
import type { VendorAccountFacts } from '../../../electron/shared/contracts/vendorAccountFacts'
import { MODEL_REFRESH_EVENT } from '../../config/modelCatalogCache'
import { getDesktopBridge } from '../../desktop/bridge'

/** Scope each reply to the connection that requested it, including after settings edits. */
export function useVendorAccountFacts(vendorKey: string | undefined, connectionRevision?: string) {
  const [result, setResult] = React.useState<{ identity: string; value: VendorAccountFacts | null }>()
  const [refreshId, setRefreshId] = React.useState(0)
  const lastRefresh = React.useRef(refreshId)
  const identity = JSON.stringify([vendorKey, connectionRevision, refreshId])
  React.useEffect(() => {
    const read = getDesktopBridge()?.onboarding?.vendorAccountFacts
    if (!vendorKey || !read) return
    let active = true
    const force = lastRefresh.current !== refreshId
    lastRefresh.current = refreshId
    let sequence = 0
    const load = (refresh: boolean) => {
      const token = ++sequence
      void read({ vendorKey, force: refresh }).then(
        value => {
          if (!active || token !== sequence) return
          setResult({ identity, value })
          if (refresh) window.dispatchEvent(new CustomEvent('nomi-account-refreshed', { detail: vendorKey }))
        },
        () => { if (active && token === sequence) setResult({ identity, value: null }) },
      )
    }
    load(force)
    const focus = () => load(false)
    const onRefresh = (event: Event) => {
      if ((event as CustomEvent).detail === vendorKey) load(false)
    }
    window.addEventListener('focus', focus)
    window.addEventListener(MODEL_REFRESH_EVENT, focus)
    window.addEventListener('nomi-account-refreshed', onRefresh)
    return () => {
      active = false
      window.removeEventListener('focus', focus)
      window.removeEventListener(MODEL_REFRESH_EVENT, focus)
      window.removeEventListener('nomi-account-refreshed', onRefresh)
    }
  }, [vendorKey, identity, refreshId])
  const settled = result?.identity === identity
  return {
    facts: settled ? result.value : null,
    loading: Boolean(vendorKey && getDesktopBridge()?.onboarding?.vendorAccountFacts && !settled),
    refresh: () => setRefreshId(n => n + 1),
  }
}
