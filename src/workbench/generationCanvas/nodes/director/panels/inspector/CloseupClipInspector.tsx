/**
 * [INPUT]: 依赖 react、react-i18next、../../../../../../design（NomiSelect / WorkbenchButton / confirmDialog）、../../../../../../ui/toast、../../DirectorEditorContext、
 *          ../../model/directorTypes（DirectorCamera / CloseupClip / CLOSEUP_MOTION_PRESETS 等）、../../model/closeupRig（DEFAULT_CUSTOM_ANCHOR / CLOSEUP_MIN_DISTANCE）、
 *          ../../model/timeGrid 的 secondsToFrame、../../timeline/timelineCommands 的 cutSelectedClip、../fields/FieldPrimitives、../fields/SliderNumberField
 * [OUTPUT]: 对外提供 CloseupClipInspector：「特写片段属性」所属机位 / 跟踪目标 / 锚点 / 开始·结束滑条（右下 F 帧号）/ 持续时长 →
 *           「取景」朝向 / 方位 / 水平角 ±180 / 俯仰角 ±89 → 「机位运动」距离 0.3–20 / 高度 −2–5 / [自定义锚点 X −3–3 · Y −1–3 · Z −3–3] / 运镜预设 →
 *           「播放头时间裁剪」裁前 / 裁后 → 转为路径 · 删除片段（确认弹窗）
 * [POS]: director/panels/inspector 的特写片段卡：字段改动经 updateCloseupClip（改动前快照），开始 / 结束经 updateClipTime（与本机位其它片段重叠即拒绝），
 *        机位位姿由播放循环每帧按 closeupRig 求值；不提供「分割」按钮，custom 方位没有角度输入。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import React from 'react'
import { useTranslation } from 'react-i18next'
import { NomiSelect, WorkbenchButton, confirmDialog } from '../../../../../../design'
import { toast } from '../../../../../../ui/toast'
import { useDirectorStore, useDirectorStoreApi } from '../../DirectorEditorContext'
import { CLOSEUP_MIN_DISTANCE, DEFAULT_CUSTOM_ANCHOR } from '../../model/closeupRig'
import {
  CLOSEUP_MOTION_PRESETS,
  type CloseupAnchor,
  type CloseupAzimuth,
  type CloseupClip,
  type CloseupFacingMode,
  type CloseupMotionPreset,
  type DirectorCamera,
} from '../../model/directorTypes'
import { secondsToFrame } from '../../model/timeGrid'
import { cutSelectedClip, type CommandResult } from '../../timeline/timelineCommands'
import { InspectorCard, SectionHeader } from '../fields/FieldPrimitives'
import { SliderNumberField } from '../fields/SliderNumberField'

const ANCHORS: CloseupAnchor[] = ['eye', 'face', 'chest', 'body', 'pelvis', 'foot', 'custom']
const AZIMUTHS: CloseupAzimuth[] = ['front', 'front_left', 'front_right', 'left', 'right', 'back', 'custom']
const FACINGS: CloseupFacingMode[] = ['look_at_target', 'follow_subject_yaw', 'world_locked', 'manual']
const NO_SPACE = 'director.timeline.toast.noSpace'
// 自定义锚点三轴量程（相对目标根部，米）
const CUSTOM_ANCHOR_RANGE = { x: { min: -3, max: 3 }, y: { min: -1, max: 3 }, z: { min: -3, max: 3 } } as const

/** 行：左标签 + 右控件，两端对齐 */
function Row({ label, children }: { label: string; children: React.ReactNode }): JSX.Element {
  return (
    <div className="flex items-center justify-between gap-2 py-0.5 text-caption text-nomi-ink-80">
      <span className="shrink-0 truncate font-medium">{label}</span>
      <div className="min-w-0">{children}</div>
    </div>
  )
}

export function CloseupClipInspector({ camera, clip }: { camera: DirectorCamera; clip: CloseupClip }): JSX.Element {
  const { t } = useTranslation()
  const store = useDirectorStoreApi()
  // 跟踪目标 = 除组以外的全部物体
  const targets = useDirectorStore((state) => state.activeScene().objects.filter((object) => object.type !== 'group'))
  const totalDuration = useDirectorStore((state) => state.timeline.totalDuration)
  const patch = (next: Partial<CloseupClip>) => {
    store.getState().saveState()
    store.getState().updateCloseupClip(camera.id, clip.id, next)
  }
  const live = (next: Partial<CloseupClip>) => store.getState().updateCloseupClip(camera.id, clip.id, next)
  const run = (result: CommandResult) => {
    if (!result.ok && result.reasonKey) toast(t(result.reasonKey as typeof NO_SPACE), 'warning')
  }
  // 开始 / 结束滑条 → updateClipTime，与本机位其它片段重叠或短于一帧则拒绝
  const setTimes = (startTime: number, endTime: number) => {
    if (!store.getState().updateClipTime(camera.id, clip.id, 'closeup', startTime, endTime, false)) toast(t(NO_SPACE), 'warning')
  }
  const customAnchor = clip.customAnchor ?? DEFAULT_CUSTOM_ANCHOR
  const durationSeconds = clip.endTime - clip.startTime
  const onDelete = async () => {
    const ok = await confirmDialog({ title: t('director.closeup.deleteTitle'), message: t('director.closeup.deleteMessage'), confirmLabel: t('common.delete'), danger: true })
    if (ok) store.getState().deleteCloseupClip(camera.id, clip.id)
  }

  return (
    <>
      <InspectorCard>
        <SectionHeader title={t('director.closeup.attrsTitle')} />
        <Row label={t('director.closeup.ownerCamera')}>
          <span className="truncate font-medium text-nomi-ink">{camera.name}</span>
        </Row>
        <Row label={t('director.closeup.trackTarget')}>
          <NomiSelect
            size="xs"
            ariaLabel={t('director.closeup.trackTarget')}
            value={targets.some((object) => object.id === clip.targetObjectId) ? clip.targetObjectId : ''}
            placeholder={t('director.closeup.pickTarget')}
            options={targets.map((object) => ({ value: object.id, label: object.name }))}
            onChange={(value) => patch({ targetObjectId: value })}
          />
        </Row>
        <Row label={t('director.closeup.anchorTitle')}>
          <NomiSelect
            size="xs"
            ariaLabel={t('director.closeup.anchorTitle')}
            value={clip.anchor}
            options={ANCHORS.map((anchor) => ({ value: anchor, label: t(`director.closeup.anchor.${anchor}`) }))}
            onChange={(value) => patch({ anchor: value as CloseupAnchor })}
          />
        </Row>
        <SliderNumberField label={t('director.closeup.start')} value={clip.startTime} min={0} max={totalDuration} step={0.1} unit="s" digits={1} onChangeStart={() => store.getState().saveState()} onChange={(startTime) => setTimes(startTime, clip.endTime)} />
        <div className="-mt-1 text-right font-nomi-mono text-micro text-nomi-ink-40">{t('director.closeup.frameTag', { frame: secondsToFrame(clip.startTime) })}</div>
        <SliderNumberField label={t('director.closeup.end')} value={clip.endTime} min={0} max={totalDuration} step={0.1} unit="s" digits={1} onChangeStart={() => store.getState().saveState()} onChange={(endTime) => setTimes(clip.startTime, endTime)} />
        <div className="-mt-1 text-right font-nomi-mono text-micro text-nomi-ink-40">{t('director.closeup.frameTag', { frame: secondsToFrame(clip.endTime) })}</div>
        <div className="mt-1 flex items-center justify-between border-t border-nomi-line-soft pt-1 text-caption">
          <span className="text-nomi-ink-40">{t('director.closeup.duration')}</span>
          <span className="font-nomi-mono text-nomi-ink">{t('director.closeup.durationValue', { seconds: durationSeconds.toFixed(2), frames: secondsToFrame(durationSeconds) })}</span>
        </div>
      </InspectorCard>

      <InspectorCard>
        <SectionHeader title={t('director.closeup.framingTitle')} />
        <Row label={t('director.closeup.facing')}>
          <NomiSelect
            size="xs"
            ariaLabel={t('director.closeup.facing')}
            value={clip.facingMode}
            options={FACINGS.map((mode) => ({ value: mode, label: t(`director.closeup.facingMode.${mode}`) }))}
            onChange={(value) => patch({ facingMode: value as CloseupFacingMode })}
          />
        </Row>
        <Row label={t('director.closeup.azimuth')}>
          <NomiSelect
            size="xs"
            ariaLabel={t('director.closeup.azimuth')}
            value={clip.azimuth}
            options={AZIMUTHS.map((azimuth) => ({ value: azimuth, label: t(`director.closeup.azimuthName.${azimuth}`) }))}
            onChange={(value) => patch({ azimuth: value as CloseupAzimuth })}
          />
        </Row>
        <SliderNumberField label={t('director.closeup.horizontalAngle')} value={clip.horizontalAngle} min={-180} max={180} step={1} unit="°" onChangeStart={() => store.getState().saveState()} onChange={(horizontalAngle) => live({ horizontalAngle })} />
        <SliderNumberField label={t('director.closeup.pitchAngle')} value={clip.pitchAngle} min={-89} max={89} step={1} unit="°" onChangeStart={() => store.getState().saveState()} onChange={(pitchAngle) => live({ pitchAngle })} />
      </InspectorCard>

      <InspectorCard>
        <SectionHeader title={t('director.closeup.movementTitle')} />
        <SliderNumberField label={t('director.closeup.distance')} value={clip.distance} min={CLOSEUP_MIN_DISTANCE} max={20} step={0.1} unit="m" digits={1} onChangeStart={() => store.getState().saveState()} onChange={(distance) => live({ distance })} />
        <SliderNumberField label={t('director.closeup.height')} value={clip.height} min={-2} max={5} step={0.1} unit="m" digits={1} onChangeStart={() => store.getState().saveState()} onChange={(height) => live({ height })} />
        {clip.anchor === 'custom'
          ? (['x', 'y', 'z'] as const).map((axis) => (
              <SliderNumberField
                key={axis}
                label={axis === 'x' ? t('director.closeup.anchorAxis.x') : axis === 'y' ? t('director.closeup.anchorAxis.y') : t('director.closeup.anchorAxis.z')}
                value={customAnchor[axis]}
                min={CUSTOM_ANCHOR_RANGE[axis].min}
                max={CUSTOM_ANCHOR_RANGE[axis].max}
                step={0.05}
                unit="m"
                digits={2}
                onChangeStart={() => store.getState().saveState()}
                onChange={(value) => live({ customAnchor: { ...customAnchor, [axis]: value } })}
              />
            ))
          : null}
        <Row label={t('director.closeup.motion')}>
          <NomiSelect
            size="xs"
            ariaLabel={t('director.closeup.motion')}
            value={clip.motionPreset}
            options={CLOSEUP_MOTION_PRESETS.map((preset) => ({ value: preset, label: t(`director.closeup.motionName.${preset}`) }))}
            onChange={(value) => patch({ motionPreset: value as CloseupMotionPreset })}
          />
        </Row>
      </InspectorCard>

      <InspectorCard>
        <SectionHeader title={t('director.closeup.trimTitle')} />
        <div className="grid grid-cols-2 gap-1.5">
          <WorkbenchButton size="sm" className="justify-center" onClick={() => run(cutSelectedClip(store, 'left'))}>
            {t('director.timelineInspector.trimLeft')}
          </WorkbenchButton>
          <WorkbenchButton size="sm" className="justify-center" onClick={() => run(cutSelectedClip(store, 'right'))}>
            {t('director.timelineInspector.trimRight')}
          </WorkbenchButton>
        </div>
      </InspectorCard>

      <div className="flex flex-col gap-1.5">
        <WorkbenchButton
          size="sm"
          className="justify-center"
          onClick={() => {
            const clipId = store.getState().convertCloseupToTrajectory(camera.id, clip.id)
            toast(clipId ? t('director.closeup.convertDone') : t(NO_SPACE), clipId ? 'success' : 'warning')
          }}
        >
          {t('director.closeup.convert')}
        </WorkbenchButton>
        <WorkbenchButton size="sm" className="justify-center text-nomi-danger" onClick={() => void onDelete()}>
          {t('director.closeup.delete')}
        </WorkbenchButton>
      </div>
    </>
  )
}
