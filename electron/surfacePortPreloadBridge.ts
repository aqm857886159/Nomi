import {
  SURFACE_CANVAS_READ_REPLY_CHANNEL,
  SURFACE_CANVAS_READ_REQUEST_CHANNEL,
  type CapturedCanvasReadSnapshotHandleWire,
  type CanvasReadSurfaceBridge,
  type CanvasReadSurfaceRequestWire,
  type SurfacePortBindingWire,
  SurfacePortWireError,
  type SurfaceSuspensionWire,
  unwrapSurfacePortIpcResponse,
} from './shared/surfacePortBinding'

type Invoke = (channel: string, payload: unknown) => Promise<unknown>
type SurfaceReadEvents = Readonly<{
  subscribe(channel: string, listener: (payload: unknown) => void): () => void
  send(channel: string, payload: unknown): void
}>

function freezeSuspensionReply(reply: { suspension: SurfaceSuspensionWire }) {
  Object.freeze(reply.suspension)
  return Object.freeze(reply)
}

function freezeBindingReply(reply: { binding: SurfacePortBindingWire }) {
  Object.freeze(reply.binding.binding)
  Object.freeze(reply.binding)
  return Object.freeze(reply)
}

function freezeCapturedSnapshotReply(reply: { handle: CapturedCanvasReadSnapshotHandleWire }) {
  Object.freeze(reply.handle)
  return Object.freeze(reply)
}

function readRequest(value: unknown): CanvasReadSurfaceRequestWire | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const request = value as Record<string, unknown>
  if (typeof request.requestId !== 'string' || !request.requestId.trim()) return null
  if (!request.binding || typeof request.binding !== 'object' || Array.isArray(request.binding)) return null
  return request as unknown as CanvasReadSurfaceRequestWire
}

export function createCanvasReadSurfacePreloadBridge(
  invoke: Invoke,
  events?: SurfaceReadEvents,
): CanvasReadSurfaceBridge {
  return Object.freeze({
    async suspend(input) {
      return freezeSuspensionReply(
        unwrapSurfacePortIpcResponse<{ suspension: SurfaceSuspensionWire }>(
          await invoke('nomi:surface:suspend', input),
        ),
      )
    },
    async commitCanvasRead(input) {
      return freezeBindingReply(
        unwrapSurfacePortIpcResponse<{ binding: SurfacePortBindingWire }>(
          await invoke('nomi:surface:commitCanvasRead', input),
        ),
      )
    },
    async captureCanvasReadSnapshot(input) {
      return freezeCapturedSnapshotReply(
        unwrapSurfacePortIpcResponse<{ handle: CapturedCanvasReadSnapshotHandleWire }>(
          await invoke('nomi:surface:captureCanvasReadSnapshot', input),
        ),
      )
    },
    async release(input) {
      return Object.freeze(
        unwrapSurfacePortIpcResponse<{ released: true }>(
          await invoke('nomi:surface:release', input),
        ),
      )
    },
    onCanvasRead(handler) {
      if (!events) throw new SurfacePortWireError('surface_port_unavailable')
      return events.subscribe(SURFACE_CANVAS_READ_REQUEST_CHANNEL, (payload) => {
        const request = readRequest(payload)
        if (!request) return
        let result: unknown | Promise<unknown>
        try {
          // Invoke synchronously so the renderer captures the live bound store
          // before any handler await can observe a later project.
          result = handler({ binding: request.binding })
        } catch (error) {
          result = Promise.reject(error)
        }
        void Promise.resolve(result).then(
          (value) => events.send(SURFACE_CANVAS_READ_REPLY_CHANNEL, {
            requestId: request.requestId,
            binding: request.binding,
            result: value,
          }),
          (error) => events.send(SURFACE_CANVAS_READ_REPLY_CHANNEL, {
            requestId: request.requestId,
            binding: request.binding,
            error: {
              code: error instanceof SurfacePortWireError ? error.code : 'surface_port_unavailable',
            },
          }),
        )
      })
    },
  })
}
