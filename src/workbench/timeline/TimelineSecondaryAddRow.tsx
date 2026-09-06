import React from 'react'
import { useTranslation } from 'react-i18next'
import { IconMusic, IconSubtitles } from '@tabler/icons-react'
import { useWorkbenchStore } from '../workbenchStore'
import { cn } from '../../utils/cn'
import { WorkbenchButton } from '../../design'
import { toast } from '../../ui/toast'
import { ASSET_LIBRARY_DRAG_MIME } from '../assets/assetLibraryDrag'
import { addAssetToTimeline, tryAddAssetFromDragData } from './addAssetToTimeline'
import AssetPicker from '../assets/AssetPicker'
import AssetPickerPopover from '../assets/AssetPickerPopover'
import { getActiveWorkbenchProjectId } from '../project/workbenchProjectSession'

/**
 * 叠加层收起条（方案 B 的空态 + 方案 A 的视觉，用户拍板）。
 * 配乐/字幕为空时不占整条副轨，收成这一条细行，**沿用空轨「浅虚线 lane + 淡灰提示」语言**(不再手写彩色 pill)：
 *  - 配乐：整条虚线 lane = 拖放区(拖素材库音频直接落,落到播放头)，居中淡提示。
 *  - 字幕：右侧一个 WorkbenchButton 极简钮(点击在播放头加字幕)。只在预览(showText)给。
 * 只空音频(生成画布)→只虚线拖放 lane;只空字幕(音频已有 clip)→只一个「+ 字幕」钮。
 */
export function TimelineSecondaryAddRow({
  showAudio,
  showText,
}: {
  showAudio: boolean
  showText: boolean
}): JSX.Element | null {
  const { t } = useTranslation()
  const addTimelineTextClip = useWorkbenchStore((state) => state.addTimelineTextClip)
  const selectTimelineTextClip = useWorkbenchStore((state) => state.selectTimelineTextClip)
  const fps = useWorkbenchStore((state) => state.timeline.fps)
  const [dropHover, setDropHover] = React.useState(false)
  const [musicPickerOpen, setMusicPickerOpen] = React.useState(false)
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
    const result = tryAddAssetFromDragData(event.dataTransfer.getData(ASSET_LIBRARY_DRAG_MIME), {
      fps,
      startFrame: playhead,
      targetTrackType: 'audio',
      activeProjectId: getActiveWorkbenchProjectId(),
    })
    if (!result) return
    event.preventDefault()
    if (result.status === 'reject-external') toast(t('assetLibrary.externalAssetHint'), 'info')
  }
  const acceptsAudio = (types: readonly string[]) => showAudio && types.includes(ASSET_LIBRARY_DRAG_MIME)

  // 「＋配乐」：与「＋字幕」对称的点击入口。此前配乐只有拖放一条路，而全 App 拖不出音频素材
  // （素材库网格过滤掉了音频）→ 那行「拖音频到此」等于无源。落 clip 走与拖放同一条实现。
  const musicBtn = showAudio ? (
    <span className="relative inline-flex">
      <WorkbenchButton
        onClick={() => setMusicPickerOpen((open) => !open)}
        className="h-6 px-2 text-micro [&>svg]:size-3 gap-1"
        aria-label={t('timelineEditor.secondary.addMusic')}
      >
        {/* 类型图标比加号可识别（合同 §2.8）：一眼看出这颗是「配乐」不是「再来一个什么」。 */}
        <IconMusic stroke={2} />
        {t('timelineEditor.secondary.music')}
      </WorkbenchButton>
      {musicPickerOpen ? (
        <AssetPickerPopover onClose={() => setMusicPickerOpen(false)}>
          <AssetPicker
            projectId={getActiveWorkbenchProjectId()}
            accept={['audio']}
            onPick={(asset) => {
              // 第一段配乐铺在**片头**，不是播放头。点「+ 配乐」的人说的是「给这支片子配个乐」，
              // 没有位置意图；落在播放头上会让成片凭空长出一截黑场（15 秒的片子随手一拖播放头，
              // 配乐从 7.5 秒起，导出就变成 22.5 秒），而用户完全不知道那一截哪来的。
              // 想放在某个点上的第二段/音效仍按播放头走——那时位置就是意图了。想改第一段的位置，
              // 拖它或拖素材过来，两条路都在。
              const state = useWorkbenchStore.getState()
              const audioTrackEmpty = state.timeline.tracks.every((track) => track.type !== 'audio' || track.clips.length === 0)
              // 加不进去时它**成功地返回 null**（时长探不出来、素材类型落不了轨），此前整个
              // Promise 被裸 `void` 丢掉：用户挑了首曲子，弹窗关了，轴上什么都没多，一个字的
              // 解释也没有（设计系统 §4.1 C1）。这不是拒绝、是「静悄悄地没做成」，所以要看返回值，
              // 光加 catch 没用；catch 是给同步抛出的意外留的，说的是同一句话。
              // 「轴保持原样」是真的：失败都发生在写轴之前。
              void addAssetToTimeline(asset, { fps, startFrame: audioTrackEmpty ? 0 : state.timeline.playheadFrame })
                .then((clip) => {
                  if (!clip) toast(t('timelineEditor.adoption.failedRecovered'), 'error')
                })
                .catch((error: unknown) => {
                  console.error('add music to timeline failed', error)
                  toast(t('timelineEditor.adoption.failedRecovered'), 'error')
                })
              setMusicPickerOpen(false)
            }}
            onUpload={() => {}}
          />
        </AssetPickerPopover>
      ) : null}
    </span>
  ) : null

  const subtitleBtn = showText ? (
    <WorkbenchButton
      onClick={addText}
      className="h-6 px-2 text-micro [&>svg]:size-3 gap-1"
      aria-label={t('timelineEditor.secondary.addCaption')}
    >
      <IconSubtitles stroke={2} />
      {t('timelineEditor.secondary.caption')}
    </WorkbenchButton>
  ) : null

  return (
    <div
      className={cn(
        'workbench-timeline-secondary-add',
        'w-full min-h-[30px] grid grid-cols-[var(--workbench-timeline-label-width)_minmax(0,1fr)]',
        'items-center mb-1 border-b-0 gap-2',
      )}
      data-testid="timeline-secondary-add"
    >
      <span
        className={cn(
          'sticky left-0 z-[3] min-w-0 pr-3 flex items-center gap-[7px] text-micro text-[var(--workbench-muted)]',
        )}
      >
        <span className="flex-none w-2 h-2 rounded-full bg-[var(--nomi-ink-20)]" aria-hidden="true" />
        <span className="truncate">{t('timelineEditor.secondary.overlay')}</span>
      </span>
      {showAudio ? (
        <div
          className={cn(
            'relative h-[26px] flex items-center justify-center rounded-[var(--nomi-radius-sm)]',
            'border border-dashed transition-[background,border-color] duration-[var(--nomi-transition-fast)]',
            dropHover
              ? 'border-[var(--workbench-audio)] bg-[var(--workbench-audio-soft)]'
              : 'border-[var(--nomi-line)]',
          )}
          data-testid="timeline-secondary-audio-drop"
          onDragEnter={(e) => {
            if (acceptsAudio(e.dataTransfer.types)) {
              e.preventDefault()
              setDropHover(true)
            }
          }}
          onDragOver={(e) => {
            if (acceptsAudio(e.dataTransfer.types)) {
              e.preventDefault()
              e.dataTransfer.dropEffect = 'copy'
            }
          }}
          onDragLeave={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as globalThis.Node | null)) setDropHover(false)
          }}
          onDrop={onDrop}
        >
          <span
            className={cn(
              'flex items-center gap-1.5 text-micro font-medium text-[var(--nomi-ink-40)] pointer-events-none',
            )}
          >
            <IconMusic size={12} stroke={1.8} />
            {t('timelineEditor.secondary.dropAudio')}
          </span>
          <span className="absolute right-1 inline-flex items-center gap-1">
            {musicBtn}
            {subtitleBtn}
          </span>
        </div>
      ) : (
        <div className="flex items-center">{subtitleBtn}</div>
      )}
    </div>
  )
}
