import React from 'react'
import { useTranslation } from 'react-i18next'
import { IconDeviceFloppy, IconPencil, IconRoute, IconStar, IconStarFilled, IconX } from '@tabler/icons-react'
import { cn } from '../../utils/cn'
import { DesignEmptyState, DesignModal, DesignSearchInput, Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../../design'
import { toast } from '../../ui/toast'
import { getDesktopBridge } from '../../desktop/bridge'
import { useGenerationCanvasStore } from '../generationCanvas/store/generationCanvasStore'
import { rewriteCanvasWorkflowTemplateAssetUrls, type CanvasWorkflowTemplate } from '../generationCanvas/plugins/canvasWorkflowTemplates'
import { getActiveWorkbenchProjectId } from '../project/workbenchProjectSession'
import {
  deleteWorkflowLibraryEntry,
  markWorkflowLibraryEntryUsed,
  readWorkflowLibrary,
  searchWorkflowLibrary,
  updateWorkflowLibraryEntry,
  WORKFLOW_LIBRARY_UPDATED_EVENT,
  type WorkflowLibraryEntry,
} from './workflowLibrary'

type WorkflowLibraryContentProps = {
  projectId: string | null
  compact?: boolean
  showHeader?: boolean
}

type WorkflowFilter = 'all' | 'recent' | 'favorites'

const FILTERS: WorkflowFilter[] = ['all', 'recent', 'favorites']

function insertionPosition(): { x: number; y: number } {
  const nodes = useGenerationCanvasStore.getState().nodes
  if (!nodes.length) return { x: 120, y: 120 }
  const right = Math.max(...nodes.map((node) => node.position.x + (node.size?.width || 280)))
  const top = Math.min(...nodes.map((node) => node.position.y))
  return { x: Math.round(right + 80), y: Math.max(80, Math.round(top)) }
}

async function materializeWorkflowAssets(
  template: CanvasWorkflowTemplate,
  targetProjectId: string,
): Promise<{ template: CanvasWorkflowTemplate; failed: number }> {
  const assets = template.assets || []
  const copyProjectAsset = getDesktopBridge()?.assets?.copyProjectAsset
  if (!assets.length || !copyProjectAsset) return { template, failed: 0 }
  const urlBySource = new Map<string, string>()
  let failed = 0
  for (const asset of assets) {
    try {
      const copied = await copyProjectAsset({
        sourceProjectId: asset.sourceProjectId,
        targetProjectId,
        relativePath: asset.relativePath,
      })
      const targetUrl = typeof copied?.data?.url === 'string' ? copied.data.url.trim() : ''
      if (!targetUrl) throw new Error('copied asset url missing')
      urlBySource.set(asset.sourceUrl, targetUrl)
    } catch {
      failed += 1
    }
  }
  return { template: rewriteCanvasWorkflowTemplateAssetUrls(template, urlBySource), failed }
}

function WorkflowThumbnail({ entry }: { entry: WorkflowLibraryEntry }): JSX.Element {
  const [imageFailed, setImageFailed] = React.useState(false)
  const imageAsset = entry.template.assets?.find((asset) => /\.(?:avif|gif|jpe?g|png|webp)$/i.test(asset.name))
  if (imageAsset && !imageFailed) {
    return <img src={imageAsset.sourceUrl} alt="" loading="lazy" className="h-12 w-16 shrink-0 rounded-nomi-sm border border-nomi-line-soft bg-nomi-ink-05 object-cover" onError={() => setImageFailed(true)} />
  }
  const nodes = entry.template.nodes.slice(0, 4)
  const points = nodes.map((_, index) => ({ x: 12 + (index % 2) * 26, y: 12 + Math.floor(index / 2) * 20 }))
  return (
    <div className="grid h-12 w-16 shrink-0 place-items-center rounded-nomi-sm border border-nomi-line-soft bg-nomi-accent-soft text-nomi-accent" aria-hidden="true">
      <svg viewBox="0 0 64 44" className="h-9 w-14" fill="none">
        {points.slice(1).map((point, index) => <path key={`edge-${index}`} d={`M${points[index]?.x || 0} ${points[index]?.y || 0} L${point.x} ${point.y}`} stroke="currentColor" strokeWidth="1.5" opacity=".55" />)}
        {points.map((point, index) => <rect key={`node-${index}`} x={point.x - 5} y={point.y - 4} width="10" height="8" rx="2" fill="currentColor" opacity={index === 0 ? 0.9 : 0.65} />)}
      </svg>
    </div>
  )
}

function WorkflowCard({
  entry,
  onCopy,
  copying,
  onToggleFavorite,
  onEdit,
  onDelete,
}: {
  entry: WorkflowLibraryEntry
  onCopy: () => void
  copying: boolean
  onToggleFavorite: () => void
  onEdit: () => void
  onDelete: () => void
}): JSX.Element {
  const { t } = useTranslation()
  const groupCount = entry.template.groups?.length || 0
  return (
    <article className="rounded-nomi border border-nomi-line-soft bg-nomi-paper p-3 shadow-nomi-sm">
      <div className="flex items-start gap-2.5">
        <WorkflowThumbnail entry={entry} />
        <div className="min-w-0 flex-1">
          <h3 className="m-0 truncate text-body-sm font-medium text-nomi-ink" title={entry.name}>{entry.name}</h3>
          <p className="m-0 mt-1 truncate text-caption text-nomi-ink-40">
            {t('libraries.workflow.nodes', { count: entry.template.nodes.length })}
            {groupCount > 0 ? ` · ${t('libraries.workflow.groups', { count: groupCount })}` : ''}
          </p>
        </div>
        <TooltipProvider delayDuration={180} skipDelayDuration={80}>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                className="grid size-7 shrink-0 place-items-center rounded-nomi-sm border-0 bg-transparent text-nomi-ink-40 hover:bg-nomi-ink-05 hover:text-nomi-accent"
                aria-label={entry.favorite ? t('libraries.workflow.unfavorite') : t('libraries.workflow.favorite')}
                onClick={onToggleFavorite}
              >
                {entry.favorite ? <IconStarFilled size={15} /> : <IconStar size={15} stroke={1.7} />}
              </button>
            </TooltipTrigger>
            <TooltipContent side="left">{entry.favorite ? t('libraries.workflow.unfavorite') : t('libraries.workflow.favorite')}</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>
      {entry.description ? <p className="m-0 mt-2 line-clamp-2 text-caption leading-relaxed text-nomi-ink-60">{entry.description}</p> : null}
      <div className="mt-2 flex items-center gap-1.5 text-micro text-nomi-ink-40">
        <span className="min-w-0 flex-1 truncate">{t('libraries.workflow.source', { name: entry.sourceProjectName || t('libraries.workflow.unknownSource') })}</span>
        <button
          type="button"
          className="grid size-6 shrink-0 place-items-center rounded-nomi-sm border-0 bg-transparent text-nomi-ink-40 hover:bg-nomi-ink-05 hover:text-nomi-ink"
          aria-label={t('libraries.workflow.edit')}
          onClick={onEdit}
        >
          <IconPencil size={13} stroke={1.8} aria-hidden="true" />
        </button>
        <button
          type="button"
          className="shrink-0 border-0 bg-transparent p-0 text-nomi-ink-40 hover:text-nomi-ink"
          aria-label={t('libraries.workflow.deleteAria', { name: entry.name })}
          onClick={onDelete}
        >
          <IconX size={14} stroke={1.8} aria-hidden="true" />
        </button>
      </div>
      <button
        type="button"
        disabled={copying}
        className="mt-2.5 inline-flex h-8 w-full items-center justify-center rounded-nomi-sm border border-nomi-accent bg-nomi-accent px-3 text-caption font-medium text-nomi-paper transition-colors hover:bg-nomi-accent/90"
        onClick={onCopy}
      >
        {t('libraries.workflow.copyToCanvas')}
      </button>
  </article>
  )
}

function WorkflowEditDialog({
  entry,
  onClose,
}: {
  entry: WorkflowLibraryEntry
  onClose: () => void
}): JSX.Element {
  const { t } = useTranslation()
  const [name, setName] = React.useState(entry.name)
  const [description, setDescription] = React.useState(entry.description)
  const [tags, setTags] = React.useState(entry.tags.join(', '))
  const [error, setError] = React.useState<string | null>(null)

  const save = () => {
    const nextName = name.trim()
    if (!nextName) {
      setError(t('libraries.workflow.invalidName'))
      return
    }
    updateWorkflowLibraryEntry(entry.id, {
      name: nextName,
      description,
      tags: tags.split(',').map((tag) => tag.trim()).filter(Boolean),
    })
    onClose()
  }

  const inputClass = cn(
    'w-full rounded-nomi-sm border border-nomi-line bg-nomi-paper px-3 py-2 text-body-sm text-nomi-ink',
    'placeholder:text-nomi-ink-40 focus:border-nomi-accent focus:outline-none',
  )

  return (
    <DesignModal opened onClose={onClose} title={t('libraries.workflow.editTitle')} centered size="md">
      <div className="grid gap-3">
        <input
          className={inputClass}
          value={name}
          maxLength={80}
          placeholder={t('libraries.workflow.namePlaceholder')}
          aria-label={t('libraries.workflow.namePlaceholder')}
          onChange={(event) => { setName(event.target.value); setError(null) }}
        />
        <textarea
          className={cn(inputClass, 'min-h-20 resize-y leading-relaxed')}
          value={description}
          maxLength={240}
          placeholder={t('libraries.workflow.descriptionPlaceholder')}
          aria-label={t('libraries.workflow.descriptionPlaceholder')}
          onChange={(event) => setDescription(event.target.value)}
        />
        <input
          className={inputClass}
          value={tags}
          maxLength={160}
          placeholder={t('libraries.workflow.tagsPlaceholder')}
          aria-label={t('libraries.workflow.tagsPlaceholder')}
          onChange={(event) => setTags(event.target.value)}
        />
        {error ? <p className="m-0 text-micro text-nomi-danger">{error}</p> : null}
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" className="inline-flex h-8 items-center gap-1 rounded-full border-0 bg-transparent px-3 text-caption text-nomi-ink-60 hover:bg-nomi-ink-05 hover:text-nomi-ink" onClick={onClose}>
            <IconX size={14} stroke={1.8} aria-hidden="true" />
            {t('libraries.workflow.cancel')}
          </button>
          <button type="button" className="inline-flex h-8 items-center gap-1.5 rounded-full border-0 bg-nomi-ink px-3.5 text-caption font-medium text-nomi-paper hover:bg-nomi-accent" onClick={save}>
            <IconDeviceFloppy size={14} stroke={1.8} aria-hidden="true" />
            {t('libraries.workflow.save')}
          </button>
        </div>
      </div>
    </DesignModal>
  )
}

export function WorkflowLibraryContent({ projectId, compact = false, showHeader = true }: WorkflowLibraryContentProps): JSX.Element {
  const { t } = useTranslation()
  const [entries, setEntries] = React.useState<WorkflowLibraryEntry[]>(() => readWorkflowLibrary())
  const [query, setQuery] = React.useState('')
  const [filter, setFilter] = React.useState<WorkflowFilter>('all')
  const [editingEntry, setEditingEntry] = React.useState<WorkflowLibraryEntry | null>(null)
  const [copyingId, setCopyingId] = React.useState<string | null>(null)

  const refresh = React.useCallback(() => setEntries(readWorkflowLibrary()), [])
  React.useEffect(() => {
    window.addEventListener(WORKFLOW_LIBRARY_UPDATED_EVENT, refresh)
    return () => window.removeEventListener(WORKFLOW_LIBRARY_UPDATED_EVENT, refresh)
  }, [refresh])

  const visibleEntries = React.useMemo(
    () => searchWorkflowLibrary(entries, { query, filter }),
    [entries, filter, query],
  )

  const copyToCanvas = React.useCallback(async (entry: WorkflowLibraryEntry) => {
    if (!projectId || projectId !== getActiveWorkbenchProjectId()) {
      toast(t('libraries.workflow.unavailable'), 'warning')
      return
    }
    if (copyingId) return
    setCopyingId(entry.id)
    try {
      const materialized = await materializeWorkflowAssets(entry.template, projectId)
      const created = useGenerationCanvasStore.getState().instantiateWorkflowTemplateSnapshot(materialized.template, insertionPosition())
      if (!created.length) return
      markWorkflowLibraryEntryUsed(entry.id)
      toast(materialized.failed ? t('libraries.workflow.assetCopyFailed') : t('libraries.workflow.copied', { name: entry.name }), materialized.failed ? 'warning' : 'success')
    } finally {
      setCopyingId(null)
    }
  }, [copyingId, projectId, t])

  const toggleFavorite = React.useCallback((entry: WorkflowLibraryEntry) => {
    updateWorkflowLibraryEntry(entry.id, { favorite: !entry.favorite })
  }, [])

  const remove = React.useCallback((entry: WorkflowLibraryEntry) => {
    deleteWorkflowLibraryEntry(entry.id)
  }, [])

  return (
    <div className={cn('flex min-h-0 flex-1 flex-col', compact ? 'text-body-sm' : 'text-body')}>
      {showHeader ? <header className="flex h-12 shrink-0 items-center border-b border-nomi-line-soft px-3"><h2 className="m-0 text-body-sm font-bold">{t('libraries.workflow.title')}</h2></header> : null}
      <div className={cn('grid gap-2', compact ? 'px-3 py-3' : 'px-5 py-4')}>
        <DesignSearchInput value={query} onChange={setQuery} placeholder={t('libraries.workflow.searchPlaceholder')} ariaLabel={t('libraries.workflow.searchAria')} />
        <div className="flex items-center gap-1" role="tablist" aria-label={t('libraries.workflow.title')}>
          {FILTERS.map((value) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={filter === value}
              className={cn(
                'rounded-nomi-sm border-0 px-2 py-1 text-caption transition-colors',
                filter === value ? 'bg-nomi-ink text-nomi-paper' : 'bg-transparent text-nomi-ink-40 hover:bg-nomi-ink-05 hover:text-nomi-ink',
              )}
              onClick={() => setFilter(value)}
            >
              {t(`libraries.workflow.${value}`)}
            </button>
          ))}
        </div>
      </div>
      <div className={cn('min-h-0 flex-1 overflow-y-auto', compact ? 'px-3 pb-3' : 'px-5 pb-5')}>
        {!projectId ? (
          <DesignEmptyState density="inline" icon={<IconRoute size={28} className="text-nomi-ink-30" />} title={t('libraries.workflow.unavailable')} />
        ) : entries.length === 0 ? (
          <DesignEmptyState density="inline" icon={<IconRoute size={28} className="text-nomi-ink-30" />} title={t('libraries.workflow.empty')} description={t('libraries.workflow.emptyHint')} />
        ) : visibleEntries.length === 0 ? (
          <DesignEmptyState density="inline" icon={<IconRoute size={28} className="text-nomi-ink-30" />} title={t('libraries.workflow.noMatch')} />
        ) : (
          <div className="grid gap-2.5">
            {visibleEntries.map((entry) => <WorkflowCard key={entry.id} entry={entry} onCopy={() => { void copyToCanvas(entry) }} copying={copyingId === entry.id} onToggleFavorite={() => toggleFavorite(entry)} onEdit={() => setEditingEntry(entry)} onDelete={() => remove(entry)} />)}
          </div>
        )}
      </div>
      {editingEntry ? <WorkflowEditDialog entry={editingEntry} onClose={() => setEditingEntry(null)} /> : null}
    </div>
  )
}
