import { beforeEach, expect, it, vi } from 'vitest'
import { getAssistantModelPref, setAssistantModelPref } from './assistantModelPref'

const values = new Map<string, string>()
beforeEach(() => {
  values.clear()
  vi.stubGlobal('localStorage', { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) })
  vi.stubGlobal('window', { dispatchEvent: vi.fn() })
})
it('persists reasoning together with the exact provider/model identity', () => {
  setAssistantModelPref({ vendorKey: 'local', modelKey: 'sol', thinkingLevel: 'low' })
  expect(getAssistantModelPref()).toEqual({ vendorKey: 'local', modelKey: 'sol', thinkingLevel: 'low' })
  expect(window.dispatchEvent).toHaveBeenCalled()
})
it('retains legacy identity and drops an invalid reasoning preference', () => {
  values.set('nomi.assistantModel', JSON.stringify({ vendorKey: 'local', modelKey: 'sol', thinkingLevel: 'invented' }))
  expect(getAssistantModelPref()).toEqual({ vendorKey: 'local', modelKey: 'sol' })
})
