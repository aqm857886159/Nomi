import React from 'react'
import { useTranslation } from 'react-i18next'
import { IconCamera, IconRoute } from '@tabler/icons-react'
import type { Scene3DCamera, Scene3DObject, Scene3DSelection, Scene3DState } from './scene3dTypes'
import type { Scene3DTrajectoryEditing } from './useScene3DTrajectoryEditing'
import type { CameraMovePresetSpec } from './cameraMovePreset'
import { PropertyPanel } from './scene3dInspector'
import { TrajectoryTimeline } from './trajectory/TrajectoryTimeline'
import { TrajectoryPlayback } from './trajectory/TrajectoryPlayback'
import { Scene3DMoveHub, type Scene3DMoveHubTab } from './scene3dMoveHub'
import type { Scene3DReferenceTargetSummary } from './scene3dReferenceDirector'

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
// 右栏 = 属性（上，随选中滚动）+ 整运镜常驻分区（下）。原「属性/轨迹」两 tab 已删：
// 轨迹不是与属性平级的另一类东西，它是整运镜的三种方式之一（IA 重排一期，加新删旧 P1）。
export function Scene3DRightPanelBody({
  state,
  trajectory,
  selection,
  readOnly,
  hubTab,
  onHubTabChange,
  onObjectPatch,
  onCameraPatch,
  onEnvironmentPatch,
  onApplyCameraMove,
  onExportCameraMoveFrames,
  referenceTarget,
  onPickCamera,
  onEnterTrajectoryMode,
  canRecordTake,
  onPossessTarget,
}: {
  state: Scene3DState
  trajectory: Scene3DTrajectoryEditing
  selection: Scene3DSelection
  readOnly: boolean
  hubTab: Scene3DMoveHubTab
  onHubTabChange: (tab: Scene3DMoveHubTab) => void
  onObjectPatch: (id: string, patch: Partial<Scene3DObject>) => void
  onCameraPatch: (id: string, patch: Partial<Scene3DCamera>) => void
  onEnvironmentPatch: (patch: Partial<Scene3DState['environment']>) => void
  onApplyCameraMove: (cameraId: string, spec: CameraMovePresetSpec) => void
  onExportCameraMoveFrames: (cameraId: string) => void
  referenceTarget?: Scene3DReferenceTargetSummary
  onPickCamera: (cameraId: string) => void
  onEnterTrajectoryMode: () => void
  canRecordTake: boolean
  onPossessTarget: (target: { kind: 'mannequin' | 'camera'; id: string }) => void
}): JSX.Element {
  const selectedCamera = selection?.type === 'camera'
    ? state.cameras.find((camera) => camera.id === selection.id)
    : undefined
  return (
    <>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <PropertyPanel
          state={state}
          selection={selection}
          readOnly={readOnly}
          onObjectPatch={onObjectPatch}
          onCameraPatch={onCameraPatch}
          onEnvironmentPatch={onEnvironmentPatch}
        />
      </div>
      <Scene3DMoveHub
        state={state}
        trajectory={trajectory}
        readOnly={readOnly}
        tab={hubTab}
        onTabChange={onHubTabChange}
        selectedCamera={selectedCamera}
        onPickCamera={onPickCamera}
        onApplyCameraMove={onApplyCameraMove}
        onExportCameraMoveFrames={onExportCameraMoveFrames}
        referenceTarget={referenceTarget}
        onEnterTrajectoryMode={onEnterTrajectoryMode}
        canRecordTake={canRecordTake}
        onPossessTarget={onPossessTarget}
      />
    </>
  )
}

/** Bottom-anchored trajectory timeline (play/pause/scrub + binding strips). */
export function Scene3DTrajectoryTimelineBar({
  trajectory,
  readOnly,
  onRequestPlayChange,
}: {
  trajectory: Scene3DTrajectoryEditing
  readOnly: boolean
  /** 播放门（含未绑定的可跳转报错）单源在 useScene3DTrajectoryModeActions，这里不再各写一份 */
  onRequestPlayChange: (playing: boolean) => void
}): JSX.Element {
  return (
    <TrajectoryTimeline
      visible={trajectory.timelineOpen}
      isPlaying={trajectory.isPlaying}
      readOnly={readOnly}
      activeGroupId={trajectory.activeGroupId}
      playheadRef={trajectory.playheadRef}
      onPlayChange={onRequestPlayChange}
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
