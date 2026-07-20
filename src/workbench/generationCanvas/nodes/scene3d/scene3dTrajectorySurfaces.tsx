import React from 'react'
import { useTranslation } from 'react-i18next'
import { IconCamera, IconRoute, IconSettings } from '@tabler/icons-react'
import { toast } from '../../../../ui/toast'
import type { Scene3DCamera, Scene3DObject, Scene3DSelection, Scene3DState } from './scene3dTypes'
import type { Scene3DTrajectoryEditing } from './useScene3DTrajectoryEditing'
import type { CameraMovePresetSpec } from './cameraMovePreset'
import { PanelButton } from './scene3dToolbar'
import { PropertyPanel } from './scene3dInspector'
import { TrajectoryPanel } from './trajectory/TrajectoryPanel'
import { TrajectoryTimeline } from './trajectory/TrajectoryTimeline'
import { TrajectoryPlayback } from './trajectory/TrajectoryPlayback'
import type { Scene3DReferenceTargetSummary } from './scene3dReferenceDirector'

export type Scene3DRightPanelTab = 'properties' | 'trajectory'

/** In-<Canvas> trajectory path + control points + live playback driver. */
export function Scene3DTrajectoryLayer({
  state,
  trajectory,
  activeTrajectoryIds,
}: {
  state: Scene3DState
  trajectory: Scene3DTrajectoryEditing
  activeTrajectoryIds: ReadonlySet<string> | null
}): JSX.Element {
  return (
    <>
      {trajectory.timelineOpen ? (
        <TrajectoryPlayback
          bindings={state.trajectoryBindings}
          isPlaying={trajectory.isPlaying}
          setIsPlaying={trajectory.setIsPlaying}
          playheadRef={trajectory.playheadRef}
          activeTrajectoryIds={activeTrajectoryIds}
        />
      ) : null}
    </>
  )
}

/** Top-center pill shown while adjusting a camera's framing. */
export function Scene3DCameraViewBanner({
  cameraName,
  onExit,
}: {
  cameraName: string
  onExit: () => void
}): JSX.Element {
  const { t } = useTranslation()
  return (
    <div className="pointer-events-auto absolute left-1/2 top-4 z-[3] flex -translate-x-1/2 items-center gap-2 rounded-nomi border border-[var(--nomi-line-soft)] bg-[var(--nomi-paper)] px-3 py-2 text-caption text-[var(--nomi-ink)] shadow-[var(--nomi-shadow-md)]">
      <IconCamera size={15} className="text-[var(--nomi-ink-60)]" />
      <span className="max-w-[220px] truncate">
        {t('scene3d.cameraPreview.adjustingNamed', { camera: cameraName })}
      </span>
      <button
        className="rounded-nomi-sm bg-[var(--nomi-ink-05)] px-2 py-1 text-micro text-[var(--nomi-ink-60)] hover:bg-[var(--nomi-ink-10)] hover:text-[var(--nomi-ink)]"
        type="button"
        onClick={onExit}
      >
        {t('scene3d.cameraPreview.exit')}
      </button>
    </div>
  )
}

/** Top-center pill that toggles trajectory edit mode (mirrors camera-view edit). */
export function Scene3DTrajectoryEditBanner({
  trajectory,
  onEnterEdit,
}: {
  trajectory: Scene3DTrajectoryEditing
  onEnterEdit: () => void
}): JSX.Element {
  const { t } = useTranslation()
  return (
    <div className="pointer-events-auto absolute left-1/2 top-4 z-[3] flex -translate-x-1/2 items-center gap-2 rounded-nomi border border-[var(--nomi-line-soft)] bg-[var(--nomi-paper)] px-3 py-2 text-caption text-[var(--nomi-ink)] shadow-[var(--nomi-shadow-md)]">
      <IconRoute size={15} className="text-[var(--nomi-ink-60)]" />
      <span>
        {trajectory.trajectoryEditMode ? t('scene3d.trajectory.editingHint') : t('scene3d.trajectory.viewing')}
      </span>
      <button
        className="rounded-nomi-sm bg-[var(--nomi-ink-05)] px-2 py-1 text-micro text-[var(--nomi-ink-60)] hover:bg-[var(--nomi-ink-10)] hover:text-[var(--nomi-ink)]"
        type="button"
        onClick={() => {
          const next = !trajectory.trajectoryEditMode
          trajectory.setTrajectoryEditMode(next)
          if (next) onEnterEdit()
        }}
      >
        {trajectory.trajectoryEditMode ? t('scene3d.trajectory.exitEdit') : t('scene3d.trajectory.enterEdit')}
      </button>
    </div>
  )
}

/** Right inspector body: Properties / Trajectory tab switcher + active tab content. */
export function Scene3DRightPanelBody({
  state,
  trajectory,
  selection,
  readOnly,
  tab,
  onTabChange,
  onObjectPatch,
  onCameraPatch,
  onEnvironmentPatch,
  onApplyCameraMove,
  onExportCameraMoveFrames,
  referenceTarget,
}: {
  state: Scene3DState
  trajectory: Scene3DTrajectoryEditing
  selection: Scene3DSelection
  readOnly: boolean
  tab: Scene3DRightPanelTab
  onTabChange: (tab: Scene3DRightPanelTab) => void
  onObjectPatch: (id: string, patch: Partial<Scene3DObject>) => void
  onCameraPatch: (id: string, patch: Partial<Scene3DCamera>) => void
  onEnvironmentPatch: (patch: Partial<Scene3DState['environment']>) => void
  onApplyCameraMove: (cameraId: string, spec: CameraMovePresetSpec) => void
  onExportCameraMoveFrames: (cameraId: string) => void
  referenceTarget?: Scene3DReferenceTargetSummary
}): JSX.Element {
  const { t } = useTranslation()
  return (
    <>
      <div className="flex shrink-0 items-center gap-1 border-b border-[var(--workbench-border)] bg-[var(--workbench-surface-solid)] px-2 py-2">
        <PanelButton
          title={t('scene3d.inspector.properties')}
          active={tab === 'properties'}
          onClick={() => onTabChange('properties')}
        >
          <IconSettings size={14} />
          <span>{t('scene3d.inspector.properties')}</span>
        </PanelButton>
        <PanelButton
          title={t('scene3d.toolbar.trajectory')}
          active={tab === 'trajectory'}
          onClick={() => onTabChange('trajectory')}
        >
          <IconRoute size={14} />
          <span>{t('scene3d.toolbar.trajectory')}</span>
        </PanelButton>
      </div>
      {tab === 'trajectory' ? (
        <Scene3DTrajectoryInspector state={state} trajectory={trajectory} readOnly={readOnly} />
      ) : (
        <PropertyPanel
          state={state}
          selection={selection}
          readOnly={readOnly}
          onObjectPatch={onObjectPatch}
          onCameraPatch={onCameraPatch}
          onEnvironmentPatch={onEnvironmentPatch}
          onApplyCameraMove={onApplyCameraMove}
          onExportCameraMoveFrames={onExportCameraMoveFrames}
          referenceTarget={referenceTarget}
        />
      )}
    </>
  )
}

/** Right-inspector trajectory tab body (add/select/patch trajectory + bindings). */
export function Scene3DTrajectoryInspector({
  state,
  trajectory,
  readOnly,
}: {
  state: Scene3DState
  trajectory: Scene3DTrajectoryEditing
  readOnly: boolean
}): JSX.Element {
  return (
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
  )
}

/** Bottom-anchored trajectory timeline (play/pause/scrub + binding strips). */
export function Scene3DTrajectoryTimelineBar({
  trajectory,
  readOnly,
}: {
  trajectory: Scene3DTrajectoryEditing
  readOnly: boolean
}): JSX.Element {
  const { t } = useTranslation()
  return (
    <TrajectoryTimeline
      visible={trajectory.timelineOpen}
      isPlaying={trajectory.isPlaying}
      readOnly={readOnly}
      activeGroupId={trajectory.activeGroupId}
      playheadRef={trajectory.playheadRef}
      onPlayChange={(playing) => {
        if (playing && !trajectory.hasPlayableBinding) {
          toast(t('scene3d.trajectory.bindTargetFirst'), 'warning')
          return
        }
        trajectory.setIsPlaying(playing)
      }}
      onSelectGroup={trajectory.selectGroup}
      onSelectTrajectory={trajectory.selectTrajectory}
      onClose={() => {
        trajectory.setIsPlaying(false)
        trajectory.setTimelineOpen(false)
      }}
      onAddGroup={trajectory.addGroup}
      onRenameGroup={trajectory.renameGroup}
      onPatchBinding={trajectory.patchBinding}
      onPatchTrajectoryPoint={trajectory.patchTrajectoryPoint}
    />
  )
}
