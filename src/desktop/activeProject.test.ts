import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const KEY = 'nomi-workbench-last-active-project-v1'

// 测试环境是 node（无 jsdom），用最小 localStorage 桩模拟 window。
const store = new Map<string, string>()
const localStorageStub = {
  getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
}

describe('getDesktopActiveProjectId（projectId 缺失窗口的兜底）', () => {
  beforeEach(() => {
    store.clear()
    vi.stubGlobal('window', { localStorage: localStorageStub })
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.resetModules()
  })

  it('内存全局有值时直接返回它', async () => {
    const { getDesktopActiveProjectId, setDesktopActiveProjectId } = await import('./activeProject')
    setDesktopActiveProjectId(' proj-A ')
    expect(getDesktopActiveProjectId()).toBe('proj-A')
  })

  it('setter 尚未运行（React effect 还没赋值的窗口）→ 回退到持久化的 last-active id', async () => {
    store.set(KEY, 'proj-persisted')
    const { getDesktopActiveProjectId } = await import('./activeProject')
    // 这正是修复点：以前这里返回空 → 生成图拿到会过期的厂商临时 URL、上传退回 base64
    expect(getDesktopActiveProjectId()).toBe('proj-persisted')
  })

  it('内存有值时优先于持久化值', async () => {
    const { getDesktopActiveProjectId, setDesktopActiveProjectId } = await import('./activeProject')
    setDesktopActiveProjectId('proj-current')
    store.set(KEY, 'proj-stale')
    expect(getDesktopActiveProjectId()).toBe('proj-current')
  })

  it('显式清空后不再回退到上一个持久化项目', async () => {
    store.set(KEY, 'proj-stale')
    const { getDesktopActiveProjectId, setDesktopActiveProjectId } = await import('./activeProject')
    setDesktopActiveProjectId(null)
    expect(getDesktopActiveProjectId()).toBe('')
  })

  it('两者都空时返回空字符串（不抛错）', async () => {
    const { getDesktopActiveProjectId } = await import('./activeProject')
    expect(getDesktopActiveProjectId()).toBe('')
  })
})
