// 整运镜三合一（IA 重排一期，docs/plan/2026-07-20-scene3d-ia-redesign.md §4/§6）：
// 预设 / 轨迹 / 录 take 三条运镜路收进右栏常驻分区——用户的问题是「想动镜头，从哪动」，
// 一个固定的家给全三条路。替代并删除：右栏顶层「轨迹」tab、顶栏轨迹 toggle、底部轨迹钮
// （同一功能只有一个家，P1）。录 take tab 一键进入操控（仍走现有接控+REC 流程，三跳变两跳）。
import React from 'react'
import { useTranslation } from 'react-i18next'
import { IconRoute, IconVideo, IconManFilled, IconPlayerRecord } from '@tabler/icons-react'
import type { Scene3DCamera, Scene3DState } from './scene3dTypes'
import type { Scene3DTrajectoryEditing } from './useScene3DTrajectoryEditing'
import { PanelButton } from './scene3dToolbar'
import { CameraMovePanel } from './scene3dCameraMovePanel'
import { TrajectoryPanel } from './trajectory'
import { isCameraMoveReady } from './scene3dPlayback'
import type { CameraMovePresetSpec } from './cameraMovePreset'
import type { Scene3DReferenceTargetSummary } from './scene3dReferenceDirector'

export type Scene3DMoveHubTab = 'preset' | 'trajectory' | 'take'

export function Scene3DMoveHub({
  state,
  trajectory,
  readOnly,
  tab,
  onTabChange,
  selectedCamera,
  onPickCamera,
  onApplyCameraMove,
  onExportCameraMoveFrames,
  referenceTarget,
  onEnterTrajectoryMode,
  canRecordTake,
  onPossessTarget,
}: {
  state: Scene3DState
  trajectory: Scene3DTrajectoryEditing
  readOnly: boolean
  tab: Scene3DMoveHubTab
  onTabChange: (tab: Scene3DMoveHubTab) => void
  selectedCamera: Scene3DCamera | undefined
  onPickCamera: (cameraId: string) => void
  onApplyCameraMove: (cameraId: string, spec: CameraMovePresetSpec) => void
  onExportCameraMoveFrames: (cameraId: string) => void
  referenceTarget?: Scene3DReferenceTargetSummary
  onEnterTrajectoryMode: () => void
  /** onRecordTake 可用性（样张/只读环境没有录 take） */
  canRecordTake: boolean
  onPossessTarget: (target: { kind: 'mannequin' | 'camera'; id: string }) => void
}): JSX.Element {
  const { t } = useTranslation()
  const mannequins = state.objects.filter((object) => object.type === 'mannequin')
  const moveReady = isCameraMoveReady(state)
  // 录 take 目标：默认选中的相机 > 第一个假人 > 第一个相机
  const [takeTargetId, setTakeTargetId] = React.useState<string>('')
  const takeTargets = [
    ...mannequins.map((object) => ({
      kind: 'mannequin' as const,
      id: object.id,
      label: t('scene3d.moveHub.mannequinLabel', { name: object.name }),
    })),
    ...state.cameras.map((camera) => ({
      kind: 'camera' as const,
      id: camera.id,
      label: t('scene3d.moveHub.cameraLabel', { name: camera.name }),
    })),
  ]
  const effectiveTakeTarget = takeTargets.find((target) => target.id === takeTargetId)
    ?? takeTargets.find((target) => target.id === selectedCamera?.id)
    ?? takeTargets[0]

  return (
    <div className="flex min-h-0 shrink-0 flex-col gap-2 border-t border-[var(--workbench-border)] p-3" data-coach="camera-move-panel">
      <div className="flex items-center gap-2">
        <span className="text-caption font-medium text-[var(--nomi-ink)]">{t('scene3d.moveHub.title')}</span>
        {moveReady ? (
          <span className="text-micro text-[var(--nomi-ink-60)]">{t('scene3d.moveHub.ready')}</span>
        ) : (
          <span className="text-micro text-[var(--nomi-ink-40)]">{t('scene3d.moveHub.chooseOne')}</span>
        )}
      </div>
      <div className="flex items-center gap-1 rounded-nomi border border-[var(--nomi-line-soft)] bg-[var(--nomi-paper)] p-0.5">
        <PanelButton title={t('scene3d.moveHub.presetTitle')} active={tab === 'preset'} onClick={() => onTabChange('preset')}>
          <IconVideo size={14} />
          <span>{t('scene3d.moveHub.preset')}</span>
        </PanelButton>
        <PanelButton title={t('scene3d.moveHub.trajectoryTitle')} active={tab === 'trajectory'} onClick={() => onTabChange('trajectory')}>
          <IconRoute size={14} />
          <span>{t('scene3d.moveHub.trajectory')}</span>
        </PanelButton>
        <PanelButton title={t('scene3d.moveHub.takeTitle')} active={tab === 'take'} onClick={() => onTabChange('take')}>
          <IconPlayerRecord size={14} />
          <span>{t('scene3d.moveHub.take')}</span>
        </PanelButton>
      </div>
      <div className="min-h-0 overflow-y-auto">
        {tab === 'preset' ? (
          selectedCamera ? (
            <CameraMovePanel
              readOnly={readOnly}
              onApply={(spec) => onApplyCameraMove(selectedCamera.id, spec)}
              onExportFrames={() => onExportCameraMoveFrames(selectedCamera.id)}
              referenceTarget={referenceTarget}
            />
          ) : (
            <div className="grid gap-2 rounded-nomi border border-dashed border-[var(--nomi-line-soft)] p-3 text-caption text-[var(--nomi-ink-60)]">
              <span>{t('scene3d.moveHub.presetRequiresCamera')}</span>
              {state.cameras[0] && !readOnly ? (
                <button
                  type="button"
                  className="h-8 rounded-nomi-sm border border-[var(--nomi-line-soft)] bg-[var(--nomi-ink-05)] px-2 text-caption text-[var(--nomi-ink)] hover:bg-[var(--nomi-ink-10)]"
                  onClick={() => onPickCamera(state.cameras[0].id)}
                >
                  {t('scene3d.moveHub.selectCamera', { camera: state.cameras[0].name })}
                </button>
              ) : null}
            </div>
          )
        ) : null}
        {tab === 'trajectory' ? (
          <div className="grid gap-2">
            {!readOnly ? (
              <button
                type="button"
                className="h-8 rounded-nomi-sm border border-[var(--nomi-line-soft)] bg-[var(--nomi-ink-05)] px-2 text-caption text-[var(--nomi-ink)] hover:bg-[var(--nomi-ink-10)]"
                title={t('scene3d.moveHub.enterTrajectoryTitle')}
                onClick={onEnterTrajectoryMode}
              >
                {t('scene3d.moveHub.enterTrajectory')}
              </button>
            ) : null}
            <TrajectoryPanel
              state={state}
              activeTrajectoryId={trajectory.activeTrajectoryId}
              activePointId={trajectory.activePointId}
              readOnly={readOnly}
              onAddTrajectory={() => {
                trajectory.setTimelineOpen(true)
                trajectory.createTrajectory()
              }}
              onSelectTrajectory={(trajectoryId) => {
                trajectory.selectTrajectory(trajectoryId)
                trajectory.setTrajectoryEditMode(true)
              }}
              onDeleteTrajectory={trajectory.deleteTrajectory}
              onPatchTrajectory={trajectory.patchTrajectory}
              onAddPoint={trajectory.addPoint}
              onSelectPoint={trajectory.selectPoint}
              onUpdatePoint={trajectory.updatePoint}
              onDeletePoint={trajectory.deletePoint}
              onBindObject={trajectory.bindObject}
              onPatchBinding={trajectory.patchBinding}
              onPatchBoundObject={trajectory.patchBoundObject}
              onUnbindObject={trajectory.unbindObject}
              onDeleteBinding={trajectory.deleteBinding}
            />
          </div>
        ) : null}
        {tab === 'take' ? (
          <div className="grid gap-2 rounded-nomi border border-[var(--nomi-line-soft)] bg-[var(--nomi-paper)] p-2 text-caption text-[var(--nomi-ink-60)]">
            <span>{t('scene3d.moveHub.takeDescription')}</span>
            {canRecordTake && !readOnly ? (
              <>
                <label className="grid gap-1">
                  <span className="text-micro text-[var(--nomi-ink-60)]">{t('scene3d.moveHub.target')}</span>
                  <select
                    className="h-8 rounded-nomi-sm border border-[var(--nomi-line)] bg-[var(--nomi-paper)] px-2 text-caption text-[var(--nomi-ink)] outline-none"
                    value={effectiveTakeTarget?.id ?? ''}
                    onChange={(event) => setTakeTargetId(event.currentTarget.value)}
                  >
                    {takeTargets.map((target) => (
                      <option key={target.id} value={target.id}>{target.label}</option>
                    ))}
                  </select>
                </label>
                <button
                  type="button"
                  disabled={!effectiveTakeTarget}
                  className="inline-flex h-8 items-center justify-center gap-1.5 rounded-nomi-sm bg-[var(--nomi-ink)] px-2 text-caption font-medium text-[var(--nomi-paper)] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                  title={t('scene3d.moveHub.enterControlTitle')}
                  onClick={() => {
                    if (!effectiveTakeTarget) return
                    onPossessTarget({ kind: effectiveTakeTarget.kind, id: effectiveTakeTarget.id })
                  }}
                >
                  <IconManFilled size={14} />
                  {t('scene3d.moveHub.enterControl')}
                </button>
              </>
            ) : (
              <span className="text-micro text-[var(--nomi-ink-40)]">{t('scene3d.moveHub.takeUnsupported')}</span>
            )}
          </div>
        ) : null}
      </div>
    </div>
  )
}
