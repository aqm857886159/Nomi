import { describe, expect, it, beforeEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { useWorkbenchStore } from '../workbenchStore'
import { TIMELINE_PANEL_DEFAULT, TIMELINE_PANEL_MAX, TIMELINE_PANEL_MIN, clampTimelinePanelHeight } from './timelinePanelBounds'
import { TIMELINE_PANEL_COLLAPSED_DEFAULT, readTimelinePanelCollapsed, writeTimelinePanelCollapsed } from './timelinePanelPrefs'

const source = fs.readFileSync(path.join(process.cwd(), 'src/workbench/timeline/TimelinePanel.tsx'), 'utf8')

/**
 * 原有不变量（本文件既有内容，2026-09-10 工具条改行时保留）：轨道视口必须能纵向滚动。
 *
 * 判据从「整份源码不许出现 `overflow-x-auto overflow-y-hidden`」收窄到「**轨道容器**里
 * 不许出现」：工具条头部行正当地需要 `overflow-y-hidden`（它只横向滚动），整份文件的字面量
 * 检查会把它误判成轨道视口失去纵向滚动。要守的从来是轨道视口那一处。
 */
describe('timeline panel overflow layout', () => {
  const tracksBlock = source.slice(
    source.indexOf("'workbench-timeline__tracks'"),
    source.indexOf("'workbench-timeline__ruler'"),
  )

  it('keeps the track viewport vertically scrollable when derived rows exceed panel height', () => {
    expect(tracksBlock.length).toBeGreaterThan(0)
    expect(tracksBlock).toContain('overflow-y-auto')
    expect(tracksBlock).not.toContain('overflow-y-hidden')
    expect(source).toContain('const showTextChip = showTextTrack')
    expect(source).toContain('{showTextTrack ? <TimelineTextTrack /> : null}')
    expect(source).toContain('new ResizeObserver(update)')
  })
})

/**
 * 类级不变量（根因合同 2026-09-10-timeline-toolbar-overlay）：
 * **时间轴面板里的常驻控件必须占一行真实布局，不许当浮层盖在标尺/轨道上。**
 * 这里断的是「工具条不是 absolute + 面板给它留了行」这个结构条件本身——
 * 走查断的是真实 rect 不相交，两条一起才盖住「浮层化回来」这一类。
 */
describe('时间轴工具条 = 参与布局的头部行', () => {
  const toolbarBlock = source.slice(
    source.indexOf("'workbench-timeline__controls'"),
    source.indexOf('workbench-timeline__tracks'),
  )

  it('面板为工具条留了一行（auto）再给轨道区剩余空间', () => {
    expect(source).toContain('grid-rows-[auto_minmax(0,1fr)]')
  })

  it('工具条容器不再是绝对定位浮层', () => {
    expect(toolbarBlock.length).toBeGreaterThan(0)
    expect(toolbarBlock).not.toMatch(/'absolute /)
    expect(toolbarBlock).not.toContain('z-[8]')
    expect(toolbarBlock).not.toContain('backdrop-blur')
  })

  it('放不下时整行横向滚动，簇内不换行', () => {
    expect(toolbarBlock).toContain('overflow-x-auto')
    expect(toolbarBlock).not.toContain('flex-wrap')
  })

  it('三簇 legend 分组与图标原样保留（09-05 合同 §2.7）', () => {
    for (const key of ['toolbar.thisSegment', 'toolbar.wholeFilm', 'toolbar.view']) {
      expect(toolbarBlock).toContain(key)
    }
    for (const icon of ['IconScissors', 'IconCopy', 'IconTrash', 'IconWand', 'IconArrowBackUp', 'IconArrowForwardUp', 'IconMagnet', 'IconZoomOut', 'IconViewportWide', 'IconZoomIn']) {
      expect(toolbarBlock).toContain(icon)
    }
  })

  it('行尾有收起钮，且用的是现役折叠原子而不是文字按钮', () => {
    expect(toolbarBlock).toContain('data-timeline-collapse="true"')
    expect(toolbarBlock).toContain('IconChevronDown')
    expect(toolbarBlock).toContain("t('timelineEditor.collapsePanel')")
  })

  it('onCollapse 真的被用上了（不再是下划线弃用形参）', () => {
    expect(source).not.toContain('_onCollapse')
    expect(source).toContain('onClick={onCollapse}')
  })
})

describe('面板高度下限 = 只剩头部行', () => {
  it('下限比一条轨道更矮，且等于「面板内边距 + 工具条行」', () => {
    // 12(pt-3) + 16(pb-4) + 8 + (1+4+32+4+1) + 8
    expect(TIMELINE_PANEL_MIN).toBe(86)
    expect(TIMELINE_PANEL_MIN).toBeLessThan(140)
  })

  it('钳制仍然守住上下限与默认值', () => {
    expect(clampTimelinePanelHeight(1)).toBe(TIMELINE_PANEL_MIN)
    expect(clampTimelinePanelHeight(9999)).toBe(TIMELINE_PANEL_MAX)
    expect(clampTimelinePanelHeight(Number.NaN)).toBe(TIMELINE_PANEL_DEFAULT)
  })
})

describe('收起状态记在本机偏好里', () => {
  // vitest 跑在 node 环境（vitest.config.ts:17），没有 localStorage。装一个最小内存实现——
  // 被测的是「偏好读写是否闭环」，不是浏览器实现本身。
  beforeEach(() => {
    const store = new Map<string, string>()
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => { store.set(key, String(value)) },
        removeItem: (key: string) => { store.delete(key) },
        clear: () => { store.clear() },
        key: () => null,
        length: 0,
      },
    })
  })

  it('没存过时用默认值（收起）', () => {
    expect(readTimelinePanelCollapsed()).toBe(TIMELINE_PANEL_COLLAPSED_DEFAULT)
  })

  it('写过之后读得回来（展开 / 收起两个方向都要）', () => {
    writeTimelinePanelCollapsed(false)
    expect(readTimelinePanelCollapsed()).toBe(false)
    writeTimelinePanelCollapsed(true)
    expect(readTimelinePanelCollapsed()).toBe(true)
  })

  it('store 的 setter 顺手落盘，不只改内存', () => {
    useWorkbenchStore.getState().setTimelinePanelCollapsed(false)
    expect(readTimelinePanelCollapsed()).toBe(false)
    useWorkbenchStore.getState().setTimelinePanelCollapsed(true)
    expect(readTimelinePanelCollapsed()).toBe(true)
  })
})
