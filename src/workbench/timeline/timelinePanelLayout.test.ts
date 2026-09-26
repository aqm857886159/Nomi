import { describe, expect, it, beforeEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { useWorkbenchStore } from '../workbenchStore'
import { TIMELINE_PANEL_DEFAULT, TIMELINE_PANEL_MAX, TIMELINE_PANEL_MIN, clampTimelinePanelHeight } from './timelinePanelBounds'
import { dockCollapsedByDefault, readDockCollapsed, writeDockCollapsed } from '../generation/dockCollapsePrefs'

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
  /** 滚动区 = 三簇工具那一段（行尾固定槽之前）。 */
  const scrollerBlock = source.slice(
    source.indexOf("'workbench-timeline__controls'"),
    source.indexOf("'workbench-timeline__controls-tail'"),
  )
  /** 钉住的行尾槽：帮助 + 收起，跟着面板走、不跟着滚。 */
  const tailBlock = source.slice(
    source.indexOf("'workbench-timeline__controls-tail'"),
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

  /**
   * 2026-09-13 真机反馈「不小心点了下面的时间轴收不回去了」的结构条件
   * （合同 2026-09-15-generation-shell-bottom-band）：收起入口是**面板级动作**，
   * 必须钉在不滚动的行尾槽里，而且带可见动作词——09-13 的截图里它就在行尾、
   * 是一颗无文字的 chevron，用户仍然报「收不回去」。
   */
  it('收起入口钉在行尾固定槽里，不在横向滚动区内', () => {
    expect(tailBlock.length).toBeGreaterThan(0)
    expect(tailBlock).toContain('data-timeline-collapse="true"')
    expect(scrollerBlock).not.toContain('data-timeline-collapse')
    expect(tailBlock).toContain('flex-none')
    expect(tailBlock).not.toContain('overflow-x-auto')
  })

  it('收起钮带可见动作词 + 折叠图形，hover 名字仍是长句', () => {
    expect(tailBlock).toContain('IconChevronDown')
    expect(tailBlock).toContain("{t('timelineEditor.collapse')}")
    expect(tailBlock).toContain("aria-label={t('timelineEditor.collapsePanel')}")
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

  /**
   * 2026-09-13 真机反馈「拉上来太大了，核心只要两个轨道一个图片一个视频可以预览就行」。
   * 默认高度必须由内容派生：面板内边距 + 工具条行 + 标尺行 + **两条主轨行**。
   * 这里的数字是**独立重算**（不 import 那几个私有常量），拍板前的 188 会直接打红。
   */
  it('展开态默认高度刚好装下两条主轨（图片轨 + 视频轨）', () => {
    const padding = 12 + 16 // TimelinePanel compact: pt-3 + pb-4
    const toolbarRow = 8 + (1 + 4 + 32 + 4 + 1) + 8
    const rulerRow = 22 + 6 // .workbench-timeline__ruler: h-[22px] mb-1.5
    const primaryTrackRow = 52 + 6 // TimelineTrack primary: min-h-[52px] mb-1.5
    expect(TIMELINE_PANEL_DEFAULT).toBe(padding + toolbarRow + rulerRow + 2 * primaryTrackRow)
    expect(TIMELINE_PANEL_DEFAULT).toBe(230)
    // 两条主轨装不下的那个旧值不许再回来。
    expect(TIMELINE_PANEL_DEFAULT).toBeGreaterThan(padding + toolbarRow + rulerRow + primaryTrackRow)
    // 默认值必须落在可拖区间里，否则一展开就被 clamp 成另一个数。
    expect(TIMELINE_PANEL_DEFAULT).toBeGreaterThanOrEqual(TIMELINE_PANEL_MIN)
    expect(TIMELINE_PANEL_DEFAULT).toBeLessThanOrEqual(TIMELINE_PANEL_MAX)
    expect(clampTimelinePanelHeight(TIMELINE_PANEL_DEFAULT)).toBe(TIMELINE_PANEL_DEFAULT)
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
    expect(readDockCollapsed('timelinePanel')).toBe(dockCollapsedByDefault('timelinePanel'))
  })

  it('写过之后读得回来（展开 / 收起两个方向都要）', () => {
    writeDockCollapsed('timelinePanel', false)
    expect(readDockCollapsed('timelinePanel')).toBe(false)
    writeDockCollapsed('timelinePanel', true)
    expect(readDockCollapsed('timelinePanel')).toBe(true)
  })

  it('store 的 setter 顺手落盘，不只改内存', () => {
    useWorkbenchStore.getState().setTimelinePanelCollapsed(false)
    expect(readDockCollapsed('timelinePanel')).toBe(false)
    useWorkbenchStore.getState().setTimelinePanelCollapsed(true)
    expect(readDockCollapsed('timelinePanel')).toBe(true)
  })
})
