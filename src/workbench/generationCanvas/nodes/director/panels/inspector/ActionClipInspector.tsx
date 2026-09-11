/**
 * [INPUT]: 依赖 react、react-i18next、../../../../../../design（WorkbenchButton / NomiSelect）、../../DirectorEditorContext、../../model/directorTypes（DirectorObject / ActionClip）、
 *          ../../model/actionLibrary 的 ACTION_LIBRARY、../../model/timeGrid 的 secondsToFrame、../../timeline/timelineCommands 的 cutSelectedClip、../fields/FieldPrimitives、../fields/SliderNumberField
 * [OUTPUT]: 对外提供 ActionClipInspector：副轨禁用横幅（一键启用）→ 卡「片段属性」（骨骼姿态片段：片段类型「骨骼姿态 N 帧」；
 *           内置动作：动作姿态下拉换动作并把名字改成「动作·X」）+ 开始 / 结束 滑条（步 0.1、带 F 帧读数）+ 持续时长 → 卡「播放头时间裁剪」（裁前 / 裁后）→ 「删除片段」
 * [POS]: director/panels/inspector 的动作片段卡：开始 / 结束经 store.updateClipTime（同副轨争位置，失败保持原值）；裁剪打到命令层；分割在时间轴。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import React from 'react'
import { useTranslation } from 'react-i18next'
import { NomiSelect, WorkbenchButton } from '../../../../../../design'
import { toast } from '../../../../../../ui/toast'
import { useDirectorStore, useDirectorStoreApi } from '../../DirectorEditorContext'
import { ACTION_LIBRARY } from '../../model/actionLibrary'
import type { ActionClip, DirectorObject } from '../../model/directorTypes'
import { secondsToFrame } from '../../model/timeGrid'
import { cutSelectedClip, type CommandResult } from '../../timeline/timelineCommands'
import { InspectorCard, SectionHeader } from '../fields/FieldPrimitives'
import { SliderNumberField } from '../fields/SliderNumberField'

type ReasonKey = 'director.reason.clipNoSpace'

export function ActionClipInspector({ object, clip }: { object: DirectorObject; clip: ActionClip }): JSX.Element {
  const { t } = useTranslation()
  const store = useDirectorStoreApi()
  const totalDuration = useDirectorStore((state) => state.timeline.totalDuration)
  const run = (result: CommandResult) => {
    if (!result.ok && result.reasonKey) toast(t(result.reasonKey as ReasonKey), 'warning')
  }
  const isPose = clip.clipType === 'custom_pose'
  const trackDisabled = object.actionTrackEnabled === false
  const setRange = (startTime: number, endTime: number) => {
    if (!store.getState().updateClipTime(object.id, clip.id, 'action', startTime, endTime, false)) toast(t('director.reason.clipNoSpace'), 'warning')
  }
  const durationSeconds = clip.endTime - clip.startTime

  return (
    <>
      {trackDisabled ? (
        <div className="flex items-center justify-between gap-2 rounded-nomi border border-nomi-warning/40 bg-nomi-warning/10 px-3 py-2 text-caption text-nomi-ink">
          <span className="truncate">{t('director.action.trackDisabled')}</span>
          <button type="button" className="shrink-0 text-caption font-medium text-nomi-warning underline hover:text-nomi-ink" onClick={() => store.getState().toggleActionTrack(object.id)}>
            {t('director.action.enableTrack')}
          </button>
        </div>
      ) : null}
      <InspectorCard>
        <SectionHeader title={t('director.action.inspectorTitle')} />
        <div className="flex items-center justify-between gap-2 py-1 text-caption">
          <span className="font-medium text-nomi-ink-80">{isPose ? t('director.action.clipTypeLabel') : t('director.action.actionPose')}</span>
          {isPose ? (
            <span className="rounded-nomi-sm bg-nomi-ink-05 px-2 py-1 text-caption text-nomi-ink">{t('director.action.poseClipFrames', { count: clip.keyframes?.length ?? 0 })}</span>
          ) : (
            <NomiSelect
              size="xs"
              ariaLabel={t('director.action.actionPose')}
              value={clip.actionPose ?? ''}
              placeholder={clip.name}
              options={ACTION_LIBRARY.map((item) => ({ value: item.id, label: t(`director.action.library.${item.id}`) }))}
              onChange={(value) => store.getState().updateActionClip(object.id, clip.id, { actionPose: value, name: t('director.action.clipName', { name: t(`director.action.library.${value}`) }) })}
            />
          )}
        </div>
        <SliderNumberField label={t('director.action.start')} value={clip.startTime} min={0} max={totalDuration} step={0.1} onChangeStart={() => store.getState().saveState()} onChange={(value) => setRange(value, clip.endTime)} />
        <div className="-mt-1 text-right font-nomi-mono text-micro text-nomi-ink-40">{t('director.action.frameReadout', { frame: secondsToFrame(clip.startTime) })}</div>
        <SliderNumberField label={t('director.action.end')} value={clip.endTime} min={0} max={totalDuration} step={0.1} onChangeStart={() => store.getState().saveState()} onChange={(value) => setRange(clip.startTime, value)} />
        <div className="-mt-1 text-right font-nomi-mono text-micro text-nomi-ink-40">{t('director.action.frameReadout', { frame: secondsToFrame(clip.endTime) })}</div>
        <div className="flex items-center justify-between border-t border-nomi-line-soft pt-1 text-caption">
          <span className="text-nomi-ink-60">{t('director.action.duration')}</span>
          <span className="font-nomi-mono text-nomi-ink">{t('director.action.durationValue', { seconds: durationSeconds.toFixed(2), frames: secondsToFrame(durationSeconds) })}</span>
        </div>
      </InspectorCard>
      <InspectorCard>
        <SectionHeader title={t('director.action.trimTitle')} />
        <div className="grid grid-cols-2 gap-1.5">
          <WorkbenchButton size="sm" className="justify-center" onClick={() => run(cutSelectedClip(store, 'left'))}>
            {t('director.action.trimLeft')}
          </WorkbenchButton>
          <WorkbenchButton size="sm" className="justify-center" onClick={() => run(cutSelectedClip(store, 'right'))}>
            {t('director.action.trimRight')}
          </WorkbenchButton>
        </div>
      </InspectorCard>
      <WorkbenchButton size="sm" className="w-full justify-center border-nomi-danger/60 text-nomi-danger" onClick={() => store.getState().deleteActionClip(object.id, clip.id)}>
        {t('director.action.deleteClipFull')}
      </WorkbenchButton>
    </>
  )
}
