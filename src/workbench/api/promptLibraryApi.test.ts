import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getDesktopBridge } from '../../desktop/bridge'
import { fetchPromptLibrary, fetchUserPrompts, filterPrompts, promptSourceOptions, PROMPT_SOURCE_ALL, type LibraryPrompt } from './promptLibraryApi'

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
    const prompts: LibraryPrompt[] = [
      { id: 'image', title: 'Portrait', prompt: 'soft light', source: 'Nomi', promptType: 'image', mediaType: 'image', tags: [], mediaUrl: '', sourceId: '', sourceUrl: '', origin: 'public' },
      { id: 'video', title: 'Night alley', prompt: 'slow dolly', source: 'Sora', promptType: 'video', mediaType: 'video', tags: [], mediaUrl: '', sourceId: '', sourceUrl: '', origin: 'public' },
    ]

    expect(filterPrompts(prompts, 'video', 'alley').map((prompt) => prompt.id)).toEqual(['video'])
    expect(filterPrompts(prompts, 'all', 'sora').map((prompt) => prompt.id)).toEqual(['video'])
    expect(filterPrompts(prompts, 'image', 'dolly')).toEqual([])
  })
})

const prompt = (overrides: Partial<LibraryPrompt>): LibraryPrompt => ({
  id: 'p',
  title: 'Untitled',
  prompt: 'A cinematic shot',
  mediaUrl: '',
  mediaType: 'image',
  promptType: 'image',
  tags: [],
  source: 'Nomi',
  sourceId: 'nomi',
  sourceUrl: '',
  origin: 'public',
  ...overrides,
})
describe('filterPrompts', () => {
  it('uses existing tags as searchable fields without changing type filtering', () => {
    const items = [
      prompt({ id: 'portrait', title: 'Portrait', tags: ['character', 'close-up'] }),
      prompt({ id: 'motion', title: 'Motion', promptType: 'video', mediaType: 'video', tags: ['camera'] }),
    ]
    expect(filterPrompts(items, 'all', 'close-up').map((item) => item.id)).toEqual(['portrait'])
    expect(filterPrompts(items, 'image', 'camera')).toEqual([])
    expect(filterPrompts(items, 'video', 'camera').map((item) => item.id)).toEqual(['motion'])
  })

  it('filters by source and derives source options from data (no hardcoded vocabulary)', () => {
    const items = [
      prompt({ id: 'a', source: 'GPT Image 2' }),
      prompt({ id: 'b', source: 'Sora 2', promptType: 'video', mediaType: 'video' }),
      prompt({ id: 'c', source: 'GPT Image 2' }),
      prompt({ id: 'd', source: '   ' }), // blank source ignored in options
    ]
    // options preserve first-seen order and dedupe; blank dropped.
    expect(promptSourceOptions(items)).toEqual(['GPT Image 2', 'Sora 2'])
    // default sentinel keeps everything.
    expect(filterPrompts(items, 'all', '', PROMPT_SOURCE_ALL).map((i) => i.id)).toEqual(['a', 'b', 'c', 'd'])
    // narrowing to one source.
    expect(filterPrompts(items, 'all', '', 'GPT Image 2').map((i) => i.id)).toEqual(['a', 'c'])
    // source + type compose.
    expect(filterPrompts(items, 'video', '', 'Sora 2').map((i) => i.id)).toEqual(['b'])
  })
})
