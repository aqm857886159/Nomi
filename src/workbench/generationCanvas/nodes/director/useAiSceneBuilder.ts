/**
 * [INPUT]: 依赖 react、react-i18next、../../../../ui/toast、../../../api/promptLibraryApi 的 getTextBrain、../../../api/taskApi 的 runWorkbenchTextTaskStream（Nomi 现有文本流式通道）、
 *          ../../../api/assetUploadApi（importWorkbenchLocalAssetFile / hostedAssetUrl）、./DirectorEditorContext、./model/aiScene（提示词 / 解析 / 规整 / 夹具）、
 *          ./model/storeAiSceneActions 的 exportAiScene / AiSceneTarget / AiSceneLibraryAsset、./panels/imageFile 的 readFileAsDataUrl
 * [OUTPUT]: 对外提供 useAiSceneBuilder() → { status, run, cancel, reset }、AiSceneStatus
 * [POS]: director 根的 AI 搭场景编排（清单 §5.8）：描述 + ≤3 参考图 → 现有文本大脑（结构化 JSON 只回 JSON）→ 容错解析 → 规整 → store 物化（当前图层 / 新图层）
 *        → 先持久化，再把几何与资产条目原子写入发起图层；取消/重置/卸载使迟到结果失效；秒表与流式字数给状态条。
 *        无桌面运行时（开发入口）：有 E2E 夹具钩子（window.__nomiDirectorAiMock）就用夹具复现固定布局，否则明说没有文本模型。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import React from 'react'
import { useTranslation } from 'react-i18next'
import { hostedAssetUrl, importWorkbenchLocalAssetFile } from '../../../api/assetUploadApi'
import { getTextBrain } from '../../../api/promptLibraryApi'
import { runWorkbenchTextTaskStream } from '../../../api/taskApi'
import { toast } from '../../../../ui/toast'
import { useDirectorStoreApi } from './DirectorEditorContext'
import { buildAiScenePrompt, normalizeAiScene, parseAiSceneText, type AiSceneSpec, type NormalizedAiScene } from './model/aiScene'
import { exportAiScene, type AiSceneTarget, type AiSceneLibraryAsset } from './model/storeAiSceneActions'
import { readFileAsDataUrl } from './panels/imageFile'

export type AiScenePhase = 'idle' | 'running' | 'done' | 'error' | 'cancelled'
export type AiSceneStatus = { phase: AiScenePhase; message: string; elapsedSeconds: number; streamedChars: number }

const IDLE: AiSceneStatus = { phase: 'idle', message: '', elapsedSeconds: 0, streamedChars: 0 }

type AiSceneMock = (input: { prompt: string; images: string[] }) => Promise<AiSceneSpec> | AiSceneSpec

function e2eMock(): AiSceneMock | null {
  try {
    if (typeof window === 'undefined' || window.localStorage?.getItem('__nomiE2E') !== '1') return null
    const mock = (window as unknown as { __nomiDirectorAiMock?: AiSceneMock }).__nomiDirectorAiMock
    return typeof mock === 'function' ? mock : null
  } catch {
    return null
  }
}

export function useAiSceneBuilder(): { status: AiSceneStatus; run: (description: string, images: string[], target: AiSceneTarget) => Promise<boolean>; cancel: () => void; reset: () => void } {
  const { t } = useTranslation()
  const store = useDirectorStoreApi()
  const [status, setStatus] = React.useState<AiSceneStatus>(IDLE)
  const abortRef = React.useRef<AbortController | null>(null)
  const timerRef = React.useRef<number | null>(null)

  const stopTimer = React.useCallback(() => {
    if (timerRef.current !== null) window.clearInterval(timerRef.current)
    timerRef.current = null
  }, [])

  React.useEffect(() => () => {
    abortRef.current?.abort()
    abortRef.current = null
    stopTimer()
  }, [stopTimer])

  const reset = React.useCallback(() => {
    abortRef.current?.abort()
    abortRef.current = null
    stopTimer()
    setStatus(IDLE)
  }, [stopTimer])

  // 取消：立刻把状态切到「已取消」（底层通道的 abort 可能慢半拍，用户点了就该有反馈），结果回来也不落场景
  const cancel = React.useCallback(() => {
    if (!abortRef.current) return
    abortRef.current.abort()
    abortRef.current = null
    stopTimer()
    setStatus((current) => ({ ...current, phase: 'cancelled', message: t('director.ai.cancelled') }))
  }, [stopTimer, t])

  const saveToLibrary = React.useCallback(
    async (scene: NormalizedAiScene, controller: AbortController): Promise<AiSceneLibraryAsset | undefined> => {
      const sceneName = scene.sceneName
      const exported = exportAiScene(scene)
      const file = new File([JSON.stringify(exported)], `${sceneName}.json`, { type: 'application/json' })
      let url: string
      try {
        url = hostedAssetUrl(await importWorkbenchLocalAssetFile(file, file.name))
      } catch {
        url = await readFileAsDataUrl(file).catch(() => '')
      }
      if (!url || controller.signal.aborted || abortRef.current !== controller) return
      return { name: t('director.ai.libraryName', { name: sceneName }), kind: 'scene', url, folderId: null, sizeBytes: file.size }
    },
    [t],
  )

  const run = React.useCallback(
    async (description: string, images: string[], target: AiSceneTarget): Promise<boolean> => {
      const trimmed = description.trim()
      if (!trimmed && images.length === 0) {
        toast(t('director.ai.needInput'), 'warning')
        return false
      }
      if (abortRef.current) return false
      const controller = new AbortController()
      abortRef.current = controller
      const targetSceneId = store.getState().project.activeSceneId
      const ownsRequest = () => abortRef.current === controller && !controller.signal.aborted
      const label = trimmed || t('director.ai.imageOnlyName')
      let elapsed = 0
      let chars = 0
      setStatus({ phase: 'running', message: t('director.ai.building', { name: label }), elapsedSeconds: 0, streamedChars: 0 })
      timerRef.current = window.setInterval(() => {
        elapsed += 1
        setStatus((current) => (current.phase === 'running' ? { ...current, elapsedSeconds: elapsed } : current))
      }, 1000)
      try {
        let spec: AiSceneSpec | null = null
        const mock = e2eMock()
        if (mock) {
          spec = await mock({ prompt: trimmed, images })
        } else {
          const brain = await getTextBrain().catch(() => null)
          if (!ownsRequest()) return false
          if (!brain) {
            setStatus({ phase: 'error', message: t('director.ai.noTextModel'), elapsedSeconds: elapsed, streamedChars: 0 })
            toast(t('director.ai.noTextModel'), 'warning')
            return false
          }
          let text = ''
          await runWorkbenchTextTaskStream(
            brain.vendor,
            { kind: 'prompt_refine', prompt: buildAiScenePrompt(trimmed, images.length), extras: { modelKey: brain.modelKey, referenceImages: images } },
            {
              signal: controller.signal,
              onDelta: (delta) => {
                text += delta
                chars = text.length
                if (ownsRequest()) setStatus((current) => (current.phase === 'running' ? { ...current, streamedChars: chars } : current))
              },
            },
          )
          spec = parseAiSceneText(text)
        }
        if (!ownsRequest()) return false
        if (!spec) {
          setStatus({ phase: 'error', message: t('director.ai.invalidOutput'), elapsedSeconds: elapsed, streamedChars: chars })
          toast(t('director.ai.invalidOutput'), 'error')
          return false
        }
        const normalized = normalizeAiScene(spec, t('director.ai.defaultSceneName'))
        const asset = await saveToLibrary(normalized, controller)
        if (!ownsRequest()) return false
        const placed = store.getState().materializeAiScene(normalized, target, targetSceneId, asset)
        setStatus({ phase: 'done', message: t('director.ai.done', { name: normalized.sceneName, count: placed.objectCount }), elapsedSeconds: elapsed, streamedChars: chars })
        toast(t('director.ai.done', { name: normalized.sceneName, count: placed.objectCount }), 'success')
        return true
      } catch (error) {
        if (!ownsRequest()) return false
        if (error instanceof DOMException && error.name === 'AbortError') {
          setStatus({ phase: 'cancelled', message: t('director.ai.cancelled'), elapsedSeconds: elapsed, streamedChars: chars })
          return false
        }
        setStatus({ phase: 'error', message: t('director.ai.failed'), elapsedSeconds: elapsed, streamedChars: chars })
        toast(t('director.ai.failed'), 'error')
        return false
      } finally {
        if (abortRef.current === controller) {
          stopTimer()
          abortRef.current = null
        }
      }
    },
    [saveToLibrary, stopTimer, store, t],
  )

  return { status, run, cancel, reset }
}
