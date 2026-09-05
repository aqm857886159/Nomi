import React from 'react'
import { useTranslation } from 'react-i18next'
import { useWorkbenchStore } from '../workbenchStore'
import { cn } from '../../utils/cn'

export type TimelineContextTarget =
  | { kind: 'clip'; clipId: string; trackId: string }
  | { kind: 'text'; textClipId: string }
  | { kind: 'transition'; fromClipId: string; toClipId: string }
  | { kind: 'track'; trackId: string }

export function TimelineContextMenu({
  target,
  x,
  y,
  onClose,
  onRegenerate,
  onChangeTransition,
}: {
  target: TimelineContextTarget
  x: number
  y: number
  onClose: () => void
  onRegenerate?: (clipId: string) => void
  onChangeTransition?: (fromClipId: string, toClipId: string) => void
}): JSX.Element {
  const { t } = useTranslation()
  const timeline = useWorkbenchStore((state) => state.timeline)
  const selectTimelineTextClip = useWorkbenchStore((state) => state.selectTimelineTextClip)
  const splitTimelineClip = useWorkbenchStore((state) => state.splitTimelineClip)
  const duplicateTimelineClip = useWorkbenchStore((state) => state.duplicateTimelineClip)
  const removeTimelineClips = useWorkbenchStore((state) => state.removeTimelineClips)
  const removeTimelineTextClip = useWorkbenchStore((state) => state.removeTimelineTextClip)
  const removeTimelineTransition = useWorkbenchStore((state) => state.removeTimelineTransition)
  const addTimelineTextClip = useWorkbenchStore((state) => state.addTimelineTextClip)
  const menuItems: Array<{ label: string; shortcut?: string; danger?: boolean; onClick: () => void }> = []
  const closeAfter = (callback: () => void) => () => { callback(); onClose() }
  if (target.kind === 'clip') {
    const clip = timeline.tracks.flatMap((track) => track.clips).find((item) => item.id === target.clipId)
    const track = timeline.tracks.find((item) => item.id === target.trackId)
    menuItems.push(
      { label: t('timelineEditor.context.split'), shortcut: 'S', onClick: closeAfter(() => clip && splitTimelineClip(clip.id, timeline.playheadFrame)) },
      { label: t('timelineEditor.context.duplicate'), shortcut: '⌘D', onClick: closeAfter(() => duplicateTimelineClip(target.clipId)) },
      { label: t('timelineEditor.regenerate'), onClick: closeAfter(() => onRegenerate?.(target.clipId)) },
      { label: clip?.audio?.muted ? t('timelineEditor.context.unmute') : t('timelineEditor.context.mute'), onClick: closeAfter(() => {
        if (!clip || !track) return
        useWorkbenchStore.getState().setTimelineTrackMuted(track.id, !(clip.audio?.muted === true))
      }) },
      { label: t('timelineEditor.context.delete'), shortcut: '⌫', danger: true, onClick: closeAfter(() => removeTimelineClips([target.clipId])) },
      { label: t('timelineEditor.context.rippleDelete'), shortcut: '⇧⌫', danger: true, onClick: closeAfter(() => removeTimelineClips([target.clipId], true)) },
      { label: t('timelineEditor.context.deleteLeft'), shortcut: 'Q', danger: true, onClick: closeAfter(() => removeTimelineClips((track?.clips ?? []).filter((item) => item.endFrame <= timeline.playheadFrame).map((item) => item.id), true)) },
      { label: t('timelineEditor.context.deleteRight'), shortcut: 'W', danger: true, onClick: closeAfter(() => removeTimelineClips((track?.clips ?? []).filter((item) => item.startFrame >= timeline.playheadFrame).map((item) => item.id), true)) },
    )
  } else if (target.kind === 'text') {
    menuItems.push(
      { label: t('timelineEditor.context.editText'), shortcut: '↩', onClick: closeAfter(() => selectTimelineTextClip(target.textClipId)) },
      { label: t('timelineEditor.context.duplicate'), onClick: closeAfter(() => {
        const clip = timeline.textClips.find((item) => item.id === target.textClipId)
        if (clip) addTimelineTextClip(clip.style, clip.startFrame + Math.max(1, clip.endFrame - clip.startFrame))
      }) },
      { label: t('timelineEditor.context.alignToShot'), onClick: onClose },
      { label: t('timelineEditor.context.delete'), shortcut: '⌫', danger: true, onClick: closeAfter(() => removeTimelineTextClip(target.textClipId)) },
    )
  } else if (target.kind === 'transition') {
    menuItems.push(
      { label: t('timelineEditor.context.changeTransition'), onClick: closeAfter(() => onChangeTransition?.(target.fromClipId, target.toClipId)) },
      { label: t('timelineEditor.context.applyTransitionAll'), onClick: onClose },
      { label: t('timelineEditor.context.removeTransition'), danger: true, onClick: closeAfter(() => removeTimelineTransition(target.fromClipId, target.toClipId)) },
    )
  } else {
    menuItems.push(
      { label: t('timelineEditor.aiArrange'), onClick: onClose },
      { label: t('timelineEditor.context.addFromAssets'), onClick: onClose },
    )
  }
  return (
    <div
      className="fixed z-50 min-w-52 rounded-[var(--nomi-radius-lg)] border border-[var(--workbench-border)] bg-[var(--nomi-paper)] p-1 shadow-[var(--nomi-shadow-lg)]"
      style={{ left: Math.min(x, window.innerWidth - 220), top: Math.min(y, window.innerHeight - menuItems.length * 34 - 12) }}
      role="menu"
      onContextMenu={(event) => event.preventDefault()}
    >
      {menuItems.map((item) => (
        <button key={`${item.label}:${item.shortcut ?? ''}`} type="button" role="menuitem" className={cn('flex w-full items-center justify-between gap-5 rounded-[var(--nomi-radius-sm)] px-2 py-1.5 text-left text-micro hover:bg-[var(--workbench-hover)]', item.danger && 'text-[var(--workbench-danger)]')} onClick={item.onClick}>
          <span>{item.label}</span><kbd className="font-mono text-[var(--workbench-muted)]">{item.shortcut}</kbd>
        </button>
      ))}
    </div>
  )
}
