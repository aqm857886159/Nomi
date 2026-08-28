import { useGenerationCanvasStore } from '../store/generationCanvasStore'
import type { GenerationNodeResult } from '../model/generationCanvasTypes'
import { isRemoteHttpUrl, localizeRemoteResultUrl } from './resultAssetLocalization'
import type { ProjectHydrationGuard } from '../../project/projectCanvasReadSurface'

// 开项目体检：打开项目后台静默扫一遍，把此前漏进节点的厂商临时 URL（会过期）就地抢救成本地资产——
// 让用户「打开就好」，不必等撞上坏的。结构闸（生成出口）挡新的、本体检救存量，二者共用 localize 逻辑。
//
// 只处理 http(s) 的 result.url（症状「生成的视频隔天打不开」）：还没过期的能救回，已过期的
// localize 会失败、保持原样，由播放守卫诚实报错。HEVC 等「本地文件但解码不了」的存量由播放守卫
// 按需自愈（已扩到各播放面），不在此重复 probe——两症各治各的根因层，不重叠也不重复扫。
//
// 绝大多数项目这里 filter 得空数组、立即返回（节点 url 本就是 nomi-local）；只有真有漏网 http 才干活。
export async function runProjectAssetHealthCheck(
  projectId: string,
  guard: ProjectHydrationGuard,
): Promise<void> {
  const trimmed = String(projectId || '').trim()
  if (!trimmed) return
  guard.assertCurrent()
  // 快照进入时这批坏 url（后台慢跑期间 store 可能被用户编辑，只处理当下这批，避免打架）。
  const targets: Array<{ nodeId: string; result: GenerationNodeResult }> = []
  for (const node of useGenerationCanvasStore.getState().nodes) {
    if (node.result && isRemoteHttpUrl(node.result.url)) {
      targets.push({ nodeId: node.id, result: node.result })
    }
  }
  for (const { nodeId, result } of targets) {
    const localized = await localizeRemoteResultUrl(result, trimmed, nodeId)
    guard.assertCurrent()
    if (localized.url === result.url) continue // 救不回（已过期）→ 原样，守卫诚实报错
    // 写回前确认节点还在、result 仍是进入时那一个（用户没在体检期间重生成/删除该节点）。
    const live = useGenerationCanvasStore.getState().nodes.find((node) => node.id === nodeId)
    if (live?.result?.url === result.url) {
      guard.assertCurrent()
      useGenerationCanvasStore.getState().updateNode(nodeId, { result: localized })
    }
  }
}
