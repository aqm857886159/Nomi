import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getDesktopBridge } from '../../desktop/bridge'
import { setAssistantModelPref } from '../ai/assistantModelPref'
import { getUserPromptsSnapshot, hasLoadedUserPrompts, resetUserPromptListForTests, subscribeUserPrompts } from '../promptLibrary/userPromptList'
import { addUserPrompt, deleteUserPromptWithSnapshot, getTextBrain, fetchPromptLibrary, fetchUserPrompts, filterPrompts, matchesPromptQuery, restoreUserPrompt, updateUserPrompt, type LibraryPrompt } from './promptLibraryApi'

vi.mock('../../desktop/bridge', () => ({ getDesktopBridge: vi.fn() }))
// 订阅者抛错会走渲染层日志（它自己会碰桌面桥）；这里只关心「写不受影响」。
vi.mock('../../desktop/rendererLog', () => ({ logRendererError: vi.fn() }))

const mockedBridge = vi.mocked(getDesktopBridge)

function mountBridge() {
  const list = vi.fn()
  const userList = vi.fn()
  const userAdd = vi.fn()
  const userUpdate = vi.fn()
  const userDelete = vi.fn()
  const userRestore = vi.fn()
  mockedBridge.mockReturnValue({ promptLibrary: { list, userList, userAdd, userUpdate, userDelete, userRestore } } as never)
  return { list, userList, userAdd, userUpdate, userDelete, userRestore }
}

describe('promptLibraryApi', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetUserPromptListForTests()
  })

  it('asks the text brain with the model the Agent panel picked, so 「跟随 Agent」 follows it', async () => {
    const textBrain = vi.fn().mockResolvedValue({ ok: true, brain: { vendor: 'b', modelKey: 'chat-b' }, status: 'ok' })
    mockedBridge.mockReturnValue({ promptLibrary: { textBrain } } as never)
    const store = new Map<string, string>()
    vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) })
    vi.stubGlobal('window', { dispatchEvent: () => true })
    setAssistantModelPref({ vendorKey: 'b', modelKey: 'chat-b' })
    await expect(getTextBrain()).resolves.toEqual({ vendor: 'b', modelKey: 'chat-b' })
    expect(textBrain).toHaveBeenLastCalledWith({ vendorKey: 'b', modelKey: 'chat-b' })
    setAssistantModelPref(null)
    await getTextBrain()
    expect(textBrain).toHaveBeenLastCalledWith(undefined)
    vi.unstubAllGlobals()
  })

  it('strict: throws a settings-pointing error when the chosen model is unavailable; non-strict falls back', async () => {
    const textBrain = vi.fn().mockResolvedValue({ ok: false, brain: null, status: 'missing', preferredUnavailable: true })
    mockedBridge.mockReturnValue({ promptLibrary: { textBrain } } as never)
    const store = new Map<string, string>([['nomi.assistantModel', JSON.stringify({ vendorKey: 'b', modelKey: 'gone' })]])
    vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null })
    await expect(getTextBrain({ strict: true })).rejects.toThrow(/no usable text model.*Settings → Models/i)
    expect(textBrain).toHaveBeenLastCalledWith({ vendorKey: 'b', modelKey: 'gone', strict: true })
    textBrain.mockResolvedValue({ ok: true, brain: { vendor: 'a', modelKey: 'chat' }, status: 'ok' })
    await expect(getTextBrain()).resolves.toEqual({ vendor: 'a', modelKey: 'chat' })
    expect(textBrain).toHaveBeenLastCalledWith({ vendorKey: 'b', modelKey: 'gone' })
    vi.unstubAllGlobals()
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

  it('rejects failed or malformed reads instead of disguising failure as an empty library', async () => {
    const { list, userList } = mountBridge()
    list.mockResolvedValueOnce({ ok: false, prompts: [], error: 'offline' }).mockResolvedValueOnce({ ok: true })
    userList.mockResolvedValue({ ok: false, prompts: [], error: 'offline' })

    await expect(fetchPromptLibrary()).rejects.toThrow('offline')
    await expect(fetchPromptLibrary()).rejects.toThrow()
    await expect(fetchUserPrompts()).rejects.toThrow('offline')
  })

  it('keeps the complete delete snapshot across the renderer mapping and restores it through the same bridge', async () => {
    const deleted = {
      id: 'mine-1',
      prompt: 'full prompt',
      origin: 'user',
      title: 'Full',
      promptType: 'image',
      mediaType: 'image',
      mediaUrl: 'nomi-local://asset/p/ref.png',
      tags: ['tag'],
      referenceImages: [{ url: 'nomi-local://asset/p/ref.png', title: 'Ref' }],
      updatedAt: '2026-01-01T00:00:00.000Z',
      futureField: { keep: true },
    }
    const userDelete = vi.fn().mockResolvedValue({ ok: true, prompts: [], deleted })
    const userRestore = vi.fn().mockResolvedValue({ ok: true, prompts: [deleted] })
    mockedBridge.mockReturnValue({ promptLibrary: { userDelete, userRestore } } as never)

    const result = await deleteUserPromptWithSnapshot('mine-1')
    expect(result.items).toEqual([])
    expect(result.deleted).toMatchObject({ id: 'mine-1', tags: ['tag'], referenceImages: deleted.referenceImages, futureField: { keep: true } })
    await expect(restoreUserPrompt(result.deleted!)).resolves.toMatchObject([{ id: 'mine-1', futureField: { keep: true } }])
    expect(userRestore).toHaveBeenCalledWith(expect.objectContaining({ id: 'mine-1', futureField: { keep: true } }))
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

  // 来源标签那一长排（P-03）并进了提示词库的分类列：来源不再单独筛，但搜来源名仍能搜到。
  it('still finds prompts by their source name through the shared query matcher', () => {
    const items = [
      prompt({ id: 'a', source: 'GPT Image 2' }),
      prompt({ id: 'b', source: 'Sora 2', promptType: 'video', mediaType: 'video' }),
    ]
    expect(items.filter((item) => matchesPromptQuery(item, 'sora')).map((item) => item.id)).toEqual(['b'])
    expect(filterPrompts(items, 'all', '').map((item) => item.id)).toEqual(['a', 'b'])
    expect(filterPrompts(items, 'image', 'sora')).toEqual([])
  })
})

// —— 「我的库」列表的出口：读口 + 4 个写口收到的整表，都只经 acceptUserPromptList 发布进共享缓存 ——
// 渲染层这份列表只有一个持有者（promptLibrary/userPromptList.ts）。直调写口（浏览器提取、保存选中文字、画布选区存库、素材面迁移
// 都是这样写的）不经过任何 hook，所以这里不挂 hook：直接看缓存和订阅者。挂着 hook 的整条链路在 useUserPrompts.behavior.test.tsx。
const row = (id: string, prompt = id) => ({ id, prompt, promptType: 'image', origin: 'user' })
const promptsOf = (items: LibraryPrompt[]): string[] => items.map((item) => item.prompt)

/** 4 个写口：各自的桥方法、调用方式、主进程这一次回的整表（写之前库里是 old 一条）。 */
const WRITE_PORTS = [
  { name: 'add', method: 'userAdd', run: () => addUserPrompt({ prompt: 'added', promptType: 'image' }), answer: { ok: true, prompts: [row('added'), row('old')] } },
  { name: 'update', method: 'userUpdate', run: () => updateUserPrompt('old', { prompt: 'edited' }), answer: { ok: true, prompts: [row('old', 'edited')] } },
  { name: 'delete', method: 'userDelete', run: () => deleteUserPromptWithSnapshot('old'), answer: { ok: true, prompts: [], deleted: row('old') } },
  { name: 'restore', method: 'userRestore', run: () => restoreUserPrompt(row('old') as never), answer: { ok: true, prompts: [row('old'), row('restored')] } },
] as const

describe('promptLibraryApi · 我的库列表只有一个出口', () => {
  const unsubscribers: Array<() => void> = []
  function wakeCounter(): { count: () => number } {
    let woken = 0
    unsubscribers.push(subscribeUserPrompts(() => { woken += 1 }))
    return { count: () => woken }
  }
  async function warmWithOld(bridge: ReturnType<typeof mountBridge>): Promise<void> {
    bridge.userList.mockResolvedValue({ ok: true, prompts: [row('old')] })
    await fetchUserPrompts()
  }

  beforeEach(() => {
    vi.clearAllMocks()
    resetUserPromptListForTests()
  })

  afterEach(() => {
    for (const off of unsubscribers.splice(0)) off()
  })

  it.each(WRITE_PORTS)('$name：直调写口，整表发布进共享缓存并叫醒订阅者一次，调用方拿到的是同一份', async ({ method, run, answer }) => {
    const bridge = mountBridge()
    await warmWithOld(bridge)
    bridge[method].mockResolvedValue(answer)
    const woken = wakeCounter()

    const result = await run()

    expect(promptsOf(getUserPromptsSnapshot())).toEqual(answer.prompts.map((item) => item.prompt))
    expect(woken.count()).toBe(1)
    expect(bridge[method]).toHaveBeenCalledTimes(1)
    // 写口自己不再读盘：整表就是主进程这次回的那份。
    expect(bridge.userList).toHaveBeenCalledTimes(1)
    expect(promptsOf(Array.isArray(result) ? result : result.items)).toEqual(promptsOf(getUserPromptsSnapshot()))
  })

  it.each(WRITE_PORTS)('$name：缓存还没载入时的第一次写也能初始化缓存（谁都没读过库、直接写，抽屉之后打开就是对的）', async ({ method, run, answer }) => {
    const bridge = mountBridge()
    bridge[method].mockResolvedValue(answer)
    expect(hasLoadedUserPrompts()).toBe(false)

    await run()

    expect(hasLoadedUserPrompts()).toBe(true)
    expect(promptsOf(getUserPromptsSnapshot())).toEqual(answer.prompts.map((item) => item.prompt))
  })

  it.each(WRITE_PORTS)('$name：写失败（ok:false 或桥抛错）不发布：缓存不变、订阅者不被叫醒、调用方拿到报错', async ({ method, run }) => {
    const bridge = mountBridge()
    await warmWithOld(bridge)
    const before = getUserPromptsSnapshot()
    const woken = wakeCounter()

    // 失败应答里也带着 prompts（主进程会回此刻的盘），照样不能当成「这次写的结果」发布。
    bridge[method].mockResolvedValue({ ok: false, error: 'disk full', prompts: [row('x')] })
    await expect(run()).rejects.toThrow('disk full')
    bridge[method].mockResolvedValue({ ok: false, prompts: [] })
    await expect(run()).rejects.toThrow(/./)
    bridge[method].mockRejectedValue(new Error('ipc down'))
    await expect(run()).rejects.toThrow('ipc down')

    expect(getUserPromptsSnapshot()).toBe(before)
    expect(woken.count()).toBe(0)
  })

  it.each(WRITE_PORTS)('$name：ok 但 prompts 不是数组，按失败处理，不把「空库」发布出去', async ({ method, run }) => {
    const bridge = mountBridge()
    await warmWithOld(bridge)
    const before = getUserPromptsSnapshot()
    const woken = wakeCounter()

    for (const malformed of [{ ok: true }, { ok: true, prompts: null }, { ok: true, prompts: 'oops' }]) {
      bridge[method].mockResolvedValue(malformed)
      await expect(run()).rejects.toThrow(/./)
    }

    expect(getUserPromptsSnapshot()).toBe(before)
    expect(woken.count()).toBe(0)
  })

  it('读口也发布：fetchUserPrompts 读到的整表就是缓存里的那份；读失败不动缓存', async () => {
    const bridge = mountBridge()
    bridge.userList.mockResolvedValueOnce({ ok: true, prompts: [row('mine-1'), row('mine-2')] })
    const read = await fetchUserPrompts()
    expect(getUserPromptsSnapshot()).toBe(read)
    expect(promptsOf(read)).toEqual(['mine-1', 'mine-2'])

    bridge.userList.mockResolvedValueOnce({ ok: false, prompts: [], error: 'offline' })
    await expect(fetchUserPrompts()).rejects.toThrow('offline')
    expect(getUserPromptsSnapshot()).toBe(read)
  })

  it('读在途时写先落了地：晚到的旧读结果不会把缓存盖回去（调用读口的人仍拿到自己那份应答）', async () => {
    const bridge = mountBridge()
    let answerRead!: (value: unknown) => void
    bridge.userList.mockReturnValue(new Promise((resolve) => { answerRead = resolve }))
    bridge.userAdd.mockResolvedValue({ ok: true, prompts: [row('new'), row('old')] })

    const read = fetchUserPrompts()
    await addUserPrompt({ prompt: 'new', promptType: 'image' })
    answerRead({ ok: true, prompts: [row('old')] }) // 这是写之前的盘
    await expect(read).resolves.toHaveLength(1)

    expect(promptsOf(getUserPromptsSnapshot())).toEqual(['new', 'old'])
  })

  it('两次写的应答乱序到达：以发起顺序为准，先发起的那次晚到不会盖掉后发起的', async () => {
    const bridge = mountBridge()
    let answerFirst!: (value: unknown) => void
    bridge.userAdd
      .mockReturnValueOnce(new Promise((resolve) => { answerFirst = resolve }))
      .mockResolvedValueOnce({ ok: true, prompts: [row('second'), row('first')] })

    const first = addUserPrompt({ prompt: 'first', promptType: 'image' })
    const second = addUserPrompt({ prompt: 'second', promptType: 'image' })
    await second
    answerFirst({ ok: true, prompts: [row('first')] })
    await first

    expect(promptsOf(getUserPromptsSnapshot())).toEqual(['second', 'first'])
  })

  it('订阅者抛错不会把一次已经成功的写变成「写失败」（用户会重试，库里就多一条重复的）', async () => {
    const bridge = mountBridge()
    bridge.userAdd.mockResolvedValue({ ok: true, prompts: [row('saved')] })
    unsubscribers.push(subscribeUserPrompts(() => { throw new Error('listener exploded') }))

    await expect(addUserPrompt({ prompt: 'saved', promptType: 'image' })).resolves.toHaveLength(1)
    expect(promptsOf(getUserPromptsSnapshot())).toEqual(['saved'])
  })
})
