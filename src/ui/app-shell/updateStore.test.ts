import { beforeEach, describe, expect, it } from 'vitest'
import type { UpdateEvent, UpdateSnapshot } from '../../../electron/shared/updateReminder'
import { UPDATER_INITIAL_STATE } from '../../../electron/shared/updateReminder'
import { resetUpdateStoreForTests, startUpdateSync, useUpdateStore } from './updateStore'

const available: UpdateEvent = { type: 'available', version: '0.24.0', notes: [], sizeBytes: null, releaseUrl: null }
const memory = { dismissedBanners: ['0.23.1'], updatedCard: null }

function fakeBridge(snapshot: UpdateSnapshot) {
  let listener: ((event: UpdateEvent) => void) | null = null
  let resolve: (value: UpdateSnapshot) => void = () => undefined
  const pending = new Promise<UpdateSnapshot>((r) => { resolve = r })
  return {
    bridge: { snapshot: () => pending, onEvent: (cb: (event: UpdateEvent) => void) => { listener = cb; return () => { listener = null } } },
    emit: (event: UpdateEvent) => listener?.(event),
    answerSnapshot: () => resolve(snapshot),
    hasListener: () => listener !== null,
  }
}

describe('updateStore 与主进程同步', () => {
  beforeEach(() => resetUpdateStoreForTests())

  it('晚挂载的窗口用快照补上之前发生的事（新版已被发现、项目库页才打开）', async () => {
    const fake = fakeBridge({ state: { ...UPDATER_INITIAL_STATE, phase: 'available', latestVersion: '0.24.0' }, memory })
    startUpdateSync(fake.bridge)
    fake.answerSnapshot()
    await Promise.resolve(); await Promise.resolve()
    expect(useUpdateStore.getState().updater).toMatchObject({ phase: 'available', latestVersion: '0.24.0' })
    expect(useUpdateStore.getState().memory.dismissedBanners).toEqual(['0.23.1'])
  })

  it('快照回来之前已经收到事件：事件更新，只采纳快照里的提醒记忆（不拿旧状态盖新状态）', async () => {
    const fake = fakeBridge({ state: UPDATER_INITIAL_STATE, memory })
    startUpdateSync(fake.bridge)
    fake.emit(available)
    fake.answerSnapshot()
    await Promise.resolve(); await Promise.resolve()
    expect(useUpdateStore.getState().updater.phase).toBe('available')
    expect(useUpdateStore.getState().memory).toEqual(memory)
  })

  it('停止订阅后不再跟随事件', () => {
    const fake = fakeBridge({ state: UPDATER_INITIAL_STATE, memory })
    const stop = startUpdateSync(fake.bridge)
    stop()
    expect(fake.hasListener()).toBe(false)
  })
})
