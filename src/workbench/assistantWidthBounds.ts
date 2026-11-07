import { nomiDesignTokens } from '../theme/nomiTheme'
import { SHELL_GUTTER, SHELL_RAIL_WIDTH } from '../ui/app-shell/shellGeometry'
// 常驻 Agent 面板的宽度界。单独成文件而不是留在 store 里：这几个数是**纯换算**，
// 与 zustand 无关，而 `workbenchStore.ts` 已经贴着 800 行的巨壳门岗（R9/R12）。
/**
 * 常驻 Agent 面板的宽度界（09-01 定稿 §11.2 窄窗态 + §11.3 拖宽）。
 *
 * **窗口变窄从不改存下的宽**——用户拖出来的宽度是他的决定，窗口变窄不是他改主意了（方向检查
 * docs/engineering/direction-checks/2026-11-08-workbench-shell-width-writeback.md，用户 11-08 拍板 2a）：
 *  - 存档只认静态界 300–600（`normalizeAssistantWidth`，写入咽喉 clampEditingPanelLayout 用它，不读窗口）；
 *  - 放不下时的「让一让」交给 CSS Grid（`assistantDockColumns`）：内容列先保底，停靠栏吃剩下的，
 *    按容器真实宽度让，宽回来自己放回存的宽；
 *  - 只有**手拖 / 方向键**按此刻的视口收上限（`clampAssistantWidth`）：上限 = min(600, 视口 − 760)，
 *    760 是内容侧底线（探索栏最窄轨 60 + 画布底线 700），拖不过这条线、手柄跟手。
 * 窗口窄过 760 + 300 = 1060 时停靠的 Nomi 先收成小球（agentFormStore 窄窗档），网格里没有停靠栏这一轨。
 *
 * 下限恒 300：再窄一份计划卡就折不出行来，那不是「小面板」是「读不了的面板」。
 */
export const ASSISTANT_WIDTH_MIN = 300
export const ASSISTANT_WIDTH_MAX = 600
/** 内容侧底线：探索栏最窄轨 60 + 画布底线 700。 */
export const ASSISTANT_CONTENT_FLOOR = 760

export function assistantWidthMaxFor(viewportWidth: number): number {
  if (!Number.isFinite(viewportWidth) || viewportWidth <= 0) return ASSISTANT_WIDTH_MAX
  return Math.max(ASSISTANT_WIDTH_MIN, Math.min(ASSISTANT_WIDTH_MAX, Math.round(viewportWidth) - ASSISTANT_CONTENT_FLOOR))
}

/** 存档里的宽：只夹静态界 300–600，**不看窗口**（写入咽喉用它；窗口大小只影响显示，见 assistantDockColumns）。 */
export function normalizeAssistantWidth(width: number): number {
  if (!Number.isFinite(width)) return 340
  return Math.max(ASSISTANT_WIDTH_MIN, Math.min(ASSISTANT_WIDTH_MAX, Math.round(width)))
}

/** 手拖 / 方向键：按此刻的视口收上限，手柄跟手（只有人亲手拖这一扇门读视口）。 */
export function clampAssistantWidth(width: number, viewportWidth: number): number {
  return Math.min(assistantWidthMaxFor(viewportWidth), normalizeAssistantWidth(width))
}

/**
 * 停靠栏左边那条 8px 缝（10-08 外壳重设计：工作面之间隔 8px，宽度把手就画在这条缝里）。
 * 与外壳 SHELL_GUTTER 同值，取设计间距 token 2。
 */
export const ASSISTANT_PANE_GUTTER = Number.parseFloat(nomiDesignTokens.spacing[2])
export function assistantPaneWidth(width: number): number { return width + ASSISTANT_PANE_GUTTER }

/** 停靠栏那一轨最窄 = 面板下限 300 + 左缝 8。 */
export const ASSISTANT_DOCK_TRACK_MIN = ASSISTANT_WIDTH_MIN + ASSISTANT_PANE_GUTTER
/**
 * 停靠时内容列的地板 = 内容侧底线 760 − 外壳左栏 60 − 外壳右缝 8 − 停靠栏左缝 8 = 684。
 * 这样窗口宽正好等于窄窗阈值 1060（= 760 + 300）时，内容 684 + 最窄停靠栏 308 正好排满工作面（1060 − 60 − 8）。
 */
export const ASSISTANT_DOCK_CONTENT_FLOOR = ASSISTANT_CONTENT_FLOOR - SHELL_RAIL_WIDTH - SHELL_GUTTER - ASSISTANT_PANE_GUTTER

function dockColumns(trackMax: string): string {
  return `minmax(min(${ASSISTANT_DOCK_CONTENT_FLOOR}px, 100%), 1fr) minmax(min(${trackMax}, ${ASSISTANT_DOCK_TRACK_MIN}px), ${trackMax})`
}

/**
 * 四个工作区停靠 Agent 时网格的两列（唯一出处）：内容列先保底，停靠栏吃剩下的——放得下就是存的宽，
 * 放不下就让到 308；按容器真实宽度让，不读窗口、不写存档，宽回来自己放回。
 */
export function assistantDockColumns(width: number): string {
  return dockColumns(`${assistantPaneWidth(width)}px`)
}

/** 同上，停靠栏那一轨最宽由一个会动画的 CSS 变量给（生成页收起 / 展开逐帧插值；变量 0px = 这一轨收成 0）。 */
export function assistantDockColumnsAnimated(trackMaxVar: string): string {
  return dockColumns(trackMaxVar)
}
