import React from 'react'
import { Line } from '@react-three/drei'
import * as THREE from 'three'
import type { Scene3DTrajectory, Scene3DVector3 } from '../scene3dTypes'
import {
  ENDPOINT_ADD_HIDE_DELAY_MS,
  type TrajectoryContextMenuState,
  type TrajectoryCreateMenuState,
  type TrajectoryPointBindMenuState,
  isTrajectoryEndpoint,
  type TrajectoryRendererProps,
  useTrajectoryWholeDrag,
  vectorFromScene,
  vectorToScene,
} from './trajectoryRendererShared'
import {
  TrajectoryContextMenu,
  TrajectoryCreateMenu,
  TrajectoryEditPlane,
  TrajectoryHitTube,
  TrajectoryPointBindMenu,
} from './TrajectoryRendererMenus'
import {
  TrajectoryControlPoint,
  TrajectoryCurveControlHandle,
  TrajectoryEndpointAddButton,
} from './TrajectoryRendererControls'
import {
  buildTrajectoryCurve,
  trajectoryInsertIndex,
  trajectoryLinePoints,
  trajectorySegmentCount,
} from './trajectoryUtils'

function nearestCurvePoint(
  curve: THREE.Curve<THREE.Vector3>,
  point: THREE.Vector3,
): THREE.Vector3 {
  const samples = curve.getSpacedPoints(160)
  let nearest = samples[0] ?? point
  let nearestDistanceSq = Number.POSITIVE_INFINITY
  samples.forEach((sample) => {
    const distanceSq = sample.distanceToSquared(point)
    if (distanceSq < nearestDistanceSq) {
      nearest = sample
      nearestDistanceSq = distanceSq
    }
  })
  return nearest.clone()
}

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

  const insertPointAtHit = React.useCallback(
    (hitPoint: THREE.Vector3) => {
      if (!editable || !onInsertPoint) return
      const curve = buildTrajectoryCurve(trajectory)
      if (!curve) return
      const insertIndex = trajectoryInsertIndex(trajectory, curve, hitPoint)
      const targetIndex = insertIndex <= 0
        ? 0
        : Math.min(insertIndex - 1, trajectory.points.length - 1)
      const targetPoint = trajectory.points[targetIndex]
      const placement = insertIndex <= 0 ? 'before' : 'after'
      const insertPosition = vectorToScene(nearestCurvePoint(curve, hitPoint))
      onSelectTrajectory?.(trajectory.id)
      onInsertPoint(trajectory.id, insertPosition, targetPoint?.id ?? null, placement)
    },
    [editable, onInsertPoint, onSelectTrajectory, trajectory],
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
              onContextMenu?.(trajectory.id, vectorToScene(event.point))
            }}
            onDoubleClick={(event) => {
              event.stopPropagation()
              insertPointAtHit(event.point)
            }}
          />
          {!editable || wholeDraggable ? (
            <TrajectoryHitTube
              trajectory={trajectory}
              onWholePointerDown={wholeDraggable ? handleWholePointerDown : undefined}
              onContextMenu={onContextMenu}
              onInsertPointAt={editable ? insertPointAtHit : undefined}
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
  const [contextMenu, setContextMenu] = React.useState<TrajectoryContextMenuState | null>(null)
  const [createMenu, setCreateMenu] = React.useState<TrajectoryCreateMenuState | null>(null)
  const [pointBindMenu, setPointBindMenu] = React.useState<TrajectoryPointBindMenuState | null>(null)

  const createTrajectoryFromBlank = React.useCallback(
    (position: Scene3DVector3) => {
      onCreateTrajectoryAt?.(position)
    },
    [onCreateTrajectoryAt],
  )

  const createMenuEnabled = Boolean(editable && onCreateTrajectoryAt)
  const contextMenuEnabled = Boolean(
    (wholeDraggable || editable) && (onEditTrajectory || onDeleteTrajectory || (editable && onInsertPoint)),
  )
  const pointBindMenuEnabled = Boolean(editable && onBindTargetToTrajectory)

  const openCreateMenu = React.useCallback(
    (position: Scene3DVector3) => {
      if (!createMenuEnabled) return
      setCreateMenu({ position })
      setContextMenu(null)
      setPointBindMenu(null)
    },
    [createMenuEnabled],
  )

  const openContextMenu = React.useCallback(
    (trajectoryId: string, position: Scene3DVector3) => {
      if (!contextMenuEnabled) return
      onSelectTrajectory?.(trajectoryId)
      setContextMenu({ trajectoryId, position })
      setCreateMenu(null)
      setPointBindMenu(null)
    },
    [contextMenuEnabled, onSelectTrajectory],
  )

  const openPointBindMenu = React.useCallback(
    (trajectoryId: string, pointId: string, position: Scene3DVector3) => {
      if (!pointBindMenuEnabled) return
      onSelectTrajectory?.(trajectoryId)
      onSelectPoint?.(trajectoryId, pointId)
      setPointBindMenu({ trajectoryId, pointId, position })
      setCreateMenu(null)
      setContextMenu(null)
    },
    [onSelectPoint, onSelectTrajectory, pointBindMenuEnabled],
  )

  const insertPointFromContextMenu = React.useCallback(
    (trajectoryId: string, position: Scene3DVector3) => {
      if (!editable || !onInsertPoint) return
      const trajectory = trajectories.find((item) => item.id === trajectoryId)
      if (!trajectory) return
      const curve = buildTrajectoryCurve(trajectory)
      if (!curve) return
      const hitPoint = vectorFromScene(position)
      const insertIndex = trajectoryInsertIndex(trajectory, curve, hitPoint)
      const targetIndex = insertIndex <= 0
        ? 0
        : Math.min(insertIndex - 1, trajectory.points.length - 1)
      const targetPoint = trajectory.points[targetIndex]
      const placement = insertIndex <= 0 ? 'before' : 'after'
      onSelectTrajectory?.(trajectory.id)
      onInsertPoint(
        trajectory.id,
        vectorToScene(nearestCurvePoint(curve, hitPoint)),
        targetPoint?.id ?? null,
        placement,
      )
    },
    [editable, onInsertPoint, onSelectTrajectory, trajectories],
  )

  React.useEffect(() => {
    if (
      contextMenu &&
      (!contextMenuEnabled ||
        !trajectories.some((trajectory) => trajectory.id === contextMenu.trajectoryId))
    ) {
      setContextMenu(null)
    }
  }, [contextMenu, contextMenuEnabled, trajectories])

  React.useEffect(() => {
    if (createMenu && !createMenuEnabled) {
      setCreateMenu(null)
    }
  }, [createMenu, createMenuEnabled])

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
      {editable ? (
        <TrajectoryEditPlane
          onCreateTrajectory={createTrajectoryFromBlank}
          onOpenCreateMenu={createMenuEnabled ? openCreateMenu : undefined}
        />
      ) : null}
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
      {contextMenuEnabled ? (
        <TrajectoryContextMenu
          menu={contextMenu}
          onClose={() => setContextMenu(null)}
          onInsertPoint={editable && onInsertPoint ? insertPointFromContextMenu : undefined}
          onEditTrajectory={onEditTrajectory}
          onDeleteTrajectory={onDeleteTrajectory}
        />
      ) : null}
      {createMenuEnabled ? (
        <TrajectoryCreateMenu
          menu={createMenu}
          onClose={() => setCreateMenu(null)}
          onCreateTrajectory={createTrajectoryFromBlank}
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
