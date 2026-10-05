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

function ratioKey(aspect: string | null | undefined): string {
  const ratio = parseAspectRatio(aspect) ?? FALLBACK_RATIO
  return (ratio.width / ratio.height).toFixed(4)
}

/**
 * **整张表共用的一只预览框**：整片画幅的那只框。
 *
 * 表只递得下来「每一镜的生效画幅」，这里取**镜数最多的那个画幅**当整片画幅（同数取先出现的）：
 * 没有覆盖的行生效画幅就是整片默认，所以只要覆盖的镜不过半，它就是整片默认本身；覆盖过半时，
 * 框跟着大多数镜走——那时候按「名义上的整片」画框，反而多数行都在框里留白。
 * 混排的少数行在这只框里 contain + 角标（见 `StoryboardShotFrame`）。
 */
export function tableFrameMediaBox(aspects: readonly (string | null | undefined)[]): FrameMediaBox {
  if (aspects.length === 0) return frameMediaBox(undefined)
  const counts = new Map<string, { count: number; aspect: string | null | undefined }>()
  for (const aspect of aspects) {
    const key = ratioKey(aspect)
    const entry = counts.get(key)
    if (entry) entry.count += 1
    else counts.set(key, { count: 1, aspect })
  }
  let best: { count: number; aspect: string | null | undefined } | null = null
  for (const entry of counts.values()) if (!best || entry.count > best.count) best = entry
  return frameMediaBox(best?.aspect)
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
