import React from 'react'
import { isApimartKeyCandidate, type VendorBalanceCheck } from '../../../electron/shared/contracts/vendorAccountBalance'
import { getDesktopBridge } from '../../desktop/bridge'
import { refreshOnboardingModelAvailability } from './onboardingModelAvailability'
import { APIMART_CONNECTED_EVENT, persistApimartOpenedAt } from './apimartConnectRoute'

type Stage = 'idle' | 'checking' | 'format' | 'invalid' | 'keychain' | 'offline' | 'unavailable' | 'passed'

export function useApimartVerification(onSaved: () => void) {
  const [stage, setStage] = React.useState<Stage>('idle')
  const [suffix, setSuffix] = React.useState('')
  const [received, setReceived] = React.useState<Extract<VendorBalanceCheck, {status: 'received'}> | null>(null)
  const candidate = React.useRef('')
  const inFlight = React.useRef(false)
  const mounted = React.useRef(true)
  React.useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false; candidate.current = '' }
  }, [])

  const check = React.useCallback(async (raw?: string) => {
    if (inFlight.current) return
    const key = raw?.trim()
    if (raw !== undefined && (!key || !isApimartKeyCandidate(key))) {
      candidate.current = ''
      setSuffix('')
      setStage('format')
      return
    }
    const catalog = getDesktopBridge()?.modelCatalog
    if (!catalog) { setStage('unavailable'); return }
    if (key) {
      candidate.current = key
      setSuffix(key.slice(-4))
    }
    setReceived(null)
    setStage('checking')
    inFlight.current = true
    try {
      const result = key
        ? await catalog.upsertVendorApiKey('apimart', { apiKey: key, enabled: false, source: 'apimart-connect' }) as VendorBalanceCheck
        : await catalog.recheckApimartBalance?.()
      candidate.current = ''
      if (key) {
        window.dispatchEvent(new CustomEvent('nomi-model-catalog-changed'))
        void refreshOnboardingModelAvailability().catch(() => {})
      }
      if (result?.status === 'received') persistApimartOpenedAt(0)
      if (!mounted.current) return
      if (result?.status === 'received') {
        setReceived(result)
        setStage('passed')
      } else {
        setStage(result?.status ?? 'unavailable')
      }
    } catch (error) {
      if (!mounted.current) return
      if (/system (keychain|secure storage)|could not be encrypted/i.test(String(error))) setStage('keychain')
      else {
        candidate.current = ''
        setStage(String(error).includes('apimart-key-invalid') ? 'invalid' : 'unavailable')
      }
    } finally {
      inFlight.current = false
    }
  }, [])
  React.useEffect(() => {
    if (stage !== 'offline') return
    const retry = () => { void check() }
    window.addEventListener('online', retry)
    return () => window.removeEventListener('online', retry)
  }, [check, stage])
  React.useEffect(() => {
    if (stage !== 'passed') return
    const timer = window.setTimeout(() => {
      window.dispatchEvent(new CustomEvent(APIMART_CONNECTED_EVENT, { detail: { remainCredits: null, unlimited: null } }))
      onSaved()
    }, 450)
    return () => window.clearTimeout(timer)
  }, [stage, onSaved])
  return { stage, suffix, received, check, retry: () => check(stage === 'keychain' ? candidate.current : undefined),
    reset: () => { setStage('idle'); setSuffix(''); candidate.current = '' } }
}
