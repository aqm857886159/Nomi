/** Bounded monitor output: reuse the production capture boundary and existing authenticated mobile bridge. */
import React from 'react'
import { MOBILE_PREVIEW_MAX_BYTES, type MobileBridgeFeedback } from '../../../../../electron/shared/contracts/directorMobileBridge'
import { getDesktopBridge } from '../../../../desktop/bridge'
import { useDirectorStoreApi } from './DirectorEditorContext'
import type { DirectorStore } from './model/directorStore'
import { exportAspectRatio } from './model/cameraLens'
import type { ViewportApiRef } from './scene/ViewportApiContext'

export function useMobilePreview(enabled: boolean, apiRef: ViewportApiRef): void {
  const store = useDirectorStoreApi()
  React.useEffect(() => {
    if (!enabled) return
    const mobile = getDesktopBridge()?.director?.mobile
    if (!mobile?.feedback) return
    return startMobilePreview(store, apiRef, (payload) => mobile.feedback(payload))
  }, [apiRef, enabled, store])
}


export function startMobilePreview(store: DirectorStore, apiRef: ViewportApiRef, feedback: (payload: MobileBridgeFeedback) => Promise<boolean>): () => void {
  let stopped = false
  let timer: ReturnType<typeof setTimeout> | undefined
  const reportState = () => feedback({ recording: Boolean(store.getState().recording) }).catch(() => false)
  const unsubscribe = store.subscribe((state, previous) => {
    if (state.recording !== previous.recording) void reportState()
  })
  const capture = async () => {
    try {
      const api = apiRef.current
      if (!api) return
      const state = store.getState()
      const size = api.getViewportSize()
      const viewportAspect = Math.max(1, size.width) / Math.max(1, size.height)
      const aspect = state.activeCameraId === 'free' ? viewportAspect : (exportAspectRatio(state.project.exportRatio) ?? viewportAspect)
      const width = Math.max(1, Math.round(aspect >= 1 ? 480 : 480 * aspect))
      const height = Math.max(1, Math.round(aspect >= 1 ? 480 / aspect : 480))
      const image = await api.captureFrame({ cameraId: state.activeCameraId, width, height, burnLabels: true })
      if (stopped) return
      const frame = image && image.blob.size <= MOBILE_PREVIEW_MAX_BYTES ? new Uint8Array(await image.blob.arrayBuffer()) : undefined
      if (!stopped) await feedback({ recording: Boolean(store.getState().recording), frame })
    } catch {
      if (!stopped) await reportState()
    } finally {
      if (!stopped) timer = setTimeout(() => { void capture() }, 250)
    }
  }
  void capture()
  return () => {
    stopped = true
    if (timer) clearTimeout(timer)
    unsubscribe()
  }
}
