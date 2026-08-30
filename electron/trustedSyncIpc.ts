import type { IpcMain, IpcMainEvent } from 'electron'
import { assertTrustedSender } from './ipcSenderGuard'

type SyncRegistrar = Pick<IpcMain, 'on'>

export function registerTrustedSyncIpc<TArgs extends unknown[], TResult>(
  registrar: SyncRegistrar,
  channel: string,
  handler: (...args: TArgs) => TResult,
  assertSender: (event: IpcMainEvent) => void = assertTrustedSender,
): void {
  registrar.on(channel, (event, ...args: unknown[]) => {
    try {
      assertSender(event)
      event.returnValue = { ok: true, value: handler(...args as TArgs) }
    } catch (error) {
      event.returnValue = {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  })
}
