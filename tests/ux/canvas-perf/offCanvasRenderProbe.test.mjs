// Unit contract for the off-canvas render probe's counting rule
// (createOffCanvasRenderTracker). This is the class-level regression test for
// the 2026-09-02 root-cause: the probe used to count any fiber whose
// subtree-inclusive `actualDuration > 0`, which massively over-counts because
// that value persists on the committed tree across bailouts. S3 ground-truthed
// that a component whose body ran 0 times during a drag was still reported ~69
// times per commit. The corrected rule counts a REAL own-body re-render only
// when a fiber's (memoizedProps, memoizedState) changed since the previous
// commit — the exact signal the browser probe now injects verbatim.
//
// These cases are the executable definition of "did this fiber re-render". The
// naive `actualDuration > 0` rule fails every one of the "bailed" cases below
// (it would count them on every commit); the fixed tracker passes.
import { describe, expect, it } from 'vitest'
import { createOffCanvasRenderTracker } from './offCanvasRenderProbe.mjs'

// Minimal fiber shape the tracker reads: identity + alternate + the two
// memoized fields. React double-buffers a fiber with its `alternate`; a real
// render flips which buffer is committed and updates memoizedProps/State, while
// a bailout re-commits the same buffer with both carried forward unchanged.
function makeFiberPair() {
  const a = { memoizedProps: null, memoizedState: null, alternate: null }
  const b = { memoizedProps: null, memoizedState: null, alternate: null }
  a.alternate = b
  b.alternate = a
  return { a, b }
}

describe('createOffCanvasRenderTracker.detect — cross-commit real-render signal', () => {
  it('counts the first sighting of an instance (mount is a render)', () => {
    const tracker = createOffCanvasRenderTracker()
    const { a } = makeFiberPair()
    a.memoizedProps = { x: 1 }
    a.memoizedState = { s: 1 }
    expect(tracker.detect(a)).toBe(true)
  })

  it('does NOT count a bailed fiber re-committed unchanged across many commits', () => {
    // This is THE regression: a component that rendered once and then bails on
    // every subsequent commit (its props/state frozen). The old actualDuration>0
    // walk counted it every commit; the tracker must count it exactly once.
    const tracker = createOffCanvasRenderTracker()
    const { a } = makeFiberPair()
    a.memoizedProps = { x: 1 }
    a.memoizedState = { s: 1 }
    expect(tracker.detect(a)).toBe(true) // mount
    let extraRenders = 0
    for (let commit = 0; commit < 60; commit += 1) {
      // Same fiber object, same frozen props/state re-walked each commit.
      if (tracker.detect(a)) extraRenders += 1
    }
    expect(extraRenders).toBe(0)
  })

  it('counts a real render when memoizedState changes (own state/subscription)', () => {
    const tracker = createOffCanvasRenderTracker()
    const { a, b } = makeFiberPair()
    a.memoizedProps = { x: 1 }
    a.memoizedState = { s: 1 }
    expect(tracker.detect(a)).toBe(true) // mount on buffer a
    // Real render flips to buffer b with new state; props unchanged by identity.
    b.memoizedProps = a.memoizedProps
    b.memoizedState = { s: 2 }
    expect(tracker.detect(b)).toBe(true)
    // Then it bails, re-committing buffer b unchanged: not counted.
    expect(tracker.detect(b)).toBe(false)
  })

  it('counts a real render when memoizedProps changes (parent passed new props)', () => {
    const tracker = createOffCanvasRenderTracker()
    const { a, b } = makeFiberPair()
    a.memoizedProps = { onClose: () => {} }
    a.memoizedState = { s: 1 }
    expect(tracker.detect(a)).toBe(true) // mount
    // Parent re-render hands a fresh closure prop → new object identity on b.
    b.memoizedState = a.memoizedState
    b.memoizedProps = { onClose: () => {} }
    expect(tracker.detect(b)).toBe(true)
    expect(tracker.detect(b)).toBe(false) // next commit bails
  })

  it('tracks each buffer flip as one render and quiet commits in between as zero', () => {
    // Simulate: mount, then 3 real renders each followed by 4 bail commits.
    const tracker = createOffCanvasRenderTracker()
    const { a, b } = makeFiberPair()
    const buffers = [a, b]
    a.memoizedProps = { v: 0 }
    a.memoizedState = null
    let committed = a
    let renders = tracker.detect(committed) ? 1 : 0 // mount = 1
    for (let realRender = 1; realRender <= 3; realRender += 1) {
      // Flip buffer, bump props → a genuine re-render this commit.
      committed = buffers[realRender % 2]
      committed.memoizedProps = { v: realRender }
      committed.memoizedState = null
      if (tracker.detect(committed)) renders += 1
      // Four quiet (bailed) commits re-walk the same committed buffer unchanged.
      for (let quiet = 0; quiet < 4; quiet += 1) {
        if (tracker.detect(committed)) renders += 1
      }
    }
    expect(renders).toBe(4) // 1 mount + 3 real renders, 12 bail commits ignored
  })

  it('regression guard: the OLD stale-duration rule over-counts the exact case this fixes', () => {
    // The pre-2026-09-02 probe counted a fiber whenever its committed
    // actualDuration was > 0. Because React leaves actualDuration on the
    // committed tree untouched across bailouts, that value stays positive for a
    // component that rendered once and then bailed — so the naive rule counts it
    // every commit. We reproduce that here to lock in WHY the tracker exists:
    // over 60 bail commits the naive rule fires 60 extra times, the tracker 0.
    const bailedFiber = { actualDuration: 3.2, memoizedProps: { x: 1 }, memoizedState: { s: 1 }, alternate: null }
    const naiveRuleCount = () => (bailedFiber.actualDuration > 0 ? 1 : 0)

    const tracker = createOffCanvasRenderTracker()
    tracker.detect(bailedFiber) // mount sighting
    let naiveExtra = 0
    let trackerExtra = 0
    for (let commit = 0; commit < 60; commit += 1) {
      naiveExtra += naiveRuleCount() // stale actualDuration stays 3.2 → always 1
      if (tracker.detect(bailedFiber)) trackerExtra += 1
    }
    expect(naiveExtra).toBe(60) // the bug: 60 phantom renders
    expect(trackerExtra).toBe(0) // the fix: none
  })

  it('two independent instances are tracked separately (no cross-talk)', () => {
    const tracker = createOffCanvasRenderTracker()
    const one = makeFiberPair()
    const two = makeFiberPair()
    one.a.memoizedProps = { id: 'one' }
    two.a.memoizedProps = { id: 'two' }
    expect(tracker.detect(one.a)).toBe(true)
    expect(tracker.detect(two.a)).toBe(true)
    // one re-renders, two bails.
    one.b.memoizedProps = { id: 'one', n: 1 }
    one.b.memoizedState = one.a.memoizedState
    expect(tracker.detect(one.b)).toBe(true)
    expect(tracker.detect(two.a)).toBe(false)
  })
})
