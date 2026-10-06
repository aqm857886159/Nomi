/**
 * 分镜行**视觉列**的几何（2026-10-06 第二轮，用户：「优化左侧的显示……给左边留出空间可以清晰预览……
 * 注意各个比例的展示……对齐」；版面由协调会话定）。
 *
 * 一句话：**预览框由整片画幅定、全表同一只**，所有行同宽同高，左右边缘逐行对齐：
 *   · 横版：宽固定 240，高 = 240 ÷ 比例（16:9 → 240×135，4:3 → 240×180，21:9 → 240×103）；
 *   · 竖版：高固定 240，宽 = 240 × 比例（9:16 → 135×240，3:4 → 180×240）；
 *   · 1:1：180×180（与横竖两族的短边同一量级，不做成一块 240 的大方砖）。
 * 窄窗（最小窗口 + Agent 面板）整只按 176/240 等比缩：横版宽 176、竖版高 176、方图 132。
 *
 * 单镜画幅和整片不同：画面在这只框里**按比例完整显示**（contain），空出的地方是浅底——框不变形，
 * 所以混排的行照样逐行对齐；画幅标签由画面格自己标在角上。
 *
 * 旧版（列宽固定 136、媒体框在列里缩）的三条封顶整套删除：那一版的目标是「省出宽度给参考列和提示词」，
 * 现在参考在框下面、提示词列只放提示词和底栏，左边要的是**看得清**。
 */

const LONG_EDGE = 240
const SQUARE_EDGE = 180
const NARROW_SCALE = 176 / 240
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

/** 某个画幅的预览框（宽档；整数 px）。 */
export function frameMediaBox(aspect: string | null | undefined): FrameMediaBox {
  const ratio = parseAspectRatio(aspect) ?? FALLBACK_RATIO
  const value = ratio.width / ratio.height
  if (Math.abs(value - 1) < 0.01) return { width: SQUARE_EDGE, height: SQUARE_EDGE }
  return value > 1
    ? { width: LONG_EDGE, height: Math.round(LONG_EDGE / value) }
    : { width: Math.round(LONG_EDGE * value), height: LONG_EDGE }
}


/** 窄窗那一档：整只框等比缩到 176/240。 */
export function densityBox(box: FrameMediaBox, narrow: boolean): FrameMediaBox {
  if (!narrow) return box
  return { width: Math.round(box.width * NARROW_SCALE), height: Math.round(box.height * NARROW_SCALE) }
}

/** 某个画幅在框里按比例完整放下（contain）的尺寸。 */
export function containedBox(box: FrameMediaBox, aspect: string | null | undefined): FrameMediaBox {
  const ratio = parseAspectRatio(aspect)
  if (!ratio) return box
  const scale = Math.min(box.width / ratio.width, box.height / ratio.height)
  return { width: Math.round(ratio.width * scale), height: Math.round(ratio.height * scale) }
}

/** 这个画幅和框是不是同一个比例（不同才在角上标画幅）。 */
export function sameAspectAsBox(box: FrameMediaBox, aspect: string | null | undefined): boolean {
  const ratio = parseAspectRatio(aspect)
  if (!ratio) return true
  return Math.abs(ratio.width / ratio.height - box.width / box.height) < 0.02
}

/** 整片是竖版（框高 > 宽）：参考缩略图排在框右边，提示词不撑满行高（2026-10-06 用户选 A）。 */
export function isPortraitBox(box: FrameMediaBox): boolean {
  return box.height > box.width
}

/**
 * 视觉列宽：横版与方图 = 框宽；**竖版与横版同宽（240）**——框靠左、参考在框右边那条带里，
 * 这样整片竖版时各行左缘和内容列起点仍与横版表一致，参考也不再把行撑高。
 */
export function visualColumnWidth(box: FrameMediaBox): number {
  return isPortraitBox(box) ? LONG_EDGE : box.width
}
