/**
 * [INPUT]: 依赖 react、react-i18next、../../../../desktop/bridge 的 getDesktopBridge、../../../../ui/toast、
 *          ./DirectorEditorContext、./useCameraMotionRecorder 的 CameraRecorderApi、./scene/ViewportApiContext 的 ViewportApiRef、
 *          ./model/mobileCamera（applyMobilePacket / mobilePacketFromValues / DEFAULT_MOBILE_SPEEDS / MobileCameraSpeeds）
 * [OUTPUT]: 对外提供 MobileCameraApi、useMobileCamera：起停局域网桥、收包写激活机位、远程录制、速度持久、对话框开关
 * [POS]: director 根的手机虚拟相机编排（清单 §6 C5）：主进程跑 HTTPS+WS，这里只经 bridge 收事件；
 *        积分基准永远是视口相机当前位姿（POV 下它跟随求值 / 关键帧 / 录制）；未录制时经 writeCameraSpatialTransform 按编辑层写回，
 *        录制中视口相机是真相 → 只 applyViewPose；手机一转头就关掉该机位的看向 / rig（否则求值层盖掉朝向，转了没反应），提示一次、可撤销。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import React from 'react'
import { useTranslation } from 'react-i18next'
import { getDesktopBridge, type DesktopDirectorMobileEvent, type DesktopDirectorMobileStatus } from '../../../../desktop/bridge'
import { toast } from '../../../../ui/toast'
import { useDirectorStoreApi } from './DirectorEditorContext'
import { applyMobilePacket, DEFAULT_MOBILE_SPEEDS, mobilePacketFromValues, type MobileCameraSpeeds } from './model/mobileCamera'
import type { CameraRecorderApi } from './useCameraMotionRecorder'
import type { ViewportApiRef } from './scene/ViewportApiContext'
import { useMobilePreview } from './useMobilePreview'
import { transformCameraPose } from './model/cameraCoordinateSpace'
import { invertFrame, sceneFrame } from './model/sceneObjectGraph'
import { resolveEditLayer } from './model/editLayer'

const SPEEDS_KEY = 'nomi:director:mobileSpeeds'

export type MobileCameraApi = {
  available: boolean
  dialogOpen: boolean
  setDialogOpen: (open: boolean) => void
  status: DesktopDirectorMobileStatus | null
  starting: boolean
  speeds: MobileCameraSpeeds
  setSpeeds: (speeds: MobileCameraSpeeds) => void
  start: () => Promise<boolean>
  stop: () => Promise<void>
}

function readSpeeds(): MobileCameraSpeeds {
  try {
    const raw = localStorage.getItem(SPEEDS_KEY)
    if (!raw) return DEFAULT_MOBILE_SPEEDS
    const parsed = JSON.parse(raw) as Partial<MobileCameraSpeeds>
    const move = Number(parsed.moveMetersPerSecond)
    const lift = Number(parsed.elevationMetersPerSecond)
    return {
      moveMetersPerSecond: Number.isFinite(move) && move > 0 ? move : DEFAULT_MOBILE_SPEEDS.moveMetersPerSecond,
      elevationMetersPerSecond: Number.isFinite(lift) && lift > 0 ? lift : DEFAULT_MOBILE_SPEEDS.elevationMetersPerSecond,
    }
  } catch {
    return DEFAULT_MOBILE_SPEEDS
  }
}

function mobilePageText(t: (key: string) => string): Record<string, string> {
  return {
    title: t('director.mobilePage.title'),
    lift: t('director.mobilePage.lift'),
    focal: t('director.mobilePage.focal'),
    gyroOff: t('director.mobilePage.gyroOff'),
    gyroOn: t('director.mobilePage.gyroOn'),
    resetRoll: t('director.mobilePage.resetRoll'),
    startRecording: t('director.mobilePage.startRecording'),
    stopRecording: t('director.mobilePage.stopRecording'),
    hint: t('director.mobilePage.hint'),
    connecting: t('director.mobilePage.connecting'),
    connected: t('director.mobilePage.connected'),
    disconnected: t('director.mobilePage.disconnected'),
    gyroDenied: t('director.mobilePage.gyroDenied'),
  }
}

export function useMobileCamera({ recorder, apiRef }: { recorder: CameraRecorderApi; apiRef: ViewportApiRef }): MobileCameraApi {
  const { t } = useTranslation()
  const store = useDirectorStoreApi()
  const available = Boolean(getDesktopBridge()?.director?.mobile)
  const [dialogOpen, setDialogOpen] = React.useState(false)
  const [status, setStatus] = React.useState<DesktopDirectorMobileStatus | null>(null)
  const [starting, setStarting] = React.useState(false)
  const [speeds, setSpeedsState] = React.useState<MobileCameraSpeeds>(readSpeeds)
  const lastAtRef = React.useRef<number | null>(null)
  const speedsRef = React.useRef(speeds)
  speedsRef.current = speeds
  const recorderRef = React.useRef(recorder)
  recorderRef.current = recorder
  const apiRefHeld = apiRef
  const startRef = React.useRef<Promise<boolean> | null>(null)
  const epochRef = React.useRef(0)
  useMobilePreview(Boolean(status?.running && status.devices.length), apiRefHeld)

  const setSpeeds = React.useCallback((next: MobileCameraSpeeds) => {
    setSpeedsState(next)
    try {
      localStorage.setItem(SPEEDS_KEY, JSON.stringify(next))
    } catch {
      // 无本地存储时速度只活在本会话
    }
  }, [])

  const applyEvent = React.useCallback(
    (event: DesktopDirectorMobileEvent) => {
      if (event.type === 'packet') {
        const packet = mobilePacketFromValues(event.values)
        if (!packet) return
        const state = store.getState()
        if (state.activeCameraId === 'free') return
        const camera = state.findCamera(state.activeCameraId)
        if (!camera) return
        const recordingThis = state.recording?.cameraId === camera.id
        // 积分基准 = 视口相机当前位姿（POV 下它跟随求值 / 关键帧 / 录制，静止层只是其中一种），
        // 拿静止层当基准会在关键帧层上每包都从静止值起算，转不动
        const view = apiRefHeld.current?.getViewPose() ?? null
        const pose = view
          ? { position: view.position, yaw: view.yaw, pitch: view.pitch, roll: view.roll, fov: view.fov }
          : transformCameraPose({ position: camera.position, yaw: camera.yaw, pitch: camera.pitch, roll: camera.roll, fov: camera.fov }, sceneFrame(state.activeScene().sceneConfig))
        const last = lastAtRef.current
        lastAtRef.current = event.at
        const dt = last == null ? 0 : (event.at - last) / 1000
        const next = applyMobilePacket(pose, packet, dt, speedsRef.current)
        if (recordingThis) {
          apiRefHeld.current?.applyViewPose(next)
          return
        }
        if (resolveEditLayer(camera, { currentTime: state.timeline.currentTime, activeWaypointId: state.selection.activeWaypointId }, true) === 'evaluated-readonly') return
        // 手机一转头就接管朝向：看向目标 / rig 会在求值层盖掉静止层的 yaw/pitch（useTimelinePlayback），
        // 不关掉的话手机转了机位纹丝不动——关一次、提示一次，可撤销
        const turning = packet.dPitch !== 0 || packet.dYaw !== 0 || packet.dRoll !== 0
        const aimed = (camera.lookAtType ?? 'none') !== 'none' || Boolean(camera.lookAtObjectId) || (camera.rigType ?? 'none') !== 'none'
        const local = transformCameraPose(next, invertFrame(sceneFrame(state.activeScene().sceneConfig)))
        if (turning && aimed) state.saveState()
        const written = state.writeCameraSpatialTransform(camera.id, {
          position: local.position,
          rotation: { x: local.pitch, y: local.yaw, z: local.roll },
        })
        if (!written.applied) return
        if (turning && aimed) {
          state.updateCamera(camera.id, { lookAtType: 'none', lookAtObjectId: undefined, rigType: 'none' })
          toast(t('director.camera.mobileLookAtCleared', { name: camera.name }), 'info')
        }
        if (next.fov !== pose.fov) state.setCameraFov(camera.id, next.fov)
        apiRefHeld.current?.applyViewPose(next)
        return
      }
      if (event.type === 'record') {
        if (event.action === 'start') recorderRef.current.start()
        else recorderRef.current.stop()
        void getDesktopBridge()?.director?.mobile?.feedback?.({ recording: Boolean(store.getState().recording) }).catch(() => false)
      }
      if (event.type === 'device' && event.state === 'disconnected') lastAtRef.current = null
      setStatus((current) => {
        if (!current) return current
        if (event.type !== 'device') return current
        const rest = current.devices.filter((device) => device.id !== event.deviceId)
        const previous = current.devices.find((device) => device.id === event.deviceId)
        const devices =
          event.state === 'disconnected'
            ? rest
            : [...rest, { id: event.deviceId, name: event.name, latencyMs: event.latencyMs, connectedAt: previous?.connectedAt ?? Date.now() }]
        return { ...current, devices }
      })
    },
    [apiRefHeld, store, t],
  )

  React.useEffect(() => {
    const mobile = getDesktopBridge()?.director?.mobile
    if (!mobile) return undefined
    return mobile.onEvent(applyEvent)
  }, [applyEvent])

  const start = React.useCallback((): Promise<boolean> => {
    if (startRef.current) return startRef.current
    const mobile = getDesktopBridge()?.director?.mobile
    if (!mobile) return Promise.resolve(false)
    const epoch = ++epochRef.current
    setStarting(true)
    const pending = (async () => {
    try {
      const next = await mobile.start({ text: mobilePageText(t) })
      if (epoch !== epochRef.current) return false
      lastAtRef.current = null
      setStatus(next)
      return true
    } catch {
      if (epoch !== epochRef.current) return false
      toast(t('director.camera.mobileStartFailed'), 'error')
      return false
    } finally {
      if (epoch === epochRef.current) {
        setStarting(false)
        startRef.current = null
      }
    }
    })()
    startRef.current = pending
    return pending
  }, [t])

  const stop = React.useCallback(async () => {
    const epoch = ++epochRef.current
    startRef.current = null
    setStarting(false)
    const mobile = getDesktopBridge()?.director?.mobile
    lastAtRef.current = null
    if (!mobile) {
      setStatus(null)
      return
    }
    try {
      const next = await mobile.stop()
      if (epoch === epochRef.current) setStatus(next)
    } catch {
      if (epoch === epochRef.current) toast(t('director.camera.mobileStartFailed'), 'error')
    }
  }, [t])

  const openDialog = React.useCallback(
    (open: boolean) => {
      setDialogOpen(open)
      if (open) void start()
    },
    [start],
  )

  React.useEffect(() => () => {
    epochRef.current += 1
    startRef.current = null
    void getDesktopBridge()?.director?.mobile?.stop().catch(() => {})
  }, [])

  return {
    available,
    dialogOpen,
    setDialogOpen: openDialog,
    status,
    starting,
    speeds,
    setSpeeds,
    start,
    stop,
  }
}
