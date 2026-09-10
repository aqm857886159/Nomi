/**
 * [INPUT]: 依赖 react、three、@react-three/fiber 的 useFrame、../DirectorEditorContext 的 useDirectorStore、../model/clips 的 waypointsOfClip、
 *          ../model/directorTypes（TimelineEntity / TrajectoryClip / Waypoint）、../model/trajectoryEval 的 sampleWaypoints、../model/vec3 的 DEG_TO_RAD、
 *          ./creation/usePathDraw 的 PathDrawGhostState、./sceneRefs（tagEditorOnly / DIRECTOR_WAYPOINT_KEY / WaypointTag）、./sceneTheme 的 TRAJECTORY_COLORS
 *          ../model/sceneObjectGraph 的完整父组矩阵：持久路径跟随父组，绘制/录制幽灵线保持世界空间
 * [OUTPUT]: 对外提供 TrajectoryVisuals：每个有路标的实体的路径曲线 + 可点选路标小球（挂在图层变换组下），画笔 / 逐点的实时预览与录制运镜的临时线（世界空间）
 * [POS]: director/scene 的路径可视化：曲线用与求值同一个 sampleWaypoints 采样，所见即所动；全部 editor-only（截图不带、描边不算）；
 *        路标小球带 userData 标记，点选由 useViewportPicking 统一处理。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import React from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import { useDirectorStore } from '../DirectorEditorContext'
import { waypointsOfClip } from '../model/clips'
import type { TimelineEntity, TrajectoryClip, Waypoint } from '../model/directorTypes'
import { sampleWaypoints } from '../model/trajectoryEval'
import { DEG_TO_RAD } from '../model/vec3'
import { objectWorldFrame } from '../model/sceneObjectGraph'
import type { RecordingGhostState } from '../useCameraMotionRecorder'
import type { PathDrawGhostState } from './creation/usePathDraw'
import { DIRECTOR_WAYPOINT_KEY, tagEditorOnly, type WaypointTag } from './sceneRefs'
import { TRAJECTORY_COLORS } from './sceneTheme'

const SAMPLES_PER_SEGMENT = 10
const MAX_GHOST_POINTS = 2048

function makeLine(color: number, capacity: number): THREE.Line {
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(capacity * 3), 3))
  geometry.setDrawRange(0, 0)
  const material = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.9, depthTest: false })
  const line = new THREE.Line(geometry, material)
  line.renderOrder = 995
  line.frustumCulled = false
  tagEditorOnly(line)
  return line
}

function writePoints(line: THREE.Line, points: Array<{ x: number; y: number; z: number }>): void {
  const attribute = line.geometry.getAttribute('position') as THREE.BufferAttribute
  const count = Math.min(points.length, attribute.count)
  for (let index = 0; index < count; index += 1) attribute.setXYZ(index, points[index].x, points[index].y, points[index].z)
  attribute.needsUpdate = true
  line.geometry.setDrawRange(0, count)
}

function buildClipLine(entity: TimelineEntity, clip: TrajectoryClip, isCamera: boolean): THREE.Line | null {
  const points = waypointsOfClip(entity.motionTrajectory ?? [], clip, entity.trajectoryClips ?? [])
  if (points.length < 2) return null
  const samples: THREE.Vector3[] = []
  for (let index = 0; index < points.length - 1; index += 1) {
    const from = points[index]
    const to = points[index + 1]
    for (let step = 0; step < SAMPLES_PER_SEGMENT; step += 1) {
      const sample = sampleWaypoints(points, from.time + ((to.time - from.time) * step) / SAMPLES_PER_SEGMENT, clip)
      if (sample) samples.push(new THREE.Vector3(sample.position.x, sample.position.y, sample.position.z))
    }
  }
  const last = points[points.length - 1]
  samples.push(new THREE.Vector3(last.x, last.y, last.z))
  const geometry = new THREE.BufferGeometry().setFromPoints(samples)
  const material = new THREE.LineBasicMaterial({ color: isCamera ? TRAJECTORY_COLORS.lineCamera : TRAJECTORY_COLORS.line, transparent: true, opacity: 0.9, depthTest: false })
  const line = new THREE.Line(geometry, material)
  line.renderOrder = 990
  line.frustumCulled = false
  tagEditorOnly(line)
  return line
}

function WaypointMarker({ entityId, waypoint, tone }: { entityId: string; waypoint: Waypoint; tone: 'normal' | 'selected' | 'active' }): JSX.Element {
  const ref = React.useRef<THREE.Mesh>(null)
  React.useLayoutEffect(() => {
    const mesh = ref.current
    if (!mesh) return
    tagEditorOnly(mesh)
    const tag: WaypointTag = { entityId, waypointId: waypoint.id, clipId: waypoint.clipId, time: waypoint.time }
    mesh.userData[DIRECTOR_WAYPOINT_KEY] = tag
  }, [entityId, waypoint])
  const color = tone === 'active' ? TRAJECTORY_COLORS.waypointActive : tone === 'selected' ? TRAJECTORY_COLORS.waypointSelected : TRAJECTORY_COLORS.waypoint
  return (
    <mesh ref={ref} position={[waypoint.x, waypoint.y, waypoint.z]} renderOrder={991}>
      <sphereGeometry args={[tone === 'normal' ? 0.06 : 0.085, 12, 12]} />
      <meshBasicMaterial color={color} depthTest={false} transparent opacity={0.95} />
    </mesh>
  )
}

function EntityTrajectory({ entity, isCamera }: { entity: TimelineEntity; isCamera: boolean }): JSX.Element {
  const activeWaypointId = useDirectorStore((state) => state.selection.activeWaypointId)
  const selectedWaypointIds = useDirectorStore((state) => state.selection.selectedWaypointIds)
  const clips = React.useMemo(() => entity.trajectoryClips ?? [], [entity.trajectoryClips])
  const waypoints = entity.motionTrajectory ?? []
  // entity 引用随任何字段变化而变（immer），曲线随之重建
  const lines = React.useMemo(() => clips.map((clip) => buildClipLine(entity, clip, isCamera)), [clips, entity, isCamera])
  React.useEffect(
    () => () => {
      for (const line of lines) {
        if (!line) continue
        line.geometry.dispose()
        ;(line.material as THREE.Material).dispose()
      }
    },
    [lines],
  )
  return (
    <group>
      {lines.map((line, index) => (line ? <primitive key={clips[index].id} object={line} /> : null))}
      {waypoints.map((waypoint) => (
        <WaypointMarker
          key={waypoint.id}
          entityId={entity.id}
          waypoint={waypoint}
          tone={waypoint.id === activeWaypointId ? 'active' : selectedWaypointIds.includes(waypoint.id) ? 'selected' : 'normal'}
        />
      ))}
    </group>
  )
}

// 画笔折线 / 逐点预览段 / 光标环：每帧从 ref 读，不进 React 状态
function PathGhost({ ghostRef }: { ghostRef: React.MutableRefObject<PathDrawGhostState> }): JSX.Element {
  const stroke = React.useMemo(() => makeLine(TRAJECTORY_COLORS.ghost, MAX_GHOST_POINTS), [])
  const preview = React.useMemo(() => makeLine(TRAJECTORY_COLORS.ghost, 2), [])
  const cursorRef = React.useRef<THREE.Mesh>(null)
  React.useLayoutEffect(() => {
    if (cursorRef.current) tagEditorOnly(cursorRef.current)
  }, [])
  React.useEffect(
    () => () => {
      for (const line of [stroke, preview]) {
        line.geometry.dispose()
        ;(line.material as THREE.Material).dispose()
      }
    },
    [preview, stroke],
  )
  useFrame(() => {
    const ghost = ghostRef.current
    stroke.visible = ghost.visible && ghost.points.length > 1
    if (stroke.visible) writePoints(stroke, ghost.points)
    preview.visible = ghost.visible && !ghost.drawing && Boolean(ghost.anchor) && Boolean(ghost.cursor)
    if (preview.visible && ghost.anchor && ghost.cursor) writePoints(preview, [ghost.anchor, ghost.cursor])
    const cursor = cursorRef.current
    if (cursor) {
      cursor.visible = ghost.visible && Boolean(ghost.cursor)
      if (ghost.cursor) cursor.position.set(ghost.cursor.x, ghost.cursor.y + 0.01, ghost.cursor.z)
    }
  })
  return (
    <>
      <primitive object={stroke} />
      <primitive object={preview} />
      <mesh ref={cursorRef} visible={false} rotation={[-Math.PI / 2, 0, 0]} renderOrder={996}>
        <ringGeometry args={[0.12, 0.16, 24]} />
        <meshBasicMaterial color={TRAJECTORY_COLORS.ghost} depthTest={false} transparent opacity={0.9} side={THREE.DoubleSide} />
      </mesh>
    </>
  )
}

// 录制运镜的临时线：录制器每采样一次就推一个点，停止后清空
function RecordingGhost({ ghostRef }: { ghostRef: React.MutableRefObject<RecordingGhostState> }): JSX.Element {
  const line = React.useMemo(() => makeLine(TRAJECTORY_COLORS.lineCamera, MAX_GHOST_POINTS), [])
  React.useEffect(
    () => () => {
      line.geometry.dispose()
      ;(line.material as THREE.Material).dispose()
    },
    [line],
  )
  useFrame(() => {
    const points = ghostRef.current.points
    line.visible = points.length > 1
    if (line.visible) writePoints(line, points)
  })
  return <primitive object={line} />
}

export function TrajectoryVisuals({ ghostRef, recordingGhostRef }: { ghostRef: React.MutableRefObject<PathDrawGhostState>; recordingGhostRef: React.MutableRefObject<RecordingGhostState> }): JSX.Element {
  const scene = useDirectorStore((state) => state.activeScene())
  const { position, rotation, scale } = scene.sceneConfig
  const objects = scene.objects.filter((object) => (object.motionTrajectory?.length ?? 0) > 0)
  const cameras = scene.cameras.filter((camera) => (camera.motionTrajectory?.length ?? 0) > 0)
  return (
    <>
      <group position={[position.x, position.y, position.z]} rotation={[rotation.x * DEG_TO_RAD, rotation.y * DEG_TO_RAD, rotation.z * DEG_TO_RAD]} scale={scale}>
        {objects.map((object) => {
          const { basis: m, position: p } = objectWorldFrame(scene.objects, object.parentId)
          const matrix = new THREE.Matrix4().set(m[0], m[1], m[2], p.x, m[3], m[4], m[5], p.y, m[6], m[7], m[8], p.z, 0, 0, 0, 1)
          return <group key={object.id} matrix={matrix} matrixAutoUpdate={false}><EntityTrajectory entity={object} isCamera={false} /></group>
        })}
        {cameras.map((camera) => (
          <EntityTrajectory key={camera.id} entity={camera} isCamera />
        ))}
      </group>
      <PathGhost ghostRef={ghostRef} />
      <RecordingGhost ghostRef={recordingGhostRef} />
    </>
  )
}
