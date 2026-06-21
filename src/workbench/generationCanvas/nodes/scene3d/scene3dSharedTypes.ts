import type {
  Scene3DCamera,
  Scene3DCaptureResult,
  Scene3DObject,
  Scene3DVector3,
} from './scene3dTypes'

export type CaptureApi = {
  captureViewport: () => Scene3DCaptureResult | null
  captureCamera: (camera: Scene3DCamera) => Scene3DCaptureResult | null
}

export type Scene3DClipboardItem =
  | { type: 'object'; item: Scene3DObject; pasteCount: number }
  | { type: 'camera'; item: Scene3DCamera; pasteCount: number }

export type CrowdAddOptions = {
  rows: number
  columns: number
  spacing: number
}

export type MannequinPoseControl = {
  axisIndex: 0 | 1 | 2
  baseOffsetDeg?: number
  bone: string
  label: string
  max?: number
  min?: number
  standingValue: number
  valueScale?: number
}

export type MannequinPoseSection =
  | {
    title: string
    controls: MannequinPoseControl[]
    groups?: never
  }
  | {
    title: string
    controls?: never
    groups: Array<{
      title: string
      controls: MannequinPoseControl[]
    }>
  }

export type MannequinPosePreset = {
  id: string
  label: string
  pose?: Record<string, Scene3DVector3>
}

export type PointerCaptureTarget = {
  setPointerCapture?: (pointerId: number) => void
  releasePointerCapture?: (pointerId: number) => void
}

export type Scene3DMovementCode =
  | 'KeyW'
  | 'KeyA'
  | 'KeyS'
  | 'KeyD'
  | 'ArrowUp'
  | 'ArrowDown'
  | 'ArrowLeft'
  | 'ArrowRight'
  | 'Space'
  | 'ShiftLeft'
  | 'ShiftRight'
