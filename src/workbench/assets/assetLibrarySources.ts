import type { GenerationCanvasNode } from '../generationCanvas/model/generationCanvasTypes'
import type { AssetRef } from './assetTypes'

export type AssetFileDeleteTarget = {
  projectId: string
  relativePath: string
}

export type AssetLibraryDeletePlan = {
  nodeIds: string[]
  fileTargets: AssetFileDeleteTarget[]
}

export function filterImageVideoAssets(assets: readonly AssetRef[]): AssetRef[] {
  return assets.filter((asset) => asset.kind === 'image' || asset.kind === 'video')
}

export function parseNomiLocalAssetUrl(url: unknown): AssetFileDeleteTarget | null {
  if (typeof url !== 'string') return null
  const prefix = 'nomi-local://asset/'
  if (!url.startsWith(prefix)) return null
  const pathPart = url.slice(prefix.length).split(/[?#]/, 1)[0]
  const segments = pathPart.split('/').filter(Boolean)
  if (segments.length < 2) return null
  try {
    const projectId = decodeURIComponent(segments[0]).trim()
    const relativePath = segments.slice(1).map((segment) => decodeURIComponent(segment)).join('/').trim()
    return projectId && relativePath ? { projectId, relativePath } : null
  } catch {
    return null
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function rawAssetTarget(raw: unknown, fallbackProjectId: string): AssetFileDeleteTarget | null {
  const rawRecord = record(raw)
  const assetRecord = record(rawRecord?.asset)
  const dataRecord = record(assetRecord?.data)
  const projectId = typeof assetRecord?.projectId === 'string' && assetRecord.projectId.trim()
    ? assetRecord.projectId.trim()
    : fallbackProjectId
  const relativePath = typeof dataRecord?.relativePath === 'string' ? dataRecord.relativePath.trim() : ''
  return projectId && relativePath ? { projectId, relativePath } : null
}

function targetKey(target: AssetFileDeleteTarget): string {
  return `${target.projectId}\u0000${target.relativePath}`
}

function comparableUrl(url: string): string {
  return url.split(/[?#]/, 1)[0]
}

export function buildAssetLibraryDeletePlan(input: {
  selectedAssets: readonly AssetRef[]
  canvasNodes: readonly GenerationCanvasNode[]
  allProjectAssets: readonly AssetRef[]
  currentProjectId: string
}): AssetLibraryDeletePlan {
  const nodeIds = Array.from(new Set(input.selectedAssets.flatMap((asset) =>
    asset.origin.source === 'canvas' ? [asset.origin.nodeId] : [],
  )))
  const selectedNodeIdSet = new Set(nodeIds)
  const selectedNodes = input.canvasNodes.filter((node) => selectedNodeIdSet.has(node.id))
  const selectedUrls = new Set<string>()
  const targetByKey = new Map<string, AssetFileDeleteTarget>()
  const addTarget = (target: AssetFileDeleteTarget | null): void => {
    if (target) targetByKey.set(targetKey(target), target)
  }

  for (const node of selectedNodes) {
    let hasExplicitFileTarget = false
    for (const result of [node.result, ...(node.history ?? [])]) {
      if (!result) continue
      for (const url of [result.url, result.thumbnailUrl]) {
        if (typeof url !== 'string' || !url.trim()) continue
        selectedUrls.add(comparableUrl(url.trim()))
        const target = parseNomiLocalAssetUrl(url)
        if (target) {
          addTarget(target)
          hasExplicitFileTarget = true
        }
      }
      const rawTarget = rawAssetTarget(result.raw, input.currentProjectId)
      if (rawTarget) {
        addTarget(rawTarget)
        hasExplicitFileTarget = true
      }
    }
    if (!hasExplicitFileTarget) {
      const relativePath = typeof node.meta?.workspaceRelativePath === 'string'
        ? node.meta.workspaceRelativePath.trim()
        : ''
      if (input.currentProjectId && relativePath) {
        addTarget({ projectId: input.currentProjectId, relativePath })
      }
    }
  }

  for (const asset of input.allProjectAssets) {
    if (asset.origin.source !== 'project') continue
    const target = {
      projectId: asset.origin.projectId,
      relativePath: asset.origin.relativePath,
    }
    const ownerMatchesCurrentProjectNode =
      asset.origin.projectId === input.currentProjectId &&
      Boolean(asset.ownerNodeId && selectedNodeIdSet.has(asset.ownerNodeId))
    const urlMatches = selectedUrls.has(comparableUrl(asset.renderUrl))
    const targetAlreadyMatched = targetByKey.has(targetKey(target))
    if (ownerMatchesCurrentProjectNode || urlMatches || targetAlreadyMatched) addTarget(target)
  }

  return { nodeIds, fileTargets: [...targetByKey.values()] }
}
