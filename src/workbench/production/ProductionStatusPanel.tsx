import { IconAlertTriangle, IconCheck, IconChevronRight, IconLoader2 } from '@tabler/icons-react'
import { useTranslation } from 'react-i18next'

import { WorkbenchButton } from '../../design'
import { buildNomiLocalAssetUrl } from '../../media/nomiLocalAssetUrl'
import { cn } from '../../utils/cn'
import { ProductionDetails } from './ProductionDetails'
import type { ProductionRunPrimaryAction, ProductionRunView } from './productionRunView'
import type { ProductionArtifact } from '../../../electron/productionRun/productionRunTypes'

type Props = {
  projectId: string
  view: ProductionRunView
  artifacts?: ProductionArtifact[]
  focusedArtifactId?: string | null
  onPrimaryAction: (action: Exclude<ProductionRunPrimaryAction, null>) => void
}

const toneClass: Record<ProductionRunView['tone'], string> = {
  working: 'bg-nomi-accent',
  attention: 'bg-nomi-warning',
  danger: 'bg-workbench-danger',
  success: 'bg-workbench-success',
  neutral: 'bg-nomi-ink-30',
}

function StatusIcon({ tone }: { tone: ProductionRunView['tone'] }): JSX.Element {
  if (tone === 'danger' || tone === 'attention') return <IconAlertTriangle size={14} stroke={1.5} aria-hidden />
  if (tone === 'success') return <IconCheck size={14} stroke={1.5} aria-hidden />
  return <IconLoader2 size={14} stroke={1.5} className={cn('animate-spin motion-reduce:animate-none')} aria-hidden />
}

function safePreviewPath(value: string | undefined): value is string {
  return Boolean(value && !value.startsWith('/') && !value.startsWith('\\') && !/^[A-Za-z]:[\\/]/.test(value) && !value.split(/[\\/]+/).includes('..'))
}

export function ProductionStatusPanel({ projectId, view, artifacts = [], focusedArtifactId = null, onPrimaryAction }: Props): JSX.Element {
  const { t } = useTranslation()
  const focusedArtifact = focusedArtifactId
    ? artifacts.find((artifact) => artifact.artifactId === focusedArtifactId
      && ['image', 'video', 'export'].includes(artifact.kind)
      && (safePreviewPath(artifact.thumbnailRelativePath) || safePreviewPath(artifact.projectRelativePath)))
    : undefined
  const preview = focusedArtifact
    ? {
        artifactId: focusedArtifact.artifactId,
        kind: focusedArtifact.kind,
        ...(safePreviewPath(focusedArtifact.thumbnailRelativePath) ? { thumbnailRelativePath: focusedArtifact.thumbnailRelativePath } : {}),
        ...(safePreviewPath(focusedArtifact.projectRelativePath) ? { projectRelativePath: focusedArtifact.projectRelativePath } : {}),
      }
    : view.preview
  const imageRelativePath = preview?.thumbnailRelativePath
    ?? (preview?.kind === 'image' ? preview.projectRelativePath : undefined)
  const videoRelativePath = preview && ['video', 'export'].includes(preview.kind)
    ? preview.projectRelativePath
    : undefined
  const previewUrl = imageRelativePath
    ? buildNomiLocalAssetUrl(projectId, imageRelativePath)
    : null
  const videoUrl = videoRelativePath
    ? buildNomiLocalAssetUrl(projectId, videoRelativePath)
    : null
  const action = view.primaryAction
  const previewFocused = Boolean(focusedArtifactId && preview?.artifactId === focusedArtifactId)

  return (
    <section
      className={cn('grid gap-3 border-b border-nomi-line-soft bg-nomi-paper px-3 py-3')}
      aria-label={t('generationCommon.production.runPanel.aria')}
    >
      <div className={cn('flex items-center justify-between gap-2')}>
        <div className={cn('inline-flex min-w-0 items-center gap-2 text-caption font-medium text-nomi-ink-80')}>
          <span className={cn('size-2 shrink-0 rounded-full', toneClass[view.tone])} aria-hidden />
          <span>{t(`generationCommon.production.runTone.${view.tone}`)}</span>
        </div>
        <span className={cn('truncate text-micro text-nomi-ink-40')}>
          {t('generationCommon.production.runPanel.origin', {
            host: t(`generationCommon.production.origin.${view.originHost}`),
          })}
        </span>
      </div>

      <div className={cn('grid gap-1')}>
        <h2 data-production-status-title className={cn('text-body-sm font-semibold leading-snug text-nomi-ink')}>
          {t(`generationCommon.${view.titleKey}`)}
        </h2>
        <p className={cn('text-caption leading-relaxed text-nomi-ink-60')}>
          {t(`generationCommon.${view.descriptionKey}`)}
        </p>
      </div>

      {typeof view.percent === 'number' ? (
        <div className={cn('grid grid-cols-[1fr_auto] items-center gap-2')}>
          <div className={cn('h-1 overflow-hidden rounded-full bg-nomi-ink-10')}>
            <div className={cn('h-full rounded-full bg-nomi-accent')} style={{ width: `${view.percent}%` }} />
          </div>
          <span className={cn('text-micro tabular-nums text-nomi-ink-60')}>{view.percent}%</span>
        </div>
      ) : null}

      <figure data-production-preview data-production-focused-artifact={previewFocused ? focusedArtifactId : undefined} className={cn('m-0 overflow-hidden rounded-nomi border border-nomi-line-soft bg-nomi-ink-05', previewFocused && 'ring-2 ring-nomi-accent ring-offset-1')}>
        {videoUrl ? (
          <video
            src={videoUrl}
            {...(previewUrl ? { poster: previewUrl } : {})}
            controls
            playsInline
            preload="metadata"
            aria-label={t('generationCommon.production.runPanel.previewAlt')}
            className={cn('aspect-video w-full bg-black object-contain')}
          />
        ) : previewUrl ? (
          <img
            src={previewUrl}
            alt={t('generationCommon.production.runPanel.previewAlt')}
            className={cn('aspect-video w-full object-cover')}
          />
        ) : (
          <div className={cn('grid aspect-video place-items-center px-4 text-center text-caption text-nomi-ink-40')}>
            {t('generationCommon.production.runPanel.noPreview')}
          </div>
        )}
        <figcaption className={cn('flex items-center justify-between gap-2 px-2.5 py-2 text-caption')}>
          <span className={cn('font-medium text-nomi-ink-80')}>{previewFocused ? t('generationCommon.production.runPanel.focusedArtifact') : t('generationCommon.production.runPanel.latestArtifact')}</span>
          <span className={cn('text-nomi-ink-40')}>
            {preview
              ? t(`generationCommon.production.artifactKind.${preview.kind}`)
              : t('generationCommon.production.runPanel.pending')}
          </span>
        </figcaption>
      </figure>

      {action ? (
        <WorkbenchButton
          data-production-primary-action
          variant="primary"
          className={cn('w-full')}
          onClick={() => onPrimaryAction(action)}
        >
          <StatusIcon tone={view.tone} />
          {t(`generationCommon.production.runAction.${action}`)}
        </WorkbenchButton>
      ) : null}

      <details className={cn('group border-t border-nomi-line-soft pt-2')}>
        <summary className={cn('flex cursor-pointer list-none items-center gap-1 text-caption font-medium text-nomi-ink-60')}>
          <IconChevronRight size={14} stroke={1.5} className={cn('transition-transform group-open:rotate-90')} aria-hidden />
          {t('generationCommon.production.runPanel.details')}
        </summary>
        <ProductionDetails details={view.details} />
      </details>
    </section>
  )
}
