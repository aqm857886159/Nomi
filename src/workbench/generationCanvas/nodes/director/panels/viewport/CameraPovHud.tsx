/**
 * [INPUT]: 依赖 react、react-i18next、../../../../../../design 的 WorkbenchButton / WorkbenchIconButton、../../../../../../vendor/tablerIcons、../../DirectorEditorContext、
 *          ../../CameraRecorderContext 的 useCameraRecorder、../../MobileCameraContext、../../model/hotkeys（DIRECTOR_HOTKEYS / formatHotkey）、
 *          ../../model/editLayer（resolveEditLayer / describeEditLayer）
 * [OUTPUT]: 对外提供 CameraPovHud：机位视角卡片（视口左下）——「机位视角 [POV] ×」/ 机位名·焦距 / FOV + 写入层 /
 *           红色「录制运镜 (R)」·「完成录制」/「连接手机虚拟相机」（已连接显示延迟）；录制中卡片顶部红点计时
 * [POS]: director/panels/viewport 的 POV 叠加层（清单 §2.4 V6 + §6 C1/C2/C4）：只在 activeCameraId ≠ free 时出现。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import React from 'react'
import { useTranslation } from 'react-i18next'
import { WorkbenchButton, WorkbenchIconButton } from '../../../../../../design'
import { IconDeviceGamepad2, IconX } from '../../../../../../vendor/tablerIcons'
import { useCameraRecorder } from '../../CameraRecorderContext'
import { useDirectorStore, useDirectorStoreApi } from '../../DirectorEditorContext'
import { useMobileCameraApi } from '../../MobileCameraContext'
import { describeEditLayer, resolveEditLayer } from '../../model/editLayer'
import { DIRECTOR_HOTKEYS, formatHotkey } from '../../model/hotkeys'

export function CameraPovHud(): JSX.Element | null {
  const { t } = useTranslation()
  const store = useDirectorStoreApi()
  const recorder = useCameraRecorder()
  const mobile = useMobileCameraApi()
  const camera = useDirectorStore((state) => (state.activeCameraId === 'free' ? null : state.findCamera(state.activeCameraId) ?? null))
  const recording = useDirectorStore((state) => state.recording)
  const elapsed = useDirectorStore((state) => (state.recording ? Math.max(0, state.timeline.currentTime - state.recording.startTime) : 0))
  const layer = useDirectorStore((state) => {
    const target = state.activeCameraId === 'free' ? undefined : state.findCamera(state.activeCameraId)
    return target ? resolveEditLayer(target, { currentTime: state.timeline.currentTime, activeWaypointId: state.selection.activeWaypointId }, true) : null
  })
  if (!camera) return null
  const layerLabel = layer === 'keyframe' ? t('director.editor.editModeKeyframe') : layer === 'evaluated-readonly' ? t('director.editor.editModeReadonly') : t('director.editor.editModeRest')
  const recordHotkey = formatHotkey(DIRECTOR_HOTKEYS.recordMotion)
  const mobileLabel = mobile.status?.devices.length
    ? t('director.camera.mobileConnected', {
        latency:
          mobile.status.devices[0]?.latencyMs == null
            ? t('director.camera.mobileLatencyPending')
            : t('director.camera.mobileLatency', { ms: Math.round(mobile.status.devices[0].latencyMs) }),
      })
    : t('director.camera.connectMobile')

  return (
    <div className="pointer-events-auto absolute bottom-16 left-3 flex w-[176px] flex-col gap-1.5 rounded-nomi-lg border border-nomi-line bg-nomi-paper/95 p-2 text-caption text-nomi-ink shadow-nomi-md backdrop-blur" data-testid="director-pov-hud">
      <div className="flex items-center gap-1.5">
        <span className="font-semibold">{t('director.camera.povTitle')}</span>
        <span className="rounded-nomi-sm bg-nomi-ink-10 px-1 font-nomi-mono text-micro text-nomi-ink-60">{t('director.camera.povBadge')}</span>
        <div className="flex-1" />
        <WorkbenchIconButton size="sm" icon={<IconX size={14} stroke={2} />} label={t('director.camera.exitPov')} disabled={Boolean(recording)} title={recording ? t('director.camera.pipRecordingBlocked') : t('director.camera.exitPov')} onClick={() => store.getState().exitCameraPOV()} />
      </div>
      <div className="truncate font-semibold" title={t('director.camera.povHint', { mode: layerLabel })}>
        {t('director.camera.povChip', { name: camera.name, mm: camera.focalLengthMm })}
      </div>
      <div className="font-nomi-mono text-micro text-nomi-ink-40" data-layer={describeEditLayer(layer ?? 'rest')}>
        {t('director.camera.povFov', { fov: camera.fov.toFixed(1) })} · {layerLabel}
      </div>
      {recording ? (
        <div className="flex items-center gap-2 text-micro text-nomi-danger" role="status">
          <span className="size-2 animate-pulse rounded-full bg-nomi-danger" />
          {t('director.camera.recordingBanner', { seconds: elapsed.toFixed(1) })}
        </div>
      ) : null}
      <WorkbenchButton size="sm" variant={recording ? 'primary' : 'default'} className={recording ? 'w-full justify-center gap-1.5' : 'w-full justify-center gap-1.5 border-nomi-danger/60 text-nomi-danger'} onClick={() => (recording ? recorder.stop() : recorder.start())}>
        <span className={recording ? 'size-2 rounded-full bg-nomi-paper' : 'size-2 rounded-full bg-nomi-danger'} aria-hidden />
        {recording ? t('director.camera.finishRecording') : t('director.camera.recordMotion')}
        <kbd className="rounded border border-nomi-line bg-nomi-bg px-1 font-nomi-mono text-micro text-nomi-ink-40">{recordHotkey}</kbd>
      </WorkbenchButton>
      <span title={t('director.camera.mobileHint')}>
        <WorkbenchButton size="sm" className="w-full justify-center gap-1.5" data-testid="director-connect-mobile" onClick={() => mobile.setDialogOpen(true)}>
          <IconDeviceGamepad2 size={14} stroke={1.9} />
          {mobileLabel}
        </WorkbenchButton>
      </span>
    </div>
  )
}
