import React, { type JSX } from 'react'
import { IconCheck, IconDots, IconGripVertical } from '@tabler/icons-react'
import { DesignBadge, WorkbenchIconButton } from '../design'
import {
  copy,
  dataImage,
  kindLabel,
  statusLabel,
  statusTone,
  type Locale,
  type Shot,
} from './storyboardLayoutExploreData'

export function ListRow({
  shot,
  locale,
  selected,
  compact = false,
}: {
  shot: Shot
  locale: Locale
  selected: boolean
  compact?: boolean
}): JSX.Element {
  const t = copy[locale]
  const mediaHeight = compact ? 28 : 52
  return (
    <div
      className={`grid items-center gap-2 border-b border-nomi-line ${compact ? 'px-2 py-0.5' : 'px-3 py-1.5'} ${selected ? 'bg-nomi-accent/8' : 'bg-nomi-paper'}`}
      style={{ gridTemplateColumns: compact ? '18px 30px minmax(0, 1fr) auto' : '20px 52px minmax(0, 1fr) auto' }}
    >
      <WorkbenchIconButton
        icon={<IconGripVertical size={14} stroke={1.6} />}
        label={locale === 'en' ? 'Drag to reorder' : '拖动排序'}
        size="sm"
        className="cursor-grab text-nomi-ink-30"
      />
      <div
        className="relative overflow-hidden rounded-nomi-sm bg-nomi-ink-05"
        style={{ height: mediaHeight, aspectRatio: shot.ratio.replace(':', '/') }}
      >
        <img
          className="absolute inset-0 size-full object-cover"
          src={dataImage(Number(shot.id.replace('shot-', '')), shot.ratio, shot.tone, '')}
          alt=""
        />
      </div>
      <div className="min-w-0">
        <div className="flex items-center gap-1.5">
          <span
            className={compact ? 'text-micro font-semibold text-nomi-ink' : 'text-caption font-semibold text-nomi-ink'}
          >
            {locale === 'en' ? 'Shot' : '镜'} {shot.id.replace('shot-', '').padStart(2, '0')}
          </span>
          <DesignBadge size="xs" tone={statusTone(shot.status)}>
            {statusLabel(shot.status, t)}
          </DesignBadge>
        </div>
        <div className="truncate text-micro text-nomi-ink-60">{locale === 'en' ? shot.promptEn : shot.prompt}</div>
      </div>
      <div className="flex items-center gap-1">
        <span className="hidden text-micro text-nomi-ink-40 sm:inline">{shot.ratio}</span>
        {selected ? (
          <span className="grid size-5 place-items-center rounded-full bg-nomi-accent text-nomi-paper">
            <IconCheck size={12} stroke={2.2} />
          </span>
        ) : (
          <WorkbenchIconButton icon={<IconDots size={15} stroke={1.7} />} label={t.more} size="sm" />
        )}
      </div>
    </div>
  )
}

export function ImprovedRow({ shot, locale, count }: { shot: Shot; locale: Locale; count: number }): JSX.Element {
  const t = copy[locale]
  const prompt = locale === 'en' ? shot.promptEn : shot.prompt
  const mediaHeight = count === 30 ? 38 : 64
  return (
    <div
      className={`group grid items-center gap-3 border-b border-nomi-line px-3 ${shot.selected ? 'bg-nomi-accent/8' : ''}`}
      style={{ minHeight: count === 30 ? 48 : 82, gridTemplateColumns: '20px auto minmax(0, 1fr) auto' }}
    >
      <WorkbenchIconButton
        icon={<IconGripVertical size={15} stroke={1.6} />}
        label={locale === 'en' ? 'Drag to reorder' : '拖动排序'}
        size="sm"
        className="cursor-grab text-nomi-ink-30 opacity-0 transition-opacity group-hover:opacity-100"
      />
      <div
        className="relative shrink-0 overflow-hidden rounded-nomi-sm bg-nomi-ink-05"
        style={{ height: mediaHeight, aspectRatio: shot.ratio.replace(':', '/') }}
      >
        <img
          className="absolute inset-0 size-full object-cover"
          src={dataImage(Number(shot.id.replace('shot-', '')), shot.ratio, shot.tone, '')}
          alt=""
        />
        {shot.status === 'generating' ? <span className="absolute inset-x-0 bottom-0 h-1 bg-nomi-accent" /> : null}
      </div>
      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-2">
          <span className="shrink-0 text-caption font-semibold text-nomi-ink">
            {locale === 'en' ? 'Shot' : '镜'} {shot.id.replace('shot-', '').padStart(2, '0')}
          </span>
          <DesignBadge size="xs" tone={statusTone(shot.status)}>
            {statusLabel(shot.status, t)}
          </DesignBadge>
          <span className="hidden truncate text-micro text-nomi-ink-60 md:inline">
            {kindLabel(shot.kind, t)} · {shot.model}
          </span>
        </div>
        <p className={`mt-0.5 truncate text-body-sm text-nomi-ink ${count === 30 ? 'max-w-[680px]' : ''}`}>{prompt}</p>
      </div>
      <div className="flex items-center gap-1.5">
        <span className="hidden rounded-nomi-sm bg-nomi-ink-05 px-1.5 py-1 text-micro text-nomi-ink-60 sm:inline">
          {shot.ratio}
        </span>
        {shot.selected ? (
          <span className="grid size-6 place-items-center rounded-full bg-nomi-accent text-nomi-paper">
            <IconCheck size={14} stroke={2.2} />
          </span>
        ) : null}
        <WorkbenchIconButton icon={<IconDots size={16} stroke={1.7} />} label={t.more} size="sm" />
      </div>
    </div>
  )
}
