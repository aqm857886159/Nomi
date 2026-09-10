/**
 * [INPUT]: 依赖 react、react-i18next、../../../../../vendor/tablerIcons、../../../../../ui/notificationPolicy、../../../../api/assetUploadApi（importWorkbenchLocalAssetFile / hostedAssetUrl）、
 *          ./panoramaImport（PANORAMA_IMPORT_MAX_BYTES）、./imageFile、../DirectorEditorContext
 * [OUTPUT]: 对外提供 usePanoramaImport() → { importPanoramaFile(file), status }
 * [POS]: director/panels 的 720 全景导入流程（清单 §2.3 V5 场景簇；与 V1 环境面板同一套校验与落盘）：图片类型 / 80MB 上限 → 读尺寸（非 2:1 软警告不拒收）
 *        → 先用 object URL 立刻上球预览 → 资产桥落盘换成托管 url → 落盘不可用（无桌面运行时）退回 data URL 并提示「临时」。写入走 patchPanoramaConfig（可撤销）。
 *        反馈就地不弹全局 toast（docs/plan/2026-09-09-notification-policy.md）：本 hook 自己持有 feedback 状态并渲染 status 条，
 *        调用点把 status 摆在触发钮旁边。非 2:1 的「可能拉伸」是常驻提示，由检查器按贴图真实尺寸渲染，不在这里一次性通知。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import React from 'react'
import { useTranslation } from 'react-i18next'
import { IconX } from '../../../../../vendor/tablerIcons'
import { notify } from '../../../../../ui/notificationPolicy'
import { hostedAssetUrl, importWorkbenchLocalAssetFile } from '../../../../api/assetUploadApi'
import { PANORAMA_IMPORT_MAX_BYTES } from './panoramaImport'
import { useDirectorStoreApi } from '../DirectorEditorContext'
import { readFileAsDataUrl, readImageDimensions } from './imageFile'

const PREVIEW_URL_TTL_MS = 30_000

export function usePanoramaImport(): { importPanoramaFile: (file: File) => void; status: JSX.Element | null } {
  const { t } = useTranslation()
  const store = useDirectorStoreApi()
  const runRef = React.useRef(0)
  const [feedback, setFeedback] = React.useState<string | null>(null)
  const report = React.useCallback((message: string) => {
    notify({ identity: 'director:panorama-import', reason: 'import', message, level: 'inline', present: setFeedback })
  }, [])

  const importPanoramaFile = React.useCallback(
    (file: File) => {
      setFeedback(null)
      if (!file.type.startsWith('image/')) {
        report(t('director.environment.imageOnly'))
        return
      }
      if (file.size > PANORAMA_IMPORT_MAX_BYTES) {
        report(t('director.environment.fileTooLarge'))
        return
      }
      const previewUrl = URL.createObjectURL(file)
      const runId = runRef.current + 1
      runRef.current = runId
      const stillCurrent = () => runRef.current === runId
      const apply = (url: string) => {
        const state = store.getState()
        state.saveState()
        state.patchPanoramaConfig({ url })
      }
      void (async () => {
        try {
          // 只用来确认这张图真能解码；非 2:1 不拒收（等距柱状贴图对任意比例渲染安全），
          // 「可能拉伸」交给检查器按贴图真实尺寸常驻提示，不在导入这一刻通知一次就没了
          try {
            await readImageDimensions(previewUrl)
          } catch {
            report(t('director.environment.dimensionsUnreadable'))
            return
          }
          if (!stillCurrent()) return
          apply(previewUrl)
          try {
            const asset = await importWorkbenchLocalAssetFile(file, file.name || 'panorama')
            const hostedUrl = hostedAssetUrl(asset)
            if (!hostedUrl) throw new Error('panorama asset missing url')
            if (!stillCurrent()) return
            // 成功不通知：全景已经铺满视口，画面本身就是回执
            store.getState().patchPanoramaConfig({ url: hostedUrl })
          } catch {
            // 没有桌面运行时（devlab / 网页）或落盘失败：退回 data URL，工程还能重开，但明说是临时的
            const dataUrl = await readFileAsDataUrl(file)
            if (!stillCurrent()) return
            store.getState().patchPanoramaConfig({ url: dataUrl })
            report(t('director.environment.importedTemporary'))
          }
        } catch {
          if (stillCurrent()) report(t('director.environment.importFailed'))
        } finally {
          window.setTimeout(() => URL.revokeObjectURL(previewUrl), PREVIEW_URL_TTL_MS)
        }
      })()
    },
    [report, store, t],
  )

  const status = feedback ? (
    <div
      role="status"
      data-testid="director-panorama-import-status"
      className="flex max-w-[240px] items-center gap-1 rounded-nomi-sm border border-nomi-line bg-nomi-paper px-2 py-0.5 text-micro text-nomi-ink-80"
    >
      <span className="min-w-0 flex-1 truncate" title={feedback}>{feedback}</span>
      <button
        type="button"
        className="shrink-0 text-nomi-ink-40 hover:text-nomi-ink"
        aria-label={t('director.environment.dismissStatus')}
        onClick={() => setFeedback(null)}
      >
        <IconX size={12} stroke={2} />
      </button>
    </div>
  ) : null

  return { importPanoramaFile, status }
}
