import { z } from 'zod'
import { ASSISTANT_WIDTH_MIN, ASSISTANT_WIDTH_MAX, clampAssistantWidth } from '../assistantWidthBounds'
export type EditingPanelPreset = 'default' | 'focus' | 'result' | 'portrait' | 'custom'

export type EditingPanelVisibility = {
  source: boolean
  inspector: boolean
  assistant: boolean
}

export type EditingPanelLayout = {
  sourceWidth: number
  inspectorWidth: number
  assistantWidth: number
  timelineHeight: number
  visibility: EditingPanelVisibility
  preset: EditingPanelPreset
}

export const EDITING_PANEL_DEFAULTS: EditingPanelLayout = {
  sourceWidth: 300,
  inspectorWidth: 240,
  assistantWidth: 390,
  timelineHeight: 260,
  visibility: { source: true, inspector: true, assistant: true },
  preset: 'default',
}

export const EDITING_PANEL_PRESETS: Record<Exclude<EditingPanelPreset, 'custom'>, EditingPanelLayout> = {
  default: EDITING_PANEL_DEFAULTS,
  focus: { ...EDITING_PANEL_DEFAULTS, visibility: { source: false, inspector: false, assistant: true }, preset: 'focus' },
  result: { ...EDITING_PANEL_DEFAULTS, visibility: { source: false, inspector: false, assistant: false }, preset: 'result' },
  portrait: { ...EDITING_PANEL_DEFAULTS, sourceWidth: 260, inspectorWidth: 220, assistantWidth: 320, timelineHeight: 240, preset: 'portrait' },
}

/**
 * 合同 §2.1 的默认 / 最小尺寸表，**像素**。
 * react-resizable-panels v4 把数字当像素、把无单位字符串当百分比，所以这张表就是面板 props 本身，
 * 无需换算——单一真相，改这里等于改界面与 Agent 契约两处。
 */
export const EDITING_PANEL_BOUNDS = {
  source: { min: 240, max: 520 },
  inspector: { min: 200, max: 420 },
  assistant: { min: ASSISTANT_WIDTH_MIN, max: ASSISTANT_WIDTH_MAX },
  timeline: { min: 140, max: 360 },
  /**
   * 预览列不可收起。min = 两侧栏都开着时预览至少留的宽（合同 §2.1）：不够就先把让出的那一栏收成条。
   * floor = 留下的那一栏放不下时，预览最多让到的宽（2026-11-04 拍板）。它由最窄内容区推出：
   * Nomi 停靠时（窗宽 ≥ 1060，2026-11-07 窄窗拍板 D3）舞台行至少 684（= ASSISTANT_CONTENT_FLOOR 760 − 左栏 60 − 两条 8px 缝），
   * 684 − 两条 1px 分隔 − 左栏最小 240 − 收起条 32 = 410 ≥ 400，点开的那一栏放得下。
   * 最小窗 700（窄窗拍板 D1）时 Nomi 不停靠，舞台行约 632：632 − 2 − 240 − 32 = 358 < 400，走到下面第⑤步——
   * 窗宽约 740 以下，点开的那一栏也收成条、预览拿满。已知限制（用户 2026-11-08「A 记为已知限制」）：窗宽 700–约 740 时
   * 素材 / 属性栏点不开，要先拉宽窗口；756、960 不受影响。行为不改，底线仍是 400。
   */
  preview: { min: 480, floor: 400 },
  /** 舞台行（预览 + 左右两栏）的高度下限，给时间轴让出 260 后仍能站住画面。 */
  stage: { min: 260 },
} as const

/** 收起后的图标条宽度（合同 §2.1：32px）。 */
export const EDITING_PANEL_RAIL_WIDTH = 32

export type EditingPanelSizeKey = 'sourceWidth' | 'inspectorWidth' | 'assistantWidth' | 'timelineHeight'

/** 预览页能收成收起条的两侧栏（Nomi 那列不在面板组里，收起后由顶栏角标叫回）。 */
export type EditingSidePanel = 'source' | 'inspector'
const SIDE_PANELS: readonly EditingSidePanel[] = ['source', 'inspector']
const WIDTH_KEY: Record<EditingSidePanel, 'sourceWidth' | 'inspectorWidth'> = { source: 'sourceWidth', inspector: 'inspectorWidth' }
const otherSide = (panel: EditingSidePanel): EditingSidePanel => (panel === 'source' ? 'inspector' : 'source')

/** 一块侧栏这一刻画成什么：展开（width ≥ 它的最小宽）或收起条（width = 收起条宽）。 */
export type EditingSideFrame = { open: boolean; width: number }

/**
 * 舞台行这一刻的实际布局。**只派生、不存储**：存档（editingPanelLayout）只记用户想要的开合与宽度，
 * 窗口多宽、Nomi 开没开都不是用户改主意（同 assistantWidthBounds「窄窗不偷改当前宽」）。
 * previewMin 喂给面板库当预览的 minSize：平时 480，留下的那一栏放不下时就是这一刻的预览宽（≥ floor）。
 */
export type EditingStageFrame = {
  source: EditingSideFrame
  inspector: EditingSideFrame
  preview: number
  previewMin: number
}

/**
 * 按真实空间把用户意图落成舞台行布局——面板库和栏里画什么都听它，这样「画成什么」和「多宽」只有一个出处。
 * （2026-11-04：此前栏里画展开还是收起条读存档开关、多宽由面板库按空间算，1280 宽开着 Nomi 时
 * 三栏最小宽 920 > 舞台 814，面板库把左栏吸成 32px，栏里仍画展开内容，空态一字一行竖排。）
 *
 * `panelsWidth` = 三块面板宽度之和（不含分隔条，与面板库算百分比的基数相同）。
 * `keep` = 两栏放不下时留哪边（用户最近点开的那边；默认左栏，2026-11-04 用户拍板「先收属性」）。
 * 只开着一栏时它就是留下的那一栏。依次让步：
 *   ① 让出的那栏缩到最小 → ② 留下的缩到最小（都只为让预览回到 480）
 *   → ③ 让出的那栏收成条，留下的回到想要的宽（到预览 480 为止）
 *   → ④ 留下的那栏维持最小宽，预览从 480 让到 400 → ⑤ 还不够（Nomi 不停靠、窗宽约 740 以下）留下的也收成条。
 * 放得下多出来的宽度全给预览，侧栏保持用户的宽。
 */
export function resolveEditingStageFrame(input: {
  panelsWidth: number
  layout: Pick<EditingPanelLayout, 'sourceWidth' | 'inspectorWidth' | 'visibility'>
  keep: EditingSidePanel
}): EditingStageFrame {
  const total = Math.max(0, Math.round(input.panelsWidth))
  const rail = EDITING_PANEL_RAIL_WIDTH
  const { min: comfort, floor } = EDITING_PANEL_BOUNDS.preview
  const intentOpen = { source: input.layout.visibility.source, inspector: input.layout.visibility.inspector }
  const kept: EditingSidePanel = intentOpen[input.keep] || !intentOpen[otherSide(input.keep)] ? input.keep : otherSide(input.keep)
  const yielding = otherSide(kept)
  const want = {
    source: clamp(input.layout.sourceWidth, EDITING_PANEL_BOUNDS.source),
    inspector: clamp(input.layout.inspectorWidth, EDITING_PANEL_BOUNDS.inspector),
  }
  const open = { ...intentOpen }
  const width = { source: open.source ? want.source : rail, inspector: open.inspector ? want.inspector : rail }
  const preview = () => total - width.source - width.inspector
  const shrinkFor = (panel: EditingSidePanel, target: number) => {
    const deficit = target - preview()
    if (open[panel] && deficit > 0) width[panel] = Math.max(EDITING_PANEL_BOUNDS[panel].min, width[panel] - deficit)
  }
  const fold = (panel: EditingSidePanel) => { open[panel] = false; width[panel] = rail }

  shrinkFor(yielding, comfort)
  shrinkFor(kept, comfort)
  if (preview() < comfort && open[yielding]) {
    fold(yielding)
    if (open[kept]) width[kept] = Math.max(EDITING_PANEL_BOUNDS[kept].min, Math.min(want[kept], total - rail - comfort))
  }
  if (preview() < floor && open[kept]) fold(kept)

  const previewWidth = preview()
  return {
    source: { open: open.source, width: width.source },
    inspector: { open: open.inspector, width: width.inspector },
    preview: previewWidth,
    previewMin: Math.max(0, Math.min(comfort, previewWidth)),
  }
}

/** 一块侧栏在这个像素宽下该不该画展开内容：不到它的最小宽就画收起条，展开内容永远不会挤进窄列。 */
export function editingSidePanelDrawnOpen(panel: EditingSidePanel, pixels: number): boolean {
  return pixels >= EDITING_PANEL_BOUNDS[panel].min - 0.5
}

/** 用户亲手拖完分隔条，要写回存档的东西。 */
export type EditingPanelDragIntent = {
  visibility: Partial<Record<EditingSidePanel, boolean>>
  sizes: Partial<Record<'sourceWidth' | 'inspectorWidth', number>>
  keep: EditingSidePanel | null
}

/**
 * 写回存档的唯一规则：只在**用户亲手拖完**（面板库 onLayoutChanged 的 isUserInteraction）时调用，
 * 拿拖之前的求解结果和拖之后的真实像素比——窗口变窄、开关 Nomi、约束重算都不经过这里，
 * 所以它们永远改不动存档（此前 onResize 一律回写：关掉 Nomi 后属性栏被按比例撑到 420 还被存下）。
 *  · 拖成收起条 → 关掉这一栏（09-25「拖过最小宽变收起条」照旧）；
 *  · 从收起条拖开 → 打开并记宽，且它成为放不下时留下的那一栏；
 *  · 只是改宽 → 记宽；被抓的是哪条分隔线（grabbed）就留哪一栏，免得下一次求解把刚拖宽的栏又缩回去。
 */
export function editingPanelDragIntent(
  frame: EditingStageFrame,
  drawnPixels: Record<EditingSidePanel, number>,
  grabbed: EditingSidePanel | null,
): EditingPanelDragIntent {
  const intent: EditingPanelDragIntent = { visibility: {}, sizes: {}, keep: null }
  for (const panel of SIDE_PANELS) {
    const pixels = drawnPixels[panel]
    const drawnOpen = pixels > EDITING_PANEL_RAIL_WIDTH + 0.5
    if (frame[panel].open && !drawnOpen) intent.visibility[panel] = false
    else if (!frame[panel].open && drawnOpen) {
      intent.visibility[panel] = true
      intent.sizes[WIDTH_KEY[panel]] = Math.round(pixels)
      intent.keep = panel
    } else if (drawnOpen && Math.abs(pixels - frame[panel].width) > 1) {
      intent.sizes[WIDTH_KEY[panel]] = Math.round(pixels)
      if (grabbed === panel) intent.keep ??= panel
    }
  }
  return intent
}

/** 时间轴高度：用户想要的高度夹进上下限，并给舞台行留住它的最小高。只派生、不存储。 */
export function resolveEditingTimelineHeight(columnHeight: number, timelineHeight: number): number {
  const room = Math.max(0, Math.round(columnHeight)) - EDITING_PANEL_BOUNDS.stage.min
  return Math.max(EDITING_PANEL_BOUNDS.timeline.min, Math.min(clamp(timelineHeight, EDITING_PANEL_BOUNDS.timeline), room))
}

function clamp(value: number, bounds: { min: number; max: number }): number {
  return Math.max(bounds.min, Math.min(bounds.max, Math.round(value)))
}

export function clampEditingPanelLayout(layout: EditingPanelLayout): EditingPanelLayout {
  return {
    ...layout,
    sourceWidth: clamp(layout.sourceWidth, EDITING_PANEL_BOUNDS.source),
    inspectorWidth: clamp(layout.inspectorWidth, EDITING_PANEL_BOUNDS.inspector),
    assistantWidth: clampAssistantWidth(layout.assistantWidth, typeof window === 'undefined' ? 0 : window.innerWidth),
    timelineHeight: clamp(layout.timelineHeight, EDITING_PANEL_BOUNDS.timeline),
    visibility: { ...layout.visibility },
  }
}

export function cloneEditingPanelLayout(layout: EditingPanelLayout): EditingPanelLayout {
  return { ...layout, visibility: { ...layout.visibility } }
}

/** Persisted layout is validated before the normalizer retains it. */
export const editingPanelLayoutSchema: z.ZodType<EditingPanelLayout> = z.object({
  sourceWidth: z.number().finite(), inspectorWidth: z.number().finite(),
  assistantWidth: z.number().finite(), timelineHeight: z.number().finite(),
  visibility: z.object({ source: z.boolean(), inspector: z.boolean(), assistant: z.boolean() }),
  preset: z.custom<EditingPanelPreset>(value => typeof value === 'string' && (value === 'custom' || Object.prototype.hasOwnProperty.call(EDITING_PANEL_PRESETS, value))),
})
