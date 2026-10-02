/**
 * [INPUT]: 依赖 react、react-i18next、../../../../ui/toast、../../../api/promptLibraryApi 的 getTextBrain、../../../api/taskApi 的 runWorkbenchTextTaskStream（Nomi 现有文本流式通道）、../../../ai/agentLoopMode 的现有 Agent Lane single-shot、
 *          ../../../api/assetUploadApi（importWorkbenchLocalAssetFile / hostedAssetUrl）、./DirectorEditorContext、./model/aiScene（提示词 / 解析 / 规整 / 夹具）、
 *          ./model/storeAiSceneActions 的 exportAiScene / AiSceneTarget / AiSceneLibraryAsset、./panels/imageFile 的 readFileAsDataUrl
 * [OUTPUT]: 对外提供 useAiSceneBuilder() → { status, run, cancel, reset }、AiSceneStatus；导演运镜输入先过 director-cinematography Skill 再落 DirectorPlan
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
import { parseDirectorRuntimePlan, type DirectorPlan } from './model/directorPlan'
import { exportAiScene, type AiSceneTarget, type AiSceneLibraryAsset } from './model/storeAiSceneActions'
import { readFileAsDataUrl } from './panels/imageFile'
import { isProjectExecutionContextCurrent, isProjectImportCancellation, withProjectAction, type ProjectExecutionContext } from '../../../project/projectCanvasReadSurface'

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

function directorRuntimePrompt(request: string, currentPlan: DirectorPlan | null): string {
  const existing = currentPlan
    ? JSON.stringify({ shots: currentPlan.shots.map((shot) => ({ order: shot.order + 1, name: shot.name, duration: shot.duration, subjects: shot.subjectIds, motions: shot.motions.map((motion) => ({ kind: motion.kind, duration: motion.duration, amount: motion.amount, easing: motion.easing })) })) })
    : 'none'
  return [
    "You are Nomi's 3D Director planning Skill. Read director-cinematography and translate the user request into a bounded playable whitebox camera plan.",
    'Return JSON only, with exactly one object: {"prompt":"..."}. The prompt must contain one to three labelled Shot 1/Shot 2/Shot 3 descriptions, concrete subjects, semantic camera motions (push, pull, pan, tilt, orbit, follow or target switch), optional duration in seconds, and target-centering/look-at intent. Preserve the existing shot order when the request edits a shot.',
    `Existing typed plan (use its shot numbering for local edits): ${existing}`,
    `User request: ${request}`,
  ].join('\n\n')
}

export function useAiSceneBuilder(): { status: AiSceneStatus; run: (description: string, images: string[], target: AiSceneTarget) => Promise<boolean>; cancel: () => void; reset: () => void } {
  const { t } = useTranslation()
  const store = useDirectorStoreApi()
  const [status, setStatus] = React.useState<AiSceneStatus>(IDLE)
  const abortRef = React.useRef<AbortController | null>(null)
  const runtimeCancelRef = React.useRef<(() => void) | null>(null)
  const timerRef = React.useRef<number | null>(null)

  const stopTimer = React.useCallback(() => {
    if (timerRef.current !== null) window.clearInterval(timerRef.current)
    timerRef.current = null
  }, [])

  React.useEffect(() => () => {
    abortRef.current?.abort()
    runtimeCancelRef.current?.()
    abortRef.current = null
    runtimeCancelRef.current = null
    stopTimer()
  }, [stopTimer])

  const reset = React.useCallback(() => {
    abortRef.current?.abort()
    runtimeCancelRef.current?.()
    abortRef.current = null
    runtimeCancelRef.current = null
    stopTimer()
    setStatus(IDLE)
  }, [stopTimer])

  // 取消：立刻把状态切到「已取消」（底层通道的 abort 可能慢半拍，用户点了就该有反馈），结果回来也不落场景
  const cancel = React.useCallback(() => {
    if (!abortRef.current) return
    abortRef.current.abort()
    runtimeCancelRef.current?.()
    abortRef.current = null
    runtimeCancelRef.current = null
    stopTimer()
    setStatus((current) => ({ ...current, phase: 'cancelled', message: t('director.ai.cancelled') }))
  }, [stopTimer, t])

  const saveToLibrary = React.useCallback(
    async (scene: NormalizedAiScene, controller: AbortController, project: ProjectExecutionContext): Promise<AiSceneLibraryAsset | undefined> => {
      const sceneName = scene.sceneName
      const exported = exportAiScene(scene)
      const file = new File([JSON.stringify(exported)], `${sceneName}.json`, { type: 'application/json' })
      let url: string
      try {
        // 落进「发起搭场景那一刻」的项目；等模型那段时间换了项目，发布前就被拒，不会落进新项目的素材库。
        url = hostedAssetUrl(await importWorkbenchLocalAssetFile(file, file.name, { projectBinding: project.binding, assertCurrent: project.assertCurrent }))
      } catch (error) {
        if (!isProjectExecutionContextCurrent(project) || isProjectImportCancellation(error)) return
        url = await readFileAsDataUrl(file).catch(() => '')
      }
      if (!url || controller.signal.aborted || abortRef.current !== controller || !isProjectExecutionContextCurrent(project)) return
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
      // 动作起点签发原项目：模型流式、落素材库、写回导演台都只认它。
      return withProjectAction(async (project) => {
        const controller = new AbortController()
        abortRef.current = controller
        const targetSceneId = store.getState().project.activeSceneId
        const ownsRequest = () => abortRef.current === controller && !controller.signal.aborted && isProjectExecutionContextCurrent(project)
        const label = trimmed || t('director.ai.imageOnlyName')
        let elapsed = 0
        let chars = 0
        setStatus({ phase: 'running', message: t('director.ai.building', { name: label }), elapsedSeconds: 0, streamedChars: 0 })
        timerRef.current = window.setInterval(() => {
          elapsed += 1
          setStatus((current) => (current.phase === 'running' ? { ...current, elapsedSeconds: elapsed } : current))
        }, 1000)
        try {
          // Text-only requests for the current layer take the typed P0 plan path. Reference-image
          // requests and new-layer placement retain the existing scene-builder flow.
          if (target === 'current_layer' && images.length === 0 && trimmed.length > 0) {
            const fixture = e2eMock()
            let planPrompt = trimmed
            if (!fixture) {
              const { runSingleShotAgent } = await import('../../../ai/agentLoopMode')
              const response = await runSingleShotAgent({
                projectId: project.binding.projectId,
                featureKey: 'director.preview-plan',
                prompt: directorRuntimePrompt(trimmed, store.getState().directorPlan),
                displayPrompt: trimmed,
                skillKey: 'director-cinematography',
                onCancelReady: (cancelRuntime) => {
                  if (abortRef.current === controller) runtimeCancelRef.current = cancelRuntime
                },
              })
              if (!ownsRequest()) return false
              const parsed = parseDirectorRuntimePlan(response.text)
              if (!parsed) {
                const message = 'Director Skill returned an invalid plan. Edit the prompt and try again.'
                setStatus({ phase: 'error', message, elapsedSeconds: elapsed, streamedChars: response.text.length })
                toast(message, 'error')
                return false
              }
              planPrompt = parsed.prompt
              chars = response.text.length
            }
            const result = store.getState().applyDirectorPlanPrompt(planPrompt)
            if (!ownsRequest()) return false
            if (!result.accepted) {
              setStatus({ phase: 'error', message: result.status.message, elapsedSeconds: elapsed, streamedChars: chars })
              toast(result.status.message, 'error')
              return false
            }
            setStatus({ phase: 'done', message: result.status.message, elapsedSeconds: elapsed, streamedChars: chars })
            toast(result.status.message, 'success')
            return true
          }
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
              project.binding.projectId,
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
          const asset = await saveToLibrary(normalized, controller, project)
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
            runtimeCancelRef.current = null
            abortRef.current = null
          }
        }
      }, async () => false)
    },
    [saveToLibrary, stopTimer, store, t],
  )

  return { status, run, cancel, reset }
}
