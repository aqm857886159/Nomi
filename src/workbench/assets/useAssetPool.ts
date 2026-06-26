// 素材池：一处真相源的派生 selector（**不是新 store**）。
// 用 useMemo 把「画布 store 切片」+「项目文件（useWorkspaceFiles，已 limit 500）」合流去重，
// picker / 面板 / @ 引用都读它。去重按 renderUrl，画布优先（保留 nodeId 线索给连边用）。

import React from 'react'
import { useGenerationCanvasStore } from '../generationCanvas/store/generationCanvasStore'
import { useWorkspaceFiles } from '../workspace/useWorkspaceFiles'
import {
  canvasNodeToAssetRef,
  workspaceNodeToAssetRef,
  flattenWorkspaceFiles,
  type AssetRef,
} from './assetTypes'

export type AssetPool = {
  assets: AssetRef[]
  loading: boolean
  /** 重新拉取项目文件源（音频上传经项目文件落库，不像画布 store 自动反应，需手动刷新）。 */
  refresh: () => void
}

export function useAssetPool(projectId: string | null): AssetPool {
  const nodes = useGenerationCanvasStore((state) => state.nodes)
  const { items, loading, refresh } = useWorkspaceFiles(projectId)

  return React.useMemo<AssetPool>(() => {
    const byUrl = new Map<string, AssetRef>()

    for (const node of nodes) {
      const ref = canvasNodeToAssetRef(node)
      if (ref && !byUrl.has(ref.renderUrl)) byUrl.set(ref.renderUrl, ref)
    }

    if (projectId) {
      for (const file of flattenWorkspaceFiles(items)) {
        const ref = workspaceNodeToAssetRef(file, projectId)
        if (ref && !byUrl.has(ref.renderUrl)) byUrl.set(ref.renderUrl, ref)
      }
    }

    return { assets: Array.from(byUrl.values()), loading, refresh }
  }, [nodes, items, projectId, loading, refresh])
}
