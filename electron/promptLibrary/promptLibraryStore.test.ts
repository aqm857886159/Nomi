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

// 远端 fetch 永不落定；库要是等它，这两条会在 vitest 的超时上红。内置包只等磁盘（技能目录自 2026-09-18 起是
// pi 的 async 加载器），所以不再拿「同一 tick 内落定」的 Promise.resolve 当哨兵——那量的是同步性，不是「不等网络」。
it('returns bundled expressions without waiting for an unresolved external request', async () => {
  mocks.fetch.mockReturnValue(new Promise(() => {}))
  const result = await getPromptLibrary()
  expect(result.filter(p => p.sourceId === 'builtin-expressions')).toHaveLength(25)
})

it('serves stale disk content immediately and makes refreshed content available on the next read', async () => {
  mocks.read.mockReturnValue({ at: 0, prompts: [old] })
  let finish!: (value: { text: string }) => void
  mocks.fetch.mockReturnValue(new Promise(resolve => { finish = resolve }))
  let persisted!: () => void
  const saved = new Promise<void>(resolve => { persisted = resolve })
  mocks.write.mockImplementation(() => persisted())
  const result = await getPromptLibrary()
  expect(result).toEqual(expect.arrayContaining([old]))
  finish({ text: 'remote content' })
  await saved
  const refreshed = await getPromptLibrary()
  expect(refreshed.some(p => p.prompt === 'fresh remote prompt')).toBe(true)
  expect(refreshed.filter(p => p.sourceId === 'builtin-expressions')).toHaveLength(25)
  expect(mocks.fetch).toHaveBeenCalledTimes(1)
})

it('test network mode serves the bundled prompt fixture without starting a remote refresh', async () => {
  const previous = process.env.NOMI_TEST_NETWORK_GUARD
  process.env.NOMI_TEST_NETWORK_GUARD = '1'
  mocks.fetch.mockRejectedValue(new Error('remote prompt source must not be touched'))
  try {
    const result = await getPromptLibrary()
    expect(result.filter(p => p.sourceId === 'builtin-expressions')).toHaveLength(25)
    expect(mocks.fetch).not.toHaveBeenCalled()
  } finally {
    if (previous === undefined) delete process.env.NOMI_TEST_NETWORK_GUARD
    else process.env.NOMI_TEST_NETWORK_GUARD = previous
  }
})
