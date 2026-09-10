/**
 * [INPUT]: 依赖 react、react-i18next、../../../../../../design（NomiSelect / NomiSegmented / WorkbenchButton）、../../../../../../ui/toast、../../DirectorEditorContext、
 *          ../../model/directorTypes（DirectorObject / LookAtClip / LookAtTargetType / LookAtBodyPart）、../../model/hotkeys、../../timeline/timelineCommands、../fields/*
 * [OUTPUT]: 对外提供 LookAtClipInspector（清单 §4.7 I11：目标类型 / 目标 / 部位 / 上下注视 / 高度偏移 / 缓入缓出 / 限幅角 / 强度 / 裁剪 / 删除；副轨旁路「一键启用」）
 * [POS]: director/panels/inspector 的视线片段卡：字段经 updateLookAtClip；求解在 scene/character/useCharacterRig。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import React from 'react'
import { useTranslation } from 'react-i18next'
import { NomiSegmented, NomiSelect, WorkbenchButton } from '../../../../../../design'
import { toast } from '../../../../../../ui/toast'
import { useDirectorStore, useDirectorStoreApi } from '../../DirectorEditorContext'
import type { DirectorObject, LookAtBodyPart, LookAtClip, LookAtTargetType } from '../../model/directorTypes'
import { DIRECTOR_HOTKEYS, formatHotkey } from '../../model/hotkeys'
import { cutSelectedClip, splitSelectedAtPlayhead, type CommandResult } from '../../timeline/timelineCommands'
import { InspectorCard, SectionHeader, ToggleField } from '../fields/FieldPrimitives'
import { SliderNumberField } from '../fields/SliderNumberField'

const TARGET_TYPES: LookAtTargetType[] = ['none', 'camera', 'object']
const BODY_PARTS: LookAtBodyPart[] = ['eye', 'face', 'chest', 'body', 'pelvis', 'foot']
type ReasonKey = 'director.timeline.toast.noSpace'

function Row({ label, children }: { label: string; children: React.ReactNode }): JSX.Element {
  return (
    <div className="grid grid-cols-[72px_1fr] items-center gap-2 py-1 text-caption text-nomi-ink-80">
      <span className="truncate">{label}</span>
      <div className="min-w-0">{children}</div>
    </div>
  )
}

export function LookAtClipInspector({ object, clip }: { object: DirectorObject; clip: LookAtClip }): JSX.Element {
  const { t } = useTranslation()
  const store = useDirectorStoreApi()
  const cameras = useDirectorStore((state) => state.activeScene().cameras)
  const others = useDirectorStore((state) => state.activeScene().objects.filter((item) => item.id !== object.id && !item.isAuxiliary && item.type !== 'group'))
  const patch = (next: Partial<LookAtClip>) => {
    store.getState().saveState()
    store.getState().updateLookAtClip(object.id, clip.id, next)
  }
  const run = (result: CommandResult) => {
    if (!result.ok && result.reasonKey) toast(t(result.reasonKey as ReasonKey), 'warning')
  }
  const targetOptions = clip.targetType === 'camera' ? cameras.map((camera) => ({ value: camera.id, label: camera.name })) : others.map((item) => ({ value: item.id, label: item.name }))

  return (
    <InspectorCard>
      <SectionHeader title={t('director.lookAtClip.title')} />
      {object.lookAtTrackEnabled === false ? (
        <div className="mb-1 flex items-center justify-between gap-2 rounded-nomi-sm bg-nomi-warning/15 px-2 py-1 text-caption text-nomi-ink">
          <span>{t('director.lookAtClip.trackDisabled')}</span>
          <WorkbenchButton size="sm" onClick={() => store.getState().toggleLookAtTrack(object.id)}>
            {t('director.lookAtClip.enableTrack')}
          </WorkbenchButton>
        </div>
      ) : null}
      <NomiSegmented
        ariaLabel={t('director.lookAtClip.target')}
        density="compact"
        value={clip.targetType === 'custom' ? 'none' : clip.targetType}
        options={TARGET_TYPES.map((type) => ({ value: type, label: t(`director.lookAtClip.targetType.${type}`) }))}
        onChange={(value) => patch({ targetType: value as LookAtTargetType, targetId: '' })}
      />
      {clip.targetType === 'camera' || clip.targetType === 'object' ? (
        <Row label={t('director.lookAtClip.targetObject')}>
          <NomiSelect
            size="xs"
            ariaLabel={t('director.lookAtClip.targetObject')}
            value={clip.targetId}
            placeholder={t('director.camera.noTarget')}
            options={targetOptions}
            onChange={(value) => patch({ targetId: value })}
          />
        </Row>
      ) : null}
      {clip.targetType === 'object' ? (
        <>
          <Row label={t('director.lookAtClip.bodyPart')}>
            <NomiSelect
              size="xs"
              ariaLabel={t('director.lookAtClip.bodyPart')}
              value={clip.targetBodyPart === 'custom' ? 'face' : clip.targetBodyPart}
              options={BODY_PARTS.map((part) => ({ value: part, label: t(`director.closeup.anchor.${part}`) }))}
              onChange={(value) => patch({ targetBodyPart: value as LookAtBodyPart })}
            />
          </Row>
          <SliderNumberField label={t('director.lookAtClip.heightOffset')} value={clip.targetHeightOffset} min={-1} max={1} step={0.05} unit="m" digits={2} onChangeStart={() => store.getState().saveState()} onChange={(targetHeightOffset) => store.getState().updateLookAtClip(object.id, clip.id, { targetHeightOffset })} />
        </>
      ) : null}
      <ToggleField label={t('director.lookAtClip.enablePitch')} checked={clip.enablePitch} onChange={(enablePitch) => patch({ enablePitch })} />
      <SliderNumberField label={t('director.lookAtClip.blendIn')} value={clip.blendInDuration} min={0} max={2} step={0.05} unit="s" digits={2} onChangeStart={() => store.getState().saveState()} onChange={(blendInDuration) => store.getState().updateLookAtClip(object.id, clip.id, { blendInDuration })} />
      <SliderNumberField label={t('director.lookAtClip.blendOut')} value={clip.blendOutDuration} min={0} max={2} step={0.05} unit="s" digits={2} onChangeStart={() => store.getState().saveState()} onChange={(blendOutDuration) => store.getState().updateLookAtClip(object.id, clip.id, { blendOutDuration })} />
      <SliderNumberField label={t('director.lookAtClip.clamping')} value={clip.clampingAngle} min={0} max={120} step={1} unit="°" onChangeStart={() => store.getState().saveState()} onChange={(clampingAngle) => store.getState().updateLookAtClip(object.id, clip.id, { clampingAngle })} />
      <SliderNumberField label={t('director.lookAtClip.weight')} value={clip.weight} min={0} max={1} step={0.05} digits={2} onChangeStart={() => store.getState().saveState()} onChange={(weight) => store.getState().updateLookAtClip(object.id, clip.id, { weight })} />
      <div className="mt-2 flex flex-wrap gap-1">
        <WorkbenchButton size="sm" onClick={() => run(cutSelectedClip(store, 'left'))}>
          {t('director.timelineInspector.trimLeft')} {formatHotkey(DIRECTOR_HOTKEYS.cutLeft)}
        </WorkbenchButton>
        <WorkbenchButton size="sm" onClick={() => run(cutSelectedClip(store, 'right'))}>
          {t('director.timelineInspector.trimRight')} {formatHotkey(DIRECTOR_HOTKEYS.cutRight)}
        </WorkbenchButton>
        <WorkbenchButton size="sm" onClick={() => run(splitSelectedAtPlayhead(store))}>
          {t('director.timelineInspector.split')}
        </WorkbenchButton>
        <WorkbenchButton size="sm" className="text-nomi-danger" onClick={() => store.getState().deleteLookAtClip(object.id, clip.id)}>
          {t('director.lookAtClip.deleteClip')}
        </WorkbenchButton>
      </div>
    </InspectorCard>
  )
}
