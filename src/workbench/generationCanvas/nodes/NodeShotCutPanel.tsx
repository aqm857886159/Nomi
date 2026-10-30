import { canvasDocumentInput } from '../../shortcutSurface'
import { notify } from '../../../ui/notificationPolicy'
/**
 * 「按镜头拆」面板：检测 → 预览 → 勾选 → 才落画布。
 *
 * 为什么不一键往画布糊 N 个节点：阈值是玄学，不同片子差很多；不给看就落，用户得挨个删。
 * 灵敏度滑杆**瞬时响应**——主进程一次低阈值检测已经把全集连同 scene_score 一起给了，
 * 滑杆只在前端过滤（见 shotCutSelection.ts）。
 *
 * ⚠️ 配色一律 `--nomi-*`：本面板 Portal 到画布视口，`--workbench-*` 只在 `.workbench-shell` 作用域内有定义，
 * 够不到就会**静默退回继承色**（上一轮走查读到 rgb(201,201,201) 才发现，单测全绿）。
 */
import React, { type JSX } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { IconAlertTriangle, IconX } from '@tabler/icons-react'
import { cn } from '../../../utils/cn'
import { getDesktopBridge } from '../../../desktop/bridge'
import type { GenerationCanvasNode } from '../model/generationCanvasTypes'
import type { ShotCutCoverage } from '../../../../electron/shared/canvas/shotTable'
import { extractShotCutsToNodes } from './extractShotCutsToNodes'
import { isProjectExecutionContextCurrent, withProjectAction } from '../../project/projectCanvasReadSurface'
import {
  SHOT_SENSITIVITY_DEFAULT,
  SHOT_SENSITIVITY_MAX,
  SHOT_SENSITIVITY_MIN,
  SHOT_SENSITIVITY_STEP,
  evenFrameCount,
  evenFrameSeconds,
  filterShotCuts,
  formatShotTimestamp,
  pickDefaultSensitivity,
  shotSheetTileStyle,
  type ShotCut,
} from './shotCutSelection'

type DetectState =
  | { phase: 'detecting' }
  | { phase: 'failed'; message: string }
  | {
      phase: 'ready'
      cuts: ShotCut[]
      durationSeconds: number
      sheetUrl: string | null
      sheetColumns: number
      sheetRows: number
      coverage: ShotCutCoverage
    }

type Props = { onFeedback: (message: string) => void;  node: GenerationCanvasNode; onClose: () => void }

export default function NodeShotCutPanel({ onFeedback, node, onClose }: Props): JSX.Element {
  const feedbackOwnerRef = React.useRef<string | null>(node.id)
  feedbackOwnerRef.current = node.id
  React.useEffect(() => { feedbackOwnerRef.current = node.id; return () => { feedbackOwnerRef.current = null } }, [node.id])
  const [feedback, setFeedback] = React.useState<string | null>(null)
  const reportFeedback = React.useCallback((message: string) => {
    if (feedbackOwnerRef.current !== node.id) { onFeedback(message); return }
    notify({ identity: `NodeShotCutPanel:${node.id}`, reason: 'interaction', message, level: 'inline', present: setFeedback })
  }, [node.id, onFeedback])

  const { t } = useTranslation()
  const [state, setState] = React.useState<DetectState>({ phase: 'detecting' })
  const [threshold, setThreshold] = React.useState(SHOT_SENSITIVITY_DEFAULT)
  const [excluded, setExcluded] = React.useState<ReadonlySet<number>>(() => new Set())
  const [committing, setCommitting] = React.useState<{ done: number; total: number } | null>(null)
  /** 打开时替用户放宽到了哪一档（没放宽则 null）。用户一动滑杆这条说明就过时了，故按值比对而不是布尔。 */
  const [autoRelaxedTo, setAutoRelaxedTo] = React.useState<number | null>(null)

  const videoUrl = node.result?.url
  React.useEffect(() => {
    let alive = true
    const detect = getDesktopBridge()?.video?.detectShotCuts
    // 打开切镜面板即动作起点：签发原项目；联系表落进它，结果只在它仍打开时进面板。
    const project = withProjectAction((issued) => issued)
    if (!detect || !project || !videoUrl) {
      setState({ phase: 'failed', message: t('generationCommon.node.shotCuts.desktopOnly') })
      return () => { alive = false }
    }
    detect({ videoUrl, projectId: project.binding.projectId })
      .then((result) => {
        if (!alive || !isProjectExecutionContextCurrent(project)) return
        const cuts = result.cuts ?? []
        // 灵敏度从这条视频自己的分数分布 derive——写死 0.3 会让弱切点的片子「打开即空」。
        const picked = pickDefaultSensitivity(cuts)
        setThreshold(picked)
        setAutoRelaxedTo(picked < SHOT_SENSITIVITY_DEFAULT ? picked : null)
        setState({
          phase: 'ready',
          cuts,
          durationSeconds: Number(result.durationSeconds) || 0,
          sheetUrl: result.sheetUrl ?? null,
          sheetColumns: result.sheetColumns || 8,
          sheetRows: result.sheetRows,
          coverage: result.coverage,
        })
      })
      .catch((error: unknown) => {
        if (!alive || !isProjectExecutionContextCurrent(project)) return
        setState({ phase: 'failed', message: error instanceof Error ? error.message : String(error) })
      })
    return () => { alive = false }
  }, [t, videoUrl])

  React.useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    canvasDocumentInput.addEventListener('keydown', onKey)
    return () => canvasDocumentInput.removeEventListener('keydown', onKey)
  }, [onClose])

  const allCuts = React.useMemo(() => (state.phase === 'ready' ? state.cuts : []), [state])
  const visible = React.useMemo(() => filterShotCuts(allCuts, threshold), [allCuts, threshold])
  const selected = React.useMemo(() => visible.filter((cut) => !excluded.has(cut.index)), [visible, excluded])

  const durationSeconds = state.phase === 'ready' ? state.durationSeconds : 0
  /** 全集 = 0：这段结构上就是一镜到底（AI 生成的片段基本都是）。不是失败，是换一条路——均匀抽帧。 */
  const isOneShot = state.phase === 'ready' && allCuts.length === 0
  const evenCount = evenFrameCount(durationSeconds)
  /** 全集非 0 但当前灵敏度筛没了（用户自己把滑杆拉高了）：给一键回到能看到的那档，别让他对着空白猜。 */
  const relaxTo = React.useMemo(() => pickDefaultSensitivity(allCuts), [allCuts])
  const relaxCount = React.useMemo(() => filterShotCuts(allCuts, relaxTo).length, [allCuts, relaxTo])
  const filteredOut = state.phase === 'ready' && allCuts.length > 0 && visible.length === 0

  const toggle = (index: number) => {
    setExcluded((prev) => {
      const next = new Set(prev)
      if (next.has(index)) next.delete(index)
      else next.add(index)
      return next
    })
  }

  /** 落画布只有这一条管线：切点选出来的秒数、均匀抽出来的秒数，走的都是它。 */
  const commitSeconds = async (seconds: readonly number[]) => {
    if (!seconds.length || committing) return
    await withProjectAction(async (project) => {
      setCommitting({ done: 0, total: seconds.length })
      const outcome = await extractShotCutsToNodes({ project, reportFeedback, node, seconds, onProgress: (progress) => setCommitting(progress) })
      if (outcome.cancelled) return
      setCommitting(null)
      if (outcome.failed === 0 && outcome.created > 0) onClose()
    }, async () => {
      reportFeedback(t('generationCommon.node.extractFrame.missingProject'))
    })
  }

  const subtitle =
    state.phase === 'detecting'
      ? t('generationCommon.node.shotCuts.detecting')
      : state.phase === 'failed'
        ? t('generationCommon.node.shotCuts.failed')
        : isOneShot
          ? t('generationCommon.node.shotCuts.oneShot')
          : autoRelaxedTo !== null && threshold === autoRelaxedTo
            ? t('generationCommon.node.shotCuts.foundAutoRelaxed', { count: visible.length })
            : t('generationCommon.node.shotCuts.found', { count: visible.length })

  const canvasViewport =
    typeof document === 'undefined' ? null : document.querySelector<HTMLElement>('.workbench-generation__canvas')
  if (!canvasViewport) return <>
{feedback ? <p role="status" className="m-0 px-2 py-1 text-caption text-nomi-ink-60">{feedback}</p> : null}</>

  return createPortal(
    <div
      className="absolute inset-0 z-application-modal flex h-full w-full items-center justify-center overflow-hidden p-6 bg-black/40"
      role="dialog"
      aria-modal="true"
      aria-label={t('generationCommon.node.shotCuts.title')}
      onPointerDown={(event) => {
        event.stopPropagation()
        if (event.target === event.currentTarget && !committing) onClose()
      }}
    >
{feedback ? <p role="status" className="m-0 px-2 py-1 text-caption text-nomi-ink-60">{feedback}</p> : null}
      <div
        className={cn(
          'flex max-h-full w-[min(760px,100%)] flex-col gap-3 rounded-nomi border border-nomi-line',
          'bg-nomi-paper p-4 shadow-nomi-lg',
        )}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-body font-medium text-nomi-ink">{t('generationCommon.node.shotCuts.title')}</div>
            <div className="mt-0.5 text-body-sm text-nomi-ink-60">{subtitle}</div>
          </div>
          <button
            type="button"
            className={cn(
              'grid size-8 shrink-0 place-items-center rounded-nomi-sm border-0 cursor-pointer',
              'bg-transparent text-nomi-ink-60 hover:bg-nomi-ink-05 hover:text-nomi-ink',
            )}
            aria-label={t('generationCommon.node.shotCuts.close')}
            onClick={onClose}
          >
            <IconX size={16} stroke={1.8} />
          </button>
        </div>

        {state.phase === 'failed' ? (
          <div className="rounded-nomi-sm bg-nomi-ink-05 px-3 py-2 text-body-sm text-nomi-ink-80">{state.message}</div>
        ) : null}

        {isOneShot ? (
          <div className="rounded-nomi-sm bg-nomi-ink-05 px-3 py-2 text-body-sm leading-relaxed text-nomi-ink-80">
            {durationSeconds > 0
              ? t('generationCommon.node.shotCuts.oneShotBody', { duration: durationSeconds.toFixed(1) })
              : t('generationCommon.node.shotCuts.noCuts')}
          </div>
        ) : null}

        {filteredOut ? (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-nomi-sm bg-nomi-ink-05 px-3 py-2 text-body-sm text-nomi-ink-80">
            <span>{t('generationCommon.node.shotCuts.filteredOut')}</span>
            <button
              type="button"
              data-shot-cut-relax="true"
              className={cn(
                'h-7 rounded-nomi-sm border-0 bg-transparent px-2 text-body-sm cursor-pointer',
                'text-nomi-accent underline underline-offset-2 hover:bg-nomi-accent-soft disabled:opacity-40',
              )}
              disabled={Boolean(committing)}
              onClick={() => setThreshold(relaxTo)}
            >
              {t('generationCommon.node.shotCuts.relaxAction', { count: relaxCount })}
            </button>
          </div>
        ) : null}

        {state.phase === 'ready' && state.coverage.capped ? (
          <div className="flex items-center gap-2 rounded-nomi-sm bg-nomi-ink-05 px-3 py-2 text-body-sm text-nomi-ink-80">
            <IconAlertTriangle size={15} stroke={1.8} aria-hidden />
            {t('generationCommon.node.shotCuts.capped', {
              detected: state.coverage.detectedCuts,
              kept: state.coverage.keptCuts,
              threshold: state.coverage.appliedThreshold.toFixed(2),
            })}
          </div>
        ) : null}

        {state.phase === 'ready' && allCuts.length > 0 ? (
          <>
            <div className="flex items-center gap-3">
              <label htmlFor="shot-cut-sensitivity" className="shrink-0 text-body-sm text-nomi-ink-60">
                {t('generationCommon.node.shotCuts.sensitivity')}
              </label>
              <input
                id="shot-cut-sensitivity"
                type="range"
                className="flex-1 accent-nomi-accent"
                min={SHOT_SENSITIVITY_MIN}
                max={SHOT_SENSITIVITY_MAX}
                step={SHOT_SENSITIVITY_STEP}
                value={threshold}
                disabled={Boolean(committing)}
                onChange={(event) => setThreshold(Number(event.target.value))}
              />
              <span className="w-[112px] shrink-0 text-right text-body-sm text-nomi-ink-60">
                {threshold <= 0.2
                  ? t('generationCommon.node.shotCuts.hintMany')
                  : threshold >= 0.5
                    ? t('generationCommon.node.shotCuts.hintFew')
                    : t('generationCommon.node.shotCuts.hintJust')}
              </span>
            </div>

            <div
              className="grid min-h-0 flex-1 gap-2 overflow-y-auto"
              style={{ gridTemplateColumns: 'repeat(auto-fill,minmax(112px,1fr))' }}
            >
              {visible.map((cut) => {
                const isOn = !excluded.has(cut.index)
                const tile = shotSheetTileStyle(cut.index, state.sheetColumns, state.sheetRows)
                return (
                  <button
                    key={cut.index}
                    type="button"
                    data-shot-cut={cut.index}
                    data-selected={isOn ? 'true' : 'false'}
                    className={cn(
                      'overflow-hidden rounded-nomi-sm border p-0 text-left cursor-pointer',
                      'transition-colors duration-nomi-fast ease-nomi-fast',
                      isOn ? 'border-transparent bg-nomi-accent-soft' : 'border-nomi-line bg-nomi-paper opacity-60',
                    )}
                    aria-pressed={isOn}
                    disabled={Boolean(committing)}
                    onClick={() => toggle(cut.index)}
                  >
                    <span
                      className="block h-[64px] w-full bg-nomi-ink-05 bg-no-repeat"
                      style={
                        state.sheetUrl
                          ? { backgroundImage: `url("${state.sheetUrl}")`, ...tile }
                          : undefined
                      }
                      aria-hidden
                    />
                    <span className="flex items-center justify-between gap-1 px-2 py-1 text-micro text-nomi-ink-60">
                      <span>{formatShotTimestamp(cut.seconds)}</span>
                      <span>{isOn ? '✓' : ''}</span>
                    </span>
                  </button>
                )
              })}
            </div>
          </>
        ) : null}

        <div className="flex items-center justify-between gap-2 border-t border-nomi-line-soft pt-3">
          {/* 一镜到底时没有任何东西可选：不摆一个永远点不了的「全选」（设计系统 C4 禁用不做沟通死路）。 */}
          {isOneShot ? (
            <span />
          ) : (
            <button
              type="button"
              className={cn(
                'h-8 rounded-nomi-sm border-0 bg-transparent px-2 text-body-sm cursor-pointer',
                'text-nomi-ink-60 hover:bg-nomi-ink-05 hover:text-nomi-ink disabled:opacity-40',
              )}
              disabled={state.phase !== 'ready' || !visible.length || Boolean(committing)}
              onClick={() => setExcluded(selected.length === visible.length ? new Set(visible.map((c) => c.index)) : new Set())}
            >
              {selected.length === visible.length && visible.length > 0
                ? t('generationCommon.node.shotCuts.selectNone')
                : t('generationCommon.node.shotCuts.selectAll')}
            </button>
          )}
          <div className="flex items-center gap-2">
            {committing ? (
              <span className="text-body-sm text-nomi-ink-60">
                {t('generationCommon.node.shotCuts.committing', { done: committing.done, total: committing.total })}
              </span>
            ) : null}
            {/* 一镜到底：主操作换成「均匀抽帧」——用户点「按镜头拆」要的是从这段里取画面，没切点不代表没得取。 */}
            <button
              type="button"
              data-shot-cut-commit="true"
              data-shot-cut-mode={isOneShot ? 'even' : 'cuts'}
              className={cn(
                'inline-flex h-9 items-center rounded-full border-0 px-4 cursor-pointer',
                'bg-nomi-ink text-body font-medium text-nomi-paper hover:bg-nomi-accent',
                'transition-colors duration-nomi-fast ease-nomi-fast disabled:opacity-40 disabled:cursor-not-allowed',
              )}
              disabled={(isOneShot ? durationSeconds <= 0 : !selected.length) || Boolean(committing)}
              onClick={() => {
                void commitSeconds(
                  isOneShot
                    ? evenFrameSeconds(durationSeconds, evenCount)
                    : selected.map((cut) => cut.seconds),
                )
              }}
            >
              {isOneShot
                ? t('generationCommon.node.shotCuts.evenFrames', { count: evenCount })
                : t('generationCommon.node.shotCuts.commit', { count: selected.length })}
            </button>
          </div>
        </div>
      </div>
    </div>,
    canvasViewport,
  )
}
