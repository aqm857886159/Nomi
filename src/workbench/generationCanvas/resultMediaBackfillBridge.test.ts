// 项目打开后的结果补全。
// 锁的行为：① 只救 http(s) 的图/视频结果，写回本地 url 时原链保进 providerUrl，预览两栏只来自落盘回执；
// ② 补预览：没有已知预览事实的本地图 / 视频（含 thumbnailUrl = url 的旧形状）都补，图片也补（2026-10-16）；
//    已有事实的（ready / source / missing）不再补——missing 不重试；
// ③ 队列：并发 ≤ 2、视口内先补、小图在内存里解码完才写回、写回前核对 url 没被换。
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { GenerationCanvasNode, GenerationNodeResult } from './model/generationCanvasTypes'

type Listener = (state: { nodes: GenerationCanvasNode[] }, previous: { nodes: GenerationCanvasNode[] }) => void
const canvas = vi.hoisted(() => ({
  state: { nodes: [] as GenerationCanvasNode[], updateNode: (_id: string, _patch: Partial<GenerationCanvasNode>, _options?: unknown) => {} },
  listeners: [] as Listener[],
  openProject: null as null | ((project: unknown) => void),
  view: { x: 0, y: 0, width: 1000, height: 800 } as { x: number; y: number; width: number; height: number } | null,
}))

vi.mock('./store/generationCanvasStore', () => ({
  useGenerationCanvasStore: {
    getState: () => canvas.state,
    subscribe: (listener: Listener) => { canvas.listeners.push(listener); return () => { canvas.listeners = canvas.listeners.filter((l) => l !== listener) } },
  },
}))
vi.mock('../project/projectCanvasReadSurface', () => ({
  subscribeProjectOpened: (listener: (project: unknown) => void) => { canvas.openProject = listener; return () => { canvas.openProject = null } },
  // 真按项目上下文走：签发的 context 带 signal，项目关了 / 换了 = signal 中止 = 不再是当前项目。
  isProjectExecutionContextCurrent: (project: { signal?: AbortSignal } | undefined) => !project?.signal?.aborted,
}))
vi.mock('./store/canvasVisibleArea', () => ({ visibleCanvasRect: () => canvas.view }))

const {
  backfilledPreviewPatch,
  collectPreviewCandidates,
  initResultMediaBackfillBridge,
  relocalizedResultPatch,
  resetResultMediaBackfillAttemptsForTests,
  shouldBackfillPreview,
  shouldRelocalizeResult,
} = await import('./resultMediaBackfillBridge')

function result(partial: Partial<GenerationNodeResult>): GenerationNodeResult {
  return { id: 'r1', type: 'video', createdAt: 0, ...partial } as GenerationNodeResult
}

function imageNode(id: string, x: number, partial: Partial<GenerationNodeResult> = {}): GenerationCanvasNode {
  const url = `nomi-local://asset/p1/assets/${id}.png`
  return {
    id, kind: 'image', title: id, categoryId: 'canvas', position: { x, y: 0 }, size: { width: 300, height: 300 },
    result: result({ id: `${id}-r`, type: 'image', url, ...partial }),
  } as unknown as GenerationCanvasNode
}

describe('shouldRelocalizeResult', () => {
  it('http(s) 的图/视频结果要救', () => {
    expect(shouldRelocalizeResult(result({ type: 'video', url: 'https://cdn.vendor.com/a.mp4' }))).toBe(true)
    expect(shouldRelocalizeResult(result({ type: 'image', url: 'http://cdn.vendor.com/a.png' }))).toBe(true)
  })

  it('已本地化(nomi-local)/文本/3D/空结果不动', () => {
    expect(shouldRelocalizeResult(result({ url: 'nomi-local://p1/assets/a.mp4' }))).toBe(false)
    expect(shouldRelocalizeResult(result({ type: 'text', url: 'https://x.com/a' }))).toBe(false)
    expect(shouldRelocalizeResult(result({ type: 'model3d', url: 'https://x.com/a.glb' }))).toBe(false)
    expect(shouldRelocalizeResult(result({ url: '' }))).toBe(false)
    expect(shouldRelocalizeResult(undefined)).toBe(false)
  })
})

describe('relocalizedResultPatch', () => {
  it('reported case：图片没派生预览时不再把本地源填进 thumbnailUrl，旧的远端「预览」（= 源）一并去掉', () => {
    const source = result({ type: 'image', url: 'https://cdn.vendor.com/a.png', thumbnailUrl: 'https://cdn.vendor.com/a.png' })
    const patch = relocalizedResultPatch(source, 'nomi-local://p1/assets/a.png', 'asset-1', { previewState: 'source' })
    expect(patch?.url).toBe('nomi-local://p1/assets/a.png')
    expect(patch?.providerUrl).toBe('https://cdn.vendor.com/a.png')
    expect(patch).not.toHaveProperty('thumbnailUrl')
    expect(patch?.previewState).toBe('source')
    expect(patch?.assetId).toBe('asset-1')
  })

  it('落盘回执派生了预览 → 图片/视频都挂预览；视频没派生出 poster → 不留会过期的远端封面链', () => {
    const image = result({ type: 'image', url: 'https://cdn.vendor.com/a.png' })
    const patch = relocalizedResultPatch(image, 'nomi-local://p1/assets/a.png', 'asset-1', { thumbnailUrl: 'nomi-local://p1/assets/a.preview.jpg', previewState: 'ready' })
    expect(patch).toMatchObject({ thumbnailUrl: 'nomi-local://p1/assets/a.preview.jpg', previewState: 'ready' })
    const video = result({ type: 'video', url: 'https://cdn.vendor.com/a.mp4', thumbnailUrl: 'https://cdn.vendor.com/poster.jpg' })
    expect(relocalizedResultPatch(video, 'nomi-local://p1/assets/a.mp4', undefined, { thumbnailUrl: 'nomi-local://p1/assets/a.preview.jpg', previewState: 'ready' })?.thumbnailUrl).toBe('nomi-local://p1/assets/a.preview.jpg')
    const noPoster = relocalizedResultPatch(video, 'nomi-local://p1/assets/a.mp4', undefined, { previewState: 'missing' })
    expect(noPoster).not.toHaveProperty('thumbnailUrl')
    expect(noPoster?.previewState).toBe('missing')
  })

  it('已有 providerUrl 不覆盖；本地 url 为空/与原值相同 → null（不产生无谓写）', () => {
    const source = result({ url: 'https://cdn.vendor.com/a.mp4', providerUrl: 'https://origin.vendor.com/a.mp4' })
    expect(relocalizedResultPatch(source, 'nomi-local://p1/assets/a.mp4')?.providerUrl).toBe('https://origin.vendor.com/a.mp4')
    expect(relocalizedResultPatch(source, '')).toBeNull()
    expect(relocalizedResultPatch(source, 'https://cdn.vendor.com/a.mp4')).toBeNull()
  })
})

describe('shouldBackfillPreview / backfilledPreviewPatch', () => {
  it('没有已知预览事实的本地图 / 视频都补（含 thumbnailUrl = url 的旧形状）；有事实的不补，missing 不重试', () => {
    expect(shouldBackfillPreview(result({ url: 'nomi-local://asset/p1/assets/a.mp4' }))).toBe(true)
    expect(shouldBackfillPreview(result({ type: 'image', url: 'nomi-local://asset/p1/assets/a.png' }))).toBe(true)
    expect(shouldBackfillPreview(result({ type: 'image', url: 'nomi-local://asset/p1/assets/a.png', thumbnailUrl: 'nomi-local://asset/p1/assets/a.png' }))).toBe(true)
    expect(shouldBackfillPreview(result({ url: 'nomi-local://asset/p1/assets/a.mp4', thumbnailUrl: 'nomi-local://asset/p1/assets/a.preview.jpg' }))).toBe(false)
    for (const previewState of ['ready', 'source', 'missing'] as const) {
      expect(shouldBackfillPreview(result({ type: 'image', url: 'nomi-local://asset/p1/assets/a.png', previewState }))).toBe(false)
    }
    expect(shouldBackfillPreview(result({ url: 'https://cdn.vendor.com/a.mp4' }))).toBe(false)
    expect(shouldBackfillPreview(result({ type: 'text', url: 'nomi-local://asset/p1/a.txt' }))).toBe(false)
    expect(shouldBackfillPreview(undefined)).toBe(false)
  })

  it('回执 → 写回：ready 挂小图；source / missing 只写事实并去掉等于源的旧 thumbnailUrl；不是本项目文件（null）→ 不写', () => {
    const legacy = result({ type: 'image', url: 'nomi-local://asset/p1/assets/a.png', thumbnailUrl: 'nomi-local://asset/p1/assets/a.png' })
    expect(backfilledPreviewPatch(legacy, { thumbnailUrl: 'nomi-local://asset/p1/assets/a.preview.jpg', previewState: 'ready' }))
      .toMatchObject({ thumbnailUrl: 'nomi-local://asset/p1/assets/a.preview.jpg', previewState: 'ready' })
    const bounded = backfilledPreviewPatch(legacy, { previewState: 'source' })
    expect(bounded).not.toHaveProperty('thumbnailUrl')
    expect(bounded?.previewState).toBe('source')
    expect(backfilledPreviewPatch(legacy, { previewState: 'missing' })?.previewState).toBe('missing')
    expect(backfilledPreviewPatch(legacy, null)).toBeNull()
    expect(backfilledPreviewPatch(legacy, {})).toBeNull()
  })
})

describe('补预览队列', () => {
  beforeEach(() => {
    resetResultMediaBackfillAttemptsForTests()
    canvas.listeners = []
    canvas.view = { x: 0, y: 0, width: 1000, height: 800 }
  })

  it('视口内先补、离视口近的先于远的；当前结果先于版本列表里的旧版本', () => {
    const near = imageNode('near', 1200)
    const inside = imageNode('inside', 100)
    const far = imageNode('far', 9000)
    const withHistory = { ...imageNode('hist', 200), history: [result({ id: 'old', type: 'image', url: 'nomi-local://asset/p1/assets/old.png' })] } as GenerationCanvasNode
    const order = collectPreviewCandidates([far, near, withHistory, inside], () => canvas.view).map((candidate) => candidate.url.replace(/^.*assets\//, ''))
    expect(order).toEqual(['hist.png', 'inside.png', 'near.png', 'far.png', 'old.png'])
  })

  it('并发不超过 2；小图在内存里解码完才写回；回填不单独存盘或进撤销；失败只记一次 missing，不重试', async () => {
    const nodes = Array.from({ length: 6 }, (_, index) => imageNode(`n${index}`, index * 100))
    nodes.push(imageNode('broken', 50))
    const updates: Array<{ id: string; patch: Partial<GenerationCanvasNode>; options: unknown }> = []
    canvas.state = {
      nodes,
      updateNode: (id, patch, options) => {
        updates.push({ id, patch, options })
        canvas.state = { ...canvas.state, nodes: canvas.state.nodes.map((node) => node.id === id ? { ...node, ...patch } : node) }
      },
    }
    let inFlight = 0
    let peak = 0
    const events: string[] = []
    const ensurePreview = vi.fn(async ({ url }: { url: string }) => {
      inFlight += 1
      peak = Math.max(peak, inFlight)
      await new Promise((resolve) => setTimeout(resolve, 5))
      inFlight -= 1
      if (url.includes('broken')) return { previewState: 'missing' }
      return { thumbnailUrl: url.replace('.png', '.preview.jpg'), previewState: 'ready' }
    })
    const decodePreview = vi.fn(async (url: string) => { events.push(`decode:${url.replace(/^.*assets\//, '')}`); return true })
    const dispose = initResultMediaBackfillBridge({ ensurePreview, decodePreview, yieldToForeground: async () => {} })
    canvas.openProject?.({ binding: { projectId: 'p1' } })
    await vi.waitFor(() => expect(updates).toHaveLength(7))
    expect(peak).toBeLessThanOrEqual(2)
    expect(ensurePreview).toHaveBeenCalledTimes(7)
    // 每张 ready 的写回之前，它的小图都已经解码过。
    for (const update of updates.filter((u) => u.id !== 'broken')) {
      expect(events).toContain(`decode:${update.id}.preview.jpg`)
      expect(update.patch.result).toMatchObject({ thumbnailUrl: expect.stringMatching(/\.preview\.jpg$/), previewState: 'ready' })
      expect(update.options).toEqual({ history: false, emit: false, persist: false })
    }
    expect(updates.find((u) => u.id === 'broken')?.patch.result).toMatchObject({ previewState: 'missing' })
    expect(decodePreview).not.toHaveBeenCalledWith(expect.stringContaining('broken'))
    // 写回触发的再次扫描不再补任何一张（有事实了；missing 也不重试）。
    for (const listener of canvas.listeners) listener(canvas.state, { nodes })
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(ensurePreview).toHaveBeenCalledTimes(7)
    dispose()
  })

  it('小图解不出来 → 记 missing，不把解不了的图换上去；结果在补的过程中被换掉 → 不覆盖新结果', async () => {
    const replaced = imageNode('replaced', 0)
    const corrupt = imageNode('corrupt', 100)
    canvas.state = {
      nodes: [replaced, corrupt],
      updateNode: (id, patch) => { canvas.state = { ...canvas.state, nodes: canvas.state.nodes.map((node) => node.id === id ? { ...node, ...patch } : node) } },
    }
    const update = vi.spyOn(canvas.state, 'updateNode')
    const ensurePreview = vi.fn(async ({ url }: { url: string }) => {
      if (url.includes('replaced')) {
        // 补的过程中用户重新生成了：结果 url 换掉了。
        canvas.state = { ...canvas.state, nodes: canvas.state.nodes.map((node) => node.id === 'replaced' ? { ...node, result: result({ id: 'new', type: 'image', url: 'nomi-local://asset/p1/assets/new.png', previewState: 'ready', thumbnailUrl: 'nomi-local://asset/p1/assets/new.preview.jpg' }) } : node) }
      }
      return { thumbnailUrl: url.replace('.png', '.preview.jpg'), previewState: 'ready' }
    })
    const dispose = initResultMediaBackfillBridge({ ensurePreview, decodePreview: async (url) => !url.includes('corrupt'), yieldToForeground: async () => {} })
    canvas.openProject?.({ binding: { projectId: 'p1' } })
    await vi.waitFor(() => expect(ensurePreview).toHaveBeenCalledTimes(2))
    await new Promise((resolve) => setTimeout(resolve, 10))
    const latest = canvas.state.nodes
    expect(latest.find((node) => node.id === 'replaced')?.result?.url).toBe('nomi-local://asset/p1/assets/new.png')
    expect(latest.find((node) => node.id === 'corrupt')?.result).toMatchObject({ previewState: 'missing' })
    expect(latest.find((node) => node.id === 'corrupt')?.result).not.toHaveProperty('thumbnailUrl')
    expect(update).toHaveBeenCalledTimes(1)
    dispose()
  })

  it('低优先级：打开本身跑完之前（startDelay 未到）不起任何派生，到了才开始', async () => {
    canvas.state = { nodes: [imageNode('late', 0)], updateNode: () => {} }
    let release!: () => void
    const ensurePreview = vi.fn(async () => ({ previewState: 'source' }))
    const dispose = initResultMediaBackfillBridge({
      ensurePreview, decodePreview: async () => true, yieldToForeground: async () => {},
      startDelay: () => new Promise<void>((resolve) => { release = resolve }),
    })
    canvas.openProject?.({ binding: { projectId: 'p1' } })
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(ensurePreview).not.toHaveBeenCalled()
    release()
    await vi.waitFor(() => expect(ensurePreview).toHaveBeenCalledTimes(1))
    dispose()
  })
})

// 生命周期（V-1209 首轮不通过的两项）：换项目 / 项目上下文失效 / dispose 必须撤掉排队和在途的补预览；
// 排队没执行就被撤的，同一项目再打开要能补上。context 用真的 AbortSignal，不恒定 true。
describe('补预览会话的生命周期', () => {
  const projectContext = () => {
    const controller = new AbortController()
    return { context: { binding: { projectId: 'p1' }, signal: controller.signal }, close: () => controller.abort() }
  }

  beforeEach(() => {
    resetResultMediaBackfillAttemptsForTests()
    canvas.listeners = []
    canvas.view = { x: 0, y: 0, width: 1000, height: 800 }
    canvas.state = { nodes: [imageNode('queued', 0)], updateNode: vi.fn() }
  })

  it('排队还没执行项目就关了：不起派生；同一项目再打开时照样补（不被永久跳过）', async () => {
    const releases: Array<() => void> = []
    const ensurePreview = vi.fn(async () => ({ previewState: 'source' }))
    const dispose = initResultMediaBackfillBridge({
      ensurePreview, decodePreview: async () => true, yieldToForeground: async () => {},
      startDelay: () => new Promise<void>((resolve) => { releases.push(resolve) }),
    })
    const first = projectContext()
    canvas.openProject?.(first.context)
    first.close()
    releases.shift()!()
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(ensurePreview).toHaveBeenCalledTimes(0)
    canvas.openProject?.(projectContext().context)
    releases.shift()!()
    await vi.waitFor(() => expect(ensurePreview).toHaveBeenCalledTimes(1))
    dispose()
  })

  it('dispose 清掉启动等待和队列：项目上下文仍有效，dispose 之后也不再起任何派生', async () => {
    let release!: () => void
    const ensurePreview = vi.fn(async () => ({ previewState: 'source' }))
    const dispose = initResultMediaBackfillBridge({
      ensurePreview, decodePreview: async () => true, yieldToForeground: async () => {},
      startDelay: () => new Promise<void>((resolve) => { release = resolve }),
    })
    canvas.openProject?.(projectContext().context)
    dispose()
    release()
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(ensurePreview).toHaveBeenCalledTimes(0)
  })

  it('在途派生时项目关了：带请求号撤回主进程那一张，不写回、不记试过；再打开重新补', async () => {
    type Receipt = { previewState?: string } | null
    const pendingCalls: Array<{ payload: { url: string; projectBinding?: unknown; requestId?: string }; resolve: (value: Receipt) => void }> = []
    const ensurePreview = vi.fn((payload: { url: string; projectBinding?: unknown; requestId?: string }) =>
      new Promise<Receipt>((resolve) => { pendingCalls.push({ payload, resolve }) }))
    const cancelPreview = vi.fn()
    const update = vi.fn()
    canvas.state = { nodes: [imageNode('inflight', 0)], updateNode: update }
    const dispose = initResultMediaBackfillBridge({ ensurePreview, cancelPreview, decodePreview: async () => true, yieldToForeground: async () => {} })
    const first = projectContext()
    canvas.openProject?.(first.context)
    await vi.waitFor(() => expect(ensurePreview).toHaveBeenCalledTimes(1))
    const call = pendingCalls[0]!
    // 请求带着发起项目的绑定与请求号：主进程据此在项目失效时杀进程。
    expect(call.payload).toMatchObject({ projectBinding: { projectId: 'p1' }, requestId: expect.stringMatching(/^preview-/) })
    first.close()
    expect(cancelPreview).toHaveBeenCalledWith({ requestId: call.payload.requestId })
    call.resolve(null)
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(update).not.toHaveBeenCalled()
    canvas.openProject?.(projectContext().context)
    await vi.waitFor(() => expect(ensurePreview).toHaveBeenCalledTimes(2))
    pendingCalls[1]!.resolve({ previewState: 'source' })
    await vi.waitFor(() => expect(update).toHaveBeenCalledTimes(1))
    dispose()
  })
})
