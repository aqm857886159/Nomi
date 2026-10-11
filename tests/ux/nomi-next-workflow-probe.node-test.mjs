import assert from 'node:assert/strict'
import test from 'node:test'
import vm from 'node:vm'
import { installCompletionProbe } from './nomi-next-workflow-probe.mjs'

test('completion probe starts its browser frame loop before trusting an input', () => {
  const listeners = {}
  let now = 0, callback, complete = false, scheduled = 0
  const context = { args: { id: 'sample', triggerSelector: '.trigger', conditions: [{ selector: '.complete' }] },
    window: {}, crypto: { randomUUID: () => 'document' }, performance: { now: () => now }, innerWidth: 1280, innerHeight: 933,
    PerformanceObserver: class { observe() {} takeRecords() { return [] } disconnect() {} },
    requestAnimationFrame: (fn) => { callback = fn; scheduled++; return scheduled }, cancelAnimationFrame: () => {},
    document: { addEventListener: (name, fn) => { listeners[name] = fn }, removeEventListener: (name) => { delete listeners[name] },
      querySelector: () => complete ? { checkVisibility: () => true, getBoundingClientRect: () => ({ width: 100, height: 100, right: 100, bottom: 100, left: 0, top: 0 }) } : null },
  }
  vm.runInNewContext(`(${installCompletionProbe.toString()})(args)`, context)
  assert.equal(scheduled, 1, 'The action must have a real scheduled browser frame observer')
  now = 10; listeners.pointerdown({ isTrusted: true, target: { closest: () => true } }); complete = true; now = 30; callback(5)
  assert.equal(context.window.__nomiCompletion.completedAt, 30)
  assert.equal(context.window.__nomiCompletion.frames[0].duration, 20)
  context.window.__nomiCompletion.stop()
  assert.equal(listeners.pointerdown, undefined)
})
