import React from 'react'

type Listener = () => void

let active = false
const listeners = new Set<Listener>()

function emit(): void {
  listeners.forEach((listener) => listener())
}

export function setJourneyTourActive(nextActive: boolean): void {
  if (active === nextActive) return
  active = nextActive
  emit()
}

export function getJourneyTourActive(): boolean {
  return active
}

export function subscribeJourneyTourActive(listener: Listener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function useJourneyTourActive(): boolean {
  return React.useSyncExternalStore(
    subscribeJourneyTourActive,
    getJourneyTourActive,
    getJourneyTourActive,
  )
}
