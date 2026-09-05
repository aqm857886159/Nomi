import { describe, expect, it } from 'vitest'

import {
  AUTO_PAN_SAFE_MARGIN_PX,
  MIN_NODE_BAND_COVERAGE,
  REACT_FLOW_AUTO_PAN_EDGE_PX,
  autoPanSafeArea,
  clampIntoAutoPanSafeArea,
  expectedFullySelected,
  nodeBandCoverage,
  sweptRect,
} from './gestureGeometry.mjs'

// 2026-09-05 实测现场（darwin，Agent 面板展开后的 stage）：
// stage = 60,56 1200×790；节点外接盒 316..1300 × 243..956。
const STAGE = { x: 60, y: 56, width: 1200, height: 790 }
const DARWIN_BAND = { left: 316.9, top: 243.9, right: 1300, bottom: 956.4 }
// 三行三列的节点带，外接盒和实测现场一致。
const DARWIN_BOXES = [0, 1, 2].flatMap((row) =>
  [0, 1, 2].map((column) => ({
    x: DARWIN_BAND.left + column * 386,
    y: DARWIN_BAND.top + column * 0 + row * 198,
    width: 211,
    height: 119,
  })),
)

describe('canvas benchmark 手势几何', () => {
  it('安全边距来自 React Flow 自己的自动平移带，不是拍脑袋的数', () => {
    expect(REACT_FLOW_AUTO_PAN_EDGE_PX).toBe(40)
    expect(AUTO_PAN_SAFE_MARGIN_PX).toBeGreaterThan(REACT_FLOW_AUTO_PAN_EDGE_PX)
  })

  it('安全区把 stage 四边都缩进自动平移带以内', () => {
    const safe = autoPanSafeArea(STAGE)
    expect(safe.x - STAGE.x).toBeGreaterThan(REACT_FLOW_AUTO_PAN_EDGE_PX)
    expect(safe.y - STAGE.y).toBeGreaterThan(REACT_FLOW_AUTO_PAN_EDGE_PX)
    expect(STAGE.x + STAGE.width - (safe.x + safe.width)).toBeGreaterThan(REACT_FLOW_AUTO_PAN_EDGE_PX)
    expect(STAGE.y + STAGE.height - (safe.y + safe.height)).toBeGreaterThan(REACT_FLOW_AUTO_PAN_EDGE_PX)
  })

  it('修复前那条手势的终点落在自动平移带里，修复后被夹出来', () => {
    // 旧写法：终点钉在 stage 边缘 -10px。这就是 9/12 跳变的来源。
    const legacyEnd = { x: STAGE.x + STAGE.width - 10, y: STAGE.y + STAGE.height - 10 }
    const distanceToRight = STAGE.x + STAGE.width - legacyEnd.x
    expect(distanceToRight).toBeLessThan(REACT_FLOW_AUTO_PAN_EDGE_PX)

    const clamped = clampIntoAutoPanSafeArea(legacyEnd, STAGE)
    expect(STAGE.x + STAGE.width - clamped.x).toBeGreaterThan(REACT_FLOW_AUTO_PAN_EDGE_PX)
    expect(STAGE.y + STAGE.height - clamped.y).toBeGreaterThan(REACT_FLOW_AUTO_PAN_EDGE_PX)
  })

  it('stage 小到装不下安全区时 fail-closed，而不是量出一个不可复现的数', () => {
    expect(() => autoPanSafeArea({ x: 0, y: 0, width: 60, height: 400 })).toThrow(/装不下/)
  })

  it('期望选中数按 SelectionMode.Full derive：整个节点在框里才算', () => {
    const rect = { x: 100, y: 100, width: 400, height: 400 }
    const boxes = [
      { x: 120, y: 120, width: 100, height: 100 }, // 完全在框内
      { x: 250, y: 250, width: 100, height: 100 }, // 完全在框内
      { x: 450, y: 120, width: 100, height: 100 }, // 右边被框线切掉 → Full 模式不选
      { x: 700, y: 700, width: 50, height: 50 }, // 完全在框外
    ]
    const { definite, possible } = expectedFullySelected(boxes, rect)
    expect(definite).toBe(2)
    expect(possible).toBe(2)
  })

  it('压在框线上的节点落进「可能」区间，不参与硬判定', () => {
    const rect = { x: 100, y: 100, width: 400, height: 400 }
    // 右边缘正好贴着 x=500 这条框线：DOM 与 React Flow 的亚像素分歧就发生在这种节点上。
    const boxes = [{ x: 400, y: 200, width: 100, height: 100 }]
    const { definite, possible } = expectedFullySelected(boxes, rect)
    expect(definite).toBe(0)
    expect(possible).toBe(1)
  })

  it('盖满够得着的节点带时覆盖率是 1，且只依赖几何、不含时间量', () => {
    const start = { x: 141, y: 125 }
    const end = clampIntoAutoPanSafeArea({ x: DARWIN_BAND.right + 30, y: DARWIN_BAND.bottom + 30 }, STAGE)
    const swept = sweptRect(start, end)
    const coverage = nodeBandCoverage(swept, DARWIN_BOXES, STAGE)
    expect(coverage).toBe(1)
    // 同样的输入必须给同样的输出——这正是旧判据做不到的那一点。
    expect(nodeBandCoverage(swept, DARWIN_BOXES, STAGE)).toBe(coverage)
  })

  // 这一条锁的是**第一版判据被自己否掉的那个理由**：用「扫过面积 ÷ 安全区面积」时，
  // 同一份 fixture 在 darwin 的 1200×790 上算出 0.941、在 CI 那种更宽的 stage 上掉到 0.583
  // ——那等于又造了一个平台相关的阈值。覆盖率必须在两种 stage 上都给出同一个判断。
  it('换一个明显更大的 stage，覆盖率不漂移（旧的面积比会漂）', () => {
    const wideStage = { x: 60, y: 56, width: 1540, height: 944 }
    const start = { x: 151, y: 129 }
    const end = clampIntoAutoPanSafeArea({ x: DARWIN_BAND.right + 30, y: DARWIN_BAND.bottom + 30 }, wideStage)
    const coverage = nodeBandCoverage(sweptRect(start, end), DARWIN_BOXES, wideStage)
    expect(coverage).toBe(1)
  })

  it('手势缩成一小块时覆盖率掉到门槛以下（取代写死的「至少 12 个节点」）', () => {
    const degenerate = sweptRect({ x: 200, y: 200 }, { x: 400, y: 300 })
    expect(nodeBandCoverage(degenerate, DARWIN_BOXES, STAGE)).toBeLessThan(MIN_NODE_BAND_COVERAGE)
  })

  it('一个节点都没有时覆盖率是 0，报红而不是当成满分', () => {
    expect(nodeBandCoverage(sweptRect({ x: 141, y: 125 }, { x: 1200, y: 790 }), [], STAGE)).toBe(0)
  })
})
