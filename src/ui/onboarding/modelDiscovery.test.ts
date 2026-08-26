import { describe, expect, it, vi } from 'vitest'
import { modelDiscoveryMessage, runModelDiscovery } from './modelDiscovery'

const previous = [{ id: 'already-picked', kind: 'video' }]

describe('model discovery picker state', () => {
  it.each(['unsupported', 'auth', 'rate_limit', 'network', 'invalid_response', 'upstream'] as const)(
    'keeps candidates and a distinct actionable status on %s', async (failureKind) => {
      const result = { ok: false, failureKind, error: 'HTTP 401', status: 401 }
      const next = await runModelDiscovery({ load: async () => result, previous, existing: [], isCurrent: () => true })
      expect(next?.candidates).toEqual(previous)
      expect(next?.result).toEqual(result)
      expect(modelDiscoveryMessage(result, true).key).toBe(
        failureKind === 'unsupported' ? 'modelSetup.discoveryUnsupportedExisting' : `modelSetup.discoveryError.${failureKind}`,
      )
    },
  )

  it('catches IPC rejection without clearing the list or leaking an unhandled rejection', async () => {
    const next = await runModelDiscovery({
      load: async () => { throw new Error('IPC disconnected') }, previous, existing: [], isCurrent: () => true,
    })
    expect(next?.candidates).toEqual(previous)
    expect(next?.result).toMatchObject({ ok: false, failureKind: 'network', error: 'IPC disconnected' })
  })

  it('does not confuse an empty remote list with an unsupported interface or local catalog', () => {
    expect(modelDiscoveryMessage({ ok: true, models: [] }, true).key).toBe('modelSetup.noModelsListedHint')
    expect(modelDiscoveryMessage({ ok: false, failureKind: 'unsupported' }, false).key).toBe('modelSetup.discoveryUnsupported')
    expect(modelDiscoveryMessage({ ok: true, models: ['new'], partial: true }, false).key).toBe('modelSetup.discoveryPartial')
    expect(modelDiscoveryMessage({ ok: true, models: ['new'] }, false).key).toBeNull()
  })

  it('keeps saved kinds authoritative, dedupes IDs, and only guesses newly fetched IDs', async () => {
    const guessKinds = vi.fn(async () => ({ kinds: { 'owner/new-video': 'video', saved: 'text' } }))
    const next = await runModelDiscovery({
      load: async () => ({ ok: true, models: [' saved ', 'owner/new-video', 'owner/new-video'] }),
      existing: [{ id: 'saved', kind: 'image' }], previous, guessKinds, isCurrent: () => true,
    })
    expect(next?.candidates).toEqual([{ id: 'saved', kind: 'image' }, { id: 'owner/new-video', kind: 'video' }])
    expect(next?.remoteTotal).toBe(2)
    expect(guessKinds).toHaveBeenCalledWith({ ids: ['owner/new-video'] })
  })

  it('uses the saved connection returned by main without reading any credential', async () => {
    const next = await runModelDiscovery({
      load: async () => ({ ok: true, models: [], connection: {
        vendorKey: 'renamed', vendorName: 'Kie.ai', baseUrl: 'https://api.kie.ai',
        existingModels: [{ modelKey: 'saved', labelZh: 'Saved', kind: 'image' }],
      } }),
      existing: [], previous, isCurrent: () => true,
    })
    expect(next?.candidates).toEqual([{ id: 'saved', kind: 'image' }])
    expect(next?.remoteTotal).toBe(0)
  })

  it('discards a response if the connection changed while fetching', async () => {
    let finish!: (value: { ok: true; models: string[] }) => void
    let current = true
    const guessKinds = vi.fn()
    const pending = runModelDiscovery({
      load: () => new Promise(resolve => { finish = resolve }),
      previous, existing: [], guessKinds, isCurrent: () => current,
    })
    current = false
    finish({ ok: true, models: ['wrong-connection'] })
    expect(await pending).toBeUndefined()
    expect(guessKinds).not.toHaveBeenCalled()
  })

  it('also discards results when the page closes during kind inference', async () => {
    let finish!: () => void
    let current = true
    const pending = runModelDiscovery({
      load: async () => ({ ok: true, models: ['wrong-connection'] }), previous, existing: [],
      guessKinds: () => new Promise(resolve => { finish = () => resolve({ kinds: {} }) }), isCurrent: () => current,
    })
    await Promise.resolve()
    current = false
    finish()
    expect(await pending).toBeUndefined()
  })

  it('uses one status mapper for both entry points and does not infer categories from English errors', () => {
    expect(modelDiscoveryMessage({ ok: false, error: 'No message available' }, true).key).toBe('modelSetup.noModelsFetchedWithReason')
    expect(modelDiscoveryMessage({ ok: false, code: 'CREDENTIAL_MISSING', error: 'missing' }, true).key).toBe('modelSetup.existingConnectionError.CREDENTIAL_MISSING')
  })
})
