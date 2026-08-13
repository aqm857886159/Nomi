import React from 'react'
import { useTranslation } from 'react-i18next'
import { IconDownload, IconPlus, IconScissors, IconTrash, IconVideo } from '@tabler/icons-react'
import { WorkbenchButton } from '../../../design'
import { cn } from '../../../utils/cn'
import { useGenerationCanvasStore } from '../store/generationCanvasStore'
import type { GenerationCanvasNode } from '../model/generationCanvasTypes'
import { useAllProjectAssets } from '../../assets/useAllProjectAssets'
import AssetPicker from '../../assets/AssetPicker'
import AssetPickerPopover from '../../assets/AssetPickerPopover'
import { getActiveWorkbenchProjectId } from '../../project/workbenchProjectSession'
import { importWorkbenchLocalAssetFile } from '../../api/assetUploadApi'
import { appendClipNodeSource, clipNodeSourceFromAsset, clipNodeTimeline, readClipNodeMeta, removeClipNodeSource, updateClipNodeSource } from './clipNodeModel'
import type { AssetRef } from '../../assets/assetTypes'
import { MagneticConnectionHandle } from './NodeConnectionHandles'
import { completeNodeConnection } from './completeNodeConnection'
import type { ConnectionAnchorSide } from '../store/canvasStoreTypes'
import { getNodeSizeBounds, resolveNodeVisualSize } from './nodeSizing'
import { useNodeDragResize } from './useNodeDragResize'
import { exportTimelineToMp4 } from '../../export/exportApi'
import { toast } from '../../../ui/toast'

type Props = { node: unknown; selected: boolean; readOnly?: boolean }

function ClipStrip({ source, active, onSelect, onRemove }: { source: ReturnType<typeof clipNodeSourceFromAsset>; active: boolean; onSelect: () => void; onRemove: () => void }): JSX.Element | null {
  const { t } = useTranslation()
  if (!source) return null
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        'group relative flex h-16 min-w-28 flex-1 overflow-hidden rounded-nomi-sm border text-left',
        active ? 'border-nomi-accent ring-1 ring-inset ring-nomi-accent' : 'border-nomi-line',
        'bg-nomi-ink-05',
      )}
      aria-label={source.label}
    >
      {source.thumbnailUrl || source.url ? (
        source.type === 'video' ? <video src={source.url} muted playsInline preload="metadata" className="absolute inset-0 size-full object-cover" /> : <img src={source.thumbnailUrl || source.url} alt="" className="absolute inset-0 size-full object-cover" />
      ) : <IconVideo size={18} className="m-auto text-nomi-ink-40" />}
      <span className="absolute inset-x-0 bottom-0 truncate bg-nomi-ink/70 px-1.5 py-1 text-micro text-nomi-paper">{source.label}</span>
      <span
        role="button"
        tabIndex={0}
        aria-label={t('generationCommon.clipNode.remove')}
        onClick={(event) => { event.stopPropagation(); onRemove() }}
        onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.stopPropagation(); onRemove() } }}
        className="absolute right-1 top-1 hidden rounded-full bg-nomi-overlay-chip-strong p-1 text-nomi-paper group-hover:block"
      ><IconTrash size={12} /></span>
    </button>
  )
}

export default function ClipNode({ node: rawNode, selected, readOnly = false }: Props): JSX.Element {
  const { t } = useTranslation()
  const node = rawNode as GenerationCanvasNode
  const updateNode = useGenerationCanvasStore((state) => state.updateNode)
  const selectNode = useGenerationCanvasStore((state) => state.selectNode)
  const captureHistory = useGenerationCanvasStore((state) => state.captureHistory)
  const commitPersistedChange = useGenerationCanvasStore((state) => state.commitPersistedChange)
  const moveNode = useGenerationCanvasStore((state) => state.moveNode)
  const moveSelectedNodes = useGenerationCanvasStore((state) => state.moveSelectedNodes)
  const isMultiSelectActive = useGenerationCanvasStore((state) => selected && state.selectedNodeIds.length > 1)
  const startConnection = useGenerationCanvasStore((state) => state.startConnection)
  const pendingSourceId = useGenerationCanvasStore((state) => state.pendingConnectionSourceId)
  const pendingSourceSide = useGenerationCanvasStore((state) => state.pendingConnectionSourceSide)
  const upstreamMedia = useGenerationCanvasStore((state) => state.edges
    .filter((edge) => edge.target === node.id)
    .map((edge) => state.nodes.find((candidate) => candidate.id === edge.source))
    .filter((candidate): candidate is GenerationCanvasNode => Boolean(candidate?.result?.url && (candidate.result.type === 'image' || candidate.result.type === 'video'))))
  const { refresh } = useAllProjectAssets()
  const [pickerOpen, setPickerOpen] = React.useState(false)
  const [exporting, setExporting] = React.useState<'current' | 'all' | null>(null)
  const visualSize = resolveNodeVisualSize(node)
  const sizeBounds = getNodeSizeBounds(node.kind)
  const { handlePointerDown, handlePointerMove, handlePointerUp } = useNodeDragResize({
    node,
    selected,
    readOnly,
    isMultiSelectActive,
    sizeBounds,
    visualSize,
    selectNode,
    captureHistory,
    moveNode,
    moveSelectedNodes,
    updateNode,
    commitPersistedChange,
  })
  const meta = readClipNodeMeta(node.meta)
  const active = meta.clips.find((clip) => clip.id === meta.selectedClipId) ?? meta.clips[0]
  const exportTimeline = clipNodeTimeline(meta)
  const exportClips = exportTimeline.tracks[0]?.clips ?? []
  const timelineDuration = Math.max(1, exportClips.at(-1)?.endFrame ?? 1)

  const persist = React.useCallback((next: ReturnType<typeof readClipNodeMeta>) => {
    updateNode(node.id, { meta: { ...(node.meta ?? {}), clip: next } })
  }, [node.id, node.meta, updateNode])

  React.useEffect(() => {
    if (!upstreamMedia.length) return
    const known = new Set(meta.clips.map((clip) => clip.id))
    const additions = upstreamMedia.filter((source) => !known.has(source.id)).map((source) => ({
      id: source.id,
      type: source.result!.type as 'image' | 'video',
      label: source.title || source.result!.type,
      url: source.result!.url!,
      ...(source.result!.thumbnailUrl ? { thumbnailUrl: source.result!.thumbnailUrl } : {}),
      durationSeconds: source.result!.durationSeconds ?? 6,
      trimStart: 0,
      trimEnd: source.result!.durationSeconds ?? 6,
    }))
    if (!additions.length) return
    persist({ ...meta, sourceNodeIds: [...meta.sourceNodeIds, ...additions.map((source) => source.id)], clips: [...meta.clips, ...additions], selectedClipId: additions[additions.length - 1].id })
  }, [meta, persist, upstreamMedia])

  const handleConnectionStart = (event: React.PointerEvent<HTMLElement>, side: ConnectionAnchorSide): void => {
    event.stopPropagation()
    startConnection(node.id, side)
  }

  const addAsset = React.useCallback((asset: AssetRef) => {
    const source = clipNodeSourceFromAsset(asset)
    if (!source) return
    persist(appendClipNodeSource(meta, source))
    setPickerOpen(false)
  }, [meta, persist])

  const upload = React.useCallback(async (file: File) => {
    const projectId = getActiveWorkbenchProjectId()
    if (!projectId) return
    const uploaded = await importWorkbenchLocalAssetFile(file, file.name, { projectId })
    const asset: AssetRef = {
      id: uploaded.id,
      name: uploaded.name,
      kind: file.type.startsWith('video/') ? 'video' : 'image',
      renderUrl: String(uploaded.data.url || ''),
      source: 'project',
      origin: { source: 'project', projectId, relativePath: String(uploaded.data.relativePath || uploaded.name) },
    }
    addAsset(asset)
    refresh()
  }, [addAsset, refresh])

  const updateTrim = (field: 'trimStart' | 'trimEnd', rawValue: string): void => {
    if (!active) return
    const nextValue = Math.max(0, Number(rawValue) || 0)
    const safeValue = field === 'trimStart'
      ? Math.min(nextValue, Math.max(0, active.trimEnd - 0.1))
      : Math.min(Math.max(active.durationSeconds, 0.1), Math.max(nextValue, active.trimStart + 0.1))
    persist(updateClipNodeSource(meta, active.id, { [field]: safeValue }))
  }

  const handleExport = async (scope: 'current' | 'all'): Promise<void> => {
    const projectId = getActiveWorkbenchProjectId()
    const sources = scope === 'current' && active ? [active] : meta.clips
    if (!projectId || sources.length === 0 || exporting) return
    setExporting(scope)
    try {
      const result = await exportTimelineToMp4({
        timeline: clipNodeTimeline({ ...meta, clips: sources }),
        aspectRatio: '16:9',
        projectId,
        resolution: '1080p',
        quality: 'standard',
        outputName: scope === 'current' ? 'nomi-clip' : 'nomi-cut',
      })
      toast(t('generationCommon.clipNode.exportComplete', { path: result.relativePath }), 'success')
    } catch (error) {
      toast(error instanceof Error ? error.message : t('generationCommon.clipNode.exportFailed'), 'error')
    } finally {
      setExporting(null)
    }
  }

  return (
    <article
      className={cn('generation-canvas-v2-node absolute block cursor-grab select-none touch-none overflow-visible', selected ? 'data-[selected=true]:z-[5]' : '')}
      style={{ transform: `translate(${node.position.x}px, ${node.position.y}px)`, width: visualSize.width, height: visualSize.height }}
      data-node-id={node.id}
      data-kind={node.kind}
      data-selected={selected ? 'true' : 'false'}
      data-clip-node="true"
      onWheel={(event) => event.stopPropagation()}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
    >
      {!readOnly ? <>
        <MagneticConnectionHandle side="left" active={pendingSourceId === node.id || pendingSourceSide === 'left'} pendingTarget={Boolean(pendingSourceId && pendingSourceId !== node.id)} onStart={handleConnectionStart} onComplete={(event) => { event.stopPropagation(); completeNodeConnection(node.id) }} />
        <MagneticConnectionHandle side="right" active={pendingSourceId === node.id || pendingSourceSide === 'right'} pendingTarget={Boolean(pendingSourceId && pendingSourceId !== node.id)} onStart={handleConnectionStart} onComplete={(event) => { event.stopPropagation(); completeNodeConnection(node.id) }} />
      </> : null}
      <div className={cn('generation-canvas-v2-node__preview flex h-full w-full flex-col overflow-hidden rounded-nomi border bg-nomi-paper shadow-nomi-md', selected ? 'ring-2 ring-nomi-accent' : 'ring-1 ring-inset ring-nomi-line')}>
      <header className="flex shrink-0 items-center gap-2 border-b border-nomi-line px-3 py-2">
        <IconScissors size={15} className="text-nomi-accent" />
        <span className="flex-1 truncate text-body-sm font-semibold text-nomi-ink">{t('generationCommon.clipNode.timeline')}</span>
        <span className="text-micro text-nomi-ink-50">{t('generationCommon.clipNode.selected', { count: meta.clips.length })}</span>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {meta.clips.length ? (
          <>
            <div className="mb-3 flex gap-1.5 overflow-x-auto pb-1">
              {meta.clips.map((clip) => (
                <ClipStrip
                  key={clip.id}
                  source={clip}
                  active={clip.id === active?.id}
                  onSelect={() => persist({ ...meta, selectedClipId: clip.id })}
                  onRemove={() => persist(removeClipNodeSource(meta, clip.id))}
                />
              ))}
              {!readOnly ? <button type="button" className="grid h-16 min-w-16 place-items-center rounded-nomi-sm border border-dashed border-nomi-line text-nomi-ink-50 hover:border-nomi-accent hover:text-nomi-accent" onClick={() => setPickerOpen(true)} aria-label={t('generationCommon.clipNode.add')}><IconPlus size={18} /></button> : null}
            </div>
            <div className="rounded-nomi-sm border border-nomi-line bg-nomi-ink-05 p-2">
              <div className="mb-1 flex items-center gap-1.5 text-micro text-nomi-ink-60"><IconScissors size={12} />{t('generationCommon.clipNode.trim')}</div>
              <div className="relative h-10 overflow-hidden rounded-nomi-sm bg-nomi-ink-10">
                {exportClips.map((clip) => <span key={clip.id} className={cn('absolute inset-y-1 rounded-nomi-sm bg-nomi-accent/70', clip.sourceNodeId === active?.id ? 'ring-1 ring-inset ring-nomi-paper' : '')} style={{ left: `${(clip.startFrame / timelineDuration) * 100}%`, width: `${Math.max(2, (clip.endFrame - clip.startFrame) / timelineDuration * 100)}%` }} />)}
              </div>
              {active ? (
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <label className="grid gap-1 text-micro text-nomi-ink-50">{t('generationCommon.clipNode.trimStart')}
                    <input type="range" min="0" max={Math.max(0.1, active.durationSeconds - 0.1)} step="0.1" value={active.trimStart} onChange={(event) => updateTrim('trimStart', event.target.value)} aria-label={t('generationCommon.clipNode.trimStart')} />
                    <span className="font-mono text-nomi-ink-60">{active.trimStart.toFixed(1)}{t('generationCommon.clipNode.seconds')}</span>
                  </label>
                  <label className="grid gap-1 text-micro text-nomi-ink-50">{t('generationCommon.clipNode.trimEnd')}
                    <input type="range" min="0.1" max={Math.max(0.1, active.durationSeconds)} step="0.1" value={active.trimEnd} onChange={(event) => updateTrim('trimEnd', event.target.value)} aria-label={t('generationCommon.clipNode.trimEnd')} />
                    <span className="font-mono text-nomi-ink-60">{active.trimEnd.toFixed(1)}{t('generationCommon.clipNode.seconds')}</span>
                  </label>
                </div>
              ) : null}
            </div>
          </>
        ) : (
          <div className="grid min-h-28 place-items-center rounded-nomi-sm border border-dashed border-nomi-line px-4 text-center text-caption text-nomi-ink-50">
            <div><IconScissors size={22} className="mx-auto mb-2 text-nomi-ink-40" /><p>{t('generationCommon.clipNode.empty')}</p></div>
          </div>
        )}
        {!readOnly ? <WorkbenchButton variant="default" size="sm" className="mt-3 w-full" onClick={() => setPickerOpen(true)}><IconPlus size={14} />{t('generationCommon.clipNode.add')}</WorkbenchButton> : null}
        {!readOnly ? (
          <div className="mt-3 grid grid-cols-2 gap-2">
            <WorkbenchButton variant="default" size="sm" disabled={!active || Boolean(exporting) || !getActiveWorkbenchProjectId()} onClick={() => void handleExport('current')}>
              <IconDownload size={14} />{exporting === 'current' ? t('generationCommon.clipNode.exporting') : t('generationCommon.clipNode.exportCurrent')}
            </WorkbenchButton>
            <WorkbenchButton variant="primary" size="sm" disabled={meta.clips.length === 0 || Boolean(exporting) || !getActiveWorkbenchProjectId()} onClick={() => void handleExport('all')}>
              <IconDownload size={14} />{exporting === 'all' ? t('generationCommon.clipNode.exporting') : t('generationCommon.clipNode.exportAll')}
            </WorkbenchButton>
          </div>
        ) : null}
        <p className="mt-2 text-center text-micro text-nomi-ink-40">{t('generationCommon.clipNode.exportHint')}</p>
      </div>
      {pickerOpen ? <AssetPickerPopover onClose={() => setPickerOpen(false)}><AssetPicker projectId={getActiveWorkbenchProjectId()} accept={['image', 'video']} onPick={addAsset} onUpload={(file) => void upload(file)} /></AssetPickerPopover> : null}
      </div>
    </article>
  )
}
