import React from 'react'

export type SendCostUnit = 'credits' | 'cny' | 'usd'

export const SEND_COST_UNITS: readonly SendCostUnit[] = ['credits', 'cny', 'usd']

const STORAGE_KEY = 'nomi.sendCostUnit'

function parseUnit(raw: unknown): SendCostUnit {
  return raw === 'cny' || raw === 'usd' || raw === 'credits' ? raw : 'credits'
}

function readStoredUnit(): SendCostUnit {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return 'credits'
    return parseUnit(window.localStorage.getItem(STORAGE_KEY))
  } catch {
    return 'credits'
  }
}

let currentUnit: SendCostUnit = readStoredUnit()
const listeners = new Set<() => void>()

function emit(): void {
  for (const listener of listeners) listener()
}

export function getSendCostUnit(): SendCostUnit {
  return currentUnit
}

export function setSendCostUnit(next: SendCostUnit): void {
  const normalized = parseUnit(next)
  if (normalized === currentUnit) return
  currentUnit = normalized
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem(STORAGE_KEY, normalized)
    }
  } catch {
    // Storage may be unavailable in restricted contexts; in-memory preference still applies.
  }
  emit()
}

export function subscribeSendCostUnit(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/** Shared user display unit for the send-button estimate (credits / CNY / USD). */
export function useSendCostUnit(): readonly [SendCostUnit, (unit: SendCostUnit) => void] {
  const unit = React.useSyncExternalStore<SendCostUnit>(subscribeSendCostUnit, getSendCostUnit, () => 'credits')
  return [unit, setSendCostUnit] as const
}

export function resetSendCostUnitForTest(unit: SendCostUnit = 'credits'): void {
  currentUnit = parseUnit(unit)
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.removeItem(STORAGE_KEY)
    }
  } catch {
    // ignore
  }
  emit()
}
