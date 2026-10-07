import React from 'react'
import { useTranslation } from 'react-i18next'
import { getDesktopBridge } from '../../../desktop/bridge'
import type { GenerationCanvasNode, GenerationNodeResult } from '../model/generationCanvasTypes'

// 下载结果到本地：图片/视频/素材统一一条路径——把 result.url（本地 nomi-local 或远端 http）另存到用户选定位置。
// 浮条按钮用 hook（带「下载中」忙态），版本卡悬停条按下哪一版下哪一版（用同一个函数，单一来源，P1）。
// 文件名由节点标题 derive，扩展名由主进程按 url/类型补全（不在这里钉死最终名）。
export function downloadNodeResult(
  input: { title?: string; result: GenerationNodeResult | undefined },
  t: (key: string) => string,
  reportFeedback: (message: string) => void,
): Promise<void> | null {
  reportFeedback('')
  const url = input.result?.url
  const type = input.result?.type
  if (!url || type === 'text') return null
  const bridge = getDesktopBridge()
  if (!bridge) return null
  const defaultName = type === 'video'
    ? t('generationCommon.resultDownload.defaultVideoName')
    : type === 'audio'
      ? t('generationCommon.resultDownload.defaultAudioName')
      : type === 'model3d'
        ? t('generationCommon.resultDownload.defaultModel3dName')
        : t('generationCommon.resultDownload.defaultImageName')
  const base = (input.title || '').trim() || defaultName
  const extension = type === 'video' ? '.mp4' : type === 'audio' ? '.mp3' : type === 'model3d' ? '.glb' : '.png'
  const urlExt = /\.[a-z0-9]{1,5}(?:$|\?)/i.test(url) ? '' : extension
  return bridge.assets
    .download({ url, suggestedName: base + urlExt })
    .then((res) => {
      if (res.ok) reportFeedback(t('generationCommon.resultDownload.saved'))
      else if (!res.canceled) reportFeedback(t('generationCommon.resultDownload.failed'))
    })
    .catch((error: unknown) =>
      reportFeedback(error instanceof Error ? error.message : t('generationCommon.resultDownload.failed')),
    )
}

export function useResultDownload(node: GenerationCanvasNode, reportFeedback: (message: string) => void, targetResult: GenerationNodeResult | undefined = node.result): {
  canDownload: boolean
  downloading: boolean
  download: () => void
} {
  const { t } = useTranslation()
  const [downloading, setDownloading] = React.useState(false)
  const url = targetResult?.url
  const type = targetResult?.type
  const canDownload = Boolean(url) && type !== 'text'

  const download = React.useCallback(() => {
    const pending = downloadNodeResult({ title: node.title, result: targetResult }, t, reportFeedback)
    if (!pending) return
    setDownloading(true)
    void pending.finally(() => setDownloading(false))
  }, [targetResult, t, node.title, reportFeedback])

  return { canDownload, downloading, download }
}
