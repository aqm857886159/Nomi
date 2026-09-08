import { platformModifier } from '../../design/platformShortcut'
import { useTranslation } from 'react-i18next'
import { useWorkbenchStore } from '../workbenchStore'
import { WorkbenchMenu, type WorkbenchMenuNode } from '../../design/menu'
import { collectApplicableSeams } from './timelineTransition'
import { toast } from '../../ui/toast'

/**
 * 时间轴右键菜单。**2026-09-08 刀 1：只换实现，不动形态。**
 *
 * 换掉的是壳：项、顺序、文案、快捷键、危险项、四种 target 的分支——一条没动
 * （逐项对账表在 docs/plan/2026-09-08-menu-primitive-inventory.md §1 第 17 行）。
 * 换来的是 `WorkbenchMenu`（Radix）带的四样现役没有的东西：
 *   · **点外面能关**——迁移前全仓唯一关不掉的菜单（只能 Esc 或点项，清单 C16）；
 *   · **方向键 / Home / End / 首字母跳转**——迁移前 0 项支持；
 *   · **按真实盒子避让**——迁移前是 `menuItems.length * 34 - 12` 猜一个高度再夹边，
 *     项数一变（clip 8 项 / text 4 项 / transition 3 项 / track 2 项）夹得就不对；
 *   · 焦点与 `role` 语义由 Radix 保证。
 *
 * 外观用 className 把**现状原样带过来**（`min-w-52` / `rounded-nomi-lg` / `p-1` /
 * 项 `text-micro` + `py-1.5` + `rounded-nomi-sm` + `--workbench-hover` 底色 / 快捷键
 * `--workbench-muted`）。它与画布菜单的视觉差异（清单 C11–C14）是**已知的、这一刀不动的**。
 */

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
  // 平台字形从 design 层 derive：此前这里写死 `⌘D`，Windows 上照样显示 ⌘。
  const mod = platformModifier(navigator.platform)
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
  // id 只做 React key 与走查锚点（`data-menu-item`），不进界面。
  const menuItems: Array<{ id: string; label: string; shortcut?: string; danger?: boolean; onClick: () => void }> = []
  if (target.kind === 'clip') {
    const clip = timeline.tracks.flatMap((track) => track.clips).find((item) => item.id === target.clipId)
    const track = timeline.tracks.find((item) => item.id === target.trackId)
    menuItems.push(
      { id: 'split', label: t('timelineEditor.context.split'), shortcut: 'S', onClick: () => clip && splitTimelineClip(clip.id, timeline.playheadFrame) },
      { id: 'duplicate', label: t('timelineEditor.context.duplicate'), shortcut: `${mod}D`, onClick: () => duplicateTimelineClip(target.clipId) },
      { id: 'regenerate', label: t('timelineEditor.regenerate'), onClick: () => onRegenerate?.(target.clipId) },
      // 菜单是从**这一段**上点开的，静音就只静这一段（写 clip.audio，合同 §④#4）。
      // 上一版这里调的是 setTimelineTrackMuted：菜单写「静音」，动作却把整条轨都静了——
      // 名实不符，而且整轨静音在轨道头本来就有自己的按钮。
      { id: 'mute', label: clip?.audio?.muted ? t('timelineEditor.context.unmute') : t('timelineEditor.context.mute'), onClick: () => {
        if (clip) setTimelineClipAudio(clip.id, { muted: !(clip.audio?.muted === true) })
      } },
      { id: 'delete', label: t('timelineEditor.context.delete'), shortcut: '⌫', danger: true, onClick: () => removeTimelineClips([target.clipId]) },
      { id: 'ripple-delete', label: t('timelineEditor.context.rippleDelete'), shortcut: '⇧⌫', danger: true, onClick: () => removeTimelineClips([target.clipId], true) },
      { id: 'delete-left', label: t('timelineEditor.context.deleteLeft'), shortcut: 'Q', danger: true, onClick: () => removeTimelineClips((track?.clips ?? []).filter((item) => item.endFrame <= timeline.playheadFrame).map((item) => item.id), true) },
      { id: 'delete-right', label: t('timelineEditor.context.deleteRight'), shortcut: 'W', danger: true, onClick: () => removeTimelineClips((track?.clips ?? []).filter((item) => item.startFrame >= timeline.playheadFrame).map((item) => item.id), true) },
    )
  } else if (target.kind === 'text') {
    menuItems.push(
      { id: 'edit-text', label: t('timelineEditor.context.editText'), shortcut: '↩', onClick: () => selectTimelineTextClip(target.textClipId) },
      { id: 'duplicate', label: t('timelineEditor.context.duplicate'), onClick: () => {
        const clip = timeline.textClips.find((item) => item.id === target.textClipId)
        if (clip) addTimelineTextClip(clip.style, clip.startFrame + Math.max(1, clip.endFrame - clip.startFrame))
      } },
      // 「对齐到所在镜头」：把字幕的起止对到它落在的那一段画面上。上一版这一项 onClick 就是
      // onClose——菜单收起、什么都没改，用户以为自己点错了。
      { id: 'align-to-shot', label: t('timelineEditor.context.alignToShot'), onClick: () => {
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
      } },
      { id: 'delete', label: t('timelineEditor.context.delete'), shortcut: '⌫', danger: true, onClick: () => removeTimelineTextClip(target.textClipId) },
    )
  } else if (target.kind === 'transition') {
    menuItems.push(
      { id: 'change-transition', label: t('timelineEditor.context.changeTransition'), onClick: () => onChangeTransition?.(target.fromClipId, target.toClipId) },
      // 「套用到所有接缝」：拿这条转场当模板，铺到每一条**放得下**的接缝（判据与接缝把手
      // 灰不灰是同一把尺子），整批一次 set，一次 ⌘Z 全撤。
      { id: 'apply-transition-all', label: t('timelineEditor.context.applyTransitionAll'), onClick: () => {
        const source = (timeline.transitions ?? []).find((item) => item.fromClipId === target.fromClipId && item.toClipId === target.toClipId)
        if (!source) return
        const seams = collectApplicableSeams(timeline, { type: source.type, durationFrames: source.durationFrames })
        if (seams.length === 0) {
          toast(t('timelineEditor.context.applyTransitionAllNone'), 'info')
          return
        }
        setTimelineTransition(seams)
        toast(t('timelineEditor.context.applyTransitionAllDone', { count: seams.length }), 'success')
      } },
      { id: 'remove-transition', label: t('timelineEditor.context.removeTransition'), danger: true, onClick: () => removeTimelineTransition(target.fromClipId, target.toClipId) },
    )
  } else {
    // 空轨两项以前都只是 onClose：菜单弹出来、点哪个都没反应。现在它们各自接到既有链路上
    // ——AI 拼片就是工具条那一颗，「从素材库添加…」把左栏切到素材页（顺带展开左栏）。
    menuItems.push(
      { id: 'ai-arrange', label: t('timelineEditor.aiArrange'), onClick: () => onArrange?.() },
      { id: 'add-from-assets', label: t('timelineEditor.context.addFromAssets'), onClick: () => openPreviewSourceTab('assets') },
    )
  }
  return (
    <WorkbenchMenu
      open
      onOpenChange={(next) => { if (!next) onClose() }}
      point={{ x, y }}
      // 项的收尾不再各自补一次 onClose：选中 → Radix 关 → onOpenChange(false) → onClose。
      items={menuItems.map((item): WorkbenchMenuNode => ({
        id: item.id,
        label: item.label,
        shortcut: item.shortcut,
        danger: item.danger,
        onSelect: item.onClick,
      }))}
      // 现状原样带过来（清单 C11/C13/C14：这一族的宽度、字号、hover 底色与画布菜单本来就不同）。
      className="min-w-52 gap-0 rounded-nomi-lg p-1"
      itemClassName="min-h-0 gap-5 rounded-nomi-sm py-1.5 text-micro data-[highlighted]:bg-workbench-hover"
      shortcutClassName="font-mono text-workbench-muted"
      data-testid="timeline-context-menu"
    />
  )
}
