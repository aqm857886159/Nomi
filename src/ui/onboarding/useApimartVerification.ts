import React from 'react'
import { isApimartKeyCandidate, type VendorBalanceCheck, type VendorBalanceFailure, type VendorReportedBalance } from '../../../electron/shared/contracts/vendorAccountBalance'
import { getDesktopBridge } from '../../desktop/bridge'
import { refreshOnboardingModelAvailability } from './onboardingModelAvailability'
import { APIMART_CONNECTED_EVENT, persistApimartOpenedAt } from './apimartConnectRoute'

type LocalStage = 'idle' | 'checking' | 'format' | 'keychain' | 'topup' | 'keyQuota' | 'passed'
type Stage = LocalStage | VendorBalanceFailure

export function isExhaustedBalance(snapshot?: VendorReportedBalance | null): boolean {
  return snapshot?.remainCredits === 0 && !snapshot.unlimited
}

function receivedStage(result: Extract<VendorBalanceCheck, {status: 'received'}>) {
  if (isExhaustedBalance(result.accountBalance)) return 'topup'
  if (isExhaustedBalance(result.keyQuota)) return 'keyQuota'
  return 'passed'
}

async function keyFingerprint(key: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key))
  return Array.from(new Uint8Array(digest)).join('.')
}

export function useApimartVerification(onSaved: () => void) {
  const [stage, setStage] = React.useState<Stage>('idle')
  const [suffix, setSuffix] = React.useState('')
  const [received, setReceived] = React.useState<Extract<VendorBalanceCheck, {status: 'received'}> | null>(null)
  const candidate = React.useRef('')
  const savedKeyId = React.useRef('')
  const exhaustedQuotas = React.useRef(new Map<string, VendorReportedBalance>())
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
      const keyId = key ? await keyFingerprint(key) : savedKeyId.current
      const result = key
        ? await catalog.upsertVendorApiKey('apimart', { apiKey: key, enabled: false, source: 'apimart-connect' }) as VendorBalanceCheck
        : await catalog.recheckApimartBalance?.()
      candidate.current = ''
      if (key) {
        savedKeyId.current = keyId
        window.dispatchEvent(new CustomEvent('nomi-model-catalog-changed'))
        void refreshOnboardingModelAvailability().catch(() => {})
      }
      if (result?.status === 'received') persistApimartOpenedAt(0)
      if (!mounted.current) return
      if (result?.status === 'received') {
        const quota = result.keyQuota
        if (quota && isExhaustedBalance(quota)) exhaustedQuotas.current.set(keyId, quota)
        else if (quota?.unlimited || (quota?.remainCredits ?? 0) > 0) exhaustedQuotas.current.delete(keyId)
        const verified = { ...result, keyQuota: exhaustedQuotas.current.get(keyId) ?? quota }
        setReceived(verified)
        setStage(receivedStage(verified))
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
    const retry = () => { void check() }
    if (stage === 'offline') {
      window.addEventListener('online', retry)
      return () => window.removeEventListener('online', retry)
    }
    if (stage === 'topup' || stage === 'keyQuota') {
      const onVisible = () => { if (document.visibilityState === 'visible') retry() }
      window.addEventListener('focus', retry)
      document.addEventListener('visibilitychange', onVisible)
      return () => {
        window.removeEventListener('focus', retry)
        document.removeEventListener('visibilitychange', onVisible)
      }
    }
  }, [check, stage])
  React.useEffect(() => {
    if (stage !== 'passed') return
    const timer = window.setTimeout(() => {
      window.dispatchEvent(new CustomEvent(APIMART_CONNECTED_EVENT, { detail: { remainCredits: received?.accountBalance?.remainCredits ?? null, unlimited: received?.accountBalance?.unlimited ?? null } }))
      onSaved()
    }, 450)
    return () => window.clearTimeout(timer)
  }, [stage, received, onSaved])
  return { stage, suffix, received, check, retry: () => check(stage === 'keychain' ? candidate.current : undefined),
    reset: () => { setStage('idle'); setSuffix(''); candidate.current = '' } }
}
