import type { LeaferApp, LeaferEditorOverlay, LeaferEditorOverlayState } from './whiteboardCanvasTypes'

export function fitLeaferCanvasToHost(app: LeaferApp): void {
  const canvasView = app.canvas?.view as HTMLElement | undefined
  if (!canvasView) {
    return
  }

  canvasView.style.width = '100%'
  canvasView.style.height = '100%'
  canvasView.style.maxWidth = '100%'
  canvasView.style.maxHeight = '100%'
}

export function createViewportScreenshotFilename(): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')

  return `nomi-whiteboard-${timestamp}.png`
}

export async function exportViewportWithoutEditorOverlays(app: LeaferApp, filename: string) {
  const editor = app.editor as LeaferEditorOverlay | undefined
  const overlayState = hideEditorOverlays(editor)

  try {
    return await app.export(filename, {
      screenshot: true,
      pixelRatio: getViewportScreenshotPixelRatio()
    })
  } finally {
    restoreEditorOverlays(editor, overlayState)
  }
}

export async function exportViewportFileWithoutEditorOverlays(app: LeaferApp, filename: string): Promise<File> {
  const editor = app.editor as LeaferEditorOverlay | undefined
  const overlayState = hideEditorOverlays(editor)

  try {
    const result = await app.export('png', {
      blob: true,
      screenshot: true,
      pixelRatio: getViewportScreenshotPixelRatio()
    })

    if (result.error) {
      throw result.error instanceof Error ? result.error : new Error('截图失败')
    }

    if (!(result.data instanceof Blob)) {
      throw new Error('截图失败')
    }

    return new File([result.data], ensurePngFilename(filename), {
      type: result.data.type || 'image/png'
    })
  } finally {
    restoreEditorOverlays(editor, overlayState)
  }
}

export function hideEditorOverlays(editor: LeaferEditorOverlay | undefined): LeaferEditorOverlayState {
  if (!editor) {
    return {}
  }

  const state = {
    visible: editor.visible
  }

  editor.visible = false

  return state
}

export function restoreEditorOverlays(editor: LeaferEditorOverlay | undefined, state: LeaferEditorOverlayState): void {
  if (!editor) {
    return
  }

  editor.visible = state.visible
}

export function getViewportScreenshotPixelRatio(): number {
  return Math.max(1, Math.min(2, window.devicePixelRatio || 1))
}

export function ensurePngFilename(filename: string): string {
  return /\.png$/i.test(filename) ? filename : `${filename}.png`
}
