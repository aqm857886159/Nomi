// 素材库 → 画布的拖拽契约。
// 素材已在池里（画布产出 / 项目文件），拖到画布只需引用其 renderUrl 建 asset 节点，无需重新上传。
// 与 workspaceFileDrag 同构，但携带 AssetRef 的 origin 线索，便于发送链解析「传输地址」（见 assetTypes.ts 文件头 R1）。

import type { AssetKind, AssetOrigin } from './assetTypes'

export const ASSET_LIBRARY_DRAG_MIME = 'application/x-nomi-asset-ref'

// 三类素材都可拖：图片/视频 → 画布建节点；音频 → 时间轴音频轨（画布无音频节点，drop 端各自判 kind）。
export type AssetLibraryDragPayload = {
  kind: AssetKind
  name: string
  renderUrl: string
  origin: AssetOrigin
  dragAnchor?: {
    xRatio: number
    yRatio: number
  }
}

export function serializeAssetLibraryDrag(payload: AssetLibraryDragPayload | readonly AssetLibraryDragPayload[]): string {
  return JSON.stringify(payload)
}

function normalizeAssetLibraryDragItem(value: unknown): AssetLibraryDragPayload | null {
  if (!value || typeof value !== 'object') return null
  const item = value as Partial<AssetLibraryDragPayload>
  const kind = item.kind
  const renderUrl = typeof item.renderUrl === 'string' ? item.renderUrl.trim() : ''
  if ((kind === 'image' || kind === 'video' || kind === 'audio') && renderUrl && item.origin && typeof item.origin === 'object') {
    const rawAnchor = item.dragAnchor
    const dragAnchor = rawAnchor && typeof rawAnchor === 'object'
      ? {
          xRatio: Math.min(1, Math.max(0, Number(rawAnchor.xRatio) || 0)),
          yRatio: Math.min(1, Math.max(0, Number(rawAnchor.yRatio) || 0)),
        }
      : undefined
    return {
      kind,
      name: typeof item.name === 'string' ? item.name : '',
      renderUrl,
      origin: item.origin as AssetOrigin,
      ...(dragAnchor ? { dragAnchor } : {}),
    }
  }
  return null
}

export function parseAssetLibraryDragItems(raw: string | null | undefined): AssetLibraryDragPayload[] {
  if (!raw) return []
  try {
    const value = JSON.parse(raw) as unknown
    const items = Array.isArray(value) ? value : [value]
    return items.flatMap((item) => {
      const normalized = normalizeAssetLibraryDragItem(item)
      return normalized ? [normalized] : []
    })
  } catch {
    // ignore malformed payloads
  }
  return []
}

export function parseAssetLibraryDrag(raw: string | null | undefined): AssetLibraryDragPayload | null {
  return parseAssetLibraryDragItems(raw)[0] ?? null
}
