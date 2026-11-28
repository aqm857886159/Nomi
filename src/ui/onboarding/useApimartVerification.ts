import React from 'react'
import { isApimartKeyCandidate, type VendorBalanceCheck, type VendorBalanceFailure, type VendorReportedBalance } from '../../../electron/shared/contracts/vendorAccountBalance'
import { getDesktopBridge } from '../../desktop/bridge'
import { refreshOnboardingModelAvailability } from './onboardingModelAvailability'
import { APIMART_CONNECTED_EVENT, persistApimartOpenedAt } from './apimartConnectRoute'
import { trackOnboardingStep } from '../../workbench/onboarding/onboardingState'

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

export function useApimartVerification(onSaved: () => void) {
  const [stage, setStage] = React.useState<Stage>('idle')
  const [suffix, setSuffix] = React.useState('')
  const [received, setReceived] = React.useState<Extract<VendorBalanceCheck, {status: 'received'}> | null>(null)
  const candidate = React.useRef('')
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
    const isDirectSubmission = raw !== undefined
    if (isDirectSubmission && (!key || !isApimartKeyCandidate(key))) {
      candidate.current = ''
      setSuffix('')
      setStage('format')
      trackOnboardingStep({ step: 'key_submitted', providerClass: 'builtin' })
      trackOnboardingStep({ step: 'verify_failed', providerClass: 'builtin', failReason: 'invalid_format' })
      return
    }
    const catalog = getDesktopBridge()?.modelCatalog
    if (!catalog) { setStage('unavailable'); return }
    if (key) {
      candidate.current = key
      setSuffix(key.slice(-4))
      trackOnboardingStep({ step: 'key_submitted', providerClass: 'builtin' })
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
        const { checkedKeyId, keyQuota: quota } = result
        if (quota && isExhaustedBalance(quota)) exhaustedQuotas.current.set(checkedKeyId, quota)
        else if (quota?.unlimited || (quota?.remainCredits ?? 0) > 0) exhaustedQuotas.current.delete(checkedKeyId)
        const verified = { ...result, keyQuota: exhaustedQuotas.current.get(checkedKeyId) ?? quota }
        const settled = receivedStage(verified)
        setReceived(verified)
        setStage(settled)
        if (key) {
          if (settled === 'passed') trackOnboardingStep({ step: 'verify_succeeded', providerClass: 'builtin' })
          else trackOnboardingStep({ step: 'verify_failed', providerClass: 'builtin', failReason: 'zero_quota' })
        }
      } else {
        const failedStage = result?.status ?? 'unavailable'
        setStage(failedStage)
        if (key) {
          const failReason = failedStage === 'invalid' ? 'auth_failed' : failedStage === 'offline' ? 'network' : 'other'
          trackOnboardingStep({ step: 'verify_failed', providerClass: 'builtin', failReason })
        }
      }
    } catch (error) {
      if (!mounted.current) return
      if (/system (keychain|secure storage)|could not be encrypted/i.test(String(error))) {
        setStage('keychain')
        if (key) trackOnboardingStep({ step: 'verify_failed', providerClass: 'builtin', failReason: 'other' })
      } else {
        candidate.current = ''
        const isInvalid = String(error).includes('apimart-key-invalid')
        setStage(isInvalid ? 'invalid' : 'unavailable')
        if (key) trackOnboardingStep({ step: 'verify_failed', providerClass: 'builtin', failReason: isInvalid ? 'auth_failed' : 'other' })
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
