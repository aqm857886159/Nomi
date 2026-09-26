import fs from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { dockCollapsedByDefault, readDockCollapsed, writeDockCollapsed, type BottomDock } from './dockCollapsePrefs'

const DOCKS: BottomDock[] = ['timelinePanel', 'timelineMiniPreview', 'canvasMinimap']

// vitest 跑在 node 环境，没有 localStorage：装一个最小内存实现（同 timelinePanelLayout.test.ts）。
// 被测的是「偏好读写是否闭环、默认值对不对」，不是浏览器实现本身。
function installStorage({ throws = false } = {}) {
  const store = new Map<string, string>()
  const guard = <T,>(run: () => T): T => { if (throws) throw new Error('blocked'); return run() }
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => guard(() => store.get(key) ?? null),
      setItem: (key: string, value: string) => guard(() => { store.set(key, String(value)) }),
      removeItem: (key: string) => { store.delete(key) },
      clear: () => { store.clear() },
      key: () => null,
      length: 0,
    },
  })
}

describe('dockCollapsePrefs（底部区域收起偏好的唯一 owner）', () => {
  beforeEach(() => installStorage())
  afterEach(() => vi.restoreAllMocks())

  it('reported case: a user who never chose sees the PiP and the minimap collapsed (2026-09-26)', () => {
    expect(readDockCollapsed('timelineMiniPreview')).toBe(true)
    expect(readDockCollapsed('canvasMinimap')).toBe(true)
  })

  it.each(DOCKS)('%s: never chosen → default collapsed; expanded once → stays expanded; collapsed again → collapsed', (dock) => {
    expect(dockCollapsedByDefault(dock)).toBe(true)
    expect(readDockCollapsed(dock)).toBe(true)
    writeDockCollapsed(dock, false)
    expect(readDockCollapsed(dock)).toBe(false)
    writeDockCollapsed(dock, true)
    expect(readDockCollapsed(dock)).toBe(true)
  })

  it('keeps the keys that already shipped, so a user who expanded the PiP before is not reset', () => {
    globalThis.localStorage.setItem('nomi.timelineMiniPreview.collapsed', '0')
    globalThis.localStorage.setItem('nomi.timelinePanel.collapsed', '0')
    expect(readDockCollapsed('timelineMiniPreview')).toBe(false)
    expect(readDockCollapsed('timelinePanel')).toBe(false)
  })

  it('the three docks do not share a key (one choice never flips another dock)', () => {
    writeDockCollapsed('canvasMinimap', false)
    expect(readDockCollapsed('timelineMiniPreview')).toBe(true)
    expect(readDockCollapsed('timelinePanel')).toBe(true)
  })

  it('falls back to the default when storage throws (private window / blocked site data)', () => {
    installStorage({ throws: true })
    for (const dock of DOCKS) {
      expect(() => writeDockCollapsed(dock, false)).not.toThrow()
      expect(readDockCollapsed(dock)).toBe(dockCollapsedByDefault(dock))
    }
  })

  it('class: no other source file reads or writes these keys directly', () => {
    const root = path.resolve(__dirname, '../..')
    const owner = path.resolve(__dirname, 'dockCollapsePrefs.ts')
    const keys = ['nomi.timelinePanel.collapsed', 'nomi.timelineMiniPreview.collapsed', 'nomi.canvasMinimap.collapsed']
    const offenders: string[] = []
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name)
        if (entry.isDirectory()) walk(full)
        else if (/\.(ts|tsx)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) && full !== owner) {
          const source = fs.readFileSync(full, 'utf8')
          if (keys.some((key) => source.includes(key))) offenders.splice(offenders.length, 0, path.relative(root, full))
        }
      }
    }
    walk(root)
    expect(offenders).toEqual([])
  })
})
