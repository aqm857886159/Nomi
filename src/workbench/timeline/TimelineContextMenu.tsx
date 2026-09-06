import React from 'react'
import { useTranslation } from 'react-i18next'
import { useWorkbenchStore } from '../workbenchStore'
import { cn } from '../../utils/cn'
import { collectApplicableSeams } from './timelineTransition'
import { toast } from '../../ui/toast'

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
  onArrange,
}: {
  target: TimelineContextTarget
  x: number
  y: number
  onClose: () => void
  onRegenerate?: (clipId: string) => void
  onChangeTransition?: (fromClipId: string, toClipId: string) => void
  /** 空轨上的「AI 拼片」= 工具条那一颗，不是第二条链路。 */
  onArrange?: () => void
}): JSX.Element {
  const { t } = useTranslation()
  const timeline = useWorkbenchStore((state) => state.timeline)
  const selectTimelineTextClip = useWorkbenchStore((state) => state.selectTimelineTextClip)
  const splitTimelineClip = useWorkbenchStore((state) => state.splitTimelineClip)
  const duplicateTimelineClip = useWorkbenchStore((state) => state.duplicateTimelineClip)
  const removeTimelineClips = useWorkbenchStore((state) => state.removeTimelineClips)
  const removeTimelineTextClip = useWorkbenchStore((state) => state.removeTimelineTextClip)
  const removeTimelineTransition = useWorkbenchStore((state) => state.removeTimelineTransition)
  const setTimelineTransition = useWorkbenchStore((state) => state.setTimelineTransition)
  const setTimelineClipAudio = useWorkbenchStore((state) => state.setTimelineClipAudio)
  const moveTimelineTextClip = useWorkbenchStore((state) => state.moveTimelineTextClip)
  const resizeTimelineTextClip = useWorkbenchStore((state) => state.resizeTimelineTextClip)
  const openPreviewSourceTab = useWorkbenchStore((state) => state.openPreviewSourceTab)
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
      // 菜单是从**这一段**上点开的，静音就只静这一段（写 clip.audio，合同 §④#4）。
      // 上一版这里调的是 setTimelineTrackMuted：菜单写「静音」，动作却把整条轨都静了——
      // 名实不符，而且整轨静音在轨道头本来就有自己的按钮。
      { label: clip?.audio?.muted ? t('timelineEditor.context.unmute') : t('timelineEditor.context.mute'), onClick: closeAfter(() => {
        if (clip) setTimelineClipAudio(clip.id, { muted: !(clip.audio?.muted === true) })
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
      // 「对齐到所在镜头」：把字幕的起止对到它落在的那一段画面上。上一版这一项 onClick 就是
      // onClose——菜单收起、什么都没改，用户以为自己点错了。
      { label: t('timelineEditor.context.alignToShot'), onClick: closeAfter(() => {
        const textClip = timeline.textClips.find((item) => item.id === target.textClipId)
        if (!textClip) return
        const centre = (textClip.startFrame + textClip.endFrame) / 2
        const shot = timeline.tracks
          .filter((item) => item.type !== 'audio')
          .flatMap((item) => item.clips)
          .find((item) => item.startFrame <= centre && centre < item.endFrame)
        if (!shot) {
          toast(t('timelineEditor.context.alignToShotMissing'), 'info')
          return
        }
        moveTimelineTextClip(textClip.id, shot.startFrame)
        resizeTimelineTextClip(textClip.id, 'right', shot.endFrame)
      }) },
      { label: t('timelineEditor.context.delete'), shortcut: '⌫', danger: true, onClick: closeAfter(() => removeTimelineTextClip(target.textClipId)) },
    )
  } else if (target.kind === 'transition') {
    menuItems.push(
      { label: t('timelineEditor.context.changeTransition'), onClick: closeAfter(() => onChangeTransition?.(target.fromClipId, target.toClipId)) },
      // 「套用到所有接缝」：拿这条转场当模板，铺到每一条**放得下**的接缝（判据与接缝把手
      // 灰不灰是同一把尺子），整批一次 set，一次 ⌘Z 全撤。
      { label: t('timelineEditor.context.applyTransitionAll'), onClick: closeAfter(() => {
        const source = (timeline.transitions ?? []).find((item) => item.fromClipId === target.fromClipId && item.toClipId === target.toClipId)
        if (!source) return
        const seams = collectApplicableSeams(timeline, { type: source.type, durationFrames: source.durationFrames })
        if (seams.length === 0) {
          toast(t('timelineEditor.context.applyTransitionAllNone'), 'info')
          return
        }
        setTimelineTransition(seams)
        toast(t('timelineEditor.context.applyTransitionAllDone', { count: seams.length }), 'success')
      }) },
      { label: t('timelineEditor.context.removeTransition'), danger: true, onClick: closeAfter(() => removeTimelineTransition(target.fromClipId, target.toClipId)) },
    )
  } else {
    // 空轨两项以前都只是 onClose：菜单弹出来、点哪个都没反应。现在它们各自接到既有链路上
    // ——AI 拼片就是工具条那一颗，「从素材库添加…」把左栏切到素材页（顺带展开左栏）。
    menuItems.push(
      { label: t('timelineEditor.aiArrange'), onClick: closeAfter(() => onArrange?.()) },
      { label: t('timelineEditor.context.addFromAssets'), onClick: closeAfter(() => openPreviewSourceTab('assets')) },
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
