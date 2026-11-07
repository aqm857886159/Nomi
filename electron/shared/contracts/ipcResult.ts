/** One envelope and one unwrapping owner for both sync IPC and explicit async results. */
export type IpcResult<T, R = never> = { ok: true; value: T } | { ok: false; error: string; reason?: R }

export class IpcResultError<R> extends Error {
  readonly reason: R | undefined
  constructor(message: string, reason: R | undefined) {
    super(message)
    this.reason = reason
  }
}

export function unwrapIpcResult<T, R = never>(result: IpcResult<T, R>, channel: string): T {
  if (!result || result.ok !== true) {
    throw new IpcResultError(result?.error || `Desktop IPC failed: ${channel}`, result?.reason)
  }
  return result.value
}
