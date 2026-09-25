import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { beginCanvasDragging, cancelCanvasDraggingWithin, CANVAS_DRAGGING_ATTRIBUTE, CANVAS_DRAGGING_OWNER } from './canvasDraggingFlag'
import type { CanvasDraggingOwner } from './canvasDraggingFlag'

function stage() {
  const attrs = new Map<string, string>()
  const element = { isConnected: true, parentElement: null, closest: () => element,
    contains: (other: unknown) => other === element,
    hasAttribute: (key: string) => attrs.has(key), getAttribute: (key: string) => attrs.get(key),
    setAttribute: (key: string, value: string) => attrs.set(key, value), removeAttribute: (key: string) => attrs.delete(key),
  } as unknown as Element
  return element
}
/** 一个「工作区槽位」：装着若干 stage，自己不是 stage。 */
function slot(...children: Element[]) {
  return { contains: (other: unknown) => children.includes(other as Element) } as unknown as Element
}
beforeEach(() => {
  vi.stubGlobal('window', new EventTarget())
  vi.stubGlobal('document', Object.assign(new EventTarget(), { hidden: false }))
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })
describe('canvas gesture ownership', () => {
  it('captures original stage across detach and does not clear a new same-source gesture', () => {
    const a = stage(); const b = stage()
    const origin = { closest: () => a } as unknown as Element
    const first = beginCanvasDragging(origin, CANVAS_DRAGGING_OWNER.node)
    const second = beginCanvasDragging(a, CANVAS_DRAGGING_OWNER.node)
    const other = beginCanvasDragging(b, CANVAS_DRAGGING_OWNER.node)
    Object.assign(origin, { closest: () => null }); first.release(); first.release()
    expect(a.hasAttribute(CANVAS_DRAGGING_ATTRIBUTE)).toBe(true)
    expect(b.hasAttribute(CANVAS_DRAGGING_ATTRIBUTE)).toBe(true)
    second.release()
    expect(a.hasAttribute(CANVAS_DRAGGING_ATTRIBUTE)).toBe(false)
    expect(b.hasAttribute(CANVAS_DRAGGING_ATTRIBUTE)).toBe(true)
    other.release()
  })
  it('null origin cannot acquire the first stage in the document', () => {
    const a = stage()
    beginCanvasDragging(null, CANVAS_DRAGGING_OWNER.node).release()
    expect(a.hasAttribute(CANVAS_DRAGGING_ATTRIBUTE)).toBe(false)
  })
  it.each(['blur', 'pointercancel', 'lostpointercapture'])('cancels once on %s and removes listeners', (name) => {
    const a = stage(); const cancel = vi.fn()
    beginCanvasDragging(a, CANVAS_DRAGGING_OWNER.node, { onCancel: cancel, pointerId: 4 })
    window.dispatchEvent(Object.assign(new Event(name), { pointerId: 4 })); window.dispatchEvent(Object.assign(new Event(name), { pointerId: 4 }))
    expect(cancel).toHaveBeenCalledTimes(1)
    expect(a.hasAttribute(CANVAS_DRAGGING_ATTRIBUTE)).toBe(false)
  })
  it('ends a button gesture once its release is lost: buttonless mouse move or native drag start', () => {
    for (const lost of [
      Object.assign(new Event('pointermove'), { pointerType: 'mouse', buttons: 0, clientX: 30, clientY: 40 }),
      Object.assign(new Event('dragstart'), { clientX: 30, clientY: 40 }),
    ]) {
      const a = stage(); const onReleaseLost = vi.fn(); const cancel = vi.fn()
      beginCanvasDragging(a, CANVAS_DRAGGING_OWNER.reactFlowNode, { onCancel: cancel, onReleaseLost })
      window.dispatchEvent(Object.assign(new Event('pointermove'), { pointerType: 'mouse', buttons: 1, clientX: 10, clientY: 20 }))
      window.dispatchEvent(Object.assign(new Event('pointermove'), { pointerType: 'touch', buttons: 0, clientX: 10, clientY: 20 }))
      expect(onReleaseLost).not.toHaveBeenCalled()
      window.dispatchEvent(lost); window.dispatchEvent(lost)
      expect(onReleaseLost).toHaveBeenCalledTimes(1)
      expect(onReleaseLost).toHaveBeenCalledWith({ clientX: 30, clientY: 40 })
      expect(cancel).not.toHaveBeenCalled()
      expect(a.hasAttribute(CANVAS_DRAGGING_ATTRIBUTE)).toBe(false)
    }
  })
  it('a lease without onReleaseLost ignores buttonless moves (wheel pans keep their flag)', () => {
    const a = stage()
    const lease = beginCanvasDragging(a, CANVAS_DRAGGING_OWNER.reactFlowViewport)
    window.dispatchEvent(Object.assign(new Event('pointermove'), { pointerType: 'mouse', buttons: 0, clientX: 1, clientY: 1 }))
    expect(a.hasAttribute(CANVAS_DRAGGING_ATTRIBUTE)).toBe(true)
    lease.release()
  })
  it('a deferred lease only takes the stage once it is activated', () => {
    // 跨过拖拽阈值才升旗（点一下空白不许写属性 → 不让整棵 stage 子树重算样式）。
    const a = stage()
    const lease = beginCanvasDragging(a, CANVAS_DRAGGING_OWNER.node, { active: false })
    expect(a.hasAttribute(CANVAS_DRAGGING_ATTRIBUTE)).toBe(false)
    lease.activate()
    expect(a.hasAttribute(CANVAS_DRAGGING_ATTRIBUTE)).toBe(true)
    lease.release()
    // 已经结束的租约再 activate 不许把旗重新升起来。
    lease.activate()
    expect(a.hasAttribute(CANVAS_DRAGGING_ATTRIBUTE)).toBe(false)
  })
  it('a hidden tab cancels the gesture', () => {
    const a = stage(); const cancel = vi.fn()
    beginCanvasDragging(a, CANVAS_DRAGGING_OWNER.viewport, { onCancel: cancel })
    Object.assign(document, { hidden: true })
    document.dispatchEvent(new Event('visibilitychange'))
    expect(cancel).toHaveBeenCalledTimes(1)
    expect(a.hasAttribute(CANVAS_DRAGGING_ATTRIBUTE)).toBe(false)
  })
  it('descendant focus changes are not a window blur', () => {
    // capture 也看得见后代的 blur；只有 window 自己失焦才算手势被打断。
    const a = stage(); const cancel = vi.fn()
    beginCanvasDragging(a, CANVAS_DRAGGING_OWNER.node, { onCancel: cancel })
    const descendant = new EventTarget()
    const event = new Event('blur')
    Object.defineProperty(event, 'target', { value: descendant })
    window.dispatchEvent(event)
    expect(cancel).not.toHaveBeenCalled()
    expect(a.hasAttribute(CANVAS_DRAGGING_ATTRIBUTE)).toBe(true)
    window.dispatchEvent(new Event('blur'))
    expect(cancel).toHaveBeenCalledTimes(1)
  })
  it('release makes a later cancel a no-op', () => {
    const a = stage(); const cancel = vi.fn()
    const lease = beginCanvasDragging(a, CANVAS_DRAGGING_OWNER.node, { onCancel: cancel })
    lease.release()
    lease.cancel()
    expect(cancel).not.toHaveBeenCalled()
  })
  // 2026-09-21：宿主隐藏/卸载走的那条路。它取代了原来「给每次手势装一个扫祖先链的
  // MutationObserver」——那条回调在 React Flow 拖动时每帧触发、每帧一轮 getComputedStyle。
  describe('host-driven cancellation (workspace slot hidden or unmounted)', () => {
    it('cancels only the gestures inside that container', () => {
      const a = stage(); const b = stage()
      const cancelA = vi.fn(); const cancelB = vi.fn()
      beginCanvasDragging(a, CANVAS_DRAGGING_OWNER.node, { onCancel: cancelA })
      const other = beginCanvasDragging(b, CANVAS_DRAGGING_OWNER.node, { onCancel: cancelB })
      cancelCanvasDraggingWithin(slot(a))
      expect(cancelA).toHaveBeenCalledTimes(1)
      expect(a.hasAttribute(CANVAS_DRAGGING_ATTRIBUTE)).toBe(false)
      expect(cancelB).not.toHaveBeenCalled()
      expect(b.hasAttribute(CANVAS_DRAGGING_ATTRIBUTE)).toBe(true)
      other.release()
    })
    it('is a no-op without a container, and never touches a finished gesture', () => {
      const a = stage(); const cancel = vi.fn()
      const lease = beginCanvasDragging(a, CANVAS_DRAGGING_OWNER.node, { onCancel: cancel })
      cancelCanvasDraggingWithin(null)
      expect(cancel).not.toHaveBeenCalled()
      lease.release()
      cancelCanvasDraggingWithin(slot(a))
      expect(cancel).not.toHaveBeenCalled()
    })
    it('finds the gesture through its stage when the origin is a descendant', () => {
      const a = stage(); const cancel = vi.fn()
      const origin = { closest: () => a } as unknown as Element
      beginCanvasDragging(origin, CANVAS_DRAGGING_OWNER.selection, { onCancel: cancel })
      cancelCanvasDraggingWithin(slot(a))
      expect(cancel).toHaveBeenCalledTimes(1)
      expect(a.hasAttribute(CANVAS_DRAGGING_ATTRIBUTE)).toBe(false)
    })
  })
  it('pointer cancellation only releases the matching gesture', () => {
    const a = stage(); const b = stage()
    beginCanvasDragging(a, CANVAS_DRAGGING_OWNER.node, { pointerId: 4 })
    const other = beginCanvasDragging(b, CANVAS_DRAGGING_OWNER.node, { pointerId: 5 })
    window.dispatchEvent(Object.assign(new Event('pointercancel'), { pointerId: 4 }))
    expect(a.hasAttribute(CANVAS_DRAGGING_ATTRIBUTE)).toBe(false)
    expect(b.hasAttribute(CANVAS_DRAGGING_ATTRIBUTE)).toBe(true)
    other.release()
  })

  it('does not let a tracked pointer cancel an untracked lease on another stage', () => {
    const activeStage = stage(); const otherStage = stage()
    beginCanvasDragging(activeStage, CANVAS_DRAGGING_OWNER.node, { pointerId: 4 })
    const other = beginCanvasDragging(otherStage, CANVAS_DRAGGING_OWNER.node)
    window.dispatchEvent(Object.assign(new Event('pointercancel'), { pointerId: 4 }))
    expect(activeStage.hasAttribute(CANVAS_DRAGGING_ATTRIBUTE)).toBe(false)
    expect(otherStage.hasAttribute(CANVAS_DRAGGING_ATTRIBUTE)).toBe(true)
    other.release()
  })

  describe('the flag never outlives the pointer gesture (2026-09-22 stuck data-dragging)', () => {
    function setup() {
      const attributes = new Map<string, string>()
      const stage = {
        closest: () => stage,
        hasAttribute: (name: string) => attributes.has(name),
        setAttribute: (name: string, value: string) => attributes.set(name, value),
        removeAttribute: (name: string) => attributes.delete(name),
      } as unknown as Element
      const listeners = new Map<string, Set<(event: Event) => void>>()
      const docListeners = new Map<string, Set<(event: Event) => void>>()
      const fakeWindow = {
        addEventListener: (name: string, fn: (event: Event) => void) => {
          if (!listeners.has(name)) listeners.set(name, new Set())
          listeners.get(name)!.add(fn)
        },
        removeEventListener: (name: string, fn: (event: Event) => void) => listeners.get(name)?.delete(fn),
        // 兜底收尾等一帧；测试里把「下一帧」攒起来，由 nextFrame() 显式推进。
        requestAnimationFrame: (fn: () => void) => { frames.push(fn); return frames.length },
      }
      const frames: Array<() => void> = []
      const nextFrame = () => { for (const fn of frames.splice(0)) fn() }
      vi.stubGlobal('document', {
        hidden: false, querySelector: () => stage,
        addEventListener: (name: string, fn: (event: Event) => void) => {
          if (!docListeners.has(name)) docListeners.set(name, new Set())
          docListeners.get(name)!.add(fn)
        },
        removeEventListener: (name: string, fn: (event: Event) => void) => docListeners.get(name)?.delete(fn),
      })
      vi.stubGlobal('window', fakeWindow)
      const fire = (type: string, target: unknown = fakeWindow) => {
        for (const fn of [...(listeners.get(type) ?? [])]) fn({ type, target } as unknown as Event)
      }
      const firePointer = (type: string, pointerId: number) => {
        for (const fn of [...(listeners.get(type) ?? [])]) fn({ type, target: fakeWindow, pointerId } as unknown as Event)
      }
      const listenerCount = () =>
        [...listeners.values()].reduce((sum, set) => sum + set.size, 0) +
        [...docListeners.values()].reduce((sum, set) => sum + set.size, 0)
      // 「某位 owner 的收尾压根没走到」——租约照旧开，但故意不调它的 release()。
      const raise = (owner: CanvasDraggingOwner, pointerId?: number) =>
        beginCanvasDragging(stage, owner, pointerId === undefined ? undefined : { pointerId })
      return { attributes, stage, fire, firePointer, listenerCount, nextFrame, raise }
    }

    it('reported case: a viewport owner whose own release was skipped is cleared when the pointer lifts', () => {
      const { attributes, fire, nextFrame, raise } = setup()
      // 平移升起标志，但 React Flow 推迟 150ms 的 onMoveEnd 因为共享布尔被重置而没有释放这张租约。
      raise(CANVAS_DRAGGING_OWNER.reactFlowViewport)
      expect(attributes.get(CANVAS_DRAGGING_ATTRIBUTE)).toBe('true')
      fire('pointerup')
      nextFrame()
      expect(attributes.has(CANVAS_DRAGGING_ATTRIBUTE)).toBe(false)
    })

    it('a gesture that starts before the settle frame keeps its own flag', () => {
      const { attributes, fire, nextFrame, raise } = setup()
      raise(CANVAS_DRAGGING_OWNER.reactFlowViewport)
      fire('pointerup')
      raise(CANVAS_DRAGGING_OWNER.reactFlowNode)
      nextFrame()
      expect(attributes.get(CANVAS_DRAGGING_ATTRIBUTE)).toBe('true')
      fire('pointerup')
      nextFrame()
      expect(attributes.has(CANVAS_DRAGGING_ATTRIBUTE)).toBe(false)
    })

    it('class: every owner is bounded by the gesture — pointercancel and window blur end it, a descendant blur does not', () => {
      const { attributes, fire, nextFrame, raise } = setup()
      for (const owner of Object.values(CANVAS_DRAGGING_OWNER)) {
        const lease = raise(owner)
        fire('blur', { nodeName: 'BUTTON' })
        nextFrame()
        expect(attributes.get(CANVAS_DRAGGING_ATTRIBUTE)).toBe('true')
        fire(owner === CANVAS_DRAGGING_OWNER.group ? 'blur' : 'pointercancel')
        nextFrame()
        expect(attributes.has(CANVAS_DRAGGING_ATTRIBUTE)).toBe(false)
        // 手势结束后 owner 迟到的释放是空操作，不会把下一次手势的标志摘掉。
        lease.release()
      }
    })

    it('a normal release disarms the guard, and a later gesture re-arms it', () => {
      const { attributes, fire, listenerCount, nextFrame, raise } = setup()
      const first = raise(CANVAS_DRAGGING_OWNER.reactFlowNode)
      expect(listenerCount()).toBeGreaterThan(0)
      first.release()
      // 正常收尾之后一个监听都不许留（否则每次手势攒一份，热路径上越拖越慢）。
      expect(listenerCount()).toBe(0)
      raise(CANVAS_DRAGGING_OWNER.selection)
      expect(listenerCount()).toBeGreaterThan(0)
      fire('pointerup')
      nextFrame()
      expect(attributes.has(CANVAS_DRAGGING_ATTRIBUTE)).toBe(false)
      expect(listenerCount()).toBe(0)
    })

    it('ignores a pointer cancellation belonging to another pointer on the same stage', () => {
      const { attributes, firePointer, nextFrame, raise } = setup()
      raise(CANVAS_DRAGGING_OWNER.reactFlowViewport, 4)
      firePointer('pointercancel', 99)
      nextFrame()
      expect(attributes.get(CANVAS_DRAGGING_ATTRIBUTE)).toBe('true')
      firePointer('pointercancel', 4)
      nextFrame()
      expect(attributes.has(CANVAS_DRAGGING_ATTRIBUTE)).toBe(false)
    })
  })
})
