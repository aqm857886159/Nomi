import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getDesktopBridge } from '../../desktop/bridge'
import { fetchPromptLibrary, fetchUserPrompts, filterPrompts } from './promptLibraryApi'

vi.mock('../../desktop/bridge', () => ({ getDesktopBridge: vi.fn() }))

const mockedBridge = vi.mocked(getDesktopBridge)

function mountBridge() {
  const list = vi.fn()
  const userList = vi.fn()
  mockedBridge.mockReturnValue({ promptLibrary: { list, userList } } as never)
  return { list, userList }
}

describe('promptLibraryApi', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('maps valid public and user rows while dropping malformed payloads', async () => {
    const { list, userList } = mountBridge()
    list.mockResolvedValue({
      ok: true,
      prompts: [
        { id: 'public-1', prompt: 'keep the subject identity', title: 'Identity', mediaType: 'video', promptType: 'video', source: 'Nomi', tags: ['identity'] },
        { id: 'missing-prompt', prompt: '' },
        null,
      ],
    })
    userList.mockResolvedValue({
      ok: true,
      prompts: [{ id: 'mine-1', prompt: 'my prompt', origin: 'user', promptType: 'image' }],
    })

    await expect(fetchPromptLibrary()).resolves.toEqual([
      expect.objectContaining({ id: 'public-1', prompt: 'keep the subject identity', promptType: 'video', origin: 'public' }),
    ])
    await expect(fetchUserPrompts()).resolves.toEqual([
      expect.objectContaining({ id: 'mine-1', prompt: 'my prompt', promptType: 'image', origin: 'user' }),
    ])
  })

  it('returns an empty list for a failed or malformed desktop response', async () => {
    const { list, userList } = mountBridge()
    list.mockResolvedValueOnce({ ok: false, prompts: [], error: 'offline' }).mockResolvedValueOnce({ ok: true })
    userList.mockResolvedValue({ ok: false, prompts: [], error: 'offline' })

    await expect(fetchPromptLibrary()).resolves.toEqual([])
    await expect(fetchPromptLibrary()).resolves.toEqual([])
    await expect(fetchUserPrompts()).resolves.toEqual([])
  })

  it('filters by prompt type and searchable title/body/source without another data owner', () => {
    const prompts = [
      { id: 'image', title: 'Portrait', prompt: 'soft light', source: 'Nomi', promptType: 'image', mediaType: 'image', tags: [], mediaUrl: '', sourceId: '', sourceUrl: '', origin: 'public' as const },
      { id: 'video', title: 'Night alley', prompt: 'slow dolly', source: 'Sora', promptType: 'video', mediaType: 'video', tags: [], mediaUrl: '', sourceId: '', sourceUrl: '', origin: 'public' as const },
    ]

    expect(filterPrompts(prompts, 'video', 'alley').map((prompt) => prompt.id)).toEqual(['video'])
    expect(filterPrompts(prompts, 'all', 'sora').map((prompt) => prompt.id)).toEqual(['video'])
    expect(filterPrompts(prompts, 'image', 'dolly')).toEqual([])
  })
})
