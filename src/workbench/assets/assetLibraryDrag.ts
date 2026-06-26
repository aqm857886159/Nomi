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
}

export function serializeAssetLibraryDrag(payload: AssetLibraryDragPayload): string {
  return JSON.stringify(payload)
}

export function parseAssetLibraryDrag(raw: string | null | undefined): AssetLibraryDragPayload | null {
  if (!raw) return null
  try {
    const value = JSON.parse(raw) as Partial<AssetLibraryDragPayload>
    const kind = value.kind
    const renderUrl = typeof value.renderUrl === 'string' ? value.renderUrl.trim() : ''
    if ((kind === 'image' || kind === 'video' || kind === 'audio') && renderUrl && value.origin && typeof value.origin === 'object') {
      return {
        kind,
        name: typeof value.name === 'string' ? value.name : '',
        renderUrl,
        origin: value.origin as AssetOrigin,
      }
    }
  } catch {
    // ignore malformed payloads
  }
  return null
}
