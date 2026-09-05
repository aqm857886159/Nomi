import { COMPOSER_GRID_SLOTS } from './composerBarModel'

/**
 * 底栏七列的**排布几何**（合同 v6 §2.3 / §6.2 / §9.1 的"七列统一断点换行"那条）。
 *
 * 要解决的是 2026-09-06 用户实测到的那一幕：七列在 492px 的提示词块里塞不下，
 * `auto` 轨道被压到 min-content 以下，于是「模式」被模型图标压住、「画幅」被截、
 * 「返回尾帧」被「生成」盖住。**截断和重叠都不是排版，是失败。**
 *
 * 所以这一层只回答两个问题，两个都从内容 derive，不写死 px：
 *   ① **每列该多宽**——取该列在所有行里的 chip 自然宽度**最大值**。列宽只跟内容有关，
 *      不跟"这一行恰好有几枚胶囊"有关，各行才会上下对齐（这正是用户要的"列固定"）。
 *   ② **什么时候换行**——七列的总需求超过容器就整表一起换成两行。断点是**整表共享的**：
 *      一行换、别行不换，列就再也对不齐了；同一断点换行，两行版仍然列列对齐。
 *
 * 换行后的落位就是用户给的那张图：
 *   第一行 `模型 | 模式 | 画幅 | 时长`，第二行 `清晰度 | 生成音频·返回尾帧 | 生成`。
 * 「生成音频/返回尾帧」这一格横跨第 2–3 列，于是「生成」落在第 4 列的右端——
 * 主按钮不管换不换行都待在同一个角落。
 */

/** 底栏内部 gap（设计系统 §间距：composer 内部 6–8px）。 */
export const COMPOSER_GRID_GAP = 6
/** 换行版的列数；七格按 §placement 落进这四列。 */
export const COMPOSER_WRAP_COLUMNS = 4

export type ComposerSlotPlacement = { row: number; column: number; span: number }

export type ComposerGridPlan = {
  wrapped: boolean
  /** grid 轨道宽度（px，长度 = 7 或 4）；最后一列在 CSS 里写成 `minmax(track, 1fr)` 吃掉余量。 */
  tracks: number[]
  /** 与 `COMPOSER_GRID_SLOTS` 同序的落位。 */
  placement: ComposerSlotPlacement[]
}

/** 换行版：七格 → 四列两行。第 6 格（音频/尾帧）跨两列，第 7 格（生成）因此落在最右列。 */
const WRAP_PLACEMENT: readonly ComposerSlotPlacement[] = [
  { row: 1, column: 1, span: 1 },
  { row: 1, column: 2, span: 1 },
  { row: 1, column: 3, span: 1 },
  { row: 1, column: 4, span: 1 },
  { row: 2, column: 1, span: 1 },
  { row: 2, column: 2, span: 2 },
  { row: 2, column: 4, span: 1 },
]

const SINGLE_PLACEMENT: readonly ComposerSlotPlacement[] = COMPOSER_GRID_SLOTS.map((_slot, index) => ({
  row: 1,
  column: index + 1,
  span: 1,
}))

/** 一组轨道排下来要多宽（含 gap）。 */
export function composerGridWidth(tracks: readonly number[], gap = COMPOSER_GRID_GAP): number {
  if (tracks.length === 0) return 0
  return tracks.reduce((total, track) => total + track, 0) + gap * (tracks.length - 1)
}

/** 跨列的格子如果比它跨的那几列加起来还宽，把差额**平摊**回那几列——不然它自己会溢出去。 */
function widenForSpans(
  tracks: number[],
  naturals: readonly number[],
  placement: readonly ComposerSlotPlacement[],
  gap: number,
): void {
  placement.forEach((cell, index) => {
    if (cell.span <= 1) return
    const covered = tracks.slice(cell.column - 1, cell.column - 1 + cell.span)
    const deficit = (naturals[index] ?? 0) - composerGridWidth(covered, gap)
    if (deficit <= 0) return
    const share = Math.ceil(deficit / cell.span)
    for (let offset = 0; offset < cell.span; offset += 1) tracks[cell.column - 1 + offset] += share
  })
}

/**
 * @param naturals 七格各自的**自然宽度**（该列在所有行里的最大值），单位 px。
 * @param available 底栏内容区可用宽度；`<= 0` 表示还没量到，按不换行处理。
 */
export function planComposerGrid(
  naturals: readonly number[],
  available: number,
  gap = COMPOSER_GRID_GAP,
): ComposerGridPlan {
  const columns = COMPOSER_GRID_SLOTS.map((_slot, index) => Math.max(0, Math.round(naturals[index] ?? 0)))
  const single = [...columns]
  if (available <= 0 || composerGridWidth(single, gap) <= available) {
    return { wrapped: false, tracks: single, placement: [...SINGLE_PLACEMENT] }
  }
  const tracks = Array.from({ length: COMPOSER_WRAP_COLUMNS }, (_unused, column) =>
    Math.max(
      0,
      ...WRAP_PLACEMENT.map((cell, index) => (cell.span === 1 && cell.column === column + 1 ? columns[index] : 0)),
    ),
  )
  widenForSpans(tracks, columns, WRAP_PLACEMENT, gap)
  return { wrapped: true, tracks, placement: [...WRAP_PLACEMENT] }
}

/** 轨道 → `grid-template-columns`；末列吃掉余量，主按钮因此始终贴右。 */
export function composerGridTemplate(plan: ComposerGridPlan): string {
  return plan.tracks
    .map((track, index) => (index === plan.tracks.length - 1 ? `minmax(${track}px, 1fr)` : `${track}px`))
    .join(' ')
}
