import React from 'react'
import { useTranslation } from 'react-i18next'
import { IconAlertTriangle, IconCheck } from '@tabler/icons-react'

import { cn } from '../../../utils/cn'
import { getDesktopBridge } from '../../../desktop/bridge'
import type { GenerationCanvasNode } from '../model/generationCanvasTypes'
import { extractShotCutsToNodes } from './extractShotCutsToNodes'
import {
  SHOT_SENSITIVITY_DEFAULT,
  SHOT_SENSITIVITY_MAX,
  SHOT_SENSITIVITY_MIN,
  SHOT_SENSITIVITY_STEP,
  filterShotCuts,
  formatShotTimestamp,
  shotSheetRows,
  shotSheetTileStyle,
  type ShotCut,
} from './shotCutSelection'

type DetectState =
  | { phase: 'detecting' }
  | { phase: 'failed'; message: string }
  | {
      phase: 'ready'
      cuts: ShotCut[]
      sheetUrl: string | null
      sheetColumns: number
      truncated: boolean
    }

export function VideoShotCutsView({ node, projectId, onDone }: { node: GenerationCanvasNode; projectId: string; onDone: () => void }): JSX.Element {
  const { t } = useTranslation()
  const [state, setState] = React.useState<DetectState>({ phase: 'detecting' })
  const [threshold, setThreshold] = React.useState(SHOT_SENSITIVITY_DEFAULT)
  const [excluded, setExcluded] = React.useState<ReadonlySet<number>>(() => new Set())
  const [committing, setCommitting] = React.useState<{ done: number; total: number } | null>(null)
  const videoUrl = node.result?.url

  React.useEffect(() => {
    let alive = true
    const detect = getDesktopBridge()?.video?.detectShotCuts
    if (!detect || !projectId || !videoUrl) {
      setState({ phase: 'failed', message: t('generationCommon.node.shotCuts.desktopOnly') })
      return () => { alive = false }
    }
    detect({ videoUrl, projectId })
      .then((result) => {
        if (!alive) return
        setState({
          phase: 'ready',
          cuts: result.cuts ?? [],
          sheetUrl: result.sheetUrl ?? null,
          sheetColumns: result.sheetColumns || 8,
          truncated: Boolean(result.truncated),
        })
      })
      .catch((error: unknown) => {
        if (alive) setState({ phase: 'failed', message: error instanceof Error ? error.message : String(error) })
      })
    return () => { alive = false }
  }, [projectId, t, videoUrl])

  const allCuts = React.useMemo(() => (state.phase === 'ready' ? state.cuts : []), [state])
  const visible = React.useMemo(() => filterShotCuts(allCuts, threshold), [allCuts, threshold])
  const selected = React.useMemo(() => visible.filter((cut) => !excluded.has(cut.index)), [visible, excluded])
  const rows = state.phase === 'ready' ? shotSheetRows(allCuts.length, state.sheetColumns) : 1

  const toggle = (index: number): void => {
    setExcluded((current) => {
      const next = new Set(current)
      if (next.has(index)) next.delete(index)
      else next.add(index)
      return next
    })
  }

  const commit = async (): Promise<void> => {
    if (!selected.length || committing) return
    setCommitting({ done: 0, total: selected.length })
    const outcome = await extractShotCutsToNodes({
      node,
      projectId,
      seconds: selected.map((cut) => cut.seconds),
      onProgress: setCommitting,
    })
    setCommitting(null)
    if (outcome.created > 0) onDone()
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b border-nomi-line-soft px-4 py-3">
        <div className="text-body-sm text-nomi-ink">
          {state.phase === 'detecting'
            ? t('generationCommon.node.shotCuts.detecting')
            : state.phase === 'failed'
              ? t('generationCommon.node.shotCuts.failed')
              : t('generationCommon.node.shotCuts.found', { count: visible.length })}
        </div>
        <div className="mt-0.5 text-micro text-nomi-ink-40">{t('generationCommon.node.videoDeconstruction.cutsHint')}</div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {state.phase === 'failed' ? (
          <div className="rounded-nomi-sm bg-nomi-ink-05 px-3 py-2 text-body-sm text-nomi-ink-80">{state.message}</div>
        ) : null}
        {state.phase === 'ready' && allCuts.length === 0 ? (
          <div className="rounded-nomi-sm bg-nomi-ink-05 px-3 py-2 text-body-sm text-nomi-ink-80">
            {t('generationCommon.node.shotCuts.noCuts')}
          </div>
        ) : null}
        {state.phase === 'ready' && state.truncated ? (
          <div className="mb-3 flex items-center gap-2 rounded-nomi-sm bg-nomi-ink-05 px-3 py-2 text-body-sm text-nomi-ink-80">
            <IconAlertTriangle size={15} stroke={1.8} aria-hidden />
            {t('generationCommon.node.shotCuts.truncated', { count: allCuts.length })}
          </div>
        ) : null}
        {state.phase === 'ready' && allCuts.length > 0 ? (
          <>
            <div className="mb-4 flex items-center gap-3">
              <label htmlFor="shot-cut-sensitivity" className="shrink-0 text-body-sm text-nomi-ink-60">
                {t('generationCommon.node.shotCuts.sensitivity')}
              </label>
              <input
                id="shot-cut-sensitivity"
                type="range"
                className="min-w-0 flex-1 accent-nomi-accent"
                min={SHOT_SENSITIVITY_MIN}
                max={SHOT_SENSITIVITY_MAX}
                step={SHOT_SENSITIVITY_STEP}
                value={threshold}
                disabled={Boolean(committing)}
                onChange={(event) => setThreshold(Number(event.target.value))}
              />
              <span className="w-28 shrink-0 text-right text-micro text-nomi-ink-60 max-[719px]:hidden">
                {threshold <= 0.2
                  ? t('generationCommon.node.shotCuts.hintMany')
                  : threshold >= 0.5
                    ? t('generationCommon.node.shotCuts.hintFew')
                    : t('generationCommon.node.shotCuts.hintJust')}
              </span>
            </div>
            <div className="grid gap-2 [grid-template-columns:repeat(auto-fill,minmax(112px,1fr))]">
              {visible.map((cut) => {
                const isOn = !excluded.has(cut.index)
                const tile = shotSheetTileStyle(cut.index, state.sheetColumns, rows)
                return (
                  <button
                    key={cut.index}
                    type="button"
                    data-shot-cut={cut.index}
                    data-selected={isOn ? 'true' : 'false'}
                    className={cn(
                      'overflow-hidden rounded-nomi-sm border p-0 text-left cursor-pointer',
                      'transition-colors duration-[var(--nomi-transition-fast)]',
                      isOn ? 'border-nomi-accent bg-nomi-accent-soft' : 'border-nomi-line bg-nomi-paper opacity-60',
                    )}
                    aria-pressed={isOn}
                    disabled={Boolean(committing)}
                    onClick={() => toggle(cut.index)}
                  >
                    <span
                      className="block h-16 w-full bg-nomi-ink-05 bg-no-repeat"
                      style={state.sheetUrl ? { backgroundImage: `url("${state.sheetUrl}")`, ...tile } : undefined}
                      aria-hidden
                    />
                    <span className="flex items-center justify-between gap-1 px-2 py-1 text-micro text-nomi-ink-60">
                      <span>{formatShotTimestamp(cut.seconds)}</span>
                      {isOn ? <IconCheck size={12} stroke={2} aria-hidden /> : <span className="size-3" />}
                    </span>
                  </button>
                )
              })}
            </div>
          </>
        ) : null}
      </div>

      <div className="flex min-h-16 shrink-0 items-center justify-between gap-2 border-t border-nomi-line px-4 py-3">
        <button
          type="button"
          className="h-8 rounded-nomi-sm border-0 bg-transparent px-2 text-body-sm text-nomi-ink-60 hover:bg-nomi-ink-05 hover:text-nomi-ink disabled:opacity-40"
          disabled={state.phase !== 'ready' || !visible.length || Boolean(committing)}
          onClick={() => setExcluded(selected.length === visible.length ? new Set(visible.map((cut) => cut.index)) : new Set())}
        >
          {selected.length === visible.length && visible.length > 0
            ? t('generationCommon.node.shotCuts.selectNone')
            : t('generationCommon.node.shotCuts.selectAll')}
        </button>
        <div className="flex min-w-0 items-center gap-2">
          {committing ? (
            <span className="truncate text-micro text-nomi-ink-60">
              {t('generationCommon.node.shotCuts.committing', { done: committing.done, total: committing.total })}
            </span>
          ) : null}
          <button
            type="button"
            data-shot-cut-commit="true"
            className="inline-flex h-9 shrink-0 items-center rounded-full border-0 bg-nomi-ink px-4 text-body font-medium text-nomi-paper hover:bg-nomi-accent disabled:cursor-not-allowed disabled:opacity-40"
            disabled={!selected.length || Boolean(committing)}
            onClick={() => { void commit() }}
          >
            {t('generationCommon.node.shotCuts.commit', { count: selected.length })}
          </button>
        </div>
      </div>
    </div>
  )
}
