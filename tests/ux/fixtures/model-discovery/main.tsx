import React from 'react'
import { createRoot } from 'react-dom/client'
import { MantineProvider } from '@mantine/core'
import '@mantine/core/styles.css'
import { I18nextProvider } from 'react-i18next'
import i18n from '../../../../src/i18n'
import { ModelPickerScreen, type PickerModel } from '../../../../src/ui/onboarding/ModelPickerScreen'
import { useModelDiscovery } from '../../../../src/ui/onboarding/useModelDiscovery'
import type { PickerDiscoveryResult } from '../../../../src/ui/onboarding/modelDiscovery'

function Fixture(): JSX.Element {
  const [scope, setScope] = React.useState('alpha')
  const [mode, setMode] = React.useState('full')
  const [pending, setPending] = React.useState(false)
  const [saved, setSaved] = React.useState<PickerModel[]>([])
  const resolve = React.useRef<(value: PickerDiscoveryResult) => void>()
  const load = React.useCallback(async (): Promise<PickerDiscoveryResult> => {
    if (scope === 'beta') return { ok: true, models: ['beta-text'] }
    if (mode === 'slow') {
      setPending(true)
      return new Promise(done => { resolve.current = done })
    }
    return { ok: true, models: mode === 'full' ? ['flux-image', 'gpt-text'] : ['gpt-text'] }
  }, [scope, mode])
  const guessKinds = React.useCallback(async ({ ids }: { ids: string[] }) => ({
    kinds: Object.fromEntries(ids.map(id => [id, id.startsWith('flux') ? 'image' : 'text'])),
  }), [])
  const discovery = useModelDiscovery({ scope, opened: true, load, guessKinds })
  return <I18nextProvider i18n={i18n}><MantineProvider>
    <button onClick={() => setMode('changed')}>Change remote list</button>
    <button onClick={() => setMode('slow')}>Delay alpha</button>
    <button onClick={discovery.cancelPending}>Cancel pending</button>
    <button onClick={() => setScope('beta')}>Switch beta</button>
    <button onClick={() => { resolve.current?.({ ok: true, models: ['stale-alpha'] }); setPending(false) }}>Release alpha</button>
    <output data-testid="pending">{String(pending)}</output>
    <output data-testid="saved">{JSON.stringify(saved)}</output>
    <section data-testid="picker">
      <ModelPickerScreen key={scope} candidates={discovery.candidates} initialSelected={[]}
        sourceName={scope} host="fixture.invalid" total={discovery.remoteTotal}
        fetching={discovery.fetching} hasFetched={discovery.fetchAttempted}
        onRefetch={discovery.fetchModels} onBack={() => undefined} onConfirm={setSaved} />
    </section>
  </MantineProvider></I18nextProvider>
}
createRoot(document.getElementById('root')!).render(<Fixture />)
