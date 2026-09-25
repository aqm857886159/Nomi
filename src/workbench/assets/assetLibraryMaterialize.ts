// 素材库拖放 → 「当前项目能写的引用」的唯一关口（2026-09-25）。
//
// 为什么要这一层：画布 / 时间轴只能写当前项目自己的地址——项目要能单独搬走、备份、换机，
// 引用别的项目的文件一挪就坏（2026-08-31 边界）。那次只做了「拦」，没做「怎么用」：
// 「全部素材」里别的项目的图从此拖不出来（用户 09-25：「拖不出图片和视频来了」）。
// 复制通道早就在：主进程 `copyProjectAsset` 校验源项目、真实路径与媒体类型后复制进目标项目，
// 渲染层从不经手原生路径（工作流库跨项目复制也走它）。所以这里只做一件事——
// 当前项目 / 当前画布的素材原样放行；别的项目的素材先复制进来，再换成复制品的引用。
// 落点（画布、时间轴）都先过这里，不各自判「属不属于本项目」。
import { getDesktopBridge, type DesktopAssetDto } from '../../desktop/bridge'
import type { ProjectExecutionContext } from '../project/projectCanvasReadSurface'
import type { AssetLibraryDragPayload } from './assetLibraryDrag'
import { assetBelongsToProject, assetToDragPayload } from './assetLibraryUsage'
import { assetRefFromDesktopAsset } from './useAllProjectAssets'

export type CopyProjectAsset = (payload: { sourceProjectId: string; targetProjectId: string; relativePath: string }) => Promise<DesktopAssetDto>

export type MaterializedLibraryItems = {
  items: AssetLibraryDragPayload[]
  /** 复制失败（或宿主没有复制通道）的条数：调用方据此给一句人话，不静默丢。 */
  failed: number
}

/**
 * 把一批素材库条目换成「属于 project 的引用」。顺序保持（锚点跟着原条目走）。
 * 复制品的引用由 DTO → AssetRef → 拖拽载荷的同一条映射派生，不手拼地址，也不沿用源项目的任何派生字段。
 */
export async function materializeAssetLibraryItems(
  items: readonly AssetLibraryDragPayload[],
  project: ProjectExecutionContext,
  copy: CopyProjectAsset | null = getDesktopBridge()?.assets?.copyProjectAsset ?? null,
): Promise<MaterializedLibraryItems> {
  const targetProjectId = project.binding.projectId
  const resolved: AssetLibraryDragPayload[] = []
  let failed = 0
  // 串行：同名文件并发复制会在目标桶里抢同一个去重文件名。
  for (const item of items) {
    if (assetBelongsToProject(item, targetProjectId)) {
      resolved.push(item)
      continue
    }
    // 画布来源恒属于当前画布（assetBelongsToProject 已放行），能走到这里的只剩别的项目的文件。
    if (item.origin.source !== 'project' || !copy) {
      failed += 1
      continue
    }
    try {
      const copied = await copy({ sourceProjectId: item.origin.projectId, targetProjectId, relativePath: item.origin.relativePath })
      const ref = assetRefFromDesktopAsset(copied)
      if (!ref || !assetBelongsToProject(ref, targetProjectId)) throw new Error('copied asset is not in the target project')
      resolved.push(assetToDragPayload(ref, item.dragAnchor))
    } catch {
      failed += 1
    }
  }
  return { items: resolved, failed }
}
