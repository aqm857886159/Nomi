// 顶栏挤的时候按顺序让（NomiEntryTopbar 板 topbar.yield-order；设计卡 docs/plan/2026-11-22-nomi-entry-topbar.md ★7）：
//   ① 「导出 MP4」收成图标 → ② 分段（连同「画布 / 列表」）往左挪、项目名跟着变短再藏 → ③ 藏分段上的进度数字 → ④「新版本」收成小点。
// 每一步都只在「分段离左右两簇 ≥ 12px」做不到时才走；走到能放下的最小一步为止。
//
// 回差（E12）：量到的是此刻的宽（已经收起的东西是收起后的宽），这里先把已经收起的那几样加回去，算出「全放开时多宽」，
// 再从第 0 步往上找。同一个窗口宽永远得出同一步，来回拖窗每个阈值只翻一次（取代 ShellTopBar 里 useExportCompact 的 fullWidth 写法）。
// 纯函数、没有 DOM：外壳只在 ResizeObserver 回调里量一次、调一次（不开 rAF 循环）。

/** 分段离两簇至少留这么宽。 */
export const TOPBAR_YIELD_GAP = 12
/** 「新版本」带字、Nomi 胶囊放得下的最窄顶栏宽（窄于它：「新版本」一律只留点，入口只出角标）。 */
export const TOPBAR_ROOMY_WIDTH = 900

export type TopbarYieldStep = 0 | 1 | 2 | 3 | 4

export type TopbarYieldMeasure = {
  /** 顶栏宽（整窗宽；分段按它居中）。 */
  barWidth: number
  /** 顶栏中线的 x（分段按整窗居中的位置）。 */
  center: number
  /** 右簇右沿的 x（Windows 让出窗口钮之后）。 */
  rightEdge: number
  /** 左簇在项目名全藏起时的右沿 x（N 标 + 展开左栏 + 项目菜单箭头）。 */
  leftMinRight: number
  /** 分段此刻的宽（不含「画布 / 列表」）。 */
  segmentWidth: number
  /** 分段右边「画布 / 列表」占的宽（含间距；没有就是 0）。 */
  switcherWidth: number
  /** 右簇此刻的宽。 */
  toolbarWidth: number
  /** 藏起进度数字省下的宽（量过一次就记住；没量过 = 0）。 */
  metaSaving: number
  /** 导出收成图标省下的宽（同上）。 */
  exportSaving: number
  /** 「新版本」收成小点省下的宽（同上；窄于 900 本来就只有点，= 0）。 */
  updateSaving: number
}

export type TopbarYield = {
  step: TopbarYieldStep
  /** 分段往左挪的像素（第 ② 步起才有）。 */
  shift: number
}

export const TOPBAR_YIELD_NONE: TopbarYield = { step: 0, shift: 0 }

/** 「新版本」此刻收没收成点：窄于 900 一律收；900 起只有走到第 ④ 步才收。 */
export function topbarUpdateCompact(barWidth: number, step: TopbarYieldStep): boolean {
  return barWidth < TOPBAR_ROOMY_WIDTH || step >= 4
}

/** Nomi 胶囊放不放得下（和让位步数无关：胶囊不在让位顺序里，C3）。 */
export function topbarRoomy(barWidth: number): boolean {
  return barWidth >= TOPBAR_ROOMY_WIDTH
}

/**
 * `current` 是量的那一刻已经在用的步数（量到的宽已经按它收过）。返回该走到第几步、分段挪多少。
 * 放不下也走到第 ④ 步为止（Windows 700 英文那一格，E6 推迟）。
 */
export function resolveTopbarYield(measure: TopbarYieldMeasure, current: TopbarYieldStep): TopbarYield {
  const updateApplied = current >= 4 && measure.barWidth >= TOPBAR_ROOMY_WIDTH
  const segmentFull = measure.segmentWidth + (current >= 3 ? measure.metaSaving : 0)
  const toolbarFull = measure.toolbarWidth + (current >= 1 ? measure.exportSaving : 0) + (updateApplied ? measure.updateSaving : 0)
  const gap = TOPBAR_YIELD_GAP
  let fallback: TopbarYield = TOPBAR_YIELD_NONE
  for (const step of [0, 1, 2, 3, 4] as const) {
    if (step === 4 && measure.barWidth < TOPBAR_ROOMY_WIDTH) break
    const toolbar = toolbarFull - (step >= 1 ? measure.exportSaving : 0) - (step >= 4 ? measure.updateSaving : 0)
    const rightLeft = measure.rightEdge - toolbar
    const segment = segmentFull - (step >= 3 ? measure.metaSaving : 0)
    const segLeft = measure.center - segment / 2
    const segRight = measure.center + segment / 2 + measure.switcherWidth
    const shift = step >= 2 ? Math.max(0, segRight + gap - rightLeft) : 0
    const fitsRight = segRight - shift + gap <= rightLeft + 0.5
    const fitsLeft = segLeft - shift >= measure.leftMinRight + gap - 0.5
    fallback = { step, shift }
    if (fitsRight && fitsLeft) return { step, shift }
  }
  return fallback
}
