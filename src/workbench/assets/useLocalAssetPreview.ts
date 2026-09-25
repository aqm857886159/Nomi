import React from 'react'
import { getDesktopBridge } from '../../desktop/bridge'

// 渲染层向「落盘边界预览」要一张封面（2026-09-25 画布跟手方案）：派生的唯一 owner 是主进程
// electron/assets/assetPreview.ts（sidecar 有就给、没有就抽一帧写回）。这里只按 URL 记住结果，
// 同一个素材在素材库 / 选择器 / @ 列表里只问一次。不是 nomi-local 或派生失败 → 空串。
const cache = new Map<string, Promise<string>>()

function requestPreview(url: string): Promise<string> {
  const known = cache.get(url)
  if (known) return known
  const ensurePreview = getDesktopBridge()?.assets?.ensurePreview
  const pending = ensurePreview
    ? ensurePreview({ url }).then((preview) => String(preview?.thumbnailUrl || '').trim(), () => '')
    : Promise.resolve('')
  cache.set(url, pending)
  return pending
}

/** 传空串 = 不需要（调用方已有封面）。 */
export function useLocalAssetPreview(url: string): string {
  const [preview, setPreview] = React.useState('')
  React.useEffect(() => {
    setPreview('')
    if (!url.startsWith('nomi-local://')) return undefined
    let alive = true
    void requestPreview(url).then((next) => { if (alive) setPreview(next) })
    return () => { alive = false }
  }, [url])
  return preview
}
