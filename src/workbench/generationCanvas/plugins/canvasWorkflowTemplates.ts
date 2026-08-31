import type { GenerationCanvasEdge, GenerationCanvasNode, NodeGroup } from '../model/generationCanvasTypes'

export type CanvasWorkflowTemplateNode = {
  sourceId: string
  node: GenerationCanvasNode
  relativePosition: { x: number; y: number }
}

export type CanvasWorkflowTemplateGroup = {
  sourceId: string
  group: NodeGroup
  relativeFrameBounds?: { x: number; y: number; w: number; h: number }
}

export type CanvasWorkflowTemplateAsset = {
  sourceUrl: string
  sourceProjectId: string
  relativePath: string
  name: string
}

export type CanvasWorkflowTemplate = {
  id: string
  schemaVersion?: number
  name: string
  description?: string
  tags?: string[]
  sourceProjectId?: string
  sourceProjectName?: string
  createdAt: number
  updatedAt: number
  nodes: CanvasWorkflowTemplateNode[]
  edges: GenerationCanvasEdge[]
  groups?: CanvasWorkflowTemplateGroup[]
  assets?: CanvasWorkflowTemplateAsset[]
}

export type InstantiatedCanvasWorkflow = {
  nodes: GenerationCanvasNode[]
  edges: GenerationCanvasEdge[]
  groups: NodeGroup[]
}

export function isCanvasWorkflowTemplate(value: unknown): value is CanvasWorkflowTemplate {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<CanvasWorkflowTemplate>
  const validFrame = (frame: unknown): boolean => Boolean(frame && typeof frame === 'object' &&
    ['x', 'y', 'w', 'h'].every((key) => typeof (frame as Record<string, unknown>)[key] === 'number' && Number.isFinite((frame as Record<string, unknown>)[key])))
  const validGroups = candidate.groups === undefined || (Array.isArray(candidate.groups) && candidate.groups.every((item) => {
    if (!item || typeof item !== 'object' || typeof item.sourceId !== 'string' || !item.group || typeof item.group !== 'object') return false
    const group = item.group as Partial<NodeGroup>
    return Array.isArray(group.nodeIds) && group.nodeIds.every((nodeId) => typeof nodeId === 'string') &&
      (item.relativeFrameBounds === undefined || validFrame(item.relativeFrameBounds)) &&
      (group.frameBounds === undefined || validFrame(group.frameBounds)) &&
      (group.inputLinks === undefined || (Array.isArray(group.inputLinks) && group.inputLinks.every((link) => Boolean(link && typeof link.sourceNodeId === 'string')))) &&
      (group.outputLinks === undefined || (Array.isArray(group.outputLinks) && group.outputLinks.every((link) => Boolean(link && typeof link.targetNodeId === 'string'))))
  }))
  const validAssets = candidate.assets === undefined || (Array.isArray(candidate.assets) && candidate.assets.every((item) => Boolean(item && typeof item.sourceUrl === 'string' && item.sourceUrl.startsWith('nomi-local://asset/') && typeof item.sourceProjectId === 'string' && typeof item.relativePath === 'string' && typeof item.name === 'string')))
  return typeof candidate.id === 'string' && typeof candidate.name === 'string' && validGroups && validAssets &&
    Array.isArray(candidate.nodes) && Array.isArray(candidate.edges) &&
    candidate.nodes.every((item) => Boolean(item && typeof item.sourceId === 'string' && item.node && typeof item.node === 'object' && item.relativePosition &&
      typeof item.relativePosition.x === 'number' && typeof item.relativePosition.y === 'number'))
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function localAssetReference(value: string): CanvasWorkflowTemplateAsset | null {
  const prefix = 'nomi-local://asset/'
  if (!value.startsWith(prefix)) return null
  const parts = value.slice(prefix.length).split('/').filter(Boolean)
  if (parts.length < 2) return null
  try {
    const sourceProjectId = decodeURIComponent(parts.shift() || '').trim()
    const relativePath = parts.map((part) => decodeURIComponent(part)).join('/').trim()
    if (!sourceProjectId || !relativePath || relativePath.startsWith('/') || relativePath.split('/').some((segment) => segment === '..')) return null
    return {
      sourceUrl: value,
      sourceProjectId,
      relativePath,
      name: relativePath.split('/').pop() || 'asset',
    }
  } catch {
    return null
  }
}

function collectLocalAssetReferences(value: unknown, output: Map<string, CanvasWorkflowTemplateAsset>): void {
  if (typeof value === 'string') {
    const asset = localAssetReference(value)
    if (asset) output.set(asset.sourceUrl, asset)
    return
  }
  if (Array.isArray(value)) {
    value.forEach((item) => collectLocalAssetReferences(item, output))
    return
  }
  if (!value || typeof value !== 'object') return
  Object.values(value).forEach((item) => collectLocalAssetReferences(item, output))
}

export function rewriteCanvasWorkflowTemplateAssetUrls(
  template: CanvasWorkflowTemplate,
  urlBySource: ReadonlyMap<string, string>,
): CanvasWorkflowTemplate {
  if (!urlBySource.size) return clone(template)
  const rewrite = (value: unknown): unknown => {
    if (typeof value === 'string') return urlBySource.get(value) || value
    if (Array.isArray(value)) return value.map(rewrite)
    if (!value || typeof value !== 'object') return value
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, rewrite(item)]))
  }
  return {
    ...clone(template),
    nodes: template.nodes.map((item) => ({ ...item, node: rewrite(item.node) as GenerationCanvasNode })),
  }
}

export function captureCanvasWorkflowTemplate(
  nodes: readonly GenerationCanvasNode[],
  edges: readonly GenerationCanvasEdge[],
  selectedNodeIds: readonly string[],
  name: string,
  id: string,
  groupsOrNow: readonly NodeGroup[] | number = [],
  now = Date.now(),
): CanvasWorkflowTemplate | null {
  const groups = typeof groupsOrNow === 'number' ? [] : groupsOrNow
  const capturedAt = typeof groupsOrNow === 'number' ? groupsOrNow : now
  const selected = nodes.filter((node) => selectedNodeIds.includes(node.id))
  if (!selected.length) return null
  const selectedIds = new Set(selected.map((node) => node.id))
  const origin = {
    x: Math.min(...selected.map((node) => node.position.x)),
    y: Math.min(...selected.map((node) => node.position.y)),
  }
  const selectedGroups = groups
    .filter((group) => group.nodeIds.length > 0 && group.nodeIds.every((nodeId) => selectedIds.has(nodeId)))
    .map((group) => {
      const frame = group.frameBounds
      return {
        sourceId: group.id,
        group: clone(group),
        ...(frame ? {
          relativeFrameBounds: {
            x: frame.x - origin.x,
            y: frame.y - origin.y,
            w: frame.w,
            h: frame.h,
          },
        } : {}),
      }
    })
  const assetsBySource = new Map<string, CanvasWorkflowTemplateAsset>()
  selected.forEach((node) => collectLocalAssetReferences(node, assetsBySource))
  return {
    id,
    schemaVersion: 1,
    name: name.trim() || `流程 · ${selected.length} 个节点`,
    createdAt: capturedAt,
    updatedAt: capturedAt,
    nodes: selected.map((node) => ({
      sourceId: node.id,
      node: clone(node),
      relativePosition: { x: node.position.x - origin.x, y: node.position.y - origin.y },
    })),
    edges: clone(edges.filter((edge) => selectedIds.has(edge.source) && selectedIds.has(edge.target))),
    groups: selectedGroups,
    assets: [...assetsBySource.values()],
  }
}

export function instantiateCanvasWorkflowTemplate(
  template: CanvasWorkflowTemplate,
  position: { x: number; y: number },
  createId: (kind: GenerationCanvasNode['kind']) => string,
  createEdgeId: (source: string, target: string, index: number) => string,
  createGroupId: () => string = () => `group-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
): InstantiatedCanvasWorkflow {
  const idMap = new Map<string, string>()
  const groupIdMap = new Map<string, string>()
  for (const group of template.groups || []) groupIdMap.set(group.sourceId, createGroupId())
  const nodes = template.nodes.map(({ sourceId, node, relativePosition }) => {
    const id = createId(node.kind)
    idMap.set(sourceId, id)
    return {
      ...clone(node),
      id,
      ...(node.groupId && groupIdMap.has(node.groupId) ? { groupId: groupIdMap.get(node.groupId) } : {}),
      position: { x: Math.round(position.x + relativePosition.x), y: Math.round(position.y + relativePosition.y) },
    }
  })
  const edges = template.edges.flatMap((edge, index) => {
    const source = idMap.get(edge.source)
    const target = idMap.get(edge.target)
    if (!source || !target) return []
    return [{ ...clone(edge), id: createEdgeId(source, target, index), source, target }]
  })
  const groups = (template.groups || []).flatMap(({ sourceId, group, relativeFrameBounds }) => {
    const id = groupIdMap.get(sourceId) || createGroupId()
    const nodeIds = group.nodeIds.map((nodeId) => idMap.get(nodeId)).filter((nodeId): nodeId is string => Boolean(nodeId))
    if (!nodeIds.length) return []
    const frame = relativeFrameBounds
      ? {
          x: Math.round(position.x + relativeFrameBounds.x),
          y: Math.round(position.y + relativeFrameBounds.y),
          w: relativeFrameBounds.w,
          h: relativeFrameBounds.h,
        }
      : group.frameBounds
        ? {
            ...group.frameBounds,
            x: Math.round(position.x + group.frameBounds.x),
            y: Math.round(position.y + group.frameBounds.y),
          }
        : undefined
    const inputLinks = group.inputLinks?.flatMap((link) => {
      const sourceNodeId = idMap.get(link.sourceNodeId)
      return sourceNodeId ? [{ ...link, sourceNodeId }] : []
    })
    const outputLinks = group.outputLinks?.flatMap((link) => {
      const targetNodeId = idMap.get(link.targetNodeId)
      return targetNodeId ? [{ ...link, targetNodeId }] : []
    })
    return [{
      ...clone(group),
      id,
      nodeIds,
      ...(frame ? { frameBounds: frame } : {}),
      ...(inputLinks ? { inputLinks } : {}),
      ...(outputLinks ? { outputLinks } : {}),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }]
  })
  return { nodes, edges, groups }
}
