import React from 'react'
import type { PickerModel } from './ModelPickerScreen'
import { runModelDiscovery, type GuessModelKinds, type PickerDiscoveryResult } from './modelDiscovery'

type DiscoveryState = {
  candidates: PickerModel[]
  remoteTotal: number
  fetching: boolean
  fetchAttempted: boolean
  result?: PickerDiscoveryResult
  scope: string
}

/** Both entry points share request lifetime: an older connection/attempt cannot publish newer state. */
export function useModelDiscovery({ scope, opened, initialModels = [], load, guessKinds }: {
  scope: string
  opened: boolean
  initialModels?: PickerModel[]
  load: () => Promise<PickerDiscoveryResult>
  guessKinds?: GuessModelKinds
}): DiscoveryState & { fetchModels: () => Promise<PickerDiscoveryResult | undefined>; cancelPending: () => void } {
  const initialSignature = JSON.stringify(initialModels)
  const currentScope = JSON.stringify([scope, opened, initialSignature])
  const initialState = React.useMemo((): DiscoveryState => ({
    candidates: JSON.parse(initialSignature) as PickerModel[], remoteTotal: 0,
    fetching: false, fetchAttempted: false, scope: currentScope,
  }), [currentScope, initialSignature])
  const [state, setState] = React.useState(initialState)
  const revision = React.useRef(0)
  React.useEffect(() => {
    revision.current += 1
    setState(initialState)
    return () => { revision.current += 1 }
  }, [initialState])
  const visible = state.scope === currentScope ? state : initialState
  const cancelPending = React.useCallback(() => {
    revision.current += 1
    setState(current => ({ ...current, fetching: false }))
  }, [])
  const fetchModels = React.useCallback(async () => {
    if (!opened) return undefined
    const attempt = ++revision.current
    const isCurrent = () => attempt === revision.current
    setState({ ...visible, fetching: true })
    const next = await runModelDiscovery({ load, guessKinds, previous: visible.candidates, existing: initialState.candidates, isCurrent })
    if (!next || !isCurrent()) return undefined
    setState({
      ...next, scope: currentScope, fetching: false, fetchAttempted: true,
      remoteTotal: next.result.ok ? next.remoteTotal : visible.remoteTotal,
    })
    return next.result
  }, [opened, load, guessKinds, visible, initialState, currentScope])
  return { ...visible, fetchModels, cancelPending }
}
