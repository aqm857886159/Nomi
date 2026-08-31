import React from 'react'
import { useTranslation } from 'react-i18next'
import {
  IconAlertTriangle,
  IconArrowRight,
  IconClock,
  IconCopy,
  IconChevronDown,
  IconFileText,
  IconLoader2,
  IconMovie,
  IconSettings,
} from '@tabler/icons-react'

import type {
  VideoAnalysisEvidence,
  VideoAnalysisResult,
  VideoAnalysisTask,
} from '../../../../electron/videoAnalysis/contracts'
import { getDesktopBridge } from '../../../desktop/bridge'
import { useFilmstrip } from '../../../media/useFilmstrip'
import { cn } from '../../../utils/cn'
import { formatElapsed } from '../../taskCenter/taskCenterEntries'
import {
  refreshVideoAnalysisTasks,
  useVideoAnalysisProjectionStore,
} from '../../videoAnalysis/videoAnalysisProjectionStore'
import type { GenerationCanvasNode } from '../model/generationCanvasTypes'
import { useGenerationCanvasStore } from '../store/generationCanvasStore'
import { extractShotCutsToNodes } from './extractShotCutsToNodes'
import {
  buildStructureDraft,
  buildStructureExtractionItems,
  hasReusableVideoAnalysisStructure,
  isEvidenceOnlyVideoAnalysisResult,
  isVideoAnalysisActiveTask,
  timeRangeStartSeconds,
} from './videoDeconstructionModel'

type HealthState =
  | { status: 'checking' }
  | { status: 'ready'; reachable: boolean; configured: boolean; engine: string | null; error: string | null }

type ResultState =
  | { status: 'idle' | 'loading' }
  | { status: 'failed'; message: string }
  | { status: 'ready'; result: VideoAnalysisResult; evidence: VideoAnalysisEvidence | null }

function EvidenceText({ label, text, empty }: { label: string; text: string; empty: string }): JSX.Element {
  const { t } = useTranslation()
  const [expanded, setExpanded] = React.useState(false)
  const value = text || empty
  const isLong = value.length > 320
  return (
    <div className="min-w-0">
      <div className="flex items-start gap-1.5">
        <p className={cn('min-w-0 flex-1 break-words', isLong && !expanded && 'line-clamp-5')}>
          <span className="text-nomi-ink-40">{label}</span> {value}
        </p>
        {text ? (
          <button
            type="button"
            className="grid size-6 shrink-0 place-items-center rounded-nomi-sm text-nomi-ink-40 hover:bg-nomi-ink-05 hover:text-nomi-ink"
            aria-label={t('generationCommon.node.videoDeconstruction.copyEvidence')}
            title={t('generationCommon.node.videoDeconstruction.copyEvidence')}
            onClick={() => { void navigator.clipboard?.writeText(text) }}
          >
            <IconCopy size={13} stroke={1.8} aria-hidden />
          </button>
        ) : null}
      </div>
      {isLong ? (
        <button
          type="button"
          className="mt-1 inline-flex items-center gap-1 text-micro text-nomi-accent hover:underline"
          onClick={() => setExpanded((value) => !value)}
        >
          <IconChevronDown size={12} stroke={1.8} className={expanded ? 'rotate-180' : undefined} aria-hidden />
          {t(expanded
            ? 'generationCommon.node.videoDeconstruction.collapseEvidence'
            : 'generationCommon.node.videoDeconstruction.expandEvidence')}
        </button>
      ) : null}
    </div>
  )
}

function taskStageKey(stage: VideoAnalysisTask['stage']): string {
  const keys = {
    queued: 'queued',
    reading_media: 'readingMedia',
    analyzing_evidence: 'analyzingEvidence',
    structuring: 'structuring',
    completed: 'completed',
  } as const
  return keys[stage]
}

function filmstripStyle(seconds: number, duration: number, url: string, tiles: number): React.CSSProperties {
  const count = Math.max(1, tiles)
  const ratio = duration > 0 ? Math.min(1, Math.max(0, seconds / duration)) : 0
  const index = Math.round(ratio * Math.max(0, count - 1))
  const position = count > 1 ? (index / (count - 1)) * 100 : 0
  return {
    backgroundImage: `url("${url}")`,
    backgroundSize: `${count * 100}% 100%`,
    backgroundPosition: `${position}% 0%`,
  }
}

export function VideoAnalysisStructureView({
  node,
  projectId,
  analysisId,
  focusedShotId,
  onAnalysisIdChange,
  onDone,
}: {
  node: GenerationCanvasNode
  projectId: string
  analysisId: string | null
  focusedShotId: number | null
  onAnalysisIdChange: (analysisId: string) => void
  onDone: () => void
}): JSX.Element {
  const { t, i18n } = useTranslation()
  const tasks = useVideoAnalysisProjectionStore((state) => state.tasksByProject[projectId] ?? [])
  const task = React.useMemo(() => {
    if (analysisId) {
      const selected = tasks.find((candidate) => candidate.analysisId === analysisId)
      if (selected) return selected
    }
    return tasks
      .filter((candidate) => candidate.sourceNodeId === node.id)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0] ?? null
  }, [analysisId, node.id, tasks])
  const [health, setHealth] = React.useState<HealthState>({ status: 'checking' })
  const [resultState, setResultState] = React.useState<ResultState>({ status: 'idle' })
  const [selectedScenes, setSelectedScenes] = React.useState<ReadonlySet<number>>(() => new Set())
  const [now, setNow] = React.useState(() => Date.now())
  const [adopting, setAdopting] = React.useState<{ done: number; total: number } | null>(null)
  const [starting, setStarting] = React.useState(false)
  const [submissionMode, setSubmissionMode] = React.useState<boolean | null>(null)
  const resultScrollRef = React.useRef<HTMLDivElement | null>(null)
  const filmstrip = useFilmstrip(node.result?.url, projectId)
  const taskAnalysisId = task?.analysisId
  const taskResultAvailable = task?.resultAvailable
  const taskStatus = task?.status

  React.useEffect(() => {
    if (task) return
    let alive = true
    const desktop = getDesktopBridge()
    const probe = desktop?.videoAnalysis?.health
    if (!probe) {
      setHealth({ status: 'ready', reachable: false, configured: false, engine: null, error: 'desktop_required' })
      return () => { alive = false }
    }
    setHealth({ status: 'checking' })
    void Promise.all([
      probe(),
      desktop?.settings?.videoAnalysis.get().catch(() => null) ?? Promise.resolve(null),
    ])
      .then(([value, settings]) => {
        if (alive) {
          setHealth({ status: 'ready', ...value })
          setSubmissionMode(settings?.externalInference ?? false)
        }
      })
      .catch((error: unknown) => {
        if (alive) setHealth({
          status: 'ready',
          reachable: false,
          configured: true,
          engine: null,
          error: error instanceof Error ? error.message : String(error),
        })
      })
    return () => { alive = false }
  }, [task])

  React.useEffect(() => {
    let alive = true
    void getDesktopBridge()?.settings?.videoAnalysis.get()
      .then((settings) => { if (alive && settings) setSubmissionMode(settings.externalInference) })
      .catch(() => undefined)
    return () => { alive = false }
  }, [projectId, taskAnalysisId])

  React.useEffect(() => {
    if (!task || !isVideoAnalysisActiveTask(task)) return
    const id = window.setInterval(() => setNow(Date.now()), 1_000)
    return () => window.clearInterval(id)
  }, [task])

  React.useEffect(() => {
    if (!taskAnalysisId || taskStatus !== 'completed' || !taskResultAvailable) {
      setResultState({ status: 'idle' })
      return
    }
    let alive = true
    setResultState({ status: 'loading' })
    void getDesktopBridge()?.videoAnalysis?.read(projectId, taskAnalysisId)
      .then((payload) => {
        if (!alive) return
        if (!payload?.result) {
          setResultState({ status: 'failed', message: t('generationCommon.node.videoDeconstruction.resultIntegrityError') })
          return
        }
        setResultState({ status: 'ready', result: payload.result, evidence: payload.evidence })
        setSelectedScenes(new Set(payload.result.scenes.map((scene) => scene.sceneIndex)))
      })
      .catch((error: unknown) => {
        if (alive) setResultState({ status: 'failed', message: error instanceof Error ? error.message : String(error) })
      })
    return () => { alive = false }
  }, [projectId, t, taskAnalysisId, taskResultAvailable, taskStatus])

  React.useEffect(() => {
    if (resultState.status !== 'ready' || !focusedShotId) return
    const frame = window.requestAnimationFrame(() => {
      resultScrollRef.current
        ?.querySelector(`[data-analysis-shot-id="${focusedShotId}"]`)
        ?.scrollIntoView({ block: 'center' })
    })
    return () => window.cancelAnimationFrame(frame)
  }, [focusedShotId, resultState.status])

  const start = async (): Promise<void> => {
    const bridge = getDesktopBridge()?.videoAnalysis
    const assetUrl = node.result?.url
    if (!bridge || !assetUrl || starting) return
    setStarting(true)
    try {
      const started = await bridge.start({ projectId, assetUrl, sourceNodeId: node.id })
      useVideoAnalysisProjectionStore.getState().publishTask(started)
      onAnalysisIdChange(started.analysisId)
      await refreshVideoAnalysisTasks(projectId).catch(() => undefined)
    } finally {
      setStarting(false)
    }
  }

  const adopt = async (): Promise<void> => {
    if (resultState.status !== 'ready' || !task || adopting) return
    const items = buildStructureExtractionItems(resultState.result, selectedScenes, task.analysisId)
    if (!items.length) return
    setAdopting({ done: 0, total: items.length })
    const outcome = await extractShotCutsToNodes({ node, projectId, items, onProgress: setAdopting })
    setAdopting(null)
    if (outcome.created > 0) onDone()
  }

  const reuseStructure = (): void => {
    if (resultState.status !== 'ready') return
    const store = useGenerationCanvasStore.getState()
    store.setGenerationAiDraft(buildStructureDraft(resultState.result, i18n.resolvedLanguage || i18n.language))
    store.setGenerationAiCollapsed(false)
    onDone()
  }

  if (!task) {
    const unavailable = health.status === 'ready' && !health.reachable
    return (
      <div className="flex h-full min-h-0 flex-col">
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          <div className="flex min-h-full flex-col justify-center py-6">
            <div className="mb-3 grid size-9 place-items-center rounded-nomi bg-nomi-ink-05 text-nomi-ink-60">
              {health.status === 'checking'
                ? <IconLoader2 size={18} stroke={1.7} className="animate-spin" aria-hidden />
                : unavailable
                  ? <IconAlertTriangle size={18} stroke={1.7} aria-hidden />
                  : <IconFileText size={18} stroke={1.7} aria-hidden />}
            </div>
            <div className="text-body font-medium text-nomi-ink">
              {health.status === 'checking'
                ? t('generationCommon.node.videoDeconstruction.checkingEngine')
                : unavailable
                  ? t('generationCommon.node.videoDeconstruction.engineUnavailable')
                  : t('generationCommon.node.videoDeconstruction.structureEmpty')}
            </div>
            <div className="mt-1 max-w-md text-body-sm leading-relaxed text-nomi-ink-60">
              {unavailable
                ? t('generationCommon.node.videoDeconstruction.engineUnavailableHint')
                : t('generationCommon.node.videoDeconstruction.structureEmptyHint')}
            </div>
            {health.status === 'ready' && health.engine ? (
              <div className="mt-3 text-micro text-nomi-ink-40">{health.engine}</div>
            ) : null}
            {health.status === 'ready' && !unavailable ? (
              <div className={cn(
                'mt-4 max-w-md border-l-2 pl-3 text-body-sm leading-relaxed',
                submissionMode ? 'border-nomi-warning text-nomi-ink-60' : 'border-nomi-line text-nomi-ink-60',
              )}>
                <div className="font-medium text-nomi-ink">
                  {submissionMode
                    ? t('generationCommon.node.videoDeconstruction.externalMode')
                    : t('generationCommon.node.videoDeconstruction.localEvidenceMode')}
                </div>
                <div className="mt-0.5">
                  {t(submissionMode
                    ? 'generationCommon.node.videoDeconstruction.externalSubmitDisclosure'
                    : 'generationCommon.node.videoDeconstruction.localSubmitDisclosure')}
                </div>
                <button
                  type="button"
                  className="mt-1 text-micro text-nomi-accent hover:underline"
                  onClick={() => window.dispatchEvent(new CustomEvent('nomi-open-settings', { detail: { tab: 'automation', section: 'video-analysis' } }))}
                >
                  {t('generationCommon.node.videoDeconstruction.changeMode')}
                </button>
              </div>
            ) : null}
          </div>
        </div>
        <div className="flex min-h-16 shrink-0 items-center justify-end gap-2 border-t border-nomi-line px-4 py-3">
          {unavailable ? (
            <button
              type="button"
              className="inline-flex h-9 items-center gap-1.5 rounded-nomi-sm border border-nomi-line bg-nomi-paper px-3 text-body-sm text-nomi-ink hover:bg-nomi-ink-05"
              onClick={() => window.dispatchEvent(new CustomEvent('nomi-open-settings', { detail: { tab: 'automation', section: 'video-analysis' } }))}
            >
              <IconSettings size={15} stroke={1.8} aria-hidden />
              {t('generationCommon.node.videoDeconstruction.openSettings')}
            </button>
          ) : (
            <button
              type="button"
              className="inline-flex h-9 items-center gap-1.5 rounded-full border-0 bg-nomi-ink px-4 text-body font-medium text-nomi-paper hover:bg-nomi-accent disabled:opacity-40"
              disabled={health.status !== 'ready' || starting}
              onClick={() => { void start() }}
            >
              {starting ? t('generationCommon.node.videoDeconstruction.starting') : t('generationCommon.node.videoDeconstruction.start')}
              <IconArrowRight size={15} stroke={1.8} aria-hidden />
            </button>
          )}
        </div>
      </div>
    )
  }

  if (isVideoAnalysisActiveTask(task)) {
    const startedAt = Date.parse(task.startedAt ?? task.createdAt)
    const lastUpdate = task.lastEngineUpdateAt ? Date.parse(task.lastEngineUpdateAt) : null
    const progressBaseline = lastUpdate ?? startedAt
    const stalled = now - progressBaseline >= 15_000
    const engineOffline = task.status === 'engine_unreachable'
    return (
      <div className="flex h-full min-h-0 flex-col">
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          <div className="flex items-start gap-3 border-b border-nomi-line-soft pb-4">
            <div className="grid size-9 shrink-0 place-items-center rounded-nomi bg-nomi-accent-soft text-nomi-accent">
              {engineOffline
                ? <IconAlertTriangle size={18} stroke={1.8} aria-hidden />
                : <IconLoader2 size={18} stroke={1.8} className="animate-spin" aria-hidden />}
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-body font-medium text-nomi-ink">
                {engineOffline
                  ? t('generationCommon.node.videoDeconstruction.engineOfflinePolling')
                  : task.status === 'submission_unknown'
                  ? t('taskCenter.videoAnalysis.submissionUnknown')
                  : t(`taskCenter.videoAnalysis.stages.${taskStageKey(task.stage)}`)}
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-micro text-nomi-ink-60">
                <span className="inline-flex items-center gap-1">
                  <IconClock size={12} stroke={1.8} aria-hidden />
                  {t('taskCenter.row.elapsed', { time: formatElapsed(now - startedAt) })}
                </span>
                <span>{task.externalInference
                  ? t('generationCommon.node.videoDeconstruction.externalMode')
                  : t('generationCommon.node.videoDeconstruction.localEvidenceMode')}</span>
              </div>
            </div>
          </div>
          <div className="py-4">
            <div className="text-micro text-nomi-ink-40">{t('generationCommon.node.videoDeconstruction.engineStage')}</div>
            <div className="mt-1 break-words text-body-sm text-nomi-ink-80">
              {engineOffline
                ? t('generationCommon.node.videoDeconstruction.engineOfflinePollingHint')
                : task.stageText || t('generationCommon.node.videoDeconstruction.waitingEngineUpdate')}
            </div>
            {task.lastEngineCheckAt ? (
              <div className="mt-1 text-micro text-nomi-ink-40">
                {t('generationCommon.node.videoDeconstruction.lastEngineCheck', {
                  time: new Date(task.lastEngineCheckAt).toLocaleTimeString(),
                })}
              </div>
            ) : null}
            {stalled ? (
              <div className="mt-3 flex items-start gap-2 rounded-nomi-sm bg-nomi-ink-05 px-3 py-2 text-body-sm text-nomi-ink-60">
                <IconClock size={15} stroke={1.8} className="mt-0.5 shrink-0" aria-hidden />
                {t('taskCenter.videoAnalysis.stillProcessing', { time: formatElapsed(now - progressBaseline) })}
              </div>
            ) : null}
          </div>
        </div>
        <div className="flex min-h-16 shrink-0 items-center justify-between gap-3 border-t border-nomi-line px-4 py-3">
          <span className="text-micro text-nomi-ink-40">{t('generationCommon.node.videoDeconstruction.safeToClose')}</span>
          {engineOffline ? (
            <button
              type="button"
              className="inline-flex h-9 items-center gap-1.5 rounded-nomi-sm border border-nomi-line bg-nomi-paper px-3 text-body-sm text-nomi-ink hover:bg-nomi-ink-05"
              onClick={() => window.dispatchEvent(new CustomEvent('nomi-open-settings', { detail: { tab: 'automation', section: 'video-analysis' } }))}
            >
              <IconSettings size={15} stroke={1.8} aria-hidden />
              {t('generationCommon.node.videoDeconstruction.openSettings')}
            </button>
          ) : <button
            type="button"
            className="h-9 rounded-nomi-sm border border-nomi-line bg-nomi-paper px-3 text-body-sm text-nomi-ink hover:bg-nomi-ink-05"
            onClick={onDone}
          >
            {t('generationCommon.node.videoDeconstruction.runInBackground')}
          </button>}
        </div>
      </div>
    )
  }

  if (task.status !== 'completed' || resultState.status === 'failed') {
    const message = resultState.status === 'failed' ? resultState.message : task.errorMessage
    const canRetry = task.status !== 'submission_unknown' && (
      task.status === 'failed'
      || task.status === 'cancelled'
      || task.status === 'engine_incompatible'
      || (task.status === 'engine_unreachable' && !task.engineTaskId)
    )
    return (
      <div className="flex h-full min-h-0 flex-col">
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          <div className="flex min-h-full flex-col justify-center py-6">
            <IconAlertTriangle size={22} stroke={1.7} className="mb-3 text-nomi-warning" aria-hidden />
            <div className="text-body font-medium text-nomi-ink">{t('generationCommon.node.videoDeconstruction.needsAttention')}</div>
            <div className="mt-1 break-words text-body-sm leading-relaxed text-nomi-ink-60">
              {message || t('generationCommon.node.videoDeconstruction.needsAttentionHint')}
            </div>
            {canRetry && submissionMode !== null ? (
              <div className={cn(
                'mt-4 max-w-md border-l-2 pl-3 text-body-sm leading-relaxed text-nomi-ink-60',
                submissionMode ? 'border-nomi-warning' : 'border-nomi-line',
              )}>
                <div className="font-medium text-nomi-ink">
                  {submissionMode
                    ? t('generationCommon.node.videoDeconstruction.externalMode')
                    : t('generationCommon.node.videoDeconstruction.localEvidenceMode')}
                </div>
                {t(submissionMode
                  ? 'generationCommon.node.videoDeconstruction.externalSubmitDisclosure'
                  : 'generationCommon.node.videoDeconstruction.localSubmitDisclosure')}
              </div>
            ) : null}
          </div>
        </div>
        <div className="flex min-h-16 shrink-0 items-center justify-end gap-2 border-t border-nomi-line px-4 py-3">
          <button
            type="button"
            className="inline-flex h-9 items-center gap-1.5 rounded-nomi-sm border border-nomi-line bg-nomi-paper px-3 text-body-sm text-nomi-ink hover:bg-nomi-ink-05"
            onClick={() => window.dispatchEvent(new CustomEvent('nomi-open-settings', { detail: { tab: 'automation', section: 'video-analysis' } }))}
          >
            <IconSettings size={15} stroke={1.8} aria-hidden />
            {t('generationCommon.node.videoDeconstruction.openSettings')}
          </button>
          {canRetry ? (
            <button
              type="button"
              className="inline-flex h-9 items-center gap-1.5 rounded-full border-0 bg-nomi-ink px-4 text-body-sm font-medium text-nomi-paper hover:bg-nomi-accent disabled:opacity-40"
              disabled={starting}
              onClick={() => { void start() }}
            >
              {starting
                ? t('generationCommon.node.videoDeconstruction.starting')
                : t('generationCommon.node.videoDeconstruction.retry')}
              <IconArrowRight size={15} stroke={1.8} aria-hidden />
            </button>
          ) : null}
        </div>
      </div>
    )
  }

  if (resultState.status !== 'ready') {
    return (
      <div className="grid h-full place-items-center text-body-sm text-nomi-ink-60">
        {t('generationCommon.node.videoDeconstruction.loadingResult')}
      </div>
    )
  }

  const { result, evidence } = resultState
  const evidenceOnly = isEvidenceOnlyVideoAnalysisResult(result)
  const canReuseStructure = hasReusableVideoAnalysisStructure(result)
  const inferredDuration = Math.max(
    Number(node.meta?.videoDuration) || 0,
    ...result.scenes.map((scene) => timeRangeStartSeconds(scene.timeRange) + 1),
  )
  const selectedShotCount = buildStructureExtractionItems(result, selectedScenes, task.analysisId).length

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b border-nomi-line-soft px-4 py-3">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-micro text-nomi-ink-60">
          <span>{t(
            evidenceOnly
              ? 'generationCommon.node.videoDeconstruction.evidenceSectionCount'
              : 'generationCommon.node.videoDeconstruction.sceneCount',
            { count: result.scenes.length },
          )}</span>
          <span>{task.externalInference
            ? t('generationCommon.node.videoDeconstruction.externalMode')
            : t('generationCommon.node.videoDeconstruction.localEvidenceMode')}</span>
          {evidence?.engine ? <span>{evidence.engine}</span> : null}
        </div>
        <div className="mt-1 text-body-sm text-nomi-ink-80">
          {t(evidenceOnly
            ? 'generationCommon.node.videoDeconstruction.localEvidenceResultHint'
            : 'generationCommon.node.videoDeconstruction.evidenceFirstHint')}
        </div>
      </div>

      <div ref={resultScrollRef} className="min-h-0 flex-1 overflow-y-auto px-4">
        {result.scenes.map((scene) => {
          const selected = selectedScenes.has(scene.sceneIndex)
          const displayedRole = evidenceOnly
            ? t('generationCommon.node.videoDeconstruction.evidenceRole')
            : scene.marketingRole
          return (
            <section key={scene.sceneIndex} className="border-b border-nomi-line-soft py-4 last:border-b-0">
              <div className="flex items-start gap-2.5">
                <input
                  type="checkbox"
                  className="mt-0.5 size-4 shrink-0 accent-nomi-accent"
                  checked={selected}
                  aria-label={t('generationCommon.node.videoDeconstruction.selectScene', { title: scene.title || displayedRole })}
                  onChange={() => setSelectedScenes((current) => {
                    const next = new Set(current)
                    if (next.has(scene.sceneIndex)) next.delete(scene.sceneIndex)
                    else next.add(scene.sceneIndex)
                    return next
                  })}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-micro font-medium text-nomi-accent">{displayedRole}</span>
                    <span className="text-micro tabular-nums text-nomi-ink-40">{scene.timeRange}</span>
                  </div>
                  <h3 className="mt-1 break-words text-body font-medium text-nomi-ink">{scene.title || displayedRole}</h3>
                </div>
              </div>

              <div className="mt-3 space-y-3">
                {scene.shots.map((shot) => {
                  const rawEvidence = evidence?.rawEvidence.find((item) => (
                    item.shotId === shot.shotId
                    && item.spokenTextRef === shot.evidence?.spokenTextRef
                    && item.ocrTextRef === shot.evidence?.ocrTextRef
                  ))
                  const seconds = rawEvidence?.visualMs[0] !== undefined
                    ? rawEvidence.visualMs[0] / 1_000
                    : timeRangeStartSeconds(shot.timeRange)
                  return (
                    <div
                      key={shot.shotId}
                      data-analysis-shot-id={shot.shotId}
                      className="grid grid-cols-[136px_minmax(0,1fr)] gap-3 max-[719px]:grid-cols-1"
                    >
                      <div>
                        <div
                          className={cn(
                            'aspect-video w-full rounded-nomi-sm bg-nomi-ink-05 bg-no-repeat ring-1 ring-inset ring-nomi-line-soft',
                            filmstrip?.status === 'pending' && 'animate-pulse',
                          )}
                          style={filmstrip?.status === 'ready'
                            ? filmstripStyle(seconds, inferredDuration, filmstrip.url, filmstrip.tiles)
                            : undefined}
                          aria-label={t('generationCommon.node.videoDeconstruction.sourceFrameAt', { time: shot.timeRange })}
                        />
                        <div className="mt-1 text-micro tabular-nums text-nomi-ink-40">{shot.timeRange}</div>
                      </div>
                      <div className="min-w-0">
                        <div className="text-micro font-medium text-nomi-ink-40">
                          {t(rawEvidence
                            ? 'generationCommon.node.videoDeconstruction.rawEvidence'
                            : 'generationCommon.node.videoDeconstruction.unverifiedEvidence')}
                        </div>
                        <div className="mt-1 grid gap-1.5 text-body-sm leading-relaxed text-nomi-ink-80">
                          {rawEvidence ? (
                            <>
                              <EvidenceText
                                label={t('generationCommon.node.videoDeconstruction.asrLabel')}
                                text={rawEvidence.spokenText}
                                empty={t('generationCommon.node.videoDeconstruction.noSpeech')}
                              />
                              <EvidenceText
                                label={t('generationCommon.node.videoDeconstruction.ocrLabel')}
                                text={rawEvidence.ocrText}
                                empty={t('generationCommon.node.videoDeconstruction.noOcr')}
                              />
                            </>
                          ) : (
                            <p className="text-nomi-warning">{t('generationCommon.node.videoDeconstruction.unverifiedEvidenceHint')}</p>
                          )}
                        </div>
                        <div className="mt-3 text-micro font-medium text-nomi-ink-40">
                          {t(evidenceOnly
                            ? 'generationCommon.node.videoDeconstruction.evidenceSummary'
                            : 'generationCommon.node.videoDeconstruction.interpretation')}
                        </div>
                        <p className="mt-1 break-all text-body-sm leading-relaxed text-nomi-ink-60">{shot.visualDescription}</p>
                      </div>
                    </div>
                  )
                })}
              </div>
              {!evidenceOnly && scene.roleAnalysis ? (
                <div className="mt-3 border-l-2 border-nomi-line pl-3">
                  <div className="text-micro font-medium text-nomi-ink-40">{t('generationCommon.node.videoDeconstruction.interpretation')}</div>
                  <p className="mt-1 break-words text-body-sm leading-relaxed text-nomi-ink-60">{scene.roleAnalysis}</p>
                </div>
              ) : null}
            </section>
          )
        })}
        {result.summary || result.hookAnalysis ? (
          <section className="border-t border-nomi-line py-4">
            <div className="text-micro font-medium text-nomi-ink-40">
              {t(evidenceOnly
                ? 'generationCommon.node.videoDeconstruction.overallEvidenceSummary'
                : 'generationCommon.node.videoDeconstruction.overallInterpretation')}
            </div>
            {result.summary ? <p className="mt-1 break-words text-body-sm leading-relaxed text-nomi-ink-80">{result.summary}</p> : null}
            {result.hookAnalysis ? <p className="mt-2 break-words text-body-sm leading-relaxed text-nomi-ink-60">{result.hookAnalysis}</p> : null}
          </section>
        ) : null}
      </div>

      <div className="flex min-h-16 shrink-0 flex-wrap items-center justify-between gap-2 border-t border-nomi-line px-4 py-3">
        <span className="text-micro text-nomi-ink-40">
          {t('generationCommon.node.videoDeconstruction.selectedShots', { count: selectedShotCount })}
        </span>
        <div className="flex flex-wrap justify-end gap-2">
          {canReuseStructure ? (
            <button
              type="button"
              className="inline-flex h-9 items-center gap-1.5 rounded-nomi-sm border border-nomi-line bg-nomi-paper px-3 text-body-sm text-nomi-ink hover:bg-nomi-ink-05"
              onClick={reuseStructure}
            >
              <IconFileText size={15} stroke={1.8} aria-hidden />
              {t('generationCommon.node.videoDeconstruction.reuseStructure')}
            </button>
          ) : evidenceOnly ? (
            <button
              type="button"
              className="inline-flex h-9 items-center gap-1.5 rounded-nomi-sm border border-nomi-line bg-nomi-paper px-3 text-body-sm text-nomi-ink hover:bg-nomi-ink-05"
              onClick={() => window.dispatchEvent(new CustomEvent('nomi-open-settings', { detail: { tab: 'automation', section: 'video-analysis' } }))}
            >
              <IconSettings size={15} stroke={1.8} aria-hidden />
              {t('generationCommon.node.videoDeconstruction.configureInference')}
            </button>
          ) : null}
          <button
            type="button"
            className="inline-flex h-9 items-center gap-1.5 rounded-full border-0 bg-nomi-ink px-4 text-body font-medium text-nomi-paper hover:bg-nomi-accent disabled:opacity-40"
            disabled={!selectedShotCount || Boolean(adopting)}
            onClick={() => { void adopt() }}
          >
            {adopting
              ? t('generationCommon.node.shotCuts.committing', { done: adopting.done, total: adopting.total })
              : t('generationCommon.node.videoDeconstruction.addToCanvas')}
            {adopting ? <IconLoader2 size={15} stroke={1.8} className="animate-spin" aria-hidden /> : <IconMovie size={15} stroke={1.8} aria-hidden />}
          </button>
        </div>
      </div>
    </div>
  )
}
