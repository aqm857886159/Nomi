// 常驻 Agent 面板的宽度界。单独成文件而不是留在 store 里：这几个数是**纯换算**，
// 与 zustand 无关，而 `workbenchStore.ts` 已经贴着 800 行的巨壳门岗（R9/R12）。
/**
 * 常驻 Agent 面板的宽度界（09-01 定稿 §11.2 窄窗态 + §11.3 拖宽）。
 *
 * **窄窗只收上限，从不偷改当前宽**——用户拖出来的宽度是他的决定，窗口变窄不是他改主意了。
 * 上限 = min(600, 视口 − 760)：760 是内容侧的底线（探索栏最窄轨 60 + 画布底线 700），
 * 也就是「面板再宽下去，画布就没法看了」的那条线。所以 1360 以下上限才开始缩水
 * （1280→520、1200→440、1100→340），最小窗 1100 上限正好等于默认宽 340——
 * 面板**仍可停靠**，只是拖不动了、放大钮该置灰，不是被强制收起。
 *
 * 下限恒 300：再窄一份计划卡就折不出行来，那不是「小面板」是「读不了的面板」。
 * 上限低于下限时（视口 < 1060，比锁死的最小窗还窄，只可能出现在测试或异常显示器上）
 * 以下限为准——宁可挤到画布，也不要产出一个负数宽度。
 */
export const ASSISTANT_WIDTH_MIN = 300
export const ASSISTANT_WIDTH_MAX = 600
/** 内容侧底线：探索栏最窄轨 60 + 画布底线 700。 */
export const ASSISTANT_CONTENT_FLOOR = 760

export function assistantWidthMaxFor(viewportWidth: number): number {
  if (!Number.isFinite(viewportWidth) || viewportWidth <= 0) return ASSISTANT_WIDTH_MAX
  return Math.max(ASSISTANT_WIDTH_MIN, Math.min(ASSISTANT_WIDTH_MAX, Math.round(viewportWidth) - ASSISTANT_CONTENT_FLOOR))
}

export function clampAssistantWidth(width: number, viewportWidth: number): number {
  if (!Number.isFinite(width)) return 340
  return Math.max(ASSISTANT_WIDTH_MIN, Math.min(assistantWidthMaxFor(viewportWidth), Math.round(width)))
}
