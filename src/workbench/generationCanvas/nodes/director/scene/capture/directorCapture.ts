/**
 * [INPUT]: 依赖 three、../sceneRefs 的 DIRECTOR_EDITOR_ONLY_KEY（editor-only 旗标：gizmo / 把手 / 灯具与相机模型 / 网格 / 视图立方）、
 *          ../cameraMath（cameraQuaternion / THREE_CAMERA_FLIP）、../../model/directorTypes 的 Vec3
 * [OUTPUT]: 对外提供 buildCaptureCamera、collectCaptureHiddenObjects、FrameRenderer（复用渲染目标 → 2D 画布）、drawLabels、encodeCanvas、CaptureLabel
 * [POS]: director/scene/capture 的出片纯工具（零 React）：截图与 MP4 帧共用一条管线——机位位姿 → PerspectiveCamera（与 PiP 同一套四元数翻转）
 *        → 离屏渲染目标 readPixels 到 2D 画布（隐藏集 = 带 editor-only 旗标的整棵子树，「成片零编辑辅助物」是结构保证不靠逐控件特判）
 *        → 标签直接画在同一张画布 → toBlob 一次异步编码，dataURL 走 FileReader。每帧不新建渲染目标、不走同步 toDataURL（1080p 每帧 0.18s）。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import * as THREE from 'three'
import type { Vec3 } from '../../model/directorTypes'
import { cameraQuaternion, THREE_CAMERA_FLIP } from '../cameraMath'
import { DIRECTOR_EDITOR_ONLY_KEY } from '../sceneRefs'

// 采集本次出片要隐藏的对象：带 editor-only 旗标的（tagEditorOnly 打的整棵子树）；调用方负责恢复 visible
export function collectCaptureHiddenObjects(scene: THREE.Object3D): THREE.Object3D[] {
  const hidden: THREE.Object3D[] = []
  scene.traverse((object) => {
    if (object.userData?.[DIRECTOR_EDITOR_ONLY_KEY] === true) hidden.push(object)
  })
  return hidden
}

export type CaptureLabel = { text: string; x: number; y: number }

// 机位位姿（度）+ 竖直 FOV + 画幅比 → 与视口 / 画中画同一套朝向约定的相机
export function buildCaptureCamera(position: Vec3, rotation: Vec3, fov: number, aspect: number, target: THREE.PerspectiveCamera = new THREE.PerspectiveCamera(50, aspect, 0.1, 2000)): THREE.PerspectiveCamera {
  target.position.set(position.x, position.y, position.z)
  target.quaternion.copy(cameraQuaternion(rotation.x, rotation.y, rotation.z)).multiply(THREE_CAMERA_FLIP)
  target.fov = fov
  target.aspect = aspect
  target.near = 0.1
  target.far = 2000
  target.updateProjectionMatrix()
  target.updateMatrixWorld(true)
  return target
}

// 离屏渲染器：渲染目标 / 读回缓冲 / 2D 画布按尺寸缓存，逐帧录制不再每帧分配 8MB
export class FrameRenderer {
  private target: THREE.WebGLRenderTarget | null = null
  private buffer: Uint8Array = new Uint8Array(0)
  private canvas: HTMLCanvasElement | null = null
  private imageData: ImageData | null = null

  private ensure(width: number, height: number): { target: THREE.WebGLRenderTarget; canvas: HTMLCanvasElement; context: CanvasRenderingContext2D; imageData: ImageData } | null {
    if (!this.target || this.target.width !== width || this.target.height !== height) {
      this.target?.dispose()
      this.target = new THREE.WebGLRenderTarget(width, height, { format: THREE.RGBAFormat, type: THREE.UnsignedByteType })
      this.target.texture.colorSpace = THREE.SRGBColorSpace
      this.buffer = new Uint8Array(width * height * 4)
      this.canvas = document.createElement('canvas')
      this.canvas.width = width
      this.canvas.height = height
      this.imageData = null
    }
    const canvas = this.canvas
    const context = canvas?.getContext('2d') ?? null
    if (!canvas || !context) return null
    if (!this.imageData) this.imageData = context.createImageData(width, height)
    return { target: this.target, canvas, context, imageData: this.imageData }
  }

  // 渲染一帧到 2D 画布（editor-only 旗标对象与网格隐藏；行序翻转）；返回画布供继续画标签
  renderToCanvas(gl: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera, width: number, height: number): HTMLCanvasElement | null {
    const slots = this.ensure(width, height)
    if (!slots) return null
    const hidden = collectCaptureHiddenObjects(scene).map((object) => {
      const entry = { object, visible: object.visible }
      object.visible = false
      return entry
    })
    const previousTarget = gl.getRenderTarget()
    try {
      gl.setRenderTarget(slots.target)
      gl.clear()
      gl.render(scene, camera)
      gl.readRenderTargetPixels(slots.target, 0, 0, width, height, this.buffer)
    } finally {
      gl.setRenderTarget(previousTarget)
      hidden.forEach((entry) => {
        entry.object.visible = entry.visible
      })
    }
    const rowBytes = width * 4
    const { data } = slots.imageData
    for (let y = 0; y < height; y += 1) {
      const sourceRow = (height - y - 1) * rowBytes
      data.set(this.buffer.subarray(sourceRow, sourceRow + rowBytes), y * rowBytes)
    }
    slots.context.putImageData(slots.imageData, 0, 0)
    return slots.canvas
  }

  dispose(): void {
    this.target?.dispose()
    this.target = null
    this.canvas = null
    this.imageData = null
    this.buffer = new Uint8Array(0)
  }
}

// 标签烧进画面：像素高的 1/40 字号、深底白字圆角牌，锚点在标签中心下方（与视口名牌同位）
export function drawLabels(context: CanvasRenderingContext2D, labels: CaptureLabel[], width: number, height: number): void {
  if (labels.length === 0) return
  const fontSize = Math.max(12, Math.round(height / 40))
  context.font = `600 ${fontSize}px system-ui, sans-serif`
  context.textAlign = 'center'
  context.textBaseline = 'middle'
  const padX = fontSize * 0.6
  const padY = fontSize * 0.35
  for (const label of labels) {
    if (label.x < 0 || label.x > width || label.y < 0 || label.y > height) continue
    const textWidth = context.measureText(label.text).width
    const boxWidth = textWidth + padX * 2
    const boxHeight = fontSize + padY * 2
    const x = label.x - boxWidth / 2
    const y = label.y - boxHeight
    context.fillStyle = 'rgba(20, 20, 24, 0.72)'
    context.beginPath()
    context.roundRect(x, y, boxWidth, boxHeight, fontSize * 0.35)
    context.fill()
    context.fillStyle = '#ffffff'
    context.fillText(label.text, label.x, y + boxHeight / 2)
  }
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => (typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('blob read failed')))
    reader.onerror = () => reject(reader.error ?? new Error('blob read failed'))
    reader.readAsDataURL(blob)
  })
}

export type EncodedFrame = { blob: Blob; dataUrl: string }

// 一次异步 PNG 编码；dataURL 由 Blob 读出（帧转视频桥 / V1 截图落盘桥的契约都是 dataURL）
export async function encodeCanvas(canvas: HTMLCanvasElement): Promise<EncodedFrame> {
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((result) => (result ? resolve(result) : reject(new Error('toBlob failed'))), 'image/png'))
  return { blob, dataUrl: await blobToDataUrl(blob) }
}
