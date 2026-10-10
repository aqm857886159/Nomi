// 文本流的订阅顺序：失败得快的流（被拦 / 凭据 / DNS 一毫秒内就错）事件早于 invoke 回包。
// 旧写法「等回包拿 streamId 再订阅」会丢掉这条 error，文本节点永远卡在「提交中」（2026-10-09 真模型走查）。
import { afterEach, describe, expect, it, vi } from 'vitest'
import { runWorkbenchTextTaskStream } from './taskApi'

type Listener = (event: unknown) => void

function installDesktop(onInvoke: (streamId: string, emit: (event: unknown) => void) => void): void {
  const listeners = new Map<string, Listener>()
  const emit = (streamId: string) => (event: unknown) => listeners.get(streamId)?.(event)
  const tasks = {
    // 与主进程一样：invoke 回包之前事件就可能已经发出（只有已订阅的监听器收得到）。
    runTextStream: vi.fn(async (payload: { streamId: string }) => { onInvoke(payload.streamId, emit(payload.streamId)); return { streamId: payload.streamId } }),
    onTextEvent: (streamId: string, listener: Listener) => { listeners.set(streamId, listener); return () => listeners.delete(streamId) },
    cancelTextStream: vi.fn(async () => ({ ok: true })),
  }
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { nomiDesktop: { tasks } } })
}
afterEach(() => { Reflect.deleteProperty(globalThis, 'window') })

const request = { kind: 'chat', prompt: 'p', extras: {} } as never

describe('runWorkbenchTextTaskStream 先订阅后发起', () => {
  it('invoke 回包之前就发出的 error 也收得到（不会卡在提交中）', async () => {
    installDesktop((_id, emit) => emit({ type: 'error', message: 'Test network blocked: blocked.example.com' }))
    await expect(runWorkbenchTextTaskStream('v', request, null)).rejects.toThrow('Test network blocked')
  })

  it('invoke 回包之前就发出的 delta 和 done 也收得到', async () => {
    installDesktop((_id, emit) => { emit({ type: 'delta', delta: '你' }); emit({ type: 'done', result: { id: 't', status: 'succeeded' } }) })
    const deltas: string[] = []
    await expect(runWorkbenchTextTaskStream('v', request, null, { onDelta: (d) => deltas.push(d) })).resolves.toMatchObject({ status: 'succeeded' })
    expect(deltas).toEqual(['你'])
  })
})
