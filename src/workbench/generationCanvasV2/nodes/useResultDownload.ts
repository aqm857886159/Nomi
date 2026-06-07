import React from 'react'
import { getDesktopBridge } from '../../../desktop/bridge'
import { toast } from '../../../ui/toast'
import type { GenerationCanvasNode } from '../model/generationCanvasTypes'

// 下载结果到本地：图片/视频/素材统一一条路径——把 result.url（本地 nomi-local 或远端 http）另存到用户选定位置。
// 从节点 UI 抽出成 hook，供图片浮动工具条按钮与视频浮条按钮共用（单一来源，P1）。
// 文件名由节点标题 derive，扩展名由主进程按 url/类型补全（不在这里钉死最终名）。
export function useResultDownload(node: GenerationCanvasNode): {
  canDownload: boolean
  downloading: boolean
  download: () => void
} {
  const [downloading, setDownloading] = React.useState(false)
  const url = node.result?.url
  const type = node.result?.type
  const canDownload = Boolean(url) && type !== 'text'

  const download = React.useCallback(() => {
    if (!url) return
    const bridge = getDesktopBridge()
    if (!bridge) return
    const base = (node.title || '').trim() || (type === 'video' ? '视频' : '图片')
    const urlExt = /\.[a-z0-9]{1,5}(?:$|\?)/i.test(url) ? '' : type === 'video' ? '.mp4' : '.png'
    setDownloading(true)
    void bridge.assets
      .download({ url, suggestedName: base + urlExt })
      .then((res) => {
        if (res.ok) toast('已保存到本地', 'success')
        else if (!res.canceled) toast('下载失败', 'error')
      })
      .catch((error: unknown) => toast(error instanceof Error ? error.message : '下载失败', 'error'))
      .finally(() => setDownloading(false))
  }, [url, type, node.title])

  return { canDownload, downloading, download }
}
