// 项目打开后对节点结果做的后台补全——唯一 owner，两件事同一套纪律：
// ① 补救本地化（2026-07-31 群反馈「生成的视频第二天就加载不出来了」的存量半边）：projectId 空窗时主进程跳过
//    落盘，node.result.url 存的是厂商临时 CDN 链接（会过期）。项目一打开就后台 importRemoteAsset 落盘、把
//    result.url 改写为 nomi-local://（原链接留在 providerUrl），顺带带上落盘边界派生的预览。
// ② 补封面（2026-09-25 画布跟手方案第 1 步）：早于「落盘边界派生预览」或经旧导入路径进来的 nomi-local
//    图片 / 视频没有 thumbnailUrl，画布只能挂原片（视频就得挂 <video>）。向主进程要一份（有缓存直接给，
//    没有就抽一帧），写回 result。
// 纪律：幂等（同 node+url 每次启动只试一次）；静默失败（下次启动再试）；写回前核对 url 未被替换
// （重生成 / 转码自愈竞态时绝不覆盖新结果）；只看 result 真变了的节点（打字不触发全表扫描）。
import { hostedAssetThumbnailUrl, hostedAssetUrl, importWorkbenchRemoteAssetUrl } from '../api/assetUploadApi'
import { getDesktopBridge } from '../../desktop/bridge'
import { useGenerationCanvasStore } from './store/generationCanvasStore'
import type { GenerationNodeResult } from './model/generationCanvasTypes'
import { isProjectExecutionContextCurrent, subscribeProjectOpened, type ProjectExecutionContext } from '../project/projectCanvasReadSurface'

type MediaPreview = { thumbnailUrl?: string }

/** 补全写回不是用户编辑：要存盘（下次打开不用再补），但不进撤销、不发画布事件。 */
const BACKFILL_UPDATE_OPTIONS = { history: false, emit: false } as const

export function shouldRelocalizeResult(result: GenerationNodeResult | null | undefined): boolean {
  if (!result) return false
  if (result.type !== 'image' && result.type !== 'video') return false
  return /^https?:\/\//i.test(String(result.url || '').trim())
}

// 只补视频封面：封面让画布平时不挂 <video>（32 个 1080p 全挂时 GPU 进程 1.7–2.0 GB）。图片不补——没有缩略图的旧图片节点直接显示原图（与 0.22.1 一致），
// 否则打开项目后几秒内图片会一张张从原图换成缩略图（先解码原图、再解码缩略图，还闪一下；2026-09-25 核心冒烟抓到画面迟迟不安定）。
// 新导入 / 新生成的图片在落盘时就带缩略图，不经过这里。
export function shouldBackfillPreview(result: GenerationNodeResult | null | undefined): boolean {
  if (!result || result.type !== 'video') return false
  if (String(result.thumbnailUrl || '').trim()) return false
  return String(result.url || '').trim().startsWith('nomi-local://')
}

function previewFields(result: GenerationNodeResult, sourceUrl: string, preview: MediaPreview | null | undefined): Partial<GenerationNodeResult> {
  const thumbnailUrl = String(preview?.thumbnailUrl || '').trim()
  return {
    // 落盘边界派生了预览就用预览；图片没派生出来时源即预览；视频没封面就不带 thumbnailUrl（远端封面链已随源一起失效）。
    ...(thumbnailUrl ? { thumbnailUrl } : result.type === 'image' ? { thumbnailUrl: sourceUrl } : { thumbnailUrl: undefined }),
  }
}

export function relocalizedResultPatch(
  result: GenerationNodeResult,
  localUrl: string,
  assetId?: string,
  preview?: MediaPreview | null,
): GenerationNodeResult | null {
  const next = String(localUrl || '').trim()
  if (!next || next === result.url) return null
  return {
    ...result,
    url: next,
    providerUrl: result.providerUrl || result.url,
    ...previewFields(result, next, preview),
    ...(assetId ? { assetId } : {}),
  }
}

export function backfilledPreviewPatch(result: GenerationNodeResult, preview: MediaPreview | null | undefined): GenerationNodeResult | null {
  const fields = previewFields(result, String(result.url || ''), preview)
  // 视频没派生出封面 → 不写（下次打开再试）；图片没派生出预览 = 源本身就是预览尺寸，记下来不再重试。
  if (!fields.thumbnailUrl) return null
  return { ...result, ...fields }
}

const attempted = new Set<string>()

/** 写回前的竞态核对：换了项目、节点没了、结果已被替换 → 放弃。 */
function writeBack(project: ProjectExecutionContext, nodeId: string, sourceUrl: string, patchFor: (current: GenerationNodeResult) => GenerationNodeResult | null): void {
  if (!isProjectExecutionContextCurrent(project)) return
  const state = useGenerationCanvasStore.getState()
  const node = state.nodes.find((candidate) => candidate.id === nodeId)
  if (!node?.result || node.result.url !== sourceUrl) return
  const patch = patchFor(node.result)
  if (patch) state.updateNode(nodeId, { result: patch }, BACKFILL_UPDATE_OPTIONS)
}

async function relocalizeNode(nodeId: string, result: GenerationNodeResult, project: ProjectExecutionContext): Promise<void> {
  const sourceUrl = String(result.url || '')
  try {
    const dto = await importWorkbenchRemoteAssetUrl(sourceUrl, undefined, {
      projectBinding: project.binding, assertCurrent: project.assertCurrent, ownerNodeId: nodeId, kind: 'generated',
    })
    const localUrl = hostedAssetUrl(dto)
    writeBack(project, nodeId, sourceUrl, (current) =>
      relocalizedResultPatch(current, localUrl, dto?.id, { thumbnailUrl: hostedAssetThumbnailUrl(dto) }))
  } catch {
    // 链接已死 / 换了项目 → 静默不打扰；attempted 只在本次启动生效，下次打开会再试。
  }
}

async function backfillPreview(nodeId: string, result: GenerationNodeResult, project: ProjectExecutionContext): Promise<void> {
  const ensurePreview = getDesktopBridge()?.assets?.ensurePreview
  if (!ensurePreview) return
  const sourceUrl = String(result.url || '')
  try {
    const preview = await ensurePreview({ url: sourceUrl })
    writeBack(project, nodeId, sourceUrl, (current) => backfilledPreviewPatch(current, preview))
  } catch {
    // 文件不在 / 派生失败 → 画布照旧挂原片，下次打开再试。
  }
}

/**
 * 每打开一个项目签发一次它的生命周期，对它画布里需要补全的节点后台补一次。
 * 目标项目只来自签发，不读「当前项目」；换项目即停。封面一个接一个补（每个都要起一次 ffmpeg）。返回解除函数。
 */
export function initResultMediaBackfillBridge(): () => void {
  let unsubscribeStore: () => void = () => undefined
  const unsubscribeOpened = subscribeProjectOpened((project) => {
    unsubscribeStore()
    const seenResults = new WeakSet<GenerationNodeResult>()
    let previewQueue: Promise<void> = Promise.resolve()
    const sweep = (): void => {
      if (!isProjectExecutionContextCurrent(project)) return
      for (const node of useGenerationCanvasStore.getState().nodes) {
        const result = node.result
        if (!result || seenResults.has(result)) continue
        seenResults.add(result)
        const key = `${project.binding.projectId}:${node.id}:${String(result.url || '')}`
        if (attempted.has(key)) continue
        if (shouldRelocalizeResult(result)) {
          attempted.add(key)
          void relocalizeNode(node.id, result, project)
        } else if (shouldBackfillPreview(result)) {
          attempted.add(key)
          previewQueue = previewQueue.then(() => backfillPreview(node.id, result, project))
        }
      }
    }
    sweep()
    unsubscribeStore = useGenerationCanvasStore.subscribe((state, previous) => {
      if (state.nodes !== previous.nodes) sweep()
    })
  })
  return () => {
    unsubscribeOpened()
    unsubscribeStore()
  }
}
