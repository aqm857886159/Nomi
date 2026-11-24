// 提示的身份与撤回都归 toast 所有者（2026-09-29 走查 pb06：同一次失败叠成「×3」、换家成功后失败提示还挂着）。
// 跑的是真的 Mantine 通知 store（不是桩）：occurrence 决定「再发生一次」还是「同一件事重新宣布」，
// validWhile 决定前提不成立时谁来收掉提示——靠状态变化，不靠定时器。
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { notifications, notificationsStore } from '@mantine/notifications'
import { useToastStore, type ToastValidity } from './toast'

const items = () => {
  const state = notificationsStore.getState()
  return [...state.notifications, ...state.queue]
}
const push = (input: Parameters<ReturnType<typeof useToastStore.getState>['push']>[0]) => useToastStore.getState().push(input)

beforeEach(() => {
  notifications.clean()
  notificationsStore.setState({ ...notificationsStore.getState(), limit: 2 })
})

describe('occurrence: the same event announced again is not another event', () => {
  it('re-announcing one failure five times (effect re-runs, two mounted controls) stays one toast without a repeat count', () => {
    for (let index = 0; index < 5; index += 1) {
      push({ id: 'node-recovery:n1', reason: 'server', occurrence: 'run-1@10', message: `failed (render ${index})`, type: 'warning', ttl: false })
    }
    expect(items()).toHaveLength(1)
    expect(items()[0]['data-notification-count']).toBe(1)
    expect(items()[0].message).toHaveProperty('props.message', 'failed (render 4)') // 内容照常刷新
    expect(items()[0].message).toHaveProperty('props.count', 1)
  })

  it('a genuinely new event under the same identity replaces the toast and counts as one more', () => {
    push({ id: 'node-recovery:n1', reason: 'server', occurrence: 'run-1@10', message: 'first', type: 'warning', ttl: false })
    push({ id: 'node-recovery:n1', reason: 'server', occurrence: 'run-2@20', message: 'second', type: 'warning', ttl: false })
    expect(items()).toHaveLength(1)
    expect(items()[0]['data-notification-count']).toBe(2)
    expect(items()[0].message).toHaveProperty('props.message', 'second')
  })

  it('a new reason still replaces without inheriting the old count', () => {
    push({ id: 'n', reason: 'server', occurrence: 'a', message: 'x', type: 'warning' })
    push({ id: 'n', reason: 'server', occurrence: 'b', message: 'x', type: 'warning' })
    push({ id: 'n', reason: 'input', occurrence: 'c', message: 'y', type: 'warning' })
    expect(items()[0]['data-notification-count']).toBe(1)
  })

  it('callers that give no occurrence keep the old contract: every push is one occurrence', () => {
    for (let index = 0; index < 3; index += 1) push({ id: 'legacy', reason: 'failed', message: 'x', type: 'error' })
    expect(items()).toHaveLength(1)
    expect(items()[0]['data-notification-count']).toBe(3)
  })

  it('remembers the newest 200 closed occurrences in close order', () => {
    const announce = (index: number) => push({ id: `cache:${index}`, occurrence: 'once', message: 'x', type: 'warning', ttl: false })
    for (let index = 0; index <= 200; index += 1) {
      announce(index)
      notifications.hide(`cache:${index}`)
    }
    announce(1)
    expect(items()).toHaveLength(0)
    announce(0)
    expect(items().map(item => item.id)).toEqual(['cache:0'])
  })

  it('an occurrence that was closed is not brought back by the next re-announcement; the next event is', () => {
    push({ id: 'node-recovery:n1', reason: 'server', occurrence: 'run-1@10', message: 'failed', type: 'warning', ttl: false })
    notifications.hide('node-recovery:n1') // 用户点了 ×
    expect(items()).toHaveLength(0)

    push({ id: 'node-recovery:n1', reason: 'server', occurrence: 'run-1@10', message: 'failed', type: 'warning', ttl: false })
    expect(items()).toHaveLength(0)

    push({ id: 'node-recovery:n1', reason: 'server', occurrence: 'run-2@20', message: 'failed again', type: 'warning', ttl: false })
    expect(items()).toHaveLength(1)
    expect(items()[0]['data-notification-count']).toBe(1)
  })
})

function controllableValidity() {
  let valid = true
  const listeners = new Set<() => void>()
  const unsubscribe = vi.fn((listener: () => void) => { listeners.delete(listener) })
  const validity: ToastValidity = {
    isValid: () => valid,
    subscribe: (recheck) => { listeners.add(recheck); return () => unsubscribe(recheck) },
  }
  return {
    validity,
    unsubscribe,
    listeners,
    set(next: boolean) { valid = next },
    fire() { for (const listener of [...listeners]) listener() },
  }
}

describe('validWhile: a toast whose premise stopped holding is withdrawn on the state change, not on a timer', () => {
  it('stays while the premise holds and is removed the moment a recheck says it no longer does', () => {
    const watched = controllableValidity()
    push({ id: 'n', reason: 'x', message: 'failed', type: 'warning', ttl: false, validWhile: watched.validity })
    expect(items()).toHaveLength(1)
    watched.fire()
    expect(items()).toHaveLength(1)

    watched.set(false)
    watched.fire()
    expect(items()).toHaveLength(0)
  })

  it('unsubscribes when the toast goes away — by withdrawal, by the user closing it, by removal, or by replacement', () => {
    const cases: Array<[string, (id: string) => void]> = [
      ['user close', (id) => notifications.hide(id)],
      ['programmatic remove', (id) => useToastStore.getState().remove(id)],
      ['replaced by a newer push under the same id', (id) => push({ id, reason: 'x', message: 'newer', type: 'warning', ttl: false })],
    ]
    for (const [, dismiss] of cases) {
      notifications.clean()
      const watched = controllableValidity()
      push({ id: 'n', reason: 'x', message: 'failed', type: 'warning', ttl: false, validWhile: watched.validity })
      expect(watched.listeners.size).toBe(1)
      dismiss('n')
      expect(watched.listeners.size).toBe(0)
      expect(watched.unsubscribe).toHaveBeenCalledTimes(1)
    }
  })

  it('a withdrawal ends the watch too, and a later recheck cannot touch a newer toast that reuses the id', () => {
    const watched = controllableValidity()
    push({ id: 'n', reason: 'x', message: 'failed', type: 'warning', ttl: false, validWhile: watched.validity })
    watched.set(false)
    watched.fire()
    expect(watched.listeners.size).toBe(0)

    push({ id: 'n', reason: 'x', message: 'another one', type: 'warning', ttl: false })
    watched.fire() // 旧监视已退订，什么都不该发生
    expect(items()).toHaveLength(1)
  })

  it('a premise check that throws counts as not holding (better one notice fewer than a stale one)', () => {
    let listener: (() => void) | null = null
    push({
      id: 'n', reason: 'x', message: 'failed', type: 'warning', ttl: false,
      validWhile: { isValid: () => { throw new Error('boom') }, subscribe: (recheck) => { listener = recheck; return () => {} } },
    })
    listener!()
    expect(items()).toHaveLength(0)
  })
})
