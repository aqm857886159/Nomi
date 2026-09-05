// 画布取点层的契约测试。
//
// 钉的是「取点之后必须在真实光标下复验」这条不变量：扫描那一刻是空白、光标一到就冒出磁性「+」的点，
// 必须被拒掉，而不是被信任（2026-09-05 #488：常驻 Agent 面板压窄 stage 后「点空白取消选中」随机翻红的根因）。
// 不碰真浏览器：用假 win 模拟「扫描时空白、鼠标到位后不空白」的时序。
import { describe, expect, it } from 'vitest'
import {
  CANVAS_BLANK_EXCLUSIONS,
  MARQUEE_STAGE_MARGIN_PX,
  REACT_FLOW_AUTO_PAN_EDGE_PX,
  clickEdgeHitPath,
  findBlankCanvasPoint,
} from './_canvasPoints.mjs'

/**
 * 假 win：第一次 evaluate（扫描）返回候选点；之后每次 evaluate（复验）按 `verdicts` 依次回答。
 * 记录 mouse.move，用来证明复验发生在光标到位之后。
 */
function fakeWin({ candidates, verdicts }) {
  const moves = []
  let evaluateCalls = 0
  return {
    moves,
    mouse: { move: async (x, y) => { moves.push({ x, y }) }, click: async () => {} },
    waitForTimeout: async () => {},
    evaluate: async () => {
      evaluateCalls += 1
      if (evaluateCalls === 1) return candidates
      const verdict = verdicts.shift()
      if (!verdict) throw new Error('复验次数超出剧本')
      return verdict
    },
  }
}

describe('findBlankCanvasPoint 光标到位后必须复验', () => {
  it('扫描时空白、鼠标到位后冒出磁性句柄 → 这个点被拒，取下一个', async () => {
    const win = fakeWin({
      candidates: [{ x: 900, y: 213 }, { x: 980, y: 213 }],
      verdicts: [
        { blank: false, hit: 'span.generation-canvas-v2-node__magnetic-handle' },
        { blank: true, hit: null },
      ],
    })
    const point = await findBlankCanvasPoint(win)
    expect(point).toEqual({ x: 980, y: 213 })
    // 复验发生在真实 mouse.move 之后，且两个候选都真的被移到过
    expect(win.moves).toEqual([{ x: 900, y: 213 }, { x: 980, y: 213 }])
  })

  it('所有候选复验都不空白 → 返回 null，不兜底成「随便一个点」', async () => {
    const win = fakeWin({
      candidates: [{ x: 1, y: 1 }],
      verdicts: [{ blank: false, hit: 'div.react-flow__node' }],
    })
    expect(await findBlankCanvasPoint(win)).toBeNull()
  })

  it('扫描一个候选都没有 → null，且一次鼠标都不动', async () => {
    const win = fakeWin({ candidates: [], verdicts: [] })
    expect(await findBlankCanvasPoint(win)).toBeNull()
    expect(win.moves).toEqual([])
  })
})

describe('排除清单与框选边距是从产品事实推出来的', () => {
  it('磁性句柄的 hit-area 挂在 React Flow 节点壳上，壳必须在排除清单里', () => {
    expect(CANVAS_BLANK_EXCLUSIONS).toContain('.react-flow__node')
    expect(CANVAS_BLANK_EXCLUSIONS).toContain('.generation-canvas-v2-node__magnetic-handle')
  })

  it('框选起终点边距必须越过 React Flow 的 autoPan 触发带（40px）', () => {
    expect(REACT_FLOW_AUTO_PAN_EDGE_PX).toBe(40)
    expect(MARQUEE_STAGE_MARGIN_PX).toBeGreaterThan(REACT_FLOW_AUTO_PAN_EDGE_PX)
  })
})

describe('clickEdgeHitPath 只点最上层真是这条 path 的点', () => {
  function fakeEdgeLocator(perPath) {
    // perPath[i]：第 i 条 path 的 evaluate 剧本 [pickPoint 结果, stillOnPath 结果]
    return {
      first: () => ({ waitFor: async () => {} }),
      count: async () => perPath.length,
      nth: (index) => {
        const script = [...perPath[index]]
        return { evaluate: async () => script.shift() }
      },
    }
  }

  it('第一条整条被压住 → 跳到第二条', async () => {
    const clicks = []
    const win = { mouse: { move: async () => {}, click: async (x, y) => { clicks.push({ x, y }) } }, waitForTimeout: async () => {} }
    await clickEdgeHitPath(win, fakeEdgeLocator([[null], [{ x: 300, y: 420 }, true]]), '编组输入线')
    expect(clicks).toEqual([{ x: 300, y: 420 }])
  })

  it('鼠标到位后浮层盖上来了 → 这条不算，继续下一条', async () => {
    const clicks = []
    const win = { mouse: { move: async () => {}, click: async (x, y) => { clicks.push({ x, y }) } }, waitForTimeout: async () => {} }
    await clickEdgeHitPath(win, fakeEdgeLocator([[{ x: 10, y: 10 }, false], [{ x: 20, y: 20 }, true]]), '编组输入线')
    expect(clicks).toEqual([{ x: 20, y: 20 }])
  })

  it('没有任何一条能点 → 报红说人话，而不是 force 硬点', async () => {
    const win = { mouse: { move: async () => {}, click: async () => { throw new Error('不该点') } }, waitForTimeout: async () => {} }
    await expect(clickEdgeHitPath(win, fakeEdgeLocator([[null]]), '编组输入线')).rejects.toThrow(/点不到「编组输入线」/)
  })

  it('label 必填', async () => {
    await expect(clickEdgeHitPath({}, fakeEdgeLocator([]), '')).rejects.toThrow(/label 必填/)
  })
})
