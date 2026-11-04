import { describe, expect, it } from 'vitest'
import { ASSISTANT_CONTENT_FLOOR, ASSISTANT_WIDTH_MAX, ASSISTANT_WIDTH_MIN, assistantPaneWidth, clampAssistantWidth } from '../assistantWidthBounds'
import { SHELL_GUTTER, SHELL_RAIL_WIDTH } from '../../ui/app-shell/shellGeometry'
import {
  EDITING_PANEL_BOUNDS,
  EDITING_PANEL_DEFAULTS,
  EDITING_PANEL_RAIL_WIDTH,
  editingPanelDragIntent,
  editingSidePanelDrawnOpen,
  resolveEditingStageFrame,
  resolveEditingTimelineHeight,
  type EditingPanelLayout,
  type EditingSidePanel,
  type EditingStageFrame,
} from './panelLayout'

/** 两条 1px 竖分隔线（SplitHandle w-px）。 */
const SEPARATORS = 2
/** Electron 主窗最小宽（electron/main 的 minWidth）。 */
const MIN_WINDOW_WIDTH = 1100

/** 视口宽 → 舞台行三块面板宽度之和。外壳：左栏 60 + 右缝 8；Nomi 停靠时再减它那列（宽 + 8px 缝）。 */
function stagePanelsWidth(viewport: number, assistantWidth: number | null): number {
  const assistant = assistantWidth === null ? 0 : assistantPaneWidth(clampAssistantWidth(assistantWidth, viewport))
  return viewport - SHELL_RAIL_WIDTH - SHELL_GUTTER - assistant - SEPARATORS
}

type Intent = Pick<EditingPanelLayout, 'sourceWidth' | 'inspectorWidth' | 'visibility'>
const intent = (source: boolean, inspector: boolean, sourceWidth = EDITING_PANEL_DEFAULTS.sourceWidth, inspectorWidth = EDITING_PANEL_DEFAULTS.inspectorWidth): Intent =>
  ({ sourceWidth, inspectorWidth, visibility: { source, inspector, assistant: true } })
const solve = (panelsWidth: number, layout: Intent, keep: EditingSidePanel = 'source') => resolveEditingStageFrame({ panelsWidth, layout, keep })
const row = (frame: EditingStageFrame) => [frame.source.open ? frame.source.width : 'rail', frame.preview, frame.inspector.open ? frame.inspector.width : 'rail']

describe('resolveEditingStageFrame — 2026-11-04 拍板的数字（左 / 预览 / 属性）', () => {
  // 先收属性：两栏放不下时默认留左栏「镜头 / 素材」。
  it('1280 开 Nomi（默认宽 390）：300 / 480 / 收起条', () => {
    const width = stagePanelsWidth(1280, 390)
    expect(width).toBe(812)
    expect(row(solve(width, intent(true, true)))).toEqual([300, 480, 'rail'])
  })

  it('1280 开 Nomi，点属性收起条（keep = 属性）：两边轮流开，左栏让成收起条', () => {
    const frame = solve(stagePanelsWidth(1280, 390), intent(true, true), 'inspector')
    expect(row(frame)).toEqual(['rail', 812 - 32 - 240, 240])
    expect(frame.preview).toBeGreaterThanOrEqual(EDITING_PANEL_BOUNDS.preview.min)
  })

  it('1440 开 Nomi：292 / 480 / 200（两栏都放得下，各自缩到预览回到 480）', () => {
    const width = stagePanelsWidth(1440, 390)
    expect(width).toBe(972)
    expect(row(solve(width, intent(true, true)))).toEqual([292, 480, 200])
  })

  it('1100 开 Nomi（最小窗，Nomi 被夹到 340）：240 / 410 / 收起条；点属性条后：收起条 / 450 / 200', () => {
    const width = stagePanelsWidth(MIN_WINDOW_WIDTH, 390)
    expect(width).toBe(682)
    expect(row(solve(width, intent(true, true)))).toEqual([240, 410, 'rail'])
    expect(row(solve(width, intent(true, true), 'inspector'))).toEqual(['rail', 450, 200])
  })

  it('Nomi 关：侧栏保持用户的宽，多出来的全给预览（不再按比例撑宽）', () => {
    expect(row(solve(stagePanelsWidth(1280, null), intent(true, true)))).toEqual([300, 1210 - 300 - 240, 240])
    expect(row(solve(stagePanelsWidth(1440, null), intent(true, true)))).toEqual([300, 1370 - 300 - 240, 240])
  })

  it('1100 开 Nomi、两栏都收着：收起条就是 32，不会被拉成空白条', () => {
    const frame = solve(stagePanelsWidth(MIN_WINDOW_WIDTH, 390), intent(false, false))
    expect(frame.source).toEqual({ open: false, width: EDITING_PANEL_RAIL_WIDTH })
    expect(frame.inspector).toEqual({ open: false, width: EDITING_PANEL_RAIL_WIDTH })
    expect(frame.preview).toBe(682 - 64)
  })
})

describe('resolveEditingStageFrame — 这一类的全部形状（视口 × Nomi 宽 × 开合 × 栏宽 × 留哪边）', () => {
  const viewports: number[] = []
  for (let viewport = MIN_WINDOW_WIDTH; viewport <= 2560; viewport += 10) viewports.push(viewport)
  const assistants = [null, ASSISTANT_WIDTH_MIN, 340, EDITING_PANEL_DEFAULTS.assistantWidth, ASSISTANT_WIDTH_MAX]
  const sourceWidths = [EDITING_PANEL_BOUNDS.source.min, EDITING_PANEL_DEFAULTS.sourceWidth, EDITING_PANEL_BOUNDS.source.max]
  const inspectorWidths = [EDITING_PANEL_BOUNDS.inspector.min, EDITING_PANEL_DEFAULTS.inspectorWidth, EDITING_PANEL_BOUNDS.inspector.max]
  const visibilities = [[true, true], [true, false], [false, true], [false, false]] as const
  const keeps: EditingSidePanel[] = ['source', 'inspector']

  type Case = { viewport: number; assistant: number | null; layout: Intent; keep: EditingSidePanel }
  const cases: Case[] = []
  for (const viewport of viewports) for (const assistant of assistants) for (const [source, inspector] of visibilities)
    for (const sourceWidth of sourceWidths) for (const inspectorWidth of inspectorWidths) for (const keep of keeps)
      cases.push({ viewport, assistant, layout: intent(source, inspector, sourceWidth, inspectorWidth), keep })

  it('最窄的舞台行仍是 684（Nomi 宽上限 = 视口 − 760），floor 400 由它推出', () => {
    const narrowest = Math.min(...cases.map(({ viewport, assistant }) => stagePanelsWidth(viewport, assistant)))
    expect(narrowest + SEPARATORS).toBe(ASSISTANT_CONTENT_FLOOR - SHELL_RAIL_WIDTH - SHELL_GUTTER * 2)
    expect(narrowest - EDITING_PANEL_BOUNDS.source.min - EDITING_PANEL_RAIL_WIDTH).toBeGreaterThanOrEqual(EDITING_PANEL_BOUNDS.preview.floor)
    expect(narrowest - EDITING_PANEL_BOUNDS.inspector.min - EDITING_PANEL_RAIL_WIDTH).toBeGreaterThanOrEqual(EDITING_PANEL_BOUNDS.preview.floor)
  })

  it(`每一种（${cases.length} 种）：侧栏要么有可读宽度要么是收起条、加起来正好铺满、预览不低于 400`, () => {
    for (const { viewport, assistant, layout, keep } of cases) {
      const width = stagePanelsWidth(viewport, assistant)
      const frame = solve(width, layout, keep)
      const label = JSON.stringify({ viewport, assistant, layout, keep, frame })
      for (const panel of ['source', 'inspector'] as const) {
        const side = frame[panel]
        if (side.open) {
          expect(side.width, label).toBeGreaterThanOrEqual(EDITING_PANEL_BOUNDS[panel].min)
          expect(side.width, label).toBeLessThanOrEqual(EDITING_PANEL_BOUNDS[panel].max)
          expect(editingSidePanelDrawnOpen(panel, side.width), label).toBe(true)
        } else {
          expect(side.width, label).toBe(EDITING_PANEL_RAIL_WIDTH)
          expect(editingSidePanelDrawnOpen(panel, side.width), label).toBe(false)
        }
        // 用户关掉的栏，求解永远不替他打开。
        if (!layout.visibility[panel]) expect(side.open, label).toBe(false)
        // 宽度只会被缩、不会被撑：多出来的空间归预览。
        if (side.open) expect(side.width, label).toBeLessThanOrEqual(Math.max(EDITING_PANEL_BOUNDS[panel].min, panel === 'source' ? layout.sourceWidth : layout.inspectorWidth))
      }
      expect(frame.source.width + frame.preview + frame.inspector.width, label).toBe(width)
      expect(frame.preview, label).toBeGreaterThanOrEqual(EDITING_PANEL_BOUNDS.preview.floor)
      expect(frame.previewMin, label).toBeLessThanOrEqual(frame.preview)
      // 两栏都开着时预览至少 480；只有一栏开着时才可能让到 400。
      if (frame.source.open && frame.inspector.open) expect(frame.preview, label).toBeGreaterThanOrEqual(EDITING_PANEL_BOUNDS.preview.min)
      // 点开的那一栏（keep，且它是开着的意图）在支持的窗口宽里永远看得到：点收起条一定有用。
      if (layout.visibility[keep]) expect(frame[keep].open, label).toBe(true)
    }
  })

  it('窗口变宽，被自动收起的栏自己回来：开着的栏在更宽的窗口里不会变成收起条', () => {
    for (const assistant of assistants) for (const [source, inspector] of visibilities) for (const keep of keeps) {
      const layout = intent(source, inspector)
      let previous: EditingStageFrame | null = null
      for (const viewport of viewports) {
        const frame = solve(stagePanelsWidth(viewport, assistant), layout, keep)
        if (previous && stagePanelsWidth(viewport, assistant) >= stagePanelsWidth(viewport - 10, assistant)) {
          for (const panel of ['source', 'inspector'] as const) {
            if (previous[panel].open) expect(frame[panel].open, JSON.stringify({ viewport, assistant, layout, keep })).toBe(true)
          }
        }
        previous = frame
      }
      // 足够宽时，用户开着的栏全部回到他的宽。
      const wide = solve(stagePanelsWidth(2560, assistant), layout, keep)
      expect(wide.source).toEqual(source ? { open: true, width: layout.sourceWidth } : { open: false, width: EDITING_PANEL_RAIL_WIDTH })
      expect(wide.inspector).toEqual(inspector ? { open: true, width: layout.inspectorWidth } : { open: false, width: EDITING_PANEL_RAIL_WIDTH })
    }
  })

  it('只开一栏时它就是留下的那一栏（keep 指着关掉的那栏也不会把开着的那栏收掉）', () => {
    const width = stagePanelsWidth(MIN_WINDOW_WIDTH, 390)
    // 留下的那栏缩到最小宽，预览从 480 让到 410 / 450（≥ 400）。
    expect(row(solve(width, intent(true, false), 'inspector'))).toEqual([240, 410, 'rail'])
    expect(row(solve(width, intent(false, true), 'source'))).toEqual(['rail', 450, 200])
  })

  it('比最小窗还窄（测试或异常显示器）：留下的那栏也收成条，绝不画挤着的展开内容', () => {
    const frame = solve(500, intent(true, true))
    expect(row(frame)).toEqual(['rail', 500 - 64, 'rail'])
  })
})

describe('editingPanelDragIntent — 只有用户亲手拖完才写回存档', () => {
  const frame = solve(stagePanelsWidth(1440, null), intent(true, true))

  it('拖成收起条 → 关掉这一栏', () => {
    expect(editingPanelDragIntent(frame, { source: EDITING_PANEL_RAIL_WIDTH, inspector: 240 }, 'source'))
      .toEqual({ visibility: { source: false }, sizes: {}, keep: null })
  })

  it('从收起条拖开 → 打开、记宽，并成为放不下时留下的那一栏', () => {
    const narrow = solve(stagePanelsWidth(1280, 390), intent(true, true))
    expect(narrow.inspector.open).toBe(false)
    expect(editingPanelDragIntent(narrow, { source: 300, inspector: 212.4 }, 'inspector'))
      .toEqual({ visibility: { inspector: true }, sizes: { inspectorWidth: 212 }, keep: 'inspector' })
  })

  it('只改宽 → 记宽；抓的是哪条分隔线就留哪一栏', () => {
    expect(editingPanelDragIntent(frame, { source: 360.6, inspector: 240 }, 'source'))
      .toEqual({ visibility: {}, sizes: { sourceWidth: 361 }, keep: 'source' })
    // 拖左边分隔线时预览被挤、属性跟着缩：两栏宽都记下，留的是被抓的那栏。
    expect(editingPanelDragIntent(frame, { source: 400, inspector: 220 }, 'source'))
      .toEqual({ visibility: {}, sizes: { sourceWidth: 400, inspectorWidth: 220 }, keep: 'source' })
  })

  it('像素没动（≤ 1px 的取整抖动）→ 什么都不写', () => {
    expect(editingPanelDragIntent(frame, { source: 300.8, inspector: 239.4 }, 'inspector'))
      .toEqual({ visibility: {}, sizes: {}, keep: null })
  })
})

describe('resolveEditingTimelineHeight — 窗口变矮不改存下的时间轴高度', () => {
  it('放得下就是用户的高度', () => {
    expect(resolveEditingTimelineHeight(880, 260)).toBe(260)
  })

  it('窗口矮到放不下时只压这一刻的高度，给舞台行留住 260，最低 140', () => {
    expect(resolveEditingTimelineHeight(480, 300)).toBe(480 - EDITING_PANEL_BOUNDS.stage.min)
    expect(resolveEditingTimelineHeight(300, 300)).toBe(EDITING_PANEL_BOUNDS.timeline.min)
  })

  it('越界的存档值夹回上下限', () => {
    expect(resolveEditingTimelineHeight(2000, 900)).toBe(EDITING_PANEL_BOUNDS.timeline.max)
    expect(resolveEditingTimelineHeight(2000, 10)).toBe(EDITING_PANEL_BOUNDS.timeline.min)
  })
})
