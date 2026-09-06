import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  CANVAS_MENU_TARGET_SELECTOR,
  CANVAS_SELECTION_OVERLAY_SELECTOR,
  resolveCanvasContextMenuTarget,
  resolveCanvasFrameMembership,
  frameContainsNodeCenter,
  canvasDragExceededThreshold,
  isCanvasCapturePanPointer,
  isCanvasPanButtonHeld,
  isCanvasContextMenuPointer,
  resolveCanvasPanButtonFromMove,
  resolveCanvasPointerDownAction,
  shouldFinishCanvasConnection,
  shouldPreventDefaultForCanvasPanStart,
} from './canvasPointerGestureModel'

describe('generation canvas pointer arbitration', () => {
  it('gives blank primary drag to panning without a modifier', () => {
    expect(
      resolveCanvasPointerDownAction({
        button: 0,
        spaceHeld: false,
        shiftKey: false,
        interactiveTarget: false,
        readOnly: false,
      }),
    ).toBe('pan')
  })

  it('keeps blank primary drag panning in read-only canvases too', () => {
    expect(
      resolveCanvasPointerDownAction({
        button: 0,
        spaceHeld: false,
        shiftKey: false,
        interactiveTarget: false,
        readOnly: true,
      }),
    ).toBe('pan')
  })

  it('moves box selection behind Shift, and only where a selection can change', () => {
    expect(
      resolveCanvasPointerDownAction({
        button: 0,
        spaceHeld: false,
        shiftKey: true,
        interactiveTarget: false,
        readOnly: false,
      }),
    ).toBe('marquee')
    expect(
      resolveCanvasPointerDownAction({
        button: 0,
        spaceHeld: false,
        shiftKey: true,
        interactiveTarget: false,
        readOnly: true,
      }),
    ).toBe('ignore')
  })

  it.each([1, 2])('gives button %s to explicit pan even over an interactive target', (button) => {
    expect(
      resolveCanvasPointerDownAction({
        button,
        spaceHeld: false,
        shiftKey: false,
        interactiveTarget: true,
        readOnly: false,
      }),
    ).toBe('pan')
  })

  it('gives Space + primary drag to explicit pan even over an interactive target', () => {
    expect(
      resolveCanvasPointerDownAction({
        button: 0,
        spaceHeld: true,
        shiftKey: false,
        interactiveTarget: true,
        readOnly: false,
      }),
    ).toBe('pan')
  })

  it('leaves controls and nodes to themselves', () => {
    expect(
      resolveCanvasPointerDownAction({
        button: 0,
        spaceHeld: false,
        shiftKey: false,
        interactiveTarget: true,
        readOnly: false,
      }),
    ).toBe('ignore')
    expect(
      resolveCanvasPointerDownAction({
        button: 0,
        spaceHeld: false,
        shiftKey: true,
        interactiveTarget: true,
        readOnly: false,
      }),
    ).toBe('ignore')
  })

  it('only lets the node-piercing chords take the capture phase', () => {
    expect(isCanvasCapturePanPointer({ button: 0, spaceHeld: true })).toBe(true)
    expect(isCanvasCapturePanPointer({ button: 1, spaceHeld: false })).toBe(true)
    expect(isCanvasCapturePanPointer({ button: 2, spaceHeld: false })).toBe(true)
    expect(isCanvasCapturePanPointer({ button: 0, spaceHeld: false })).toBe(false)
  })

  it('detects a pan chord that begins after the primary pointer is already down', () => {
    expect(resolveCanvasPanButtonFromMove({ buttons: 1, spaceHeld: true })).toBe(0)
    expect(resolveCanvasPanButtonFromMove({ buttons: 3, spaceHeld: false })).toBe(2)
    expect(resolveCanvasPanButtonFromMove({ buttons: 5, spaceHeld: false })).toBe(1)
    // 裸左键不在此认领：它此刻可能正在框选或拖节点。
    expect(resolveCanvasPanButtonFromMove({ buttons: 1, spaceHeld: false })).toBeNull()
  })

  it('models the complete chord lifecycle while the primary pointer stays down', () => {
    expect(isCanvasPanButtonHeld(2, { buttons: 3 })).toBe(true)
    expect(isCanvasPanButtonHeld(2, { buttons: 1 })).toBe(false)
    expect(isCanvasPanButtonHeld(1, { buttons: 5 })).toBe(true)
    expect(isCanvasPanButtonHeld(1, { buttons: 1 })).toBe(false)
    expect(isCanvasPanButtonHeld(0, { buttons: 1 })).toBe(true)
    expect(isCanvasPanButtonHeld(0, { buttons: 0 })).toBe(false)
  })

  it('uses the shared four-pixel drag threshold on either axis', () => {
    expect(canvasDragExceededThreshold(0, 0, 3, 3)).toBe(false)
    expect(canvasDragExceededThreshold(0, 0, 4, 0)).toBe(true)
    expect(canvasDragExceededThreshold(0, 0, 0, -4)).toBe(true)
  })

  it('only lets primary pointer-up finish a connection', () => {
    expect(shouldFinishCanvasConnection(0)).toBe(true)
    expect(shouldFinishCanvasConnection(0, true)).toBe(false)
    expect(shouldFinishCanvasConnection(1)).toBe(false)
    expect(shouldFinishCanvasConnection(2)).toBe(false)
  })

  it('keeps right-button default behavior until drag distance decides whether to show its menu', () => {
    expect(shouldPreventDefaultForCanvasPanStart(0)).toBe(true)
    expect(shouldPreventDefaultForCanvasPanStart(1)).toBe(true)
    expect(shouldPreventDefaultForCanvasPanStart(2)).toBe(false)
  })

  it('covers every menu role in the dismissal exemption selector', () => {
    // 菜单渲染在 stage 里，而收菜单发生在 capture 阶段——子项的 stopPropagation 来不及拦。
    // 少覆盖一个 role，那类菜单项就会「点了没反应」（曾漏掉节点右键菜单整条路）。
    // 这里只钉选择器覆盖面（本仓单测跑在 node 环境、无 DOM）；真实点击由走查验。
    for (const role of ['menu', 'menuitem', 'menuitemradio']) {
      expect(CANVAS_MENU_TARGET_SELECTOR).toContain(`[role="${role}"]`)
    }
  })

  it('treats macOS Ctrl + primary as the native secondary-click equivalent', () => {
    expect(isCanvasContextMenuPointer(2, false, 'Win32')).toBe(true)
    expect(isCanvasContextMenuPointer(0, true, 'MacIntel')).toBe(true)
    expect(isCanvasContextMenuPointer(0, true, 'iPad')).toBe(true)
    expect(isCanvasContextMenuPointer(0, true, 'Win32')).toBe(false)
    expect(isCanvasContextMenuPointer(0, false, 'MacIntel')).toBe(false)
  })

  // ── 右键落点四分（2026-09-06 真机取证的那个 bug 的类级不变量）──
  it('never calls a hit on the selection overlay blank', () => {
    // 报告的那一例：框选后罩子盖住节点，右键取不到 data-node-id。判成 'blank' 就会清掉刚框好的
    // 一批 + 弹「添加节点」菜单，「建组」当场不可达。
    expect(resolveCanvasContextMenuTarget({ nodeId: null, selectionOverlay: true })).toBe('selection')
    // 类级：罩子的存在与否，永远不能把落点降级成空白——哪怕同时命中节点。
    expect(resolveCanvasContextMenuTarget({ nodeId: 'gen-1', selectionOverlay: true })).toBe('node')
    expect(resolveCanvasContextMenuTarget({ nodeId: 'gen-1', selectionOverlay: false })).toBe('node')
    // 只有三者都不命中才是真空白——这是唯一允许清选择的分支。
    expect(resolveCanvasContextMenuTarget({ nodeId: null, selectionOverlay: false })).toBe('blank')
  })

  it('never calls a hit on a frame body blank either', () => {
    // 同一个反向定义的另一面（实拍 d、d2）：框体上右键取不到 data-node-id，
    // 被吞成「空白」→ 弹的是「添加节点」，框的改名/解散/整框动作一个都不可达。
    expect(resolveCanvasContextMenuTarget({ nodeId: null, selectionOverlay: false, frameId: 'group-1' })).toBe('frame')
    // 优先级：节点压在框上面，罩子又压在两者之上——命中更上层的就以更上层为准。
    expect(resolveCanvasContextMenuTarget({ nodeId: 'gen-1', selectionOverlay: false, frameId: 'group-1' })).toBe('node')
    expect(resolveCanvasContextMenuTarget({ nodeId: null, selectionOverlay: true, frameId: 'group-1' })).toBe('selection')
    // frameId 缺省（老调用方）行为不变。
    expect(resolveCanvasContextMenuTarget({ nodeId: null, selectionOverlay: false })).toBe('blank')
  })

  // ── 框工具就绪时的空白左键（2026-09-06 第一档）──
  it('gives the blank primary drag to the frame tool while it is armed', () => {
    const base = { button: 0, spaceHeld: false, shiftKey: false, interactiveTarget: false, readOnly: false }
    expect(resolveCanvasPointerDownAction({ ...base, frameToolArmed: true })).toBe('frame')
    // 就绪只抢空白左键。平移随时可用（空格/中键/右键都通），不会被这颗工具堵死。
    expect(resolveCanvasPointerDownAction({ ...base, frameToolArmed: true, spaceHeld: true })).toBe('pan')
    expect(resolveCanvasPointerDownAction({ ...base, frameToolArmed: true, button: 1 })).toBe('pan')
    expect(resolveCanvasPointerDownAction({ ...base, frameToolArmed: true, button: 2 })).toBe('pan')
    // 压在节点/控件上不画框——那是它们自己的指针。
    expect(resolveCanvasPointerDownAction({ ...base, frameToolArmed: true, interactiveTarget: true })).toBe('ignore')
    // 只读态画不了框。
    expect(resolveCanvasPointerDownAction({ ...base, frameToolArmed: true, readOnly: true })).toBe('ignore')
    // 没就绪时一切照旧（这条防的是「加了新分支顺手改了默认手势」）。
    expect(resolveCanvasPointerDownAction(base)).toBe('pan')
    expect(resolveCanvasPointerDownAction({ ...base, shiftKey: true })).toBe('marquee')
  })

  // ── 拖进 = 入组，拖出 = 退组 ──
  it('decides membership by the dragged node centre, not by any overlap', () => {
    const frame = { x: 0, y: 0, w: 400, h: 300 }
    // 中心在里 = 在里，哪怕卡片比框还大（「完全包含」制下它永远进不去）。
    expect(frameContainsNodeCenter(frame, { x: -100, y: -50, width: 600, height: 400 })).toBe(true)
    // 只是挨着框边蹭进来一点 = 不在里（「任意重叠」制下它会被吸进去）。
    expect(frameContainsNodeCenter(frame, { x: 380, y: 100, width: 200, height: 100 })).toBe(false)
    // 中心正好压在边上算在里面——宽容一侧，用户不必像素级对齐。
    expect(frameContainsNodeCenter(frame, { x: 300, y: 100, width: 200, height: 100 })).toBe(true)
  })

  it('turns inside/member into the four outcomes, and only those', () => {
    // 实拍里最伤的那一下：拖出去松手，框追着长大把它重新包住、成员没退组。
    // 这张表就是那件事的反面——出框 + 是成员 = 退组，没有第二种解释。
    expect(resolveCanvasFrameMembership({ inside: true, isMember: false })).toBe('join')
    expect(resolveCanvasFrameMembership({ inside: false, isMember: true })).toBe('leave')
    // 在框里挪来挪去、以及跟这个框本来就没关系的节点 —— 什么都不该发生。
    expect(resolveCanvasFrameMembership({ inside: true, isMember: true })).toBe('none')
    expect(resolveCanvasFrameMembership({ inside: false, isMember: false })).toBe('none')
  })

  it('points the selection-overlay selector at the class React Flow actually renders', () => {
    // 本仓单测跑在 node 环境（无 DOM），选择器本身测不了「命中没命中」。但它指错类名的后果
    // 和没修一样，所以拿**同一个类名的另一处真相**交叉验：画布 CSS 就是给这层罩子上皮肤的地方。
    // 罩子换名（React Flow 升级）时这条会红，而不是等到用户又一次框选建不了组。
    const flowStyles = readFileSync(
      fileURLToPath(new URL('../reactFlow/generationCanvasReactFlow.css', import.meta.url)),
      'utf8',
    )
    expect(CANVAS_SELECTION_OVERLAY_SELECTOR).toContain('.react-flow__nodesselection-rect')
    expect(flowStyles).toContain('.react-flow__nodesselection-rect')
  })
})
