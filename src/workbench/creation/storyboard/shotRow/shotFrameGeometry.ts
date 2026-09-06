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

/**
 * **整张表共用的一只媒体盒**（2026-09-06 用户反馈四：「不同画幅的行一放进来整个框就不齐……
 * 至少大家都同一个比例时，单个分镜行要排得很好、对齐」）。
 *
 * 上一版每行按自己的画幅算框：一列 9:16 里混进一行 16:9，两行的媒体框一个 76×135、一个 136×77，
 * 顶线对齐了、**底线和右边缘全错开**，参考列和参数行跟着上下浮动——用户看到的"整个框就不齐"。
 * 合同 §2.4 原写的"列宽固定就够齐了"在混排下不成立：列宽齐、盒子不齐，人眼读的是盒子。
 *
 * 所以盒子改成**表级 derive**，两种输入两种答案：
 *   - **全表同一画幅** → 盒子就是那个画幅的框（16:9 → 136×77、9:16 → 76×135、1:1 → 108×108）。
 *     缩略图正好铺满，没有一条黑边；所有行同高、四条线（顶线、盒、参数行、生成钮）逐行对齐。
 *   - **混合画幅** → 一只统一盒：宽取列宽上限、高取短边上限（`136×108`，两个数都是合同里已有的
 *     两条封顶，不是新编的数）。横版贴满宽、竖版贴满高、方图居中，各自 letterbox 在盒内——
 *     **盒不随内容变形**，于是混排行仍然行行同高、边缘同线。
 *
 * 缩略图在盒内 `object-contain` 居中（letterbox），不拉伸也不裁切：拉伸会让人对不上真实出画比例，
 * 裁切会把用户已经生成出来的画面切掉一块，两种都是拿"排得齐"去换真实性。
 */
export function tableFrameMediaBox(aspects: readonly (string | null | undefined)[]): FrameMediaBox {
  const ratios = aspects.map((aspect) => parseAspectRatio(aspect) ?? FALLBACK_RATIO)
  const first = ratios[0] ?? FALLBACK_RATIO
  const uniform = ratios.every((ratio) => ratio.width * first.height === first.width * ratio.height)
  if (uniform) return frameMediaBox(`${first.width}:${first.height}`)
  return { width: FRAME_COLUMN_WIDTH, height: FRAME_MAX_SHORT_EDGE }
}
