/**
 * 画面格几何（设计合同 v6 §2.4）。
 *
 * 规则一句话：**列宽固定 136px 不动，媒体框按画幅在列里缩放**。
 * v5 的画面格写死 76×132（竖版专用），横版镜头没有任何真实表达；样张原方案是"整行列宽切到
 * 176px"，09-05 讨论中被否——列宽一变，混合画幅的行就失去左边缘对齐，表格"扫一列看全片"
 * 这个最高价值就没了。所以变的是框，不是列。
 *
 * 三条约束，缺一条都还原不出拍板样张（`docs/design/mockups/2026-09-05-storyboard-table-v6/Main.html`）：
 *   ① 宽 ≤ 136（列宽）；② 高 ≤ 135（行内容自然高度）；
 *   ③ **短边 ≤ 108**——没有这条，1:1 会算成 135×135，在一列竖版行里像块大方砖，把"图是主角"
 *      变成"方图是主角"；样张里 1:1 画的正是 108×108。
 * 三种拍板画幅的落点：9:16 → 76×135、16:9 → 136×77、1:1 → 108×108，与样张逐像素一致。
 */

export const FRAME_COLUMN_WIDTH = 136
const FRAME_MAX_HEIGHT = 135
const FRAME_MAX_SHORT_EDGE = 108
/** 画幅缺省（模型没声明、plan 没定）时的兜底：竖屏，与项目主画幅一致。 */
const FALLBACK_RATIO = { width: 9, height: 16 }

export type FrameMediaBox = { width: number; height: number }

/** `"16:9"` / `"16x9"` / `"1.777"` → 比例；解析不出 → null（调用方用兜底，不编造）。 */
export function parseAspectRatio(aspect: string | null | undefined): { width: number; height: number } | null {
  if (!aspect) return null
  const pair = /^\s*(\d+(?:\.\d+)?)\s*[:x/]\s*(\d+(?:\.\d+)?)\s*$/i.exec(aspect)
  if (pair) {
    const width = Number(pair[1])
    const height = Number(pair[2])
    if (width > 0 && height > 0) return { width, height }
  }
  const decimal = Number(aspect)
  if (Number.isFinite(decimal) && decimal > 0) return { width: decimal, height: 1 }
  return null
}

/** 该画幅在固定 136px 列里的媒体框尺寸（整数 px；上面三条约束的唯一实现）。 */
export function frameMediaBox(aspect: string | null | undefined): FrameMediaBox {
  const ratio = parseAspectRatio(aspect) ?? FALLBACK_RATIO
  const fit = Math.min(FRAME_COLUMN_WIDTH / ratio.width, FRAME_MAX_HEIGHT / ratio.height)
  const shortEdge = Math.min(ratio.width, ratio.height) * fit
  const scale = shortEdge > FRAME_MAX_SHORT_EDGE ? FRAME_MAX_SHORT_EDGE / Math.min(ratio.width, ratio.height) : fit
  return {
    width: Math.round(ratio.width * scale),
    height: Math.round(ratio.height * scale),
  }
}
