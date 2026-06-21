import React from 'react'
import { Line } from '@react-three/drei'
import type { Scene3DTrajectory, Scene3DVector3 } from '../scene3dTypes'
import {
  ENDPOINT_ADD_HIDE_DELAY_MS,
  isTrajectoryEndpoint,
  type TrajectoryRendererProps,
  useTrajectoryWholeDrag,
} from './trajectoryRendererShared'
import {
  TrajectoryContextMenu,
  TrajectoryEditPlane,
  TrajectoryHitTube,
  TrajectoryPointBindMenu,
} from './TrajectoryRendererMenus'
import {
  TrajectoryControlPoint,
  TrajectoryCurveControlHandle,
  TrajectoryEndpointAddButton,
} from './TrajectoryRendererControls'
import { trajectoryLinePoints, trajectorySegmentCount } from './trajectoryUtils'

function TrajectoryLineView({
  trajectory,
  active,
  activePointId,
  editable,
  wholeDraggable,
  onSelectTrajectory,
  onSelectPoint,
  onInsertPoint,
  onUpdateCurveControl,
  onUpdatePoint,
  onTranslateTrajectory,
  onContextMenu,
  onPointContextMenu,
}: {
  trajectory: Scene3DTrajectory
  active: boolean
  activePointId?: string | null
  editable: boolean
  wholeDraggable?: boolean
  onSelectTrajectory?: (trajectoryId: string) => void
  onSelectPoint?: (trajectoryId: string, pointId: string) => void
  onInsertPoint?: (
    trajectoryId: string,
    position: Scene3DVector3,
    targetPointId?: string | null,
    placement?: 'before' | 'after',
  ) => void
  onUpdateCurveControl?: (
    trajectoryId: string,
    segmentStartPointId: string,
    position: Scene3DVector3 | null,
  ) => void
  onUpdatePoint?: (trajectoryId: string, pointId: string, position: Scene3DVector3) => void
  onTranslateTrajectory?: (trajectoryId: string, delta: Scene3DVector3) => void
  onContextMenu?: (trajectoryId: string, position: Scene3DVector3) => void
  onPointContextMenu?: (trajectoryId: string, pointId: string, position: Scene3DVector3) => void
}): JSX.Element {
  const points = React.useMemo(() => trajectoryLinePoints(trajectory), [trajectory])
  const segmentCount = trajectorySegmentCount(trajectory)
  const lineColor = active ? '#facc15' : trajectory.color
  const handleWholePointerDown = useTrajectoryWholeDrag({
    enabled: Boolean(wholeDraggable),
    trajectoryId: trajectory.id,
    onSelectTrajectory,
    onTranslateTrajectory,
  })
  const [hoveredEndpointId, setHoveredEndpointId] = React.useState<string | null>(null)
  const hideEndpointTimerRef = React.useRef<number | null>(null)

  const clearHideEndpointTimer = React.useCallback(() => {
    if (hideEndpointTimerRef.current === null) return
    window.clearTimeout(hideEndpointTimerRef.current)
    hideEndpointTimerRef.current = null
  }, [])

  const showEndpointButton = React.useCallback(
    (pointId: string) => {
      clearHideEndpointTimer()
      setHoveredEndpointId(pointId)
    },
    [clearHideEndpointTimer],
  )

  const requestHideEndpointButton = React.useCallback(() => {
    clearHideEndpointTimer()
    hideEndpointTimerRef.current = window.setTimeout(() => {
      setHoveredEndpointId(null)
      hideEndpointTimerRef.current = null
    }, ENDPOINT_ADD_HIDE_DELAY_MS)
  }, [clearHideEndpointTimer])

  React.useEffect(
    () => () => {
      clearHideEndpointTimer()
    },
    [clearHideEndpointTimer],
  )

  return (
    <>
      {points.length >= 2 ? (
        <>
          <Line
            points={points}
            color={lineColor}
            lineWidth={active ? 3 : 2}
            transparent
            opacity={active ? 1 : 0.82}
            depthTest={false}
            renderOrder={1}
            onClick={(event) => {
              event.stopPropagation()
              onSelectTrajectory?.(trajectory.id)
            }}
            onPointerDown={wholeDraggable ? handleWholePointerDown : undefined}
            onContextMenu={(event) => {
              event.stopPropagation()
              event.nativeEvent.preventDefault()
              onContextMenu?.(trajectory.id, [
                Number(event.point.x.toFixed(4)),
                Number(event.point.y.toFixed(4)),
                Number(event.point.z.toFixed(4)),
              ])
            }}
          />
          {!editable || wholeDraggable ? (
            <TrajectoryHitTube
              trajectory={trajectory}
              onWholePointerDown={wholeDraggable ? handleWholePointerDown : undefined}
              onContextMenu={onContextMenu}
              onSelectTrajectory={onSelectTrajectory}
            />
          ) : null}
        </>
      ) : null}
      {editable && active
        ? Array.from({ length: segmentCount }, (_, segmentIndex) => (
            <TrajectoryCurveControlHandle
              key={`${trajectory.id}:curve-control:${segmentIndex}`}
              trajectory={trajectory}
              segmentIndex={segmentIndex}
              visible={editable && active}
              onSelectTrajectory={onSelectTrajectory}
              onUpdateCurveControl={onUpdateCurveControl}
            />
          ))
        : null}
      {editable || wholeDraggable
        ? trajectory.points.map((point, pointIndex) => {
            const endpoint = editable && isTrajectoryEndpoint(trajectory, pointIndex)
            return (
              <React.Fragment key={point.id}>
                <TrajectoryControlPoint
                  trajectory={trajectory}
                  activePointId={activePointId}
                  point={point}
                  active={active}
                  editable={editable}
                  onPointerHover={endpoint ? () => showEndpointButton(point.id) : undefined}
                  onPointerUnhover={endpoint ? requestHideEndpointButton : undefined}
                  onSelectTrajectory={onSelectTrajectory}
                  onSelectPoint={editable ? onSelectPoint : undefined}
                  onWholePointerDown={wholeDraggable ? handleWholePointerDown : undefined}
                  onContextMenu={onContextMenu}
                  onPointContextMenu={onPointContextMenu}
                  onUpdatePoint={onUpdatePoint}
                />
                <TrajectoryEndpointAddButton
                  trajectory={trajectory}
                  pointIndex={pointIndex}
                  visible={endpoint && hoveredEndpointId === point.id}
                  onKeepVisible={() => showEndpointButton(point.id)}
                  onRequestHide={requestHideEndpointButton}
                  onSelectTrajectory={onSelectTrajectory}
                  onSelectPoint={onSelectPoint}
                  onInsertPoint={onInsertPoint}
                />
              </React.Fragment>
            )
          })
        : null}
    </>
  )
}

export function TrajectoryRenderer({
  trajectories,
  activeTrajectoryId,
  activePointId,
  editable,
  wholeDraggable,
  onSelectTrajectory,
  onSelectPoint,
  onCreateTrajectoryAt,
  onInsertPoint,
  onUpdateCurveControl,
  onUpdatePoint,
  onTranslateTrajectory,
  onEditTrajectory,
  onDeleteTrajectory,
  bindTargets = [],
  onBindTargetToTrajectory,
}: TrajectoryRendererProps): JSX.Element | null {
  const [contextMenu, setContextMenu] = React.useState<{
    trajectoryId: string
    position: Scene3DVector3
  } | null>(null)
  const [pointBindMenu, setPointBindMenu] = React.useState<{
    trajectoryId: string
    pointId: string
    position: Scene3DVector3
  } | null>(null)

  const createTrajectoryFromBlank = React.useCallback(
    (position: Scene3DVector3) => {
      onCreateTrajectoryAt?.(position)
    },
    [onCreateTrajectoryAt],
  )

  const contextMenuEnabled = Boolean(wholeDraggable && (onEditTrajectory || onDeleteTrajectory))
  const pointBindMenuEnabled = Boolean(editable && onBindTargetToTrajectory)

  const openContextMenu = React.useCallback(
    (trajectoryId: string, position: Scene3DVector3) => {
      if (!contextMenuEnabled) return
      onSelectTrajectory?.(trajectoryId)
      setContextMenu({ trajectoryId, position })
    },
    [contextMenuEnabled, onSelectTrajectory],
  )

  const openPointBindMenu = React.useCallback(
    (trajectoryId: string, pointId: string, position: Scene3DVector3) => {
      if (!pointBindMenuEnabled) return
      onSelectTrajectory?.(trajectoryId)
      onSelectPoint?.(trajectoryId, pointId)
      setPointBindMenu({ trajectoryId, pointId, position })
    },
    [onSelectPoint, onSelectTrajectory, pointBindMenuEnabled],
  )

  React.useEffect(() => {
    if (
      contextMenu &&
      (editable || !trajectories.some((trajectory) => trajectory.id === contextMenu.trajectoryId))
    ) {
      setContextMenu(null)
    }
  }, [contextMenu, editable, trajectories])

  React.useEffect(() => {
    if (
      pointBindMenu &&
      (!editable ||
        !trajectories.some(
          (trajectory) =>
            trajectory.id === pointBindMenu.trajectoryId &&
            trajectory.points.some((point) => point.id === pointBindMenu.pointId),
        ))
    ) {
      setPointBindMenu(null)
    }
  }, [editable, pointBindMenu, trajectories])

  return (
    <group>
      {editable ? <TrajectoryEditPlane onCreateTrajectory={createTrajectoryFromBlank} /> : null}
      {trajectories.map((trajectory) => (
        <TrajectoryLineView
          key={trajectory.id}
          trajectory={trajectory}
          active={trajectory.id === activeTrajectoryId}
          activePointId={activePointId}
          editable={editable}
          wholeDraggable={wholeDraggable}
          onSelectTrajectory={onSelectTrajectory}
          onSelectPoint={onSelectPoint}
          onInsertPoint={onInsertPoint}
          onUpdateCurveControl={onUpdateCurveControl}
          onUpdatePoint={onUpdatePoint}
          onTranslateTrajectory={onTranslateTrajectory}
          onContextMenu={contextMenuEnabled ? openContextMenu : undefined}
          onPointContextMenu={pointBindMenuEnabled ? openPointBindMenu : undefined}
        />
      ))}
      {!editable && contextMenuEnabled ? (
        <TrajectoryContextMenu
          menu={contextMenu}
          onClose={() => setContextMenu(null)}
          onEditTrajectory={onEditTrajectory}
          onDeleteTrajectory={onDeleteTrajectory}
        />
      ) : null}
      {editable && pointBindMenuEnabled ? (
        <TrajectoryPointBindMenu
          menu={pointBindMenu}
          targets={bindTargets}
          onClose={() => setPointBindMenu(null)}
          onBindTarget={onBindTargetToTrajectory}
        />
      ) : null}
    </group>
  )
}
