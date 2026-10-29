// 项目打开后对节点结果做的后台补全——唯一 owner，两件事同一套纪律：
// ① 补救本地化（2026-07-31 群反馈「生成的视频第二天就加载不出来了」的存量半边）：projectId 空窗时主进程跳过
//    落盘，node.result.url 存的是厂商临时 CDN 链接（会过期）。项目一打开就后台 importRemoteAsset 落盘、把
//    result.url 改写为 nomi-local://（原链接留在 providerUrl），顺带带上落盘回执的预览两栏。
// ② 补预览（2026-10-16 起图片也补）：没有已知预览事实的 nomi-local 图 / 视频——升级前的旧数据、
//    thumbnailUrl 等于 url 的旧形状、或只交了 URL 的入口（白板、截图、抽帧……）——向主进程要一份
//    （sidecar 有就直接给，没有就派生一份），把小图 + 预览事实写回结果。这是画布「预览」不变式的第二道共享边界：
//    第一道是落盘回执（入口出生就带事实），这一道兜住所有没带事实就进了画布的结果，下次打开不再补。
//
// 为什么图片现在可以补（14a5320a0 当年把图片关掉的原因）：那时直接换 src，画布先解码原图、再解码缩略图，
// 一张张闪。现在：先在内存里 img.decode() 把小图解码完再写回（DeferredNodeImage 换 src 时旧图垫着，新图
// 已在解码缓存里，一帧也不空）；只补当前项目、低优先级（空闲时）、并发 2、视口内和靠近视口的先补；
// 源本身已有界（source）或派生不出来（missing）只写事实，src 一个字不变，画面不动。
//
// 纪律：幂等（同 node+url 每次启动只试一次；写回后有事实就不再进队）；失败记「预览缺失」事实，不重试风暴；
// 写回前核对 url 未被替换（重生成 / 转码自愈竞态时绝不覆盖新结果）；只看 result 真变了的节点（打字不触发全表扫描）。
import { hostedAssetCanvasPreview, hostedAssetUrl, importWorkbenchRemoteAssetUrl } from '../api/assetUploadApi'
import { assetKindOf } from '../assets/assetTypes'
import { getDesktopBridge } from '../../desktop/bridge'
import { useGenerationCanvasStore } from './store/generationCanvasStore'
import type { GenerationCanvasNode, GenerationNodeResult } from './model/generationCanvasTypes'
import { isProjectExecutionContextCurrent, subscribeProjectOpened, type ProjectExecutionContext } from '../project/projectCanvasReadSurface'
import { visibleCanvasRect, type CanvasRect } from './store/canvasVisibleArea'
import { deferredNodeMediaQuietForMs } from './nodes/deferredNodeMediaQueue'
import {
  canvasPreviewFieldsFromReceipt,
  hasCanvasPreviewFact,
  type CanvasPreviewFields,
} from '../../../electron/shared/canvas/canvasMediaPreview'

type PreviewReceipt = { thumbnailUrl?: string; previewState?: string } | null | undefined

/** 补全写回不是用户编辑：要存盘（下次打开不用再补），但不进撤销、不发画布事件。 */
const BACKFILL_UPDATE_OPTIONS = { history: false, emit: false } as const

/** 补预览的并发：每张都要主进程起一次 ffmpeg（约一次缩放），2 路足够跟上滚动又不抢前台。 */
export const PREVIEW_BACKFILL_CONCURRENCY = 2
/** 项目打开后先让打开本身跑完（冷开约 2.3s）：这段时间不起任何 ffmpeg。 */
export const PREVIEW_BACKFILL_START_DELAY_MS = 3_000
/** 画布媒体安静这么久才做下一张：打开、平移出一批新图时让路。 */
export const PREVIEW_BACKFILL_QUIET_MS = 1_000

export function shouldRelocalizeResult(result: GenerationNodeResult | null | undefined): boolean {
  if (!result) return false
  if (result.type !== 'image' && result.type !== 'video') return false
  return /^https?:\/\//i.test(String(result.url || '').trim())
}

/** 没有已知预览事实的本地图 / 视频（thumbnailUrl 等于 url 的旧形状也算没有）。已经记了 missing 的不再补。 */
export function shouldBackfillPreview(result: GenerationNodeResult | null | undefined): boolean {
  if (!result || (result.type !== 'image' && result.type !== 'video')) return false
  if (!String(result.url || '').trim().startsWith('nomi-local://')) return false
  return !hasCanvasPreviewFact(result)
}

/** 把回执投影成的预览两栏换进结果：旧的 thumbnailUrl（可能等于 url）和旧事实一律先去掉。 */
function withPreviewFields(result: GenerationNodeResult, fields: CanvasPreviewFields): GenerationNodeResult {
  const { thumbnailUrl: _staleThumbnail, previewState: _staleState, ...rest } = result
  return { ...rest, ...fields }
}

export function relocalizedResultPatch(
  result: GenerationNodeResult,
  localUrl: string,
  assetId?: string,
  preview?: CanvasPreviewFields | null,
): GenerationNodeResult | null {
  const next = String(localUrl || '').trim()
  if (!next || next === result.url) return null
  // 预览两栏来自落盘回执：派生了就挂小图；没派生出来就是明确的事实，不回落成「源即预览」，
  // 视频也不留远端封面链（它和源一起过期）。
  return {
    ...withPreviewFields(result, preview ?? {}),
    url: next,
    providerUrl: result.providerUrl || result.url,
    ...(assetId ? { assetId } : {}),
  }
}

/** 主进程给的预览回执 → 写回的结果；回执没有事实（不是本项目落盘文件）→ null，不写。 */
export function backfilledPreviewPatch(result: GenerationNodeResult, preview: PreviewReceipt): GenerationNodeResult | null {
  if (!preview) return null
  const fields = canvasPreviewFieldsFromReceipt(result.type, preview, result.url)
  if (!fields.previewState && !fields.thumbnailUrl) return null
  return withPreviewFields(result, fields)
}

const attempted = new Set<string>()

/** 写回前的竞态核对：换了项目、节点没了、结果已被替换 → 放弃。版本列表里同一个 url 的条目一起补。 */
function writeBack(project: ProjectExecutionContext, nodeId: string, sourceUrl: string, patchFor: (current: GenerationNodeResult) => GenerationNodeResult | null): void {
  if (!isProjectExecutionContextCurrent(project)) return
  const state = useGenerationCanvasStore.getState()
  const node = state.nodes.find((candidate) => candidate.id === nodeId)
  if (!node) return
  const resultPatch = node.result?.url === sourceUrl ? patchFor(node.result) : null
  let historyChanged = false
  const history = node.history?.map((entry) => {
    if (!entry || entry.url !== sourceUrl) return entry
    const patched = patchFor(entry)
    if (!patched) return entry
    historyChanged = true
    return patched
  })
  if (!resultPatch && !historyChanged) return
  state.updateNode(nodeId, {
    ...(resultPatch ? { result: resultPatch } : {}),
    ...(historyChanged && history ? { history } : {}),
  }, BACKFILL_UPDATE_OPTIONS)
}

async function relocalizeNode(nodeId: string, result: GenerationNodeResult, project: ProjectExecutionContext): Promise<void> {
  const sourceUrl = String(result.url || '')
  // 它该是哪一类就是结果记着的那一类；不是媒体结果就没有可补的本地文件。
  const expectedKind = assetKindOf(result.type)
  if (!expectedKind) return
  try {
    const dto = await importWorkbenchRemoteAssetUrl(sourceUrl, undefined, {
      projectBinding: project.binding, assertCurrent: project.assertCurrent, ownerNodeId: nodeId, kind: 'generated', expectedKind,
    })
    const localUrl = hostedAssetUrl(dto)
    writeBack(project, nodeId, sourceUrl, (current) =>
      relocalizedResultPatch(current, localUrl, dto?.id, hostedAssetCanvasPreview(dto, current.type)))
  } catch {
    // 链接已死 / 换了项目 → 静默不打扰；attempted 只在本次启动生效，下次打开会再试。
  }
}

export type PreviewBackfillDeps = {
  /** 带发起项目的绑定与请求号：项目关了 / 换了 / 窗口没了，主进程就杀掉在途派生（请求登记 electron/ipcRequestRegistry.ts）。 */
  ensurePreview: (payload: { url: string; projectBinding?: ProjectExecutionContext['binding']; requestId?: string }) => Promise<PreviewReceipt>
  /** 渲染层撤回一个在途派生（换项目、桥 dispose）：主进程杀子进程、删产物。 */
  cancelPreview?: (payload: { requestId: string }) => unknown
  /** 在内存里把小图解码完（成功 true）。写回前必须先过这一步：换 src 那一帧新图已在解码缓存里，不闪。 */
  decodePreview: (url: string) => Promise<boolean>
  /** 让出前台：画布媒体安静、主线程空闲时再做下一张；signal 中止就立刻返回。 */
  yieldToForeground: (signal: AbortSignal) => Promise<void>
  /** 项目打开后到开始补之间的等待（让打开本身先跑完）；signal 中止就立刻返回、不再开始。 */
  startDelay?: (signal: AbortSignal) => Promise<void>
}

/** 一次项目打开的补全会话：换项目、项目上下文失效、桥 dispose 都中止它。 */
type BackfillSession = { project: ProjectExecutionContext; signal: AbortSignal }

function sessionLive(session: BackfillSession): boolean {
  return !session.signal.aborted && isProjectExecutionContextCurrent(session.project)
}

function abortableDelay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) { resolve(); return }
    const timer = setTimeout(done, ms)
    function done(): void { clearTimeout(timer); signal.removeEventListener('abort', done); resolve() }
    signal.addEventListener('abort', done, { once: true })
  })
}

let previewRequestSeq = 0

/** 浏览器内建：new Image() + decode()。解码失败（文件坏 / 读不到）→ false。 */
export async function decodePreviewInMemory(url: string): Promise<boolean> {
  if (typeof Image === 'undefined') return false
  const image = new Image()
  image.decoding = 'async'
  image.src = url
  try {
    await image.decode()
    return true
  } catch {
    return false
  }
}

function idleOnce(): Promise<void> {
  return new Promise((resolve) => {
    const idle = (globalThis as { requestIdleCallback?: (cb: () => void, options?: { timeout: number }) => number }).requestIdleCallback
    if (typeof idle === 'function') idle(() => resolve(), { timeout: 2_000 })
    else setTimeout(resolve, 0)
  })
}

/** 等到画布媒体安静 PREVIEW_BACKFILL_QUIET_MS、主线程空闲（低优先级：有图在载入就一直让路）；会话中止就返回。 */
async function yieldUntilCanvasQuiet(signal: AbortSignal): Promise<void> {
  while (!signal.aborted) {
    await idleOnce()
    const quietFor = deferredNodeMediaQuietForMs()
    if (quietFor >= PREVIEW_BACKFILL_QUIET_MS) return
    await abortableDelay(Math.max(250, PREVIEW_BACKFILL_QUIET_MS - quietFor), signal)
  }
}

/**
 * 补一张。返回这一张算不算「试过了」：真正拿到主进程回执（不论有没有派生出小图）才算；
 * 中途被取消（换项目 / dispose / 项目上下文失效）不算——同一项目再打开时照样会补。
 */
async function backfillPreview(candidate: PreviewCandidate, session: BackfillSession, deps: PreviewBackfillDeps): Promise<boolean> {
  const { project, signal } = session
  previewRequestSeq += 1
  const requestId = `preview-${Date.now().toString(36)}-${previewRequestSeq}`
  const cancel = (): void => { void deps.cancelPreview?.({ requestId }) }
  signal.addEventListener('abort', cancel, { once: true })
  let receipt: PreviewReceipt
  try {
    receipt = await deps.ensurePreview({ url: candidate.url, projectBinding: project.binding, requestId })
  } catch {
    // IPC 本身失败（主进程忙）：不写事实，本次启动不再试，下次打开再说——不重试风暴。
    return sessionLive(session)
  } finally {
    signal.removeEventListener('abort', cancel)
  }
  // 会话已中止（换项目 / dispose）：这张不算试过。回执 null = 不是本项目落盘文件，或主进程那边已取消。
  if (!sessionLive(session)) return false
  if (receipt === null) return true
  let fields = canvasPreviewFieldsFromReceipt(candidate.type, receipt, candidate.url)
  if (fields.thumbnailUrl && !(await deps.decodePreview(fields.thumbnailUrl))) {
    // 小图解不出来（坏文件）：如实记缺失，不把一张解不了的图换上去。
    fields = { previewState: 'missing' }
  }
  if (!sessionLive(session)) return false
  if (fields.previewState || fields.thumbnailUrl) writeBack(project, candidate.nodeId, candidate.url, (current) => backfilledPreviewPatch(current, fields))
  return true
}

type PreviewCandidate = { nodeId: string; url: string; type: GenerationNodeResult['type']; distance: number; primary: boolean }

function nodeRect(node: GenerationCanvasNode): CanvasRect {
  return { x: node.position.x, y: node.position.y, width: node.size?.width ?? 320, height: node.size?.height ?? 320 }
}

/** 节点离它所在分类可见区的距离（画布坐标）：可见区里 = 0；舞台未知 → 一律 0，按原顺序。 */
export function distanceToVisibleArea(node: GenerationCanvasNode, view: CanvasRect | null): number {
  if (!view) return 0
  const rect = nodeRect(node)
  const dx = Math.max(view.x - (rect.x + rect.width), 0, rect.x - (view.x + view.width))
  const dy = Math.max(view.y - (rect.y + rect.height), 0, rect.y - (view.y + view.height))
  return Math.hypot(dx, dy)
}

/** 本轮要补的结果：当前结果先于版本列表里的旧版本，再按离视口由近到远。 */
export function collectPreviewCandidates(
  nodes: readonly GenerationCanvasNode[],
  viewFor: (categoryId: string) => CanvasRect | null,
): PreviewCandidate[] {
  const out: PreviewCandidate[] = []
  for (const node of nodes) {
    const distance = distanceToVisibleArea(node, node.categoryId ? viewFor(node.categoryId) : null)
    const seen = new Set<string>()
    const entries = [node.result, ...(node.history ?? [])]
    entries.forEach((entry, index) => {
      if (!entry || !shouldBackfillPreview(entry)) return
      const url = String(entry.url)
      if (seen.has(url)) return
      seen.add(url)
      out.push({ nodeId: node.id, url, type: entry.type, distance, primary: index === 0 })
    })
  }
  return sortPreviewCandidates(out)
}

function sortPreviewCandidates(candidates: PreviewCandidate[]): PreviewCandidate[] {
  return candidates.sort((a, b) => Number(b.primary) - Number(a.primary) || a.distance - b.distance)
}

function defaultPreviewDeps(): PreviewBackfillDeps | null {
  const ensurePreview = getDesktopBridge()?.assets?.ensurePreview
  const cancelPreview = getDesktopBridge()?.assets?.cancelPreview
  if (!ensurePreview) return null
  return {
    ensurePreview,
    decodePreview: decodePreviewInMemory,
    yieldToForeground: yieldUntilCanvasQuiet,
    ...(cancelPreview ? { cancelPreview } : {}),
    startDelay: (signal) => abortableDelay(PREVIEW_BACKFILL_START_DELAY_MS, signal),
  }
}

/**
 * 每打开一个项目签发一次它的生命周期，对它画布里需要补全的节点后台补一次。
 * 目标项目只来自签发，不读「当前项目」；换项目即停。补预览走有界并发队列，每次扫描按离视口远近重排。
 *
 * 生命周期（2026-10-16 V-1209）：每次打开一个会话（AbortController）。换项目、项目上下文失效、返回的解除函数被调用，
 * 都中止会话：清掉启动等待和队列，撤回在途派生（主进程杀子进程），不再写回。「试过了」只在真正拿到回执后才记；
 * 排着队没执行就被撤的不记，同一项目再打开时照样补。
 */
export function initResultMediaBackfillBridge(deps: PreviewBackfillDeps | null = defaultPreviewDeps()): () => void {
  let unsubscribeStore: () => void = () => undefined
  let endSession: () => void = () => undefined
  const unsubscribeOpened = subscribeProjectOpened((project) => {
    unsubscribeStore()
    endSession()
    const controller = new AbortController()
    const session: BackfillSession = { project, signal: controller.signal }
    const projectSignal = (project as { signal?: AbortSignal }).signal
    const onProjectAbort = (): void => controller.abort()
    projectSignal?.addEventListener('abort', onProjectAbort, { once: true })
    endSession = () => {
      controller.abort()
      projectSignal?.removeEventListener('abort', onProjectAbort)
    }
    const seenResults = new WeakSet<GenerationNodeResult>()
    const queuedKeys = new Set<string>()
    let pending: PreviewCandidate[] = []
    let running = 0
    const keyOf = (candidate: PreviewCandidate): string => `${project.binding.projectId}:${candidate.nodeId}:${candidate.url}`
    controller.signal.addEventListener('abort', () => { pending = []; queuedKeys.clear() }, { once: true })
    // 打开本身先跑完，再开始补（只等一次；之后结果变更进来的直接排队，仍受「画布安静」约束）。
    let started = !deps?.startDelay
    const pump = (): void => {
      if (!deps || !started || !sessionLive(session)) return
      while (running < PREVIEW_BACKFILL_CONCURRENCY && pending.length > 0) {
        const next = pending.shift()!
        running += 1
        void (async () => {
          try {
            await deps.yieldToForeground(controller.signal)
            if (!sessionLive(session)) return
            const key = keyOf(next)
            if (attempted.has(key)) return
            if (await backfillPreview(next, session, deps)) attempted.add(key)
          } finally {
            running -= 1
            queuedKeys.delete(keyOf(next))
            pump()
          }
        })()
      }
    }
    const sweep = (): void => {
      if (!sessionLive(session)) return
      const nodes = useGenerationCanvasStore.getState().nodes
      const fresh: GenerationCanvasNode[] = []
      for (const node of nodes) {
        const result = node.result
        if (!result || seenResults.has(result)) continue
        seenResults.add(result)
        const key = `${project.binding.projectId}:${node.id}:${String(result.url || '')}`
        if (shouldRelocalizeResult(result)) {
          if (attempted.has(key)) continue
          attempted.add(key)
          void relocalizeNode(node.id, result, project)
          continue
        }
        fresh.push(node)
      }
      const queued = collectPreviewCandidates(fresh, (categoryId) => visibleCanvasRect(categoryId))
        .filter((candidate) => {
          const key = keyOf(candidate)
          if (attempted.has(key) || queuedKeys.has(key)) return false
          queuedKeys.add(key)
          return true
        })
      if (queued.length === 0) return
      pending = sortPreviewCandidates([...pending, ...queued])
      pump()
    }
    sweep()
    if (!started) void deps!.startDelay!(controller.signal).then(() => { started = true; pump() })
    unsubscribeStore = useGenerationCanvasStore.subscribe((state, previous) => {
      if (state.nodes !== previous.nodes) sweep()
    })
  })
  return () => {
    unsubscribeOpened()
    unsubscribeStore()
    endSession()
  }
}

/** 测试专用：清掉本次启动的「已试过」记录。 */
export function resetResultMediaBackfillAttemptsForTests(): void {
  attempted.clear()
}
