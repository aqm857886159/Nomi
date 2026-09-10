import { beforeEach, expect, it, vi } from 'vitest'
import type { LibraryPrompt } from './promptLibraryTypes'
const mocks = vi.hoisted(() => ({ fetch: vi.fn(), read: vi.fn(), write: vi.fn() }))
vi.mock('../hardenedFetch', () => ({ hardenedFetchText: mocks.fetch }))
vi.mock('../runtimePaths', () => ({ getSettingsRoot: () => '/tmp/nomi-prompt-test', readJson: mocks.read }))
vi.mock('../jsonFile', () => ({ writeJsonFileAtomic: mocks.write }))
vi.mock('./promptSources', () => ({ PROMPT_SOURCES: [{ id: 'remote', label: 'Remote', sourceUrl: 'https://example.com', rawBase: 'https://example.com', files: ['prompts.md'], cap: 10, promptType: 'image', parse: () => [{ title: 'Fresh', prompt: 'fresh remote prompt', mediaUrl: '', mediaType: 'image', tags: [] }] }] }))
import { getPromptLibrary, resetPromptLibraryCache } from './promptLibraryStore'
const old = { id: 'old', title: 'Cached', prompt: 'old remote prompt', sourceId: 'remote', mediaType: 'image', promptType: 'image', origin: 'public', source: 'Remote', sourceUrl: '', mediaUrl: '', tags: [] } satisfies LibraryPrompt
beforeEach(() => { vi.clearAllMocks(); mocks.read.mockReturnValue(null); resetPromptLibraryCache() })

it('returns bundled expressions without waiting for an unresolved external request', async () => {
  mocks.fetch.mockReturnValue(new Promise(() => {}))
  const result = await Promise.race([getPromptLibrary(), Promise.resolve('network-blocked')])
  expect(result).not.toBe('network-blocked')
  expect((result as LibraryPrompt[]).filter(p => p.sourceId === 'builtin-expressions')).toHaveLength(25)
})

it('serves stale disk content immediately and makes refreshed content available on the next read', async () => {
  mocks.read.mockReturnValue({ at: 0, prompts: [old] })
  let finish!: (value: { text: string }) => void
  mocks.fetch.mockReturnValue(new Promise(resolve => { finish = resolve }))
  let persisted!: () => void
  const saved = new Promise<void>(resolve => { persisted = resolve })
  mocks.write.mockImplementation(() => persisted())
  const result = await Promise.race([getPromptLibrary(), Promise.resolve('network-blocked')])
  expect(result).not.toBe('network-blocked')
  expect(result).toEqual(expect.arrayContaining([old]))
  finish({ text: 'remote content' })
  await saved
  const refreshed = await getPromptLibrary()
  expect(refreshed.some(p => p.prompt === 'fresh remote prompt')).toBe(true)
  expect(refreshed.filter(p => p.sourceId === 'builtin-expressions')).toHaveLength(25)
  expect(mocks.fetch).toHaveBeenCalledTimes(1)
})
