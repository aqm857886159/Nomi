import React from 'react'
import { IconMusic, IconPlus } from '@tabler/icons-react'
import { useWorkbenchStore } from '../workbenchStore'
import { cn } from '../../utils/cn'
import { WorkbenchButton } from '../../design'
import { ASSET_LIBRARY_DRAG_MIME } from '../assets/assetLibraryDrag'
import { tryAddAudioAssetFromDragData } from './dropAudioAssetToTimeline'

/**
 * 叠加层收起条（方案 B 的空态 + 方案 A 的视觉，用户拍板）。
 * 配乐/字幕为空时不占整条副轨，收成这一条细行，**沿用空轨「浅虚线 lane + 淡灰提示」语言**(不再手写彩色 pill)：
 *  - 配乐：整条虚线 lane = 拖放区(拖素材库音频直接落,落到播放头)，居中淡提示。
 *  - 字幕：右侧一个 WorkbenchButton 极简钮(点击在播放头加字幕)。只在预览(showText)给。
 * 只空音频(生成画布)→只虚线拖放 lane;只空字幕(音频已有 clip)→只一个「+ 字幕」钮。
 */
export function TimelineSecondaryAddRow({ showAudio, showText }: { showAudio: boolean; showText: boolean }): JSX.Element | null {
  const addTimelineTextClip = useWorkbenchStore((state) => state.addTimelineTextClip)
  const selectTimelineTextClip = useWorkbenchStore((state) => state.selectTimelineTextClip)
  const fps = useWorkbenchStore((state) => state.timeline.fps)
  const [dropHover, setDropHover] = React.useState(false)
  if (!showAudio && !showText) return null

  const addText = () => {
    const playhead = useWorkbenchStore.getState().timeline.playheadFrame
    selectTimelineTextClip(addTimelineTextClip('caption', playhead))
  }
  // 收起态音频轨没有 lane → 让虚线 lane 本身收音频拖放(落到播放头)。
  const onDrop = (event: React.DragEvent<HTMLDivElement>) => {
    setDropHover(false)
    if (!showAudio) return
    const playhead = useWorkbenchStore.getState().timeline.playheadFrame
    if (tryAddAudioAssetFromDragData(event.dataTransfer.getData(ASSET_LIBRARY_DRAG_MIME), { fps, startFrame: playhead })) event.preventDefault()
  }
  const acceptsAudio = (types: readonly string[]) => showAudio && types.includes(ASSET_LIBRARY_DRAG_MIME)

  const subtitleBtn = showText ? (
    <WorkbenchButton onClick={addText} className="h-6 px-2 text-micro [&>svg]:size-3 gap-1" aria-label="添加字幕">
      <IconPlus stroke={2} />字幕
    </WorkbenchButton>
  ) : null

  return (
    <div className={cn(
      'workbench-timeline-secondary-add',
      'w-full min-h-[30px] grid grid-cols-[var(--workbench-timeline-label-width)_minmax(0,1fr)]',
      'items-center mb-1 border-b-0 gap-2',
    )} data-testid="timeline-secondary-add">
      <span className={cn('sticky left-0 z-[3] min-w-0 pr-3 flex items-center gap-[7px] text-micro text-[var(--workbench-muted)]')}>
        <span className="flex-none w-2 h-2 rounded-full bg-[var(--nomi-ink-20)]" aria-hidden="true" />
        <span className="truncate">叠加层</span>
      </span>
      {showAudio ? (
        <div
          className={cn(
            'relative h-[26px] flex items-center justify-center rounded-[var(--nomi-radius-sm)]',
            'border border-dashed transition-[background,border-color] duration-[var(--nomi-transition-fast)]',
            dropHover ? 'border-[var(--workbench-audio)] bg-[var(--workbench-audio-soft)]' : 'border-[var(--nomi-line)]',
          )}
          data-testid="timeline-secondary-audio-drop"
          onDragEnter={(e) => { if (acceptsAudio(e.dataTransfer.types)) { e.preventDefault(); setDropHover(true) } }}
          onDragOver={(e) => { if (acceptsAudio(e.dataTransfer.types)) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy' } }}
          onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as globalThis.Node | null)) setDropHover(false) }}
          onDrop={onDrop}
        >
          <span className={cn('flex items-center gap-1.5 text-micro font-medium text-[var(--nomi-ink-40)] pointer-events-none')}>
            <IconMusic size={12} stroke={1.8} />拖音频到此当配乐
          </span>
          {subtitleBtn ? <span className="absolute right-1">{subtitleBtn}</span> : null}
        </div>
      ) : (
        <div className="flex items-center">{subtitleBtn}</div>
      )}
    </div>
  )
}
