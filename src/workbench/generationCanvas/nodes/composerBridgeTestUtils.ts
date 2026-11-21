// Test-only：生成框（NodeGenerationComposer）测试共用的假桌面桥。不进产品路径。
// 生成框挂上时一定会读的口在这里统一回答，各测试只覆盖和自己有关的数据（模型、项目、素材）。
// 生成框以后多读一个口，只在 MOUNT_READS 加一行；不会再出现某份副本漏答、回 undefined 让 .then 炸掉。
// 不引 vitest（渲染层依赖清单会把它当成产品依赖）：这里只造窗口对象，由测试 vi.stubGlobal('window', …) 装上。

export type BridgeAnswers = Record<string, (...args: unknown[]) => unknown>
/**
 * 想记账的测试传进来：每次桥调用记进 io，订阅类 on* 记进 listeners。
 * 给了 pending 就记还没落定的事：排着的 window.setTimeout（约价的防抖读价、旧数暂留到期）和还没回来的桥调用——
 * 要「挂上后什么都落定了再开始数」的测试按它等，不按毫秒猜（见 composerMountBudget.test 的 settleIdle）。
 */
export type PendingWork = { timers: Set<unknown>; calls: number }
export type BridgeProbe = { io?: string[]; listeners?: string[]; pending?: PendingWork }

const MOUNT_READS: BridgeAnswers = {
  'modelCatalog.listMappings': () => [],
  'projects.listAsync': async () => [],
  'assets.list': async () => ({ items: [], cursor: null }),
  'settings.generationModelDefaults.get': async () => ({ schemaVersion: 1, byTaskKind: {} }),
  'promptLibrary.list': async () => ({ ok: true, prompts: [] }),
  'promptLibrary.userList': async () => ({ ok: true, prompts: [] }),
  // 发送键约价：生成框挂上后防抖读一次公开价；默认答「算不出」。
  'onboarding.vendorPricePreview': async () => null,
}

function recordingBridge(answers: BridgeAnswers, probe: BridgeProbe): unknown {
  const make = (path: string[]): unknown => new Proxy(function bridgeMember() {}, {
    get: (_target, key) => (typeof key === 'symbol' || key === 'then' ? undefined : make([...path, key])),
    apply: (_target, _self, args: unknown[]) => {
      const name = path.join('.')
      if (/(^|\.)on[A-Z]/.test(name)) { probe.listeners?.push(name); return () => undefined }
      probe.io?.push(name)
      const answer = answers[name]?.(...args)
      const pending = probe.pending
      if (pending && typeof (answer as PromiseLike<unknown> | undefined)?.then === 'function') {
        pending.calls += 1
        const done = (): void => { pending.calls -= 1 }
        ;(answer as PromiseLike<unknown>).then(done, done)
      }
      return answer
    },
  })
  return make([])
}

/** 带假桥的 window 对象；`answers` 覆盖 MOUNT_READS 里的同名口。用法：vi.stubGlobal('window', composerWindow(ANSWERS, probe))。 */
export function composerWindow(answers: BridgeAnswers, probe: BridgeProbe = {}): Record<string, unknown> {
  const listeners = new Map<string, Set<(event: Event) => void>>()
  return {
    nomiDesktop: recordingBridge({ ...MOUNT_READS, ...answers }, probe),
    addEventListener: (type: string, listener: (event: Event) => void) => {
      if (!listeners.has(type)) listeners.set(type, new Set())
      listeners.get(type)!.add(listener)
    },
    removeEventListener: (type: string, listener: (event: Event) => void) => listeners.get(type)?.delete(listener),
    dispatchEvent: (event: Event) => { for (const listener of listeners.get(event.type) ?? []) listener(event); return true },
    ...trackedTimers(probe.pending),
  }
}

function trackedTimers(pending: PendingWork | undefined): { setTimeout: typeof setTimeout; clearTimeout: typeof clearTimeout } {
  if (!pending) return { setTimeout, clearTimeout }
  const track = ((handler: (...args: unknown[]) => void, ms?: number, ...args: unknown[]) => {
    const id = setTimeout(() => { pending.timers.delete(id); handler(...args) }, ms)
    pending.timers.add(id)
    return id
  }) as typeof setTimeout
  const clear = ((id: Parameters<typeof clearTimeout>[0]) => { pending.timers.delete(id); clearTimeout(id) }) as typeof clearTimeout
  return { setTimeout: track, clearTimeout: clear }
}
