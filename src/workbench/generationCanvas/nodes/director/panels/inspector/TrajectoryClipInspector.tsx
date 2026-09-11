/**
 * [INPUT]: 依赖 react、react-i18next、../../../../../../design 的 WorkbenchButton、../../../../../../ui/toast、../../DirectorEditorContext、
 *          ../../model/directorTypes（TimelineEntity / TrajectoryClip）、../../model/hotkeys（DIRECTOR_HOTKEYS / formatHotkey）、../../model/timeGrid 的 FRAME_SECONDS、
 *          ../../timeline/timelineCommands（cutSelectedClip / splitSelectedAtPlayhead）、../fields/FieldPrimitives、../fields/SliderNumberField
 * [OUTPUT]: 对外提供 TrajectoryClipInspector（清单 §4.6 I7：所属实体、开始/结束/时长、裁掉前段/裁掉后段、分割、删除）
 * [POS]: director/panels/inspector 的路径片段卡：改时间走 updateClipTime（重叠即拒绝并 toast），裁切/分割复用时间轴命令层。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import React from 'react'
import { useTranslation } from 'react-i18next'
import { WorkbenchButton } from '../../../../../../design'
import { toast } from '../../../../../../ui/toast'
import { useDirectorStore, useDirectorStoreApi } from '../../DirectorEditorContext'
import type { TimelineEntity, TrajectoryClip } from '../../model/directorTypes'
import { DIRECTOR_HOTKEYS, formatHotkey } from '../../model/hotkeys'
import { FRAME_SECONDS } from '../../model/timeGrid'
import { cutSelectedClip, splitSelectedAtPlayhead, type CommandResult } from '../../timeline/timelineCommands'
import { InspectorCard, SectionHeader } from '../fields/FieldPrimitives'
import { SliderNumberField } from '../fields/SliderNumberField'

const NO_SPACE = 'director.timeline.toast.noSpace'

function Kbd({ children }: { children: React.ReactNode }): JSX.Element {
  return <kbd className="rounded border border-nomi-line bg-nomi-bg px-1 font-nomi-mono text-micro text-nomi-ink-40">{children}</kbd>
}

export function TrajectoryClipInspector({ entity, clip }: { entity: TimelineEntity; clip: TrajectoryClip }): JSX.Element {
  const { t } = useTranslation()
  const store = useDirectorStoreApi()
  const totalDuration = useDirectorStore((state) => state.timeline.totalDuration)
  const run = (result: CommandResult) => {
    if (!result.ok && result.reasonKey) toast(t(result.reasonKey as typeof NO_SPACE), 'warning')
  }
  const setRange = (start: number, end: number) => {
    if (!store.getState().updateClipTime(entity.id, clip.id, 'trajectory', start, end, false)) toast(t(NO_SPACE), 'warning')
  }

  return (
    <InspectorCard>
      <SectionHeader title={t('director.timelineInspector.clipTitle')} />
      <div className="grid grid-cols-[72px_1fr] items-center gap-2 py-1 text-caption text-nomi-ink-80">
        <span className="truncate">{t('director.timelineInspector.clipEntity')}</span>
        <span className="truncate text-nomi-ink">{entity.name}</span>
      </div>
      <SliderNumberField label={t('director.timelineInspector.clipStart')} value={clip.startTime} min={0} max={totalDuration} step={FRAME_SECONDS} unit="s" digits={2} onChangeStart={() => store.getState().saveState()} onChange={(start) => setRange(start, clip.endTime)} />
      <SliderNumberField label={t('director.timelineInspector.clipEnd')} value={clip.endTime} min={0} max={totalDuration} step={FRAME_SECONDS} unit="s" digits={2} onChangeStart={() => store.getState().saveState()} onChange={(end) => setRange(clip.startTime, end)} />
      <div className="grid grid-cols-[72px_1fr] items-center gap-2 py-1 text-caption text-nomi-ink-80">
        <span className="truncate">{t('director.timelineInspector.clipDuration')}</span>
        <span className="font-nomi-mono text-nomi-ink">{t('director.timelineInspector.secondsWithFrames', { seconds: (clip.endTime - clip.startTime).toFixed(2), frame: clip.endFrame - clip.startFrame })}</span>
      </div>
      <div className="mt-2 flex flex-wrap gap-1">
        <WorkbenchButton size="sm" className="gap-1" onClick={() => run(cutSelectedClip(store, 'left'))}>
          {t('director.timelineInspector.trimLeft')}
          <Kbd>{formatHotkey(DIRECTOR_HOTKEYS.cutLeft)}</Kbd>
        </WorkbenchButton>
        <WorkbenchButton size="sm" className="gap-1" onClick={() => run(cutSelectedClip(store, 'right'))}>
          {t('director.timelineInspector.trimRight')}
          <Kbd>{formatHotkey(DIRECTOR_HOTKEYS.cutRight)}</Kbd>
        </WorkbenchButton>
        <WorkbenchButton size="sm" className="gap-1" onClick={() => run(splitSelectedAtPlayhead(store))}>
          {t('director.timelineInspector.split')}
          <Kbd>{formatHotkey(DIRECTOR_HOTKEYS.splitClip)}</Kbd>
        </WorkbenchButton>
        <WorkbenchButton size="sm" className="text-nomi-danger" title={t('director.timelineInspector.deleteClipHint')} onClick={() => store.getState().deleteTrajectoryClip(entity.id, clip.id)}>
          {t('director.timelineInspector.deleteClip')}
        </WorkbenchButton>
      </div>
    </InspectorCard>
  )
}
