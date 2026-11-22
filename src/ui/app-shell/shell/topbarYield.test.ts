import { describe, expect, it } from 'vitest'
import { resolveTopbarYield, topbarRoomy, topbarUpdateCompact, TOPBAR_YIELD_GAP, type TopbarYieldStep } from './topbarYield'

/**
 * 一条假顶栏：各样东西「全放开时」多宽；量到的宽 = 全放开 − 此刻已经收起的那几样（和真 DOM 一样）。
 * 数字取自画布 Bar900 / Main 最挤那几行的量级（N 标 + 项目箭头、带进度的分段、新版本 + 3 个任务 + 等你确认 + 导出）。
 */
type Bar = {
  leftMinRight: number
  segment: number
  meta: number
  switcher: number
  /** 窄于 900 时右簇全放开多宽（「新版本」只有点、入口是脸 + 角标）。 */
  toolbarNarrow: number
  /** 900 起右簇多出来的（「新版本」的字 + 胶囊比脸宽的那段）。 */
  roomyExtra: number
  exportSaving: number
  updateSaving: number
}

const CROWDED: Bar = { leftMinRight: 136, segment: 262, meta: 74, switcher: 0, toolbarNarrow: 300, roomyExtra: 170, exportSaving: 82, updateSaving: 84 }

function settle(bar: Bar, width: number, current: TopbarYieldStep): TopbarYieldStep {
  let step = current
  // 真窗口里每改一次 DOM，ResizeObserver 再回调一次；最多三轮就该稳。
  for (let round = 0; round < 3; round += 1) {
    const roomy = width >= 900
    const toolbarFull = bar.toolbarNarrow + (roomy ? bar.roomyExtra : 0)
    const next = resolveTopbarYield({
      barWidth: width,
      center: width / 2,
      rightEdge: width - 8,
      leftMinRight: bar.leftMinRight,
      segmentWidth: bar.segment - (step >= 3 ? bar.meta : 0),
      switcherWidth: bar.switcher,
      toolbarWidth: toolbarFull - (step >= 1 ? bar.exportSaving : 0) - (step >= 4 && roomy ? bar.updateSaving : 0),
      metaSaving: bar.meta,
      exportSaving: bar.exportSaving,
      updateSaving: roomy ? bar.updateSaving : 0,
    }, step).step
    if (next === step) return step
    step = next
  }
  throw new Error(`第 ${width}px 三轮还没稳（${current} → ${step}）`)
}

function sweep(bar: Bar, from: number, to: number): Map<number, TopbarYieldStep> {
  const result = new Map<number, TopbarYieldStep>()
  let step: TopbarYieldStep = 0
  const direction = to > from ? 1 : -1
  for (let width = from; direction > 0 ? width <= to : width >= to; width += direction) {
    step = settle(bar, width, step)
    result.set(width, step)
  }
  return result
}

const flips = (sequence: TopbarYieldStep[]): number => sequence.reduce<number>((count, step, index) => count + (index > 0 && step !== sequence[index - 1] ? 1 : 0), 0)

describe('resolveTopbarYield（NomiEntryTopbar 板 topbar.yield-order）', () => {
  it('E12：700 → 1440 → 700 每 1px 一步，同一宽度两个方向结果一致、每个阈值只翻一次', () => {
    const down = sweep(CROWDED, 1440, 700)
    const up = sweep(CROWDED, 700, 1440)
    for (const [width, step] of down) expect(up.get(width), `${width}px`).toBe(step)
    // 900 本身是一道阈值（窄于它「新版本」只剩点、入口只出角标，右簇一下子窄 170，步数会往回落一档），不在让位顺序里（C3）。
    // 所以分两段数：900 以上、900 以下各自单调，每个让位阈值只翻一次；跨 900 那一下再翻一次。两个方向翻的次数一样。
    const range = (map: Map<number, TopbarYieldStep>, lo: number, hi: number): TopbarYieldStep[] => [...map.entries()].filter(([width]) => width >= lo && width <= hi).sort((a, b) => b[0] - a[0]).map(([, step]) => step)
    const roomyDown = range(down, 900, 1440)
    const narrowDown = range(down, 700, 899)
    expect(new Set(roomyDown).size).toBeGreaterThan(2)
    expect(flips(roomyDown)).toBe(new Set(roomyDown).size - 1)
    expect(flips(narrowDown)).toBe(new Set(narrowDown).size - 1)
    expect(flips([...up.values()])).toBe(flips([...down.values()]))
  })

  it('宽窗不让（E11）：1440 第 0 步、分段不挪', () => {
    expect(resolveTopbarYield({ barWidth: 1440, center: 720, rightEdge: 1432, leftMinRight: 136, segmentWidth: 262, switcherWidth: 0, toolbarWidth: 470, metaSaving: 74, exportSaving: 82, updateSaving: 84 }, 0)).toEqual({ step: 0, shift: 0 })
  })

  it('顺序：① 能放下就不挪分段；② 挪得刚好留 12；③ 先于 ④', () => {
    const base = { barWidth: 900, center: 450, rightEdge: 892, leftMinRight: 136, switcherWidth: 0, metaSaving: 74, exportSaving: 82, updateSaving: 84 }
    // 导出收起就放得下 → 第 ① 步。
    expect(resolveTopbarYield({ ...base, segmentWidth: 262, toolbarWidth: 370 }, 0)).toEqual({ step: 1, shift: 0 })
    // 再挪一点就放得下 → 第 ② 步，挪到分段右沿离右簇正好 12。
    const two = resolveTopbarYield({ ...base, segmentWidth: 262, toolbarWidth: 470 }, 0)
    expect(two.step).toBe(2)
    expect(450 + 131 - two.shift + TOPBAR_YIELD_GAP).toBeCloseTo(892 - (470 - 82), 5)
    // 挪到左边也贴上了：藏进度数字（③）就够 → 停在 ③，不收「新版本」。
    expect(resolveTopbarYield({ ...base, segmentWidth: 262, toolbarWidth: 560 }, 0).step).toBe(3)
    // 只藏进度数字就够、只收「新版本」不够 → 停在 ③（顺序写反、先收「新版本」的话这一格会走到 ④）。
    expect(resolveTopbarYield({ ...base, segmentWidth: 262, toolbarWidth: 600, updateSaving: 40 }, 0).step).toBe(3)
    // ③ 也不够 → ④。
    expect(resolveTopbarYield({ ...base, segmentWidth: 262, toolbarWidth: 640 }, 0).step).toBe(4)
  })

  it('窄于 900 没有第 ④ 步：「新版本」本来就只有点', () => {
    const narrow = resolveTopbarYield({ barWidth: 700, center: 350, rightEdge: 692, leftMinRight: 136, segmentWidth: 262, switcherWidth: 0, toolbarWidth: 600, metaSaving: 74, exportSaving: 82, updateSaving: 0 }, 0)
    expect(narrow.step).toBe(3)
    expect(topbarUpdateCompact(899, 0)).toBe(true)
    expect(topbarUpdateCompact(900, 3)).toBe(false)
    expect(topbarUpdateCompact(900, 4)).toBe(true)
    expect(topbarRoomy(899)).toBe(false)
    expect(topbarRoomy(900)).toBe(true)
  })

  it('量的时候已经收起的东西先加回去：已在第 ④ 步时量到的窄右簇不会让它退回去', () => {
    const measure = { barWidth: 900, center: 450, rightEdge: 892, leftMinRight: 136, segmentWidth: 262 - 74, switcherWidth: 0, toolbarWidth: 640 - 82 - 84, metaSaving: 74, exportSaving: 82, updateSaving: 84 }
    expect(resolveTopbarYield(measure, 4).step).toBe(4)
  })
})
