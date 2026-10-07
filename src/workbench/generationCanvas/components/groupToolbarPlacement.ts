/**
 * 组工具条放哪儿：默认在组框上方（组名标签再往上一格）；组贴着画布顶边放不下就翻到框下方；
 * 上下都放不下（组比视口还高）就贴着舞台顶边浮在框内。三种情形工具条整条都在舞台里，不被裁。
 *
 * 工具条按屏幕像素定尺寸（随缩放反向缩放），所以这里一半用屏幕 px、一半用画布 px（flow）：
 * 画布 px = 屏幕 px / zoom；screen = flow * zoom + offset。
 */
export const GROUP_TOOLBAR_HEIGHT = 42
/** 工具条与组框 / 舞台边缘之间的最小间隙（屏幕 px）。 */
export const GROUP_TOOLBAR_GAP = 8
/** 组名标签占的高度（画布 px，随缩放；标签在框上方 6–30 的位置）。 */
export const GROUP_LABEL_RISE = 30

export type GroupToolbarPlacement =
  | { side: 'above'; offset: number }
  | { side: 'below'; offset: number }
  | { side: 'inside'; offset: number }

/** 舞台底部常驻控件（左下导航栏、居中时间轴胶囊）占的高度（屏幕 px）：翻到框下方时不能落进这一条里被盖住。 */
export const GROUP_TOOLBAR_BOTTOM_RESERVE = 72

/**
 * `offset` 是相对组框的**画布 px**：above = 工具条下沿离框上沿多远；below = 工具条上沿离框下沿多远；
 * inside = 工具条上沿离框上沿多远（向下）。
 */
export function resolveGroupToolbarPlacement(input: {
  /** 组框上沿 / 高度，画布 px。 */
  frameTop: number
  frameHeight: number
  zoom: number
  /** 视口平移 y（屏幕 px）与舞台高度（屏幕 px）。 */
  offsetY: number
  stageHeight: number
}): GroupToolbarPlacement {
  const zoom = input.zoom || 1
  const aboveOffset = GROUP_LABEL_RISE + GROUP_TOOLBAR_GAP / zoom
  const frameTopScreen = input.frameTop * zoom + input.offsetY
  const frameBottomScreen = (input.frameTop + input.frameHeight) * zoom + input.offsetY
  const toolbarTopIfAbove = frameTopScreen - aboveOffset * zoom - GROUP_TOOLBAR_HEIGHT
  if (toolbarTopIfAbove >= GROUP_TOOLBAR_GAP) return { side: 'above', offset: aboveOffset }
  // 框上沿贴着舞台顶：小组翻到框下方（前提是下方放得下、也不会落进底部常驻控件那一条里）。
  const belowOffset = GROUP_TOOLBAR_GAP / zoom
  const toolbarBottomIfBelow = frameBottomScreen + GROUP_TOOLBAR_GAP + GROUP_TOOLBAR_HEIGHT
  if (input.stageHeight > 0 && toolbarBottomIfBelow <= input.stageHeight - GROUP_TOOLBAR_BOTTOM_RESERVE) {
    return { side: 'below', offset: belowOffset }
  }
  // 上下都放不下（组很高、或下面是底部控件）：浮在框内上沿，框上沿已出舞台时贴着舞台顶边；
  // 但不越过框自己的下沿，免得跟框脱节。
  const insideTopScreen = Math.max(GROUP_TOOLBAR_GAP, frameTopScreen + GROUP_TOOLBAR_GAP)
  const wanted = (insideTopScreen - frameTopScreen) / zoom
  const maxInside = Math.max(0, input.frameHeight - (GROUP_TOOLBAR_HEIGHT + GROUP_TOOLBAR_GAP) / zoom)
  return { side: 'inside', offset: Math.max(0, Math.min(wanted, maxInside)) }
}

/**
 * 水平方向：工具条默认以组框中线为中心；组框比视口宽、或贴着左右边时中线可能在舞台外，工具条就被裁了。
 * 返回要把工具条往里挪多少（画布 px，正 = 往右）；`toolbarWidth` 是屏幕 px（工具条反向缩放，屏上宽度就是它的 CSS 宽度）。
 * 舞台比工具条还窄时不挪（放不下就放不下，别来回抖）。
 */
export function resolveGroupToolbarShiftX(input: {
  /** 组框左沿 / 宽度，画布 px。 */
  frameLeft: number
  frameWidth: number
  zoom: number
  /** 视口平移 x（屏幕 px）与舞台宽度（屏幕 px）。 */
  offsetX: number
  stageWidth: number
  toolbarWidth: number
}): number {
  const zoom = input.zoom || 1
  if (input.stageWidth <= 0 || input.toolbarWidth <= 0 || input.stageWidth < input.toolbarWidth + GROUP_TOOLBAR_GAP * 2) return 0
  const centerScreen = (input.frameLeft + input.frameWidth / 2) * zoom + input.offsetX
  const half = input.toolbarWidth / 2
  const clamped = Math.min(Math.max(centerScreen, GROUP_TOOLBAR_GAP + half), input.stageWidth - GROUP_TOOLBAR_GAP - half)
  return (clamped - centerScreen) / zoom
}
