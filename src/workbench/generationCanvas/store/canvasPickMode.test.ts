// 「在画布上点选」= 画布的一个共享能力（左「+」菜单、剪辑空态、下一条自动引用线的 @ → 画布节点都调它）。
// 合同：只有 eligible 的卡能点；点中回调恰好一次并退出；Esc / 点空白取消；再次进入会先取消上一次。
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  canvasPickNodeState,
  cancelCanvasPickMode,
  enterCanvasPickMode,
  handleCanvasPickModeKeyDown,
  isCanvasPickModeActive,
  pickCanvasNode,
} from './canvasPickMode'

beforeEach(() => cancelCanvasPickMode())

describe('canvas pick mode', () => {
  it('marks eligible / ineligible nodes only while active', () => {
    expect(canvasPickNodeState('a')).toBeNull()
    enterCanvasPickMode({ eligible: (id) => id === 'a', onPick: () => {} })
    expect(isCanvasPickModeActive()).toBe(true)
    expect(canvasPickNodeState('a')).toBe('eligible')
    expect(canvasPickNodeState('target')).toBe('ineligible')
  })

  it('picking an eligible node calls back exactly once and exits', () => {
    const onPick = vi.fn()
    const onCancel = vi.fn()
    enterCanvasPickMode({ eligible: (id) => id === 'a', onPick, onCancel })
    expect(pickCanvasNode('a')).toBe(true)
    expect(pickCanvasNode('a')).toBe(false)
    expect(onPick).toHaveBeenCalledTimes(1)
    expect(onPick).toHaveBeenCalledWith('a')
    expect(onCancel).not.toHaveBeenCalled()
    expect(isCanvasPickModeActive()).toBe(false)
  })

  it('an ineligible node is ignored and the mode stays', () => {
    const onPick = vi.fn()
    enterCanvasPickMode({ eligible: () => false, onPick })
    expect(pickCanvasNode('b')).toBe(false)
    expect(onPick).not.toHaveBeenCalled()
    expect(isCanvasPickModeActive()).toBe(true)
  })

  it('Esc cancels without picking', () => {
    const onPick = vi.fn()
    const onCancel = vi.fn()
    enterCanvasPickMode({ eligible: () => true, onPick, onCancel })
    expect(handleCanvasPickModeKeyDown({ key: 'Escape' })).toBe(true)
    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(onPick).not.toHaveBeenCalled()
    expect(isCanvasPickModeActive()).toBe(false)
    expect(handleCanvasPickModeKeyDown({ key: 'Escape' })).toBe(false)
  })

  it('entering again cancels the previous request first; the exit function only exits its own request', () => {
    const first = { onPick: vi.fn(), onCancel: vi.fn() }
    const exitFirst = enterCanvasPickMode({ eligible: () => true, ...first })
    enterCanvasPickMode({ eligible: () => true, onPick: () => {} })
    expect(first.onCancel).toHaveBeenCalledTimes(1)
    exitFirst()
    expect(isCanvasPickModeActive()).toBe(true)
  })
})
