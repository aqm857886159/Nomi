// 生成结果「趁链接还活着」补救本地化（2026-07-31 群反馈「生成的视频第二天就加载不出来了」的存量半边）。
// projectId 空窗时主进程跳过落盘，node.result.url 存的是厂商临时 CDN 链接（会过期）——主进程侧
// 已加活动项目兜底堵新增，这里救**已经带着 http(s) 结果的存量节点**：项目一打开就后台
// importRemoteAsset 落盘、把 result.url 改写为 nomi-local://（原链接留在 providerUrl）。
// 纪律：幂等（同 node+url 每次启动只试一次）；静默失败（链接已死 → 播放层自会给人话报错，
// 下次启动再试）；写回前核对 url 未被替换（重生成/转码自愈竞态时绝不覆盖新结果）。
import { hostedAssetDimensions, hostedAssetThumbnailUrl, hostedAssetUrl, importWorkbenchRemoteAssetUrl } from '../api/assetUploadApi'
import { useGenerationCanvasStore } from './store/generationCanvasStore'
import type { GenerationNodeResult } from './model/generationCanvasTypes'

export function shouldRelocalizeResult(result: GenerationNodeResult | null | undefined): boolean {
  if (!result) return false
  if (result.type !== 'image' && result.type !== 'video') return false
  return /^https?:\/\//i.test(String(result.url || '').trim())
}

export function relocalizedResultPatch(
  result: GenerationNodeResult,
  localUrl: string,
  assetId?: string,
  preview?: { thumbnailUrl?: string; width?: number; height?: number } | null,
): GenerationNodeResult | null {
  const next = String(localUrl || '').trim()
  if (!next || next === result.url) return null
  const thumbnailUrl = String(preview?.thumbnailUrl || '').trim()
  return {
    ...result,
    url: next,
    providerUrl: result.providerUrl || result.url,
    // 落盘边界派生了预览就用预览；图片没派生出来时源即预览；视频没 poster 就不带 thumbnailUrl（远端封面链已随源一起失效）。
    ...(thumbnailUrl ? { thumbnailUrl } : result.type === 'image' ? { thumbnailUrl: next } : { thumbnailUrl: undefined }),
    ...(preview?.width && preview?.height ? { width: preview.width, height: preview.height } : {}),
    ...(assetId ? { assetId } : {}),
  }
}

const attempted = new Set<string>()

async function relocalizeNode(nodeId: string, result: GenerationNodeResult): Promise<void> {
  const sourceUrl = String(result.url || '')
  try {
    const dto = await importWorkbenchRemoteAssetUrl(sourceUrl, undefined, { ownerNodeId: nodeId, kind: 'generated' })
    const localUrl = hostedAssetUrl(dto)
    const state = useGenerationCanvasStore.getState()
    const node = state.nodes.find((candidate) => candidate.id === nodeId)
    if (!node?.result || node.result.url !== sourceUrl) return
    const patch = relocalizedResultPatch(node.result, localUrl, dto?.id, { thumbnailUrl: hostedAssetThumbnailUrl(dto), ...hostedAssetDimensions(dto) })
    if (patch) state.updateNode(nodeId, { result: patch })
  } catch {
    // 链接已死 / 项目上下文缺失 → 静默不打扰；attempted 只在本次启动生效，下次打开会再试。
  }
}

/** 订阅画布 store，对带 http(s) 结果的节点后台补一次本地化。返回解除函数。 */
export function initResultUrlRelocalizeBridge(): () => void {
  const sweep = (): void => {
    for (const node of useGenerationCanvasStore.getState().nodes) {
      if (!shouldRelocalizeResult(node.result)) continue
      const key = `${node.id}:${String(node.result?.url || '')}`
      if (attempted.has(key)) continue
      attempted.add(key)
      void relocalizeNode(node.id, node.result as GenerationNodeResult)
    }
  }
  sweep()
  return useGenerationCanvasStore.subscribe(sweep)
}
