import assert from 'node:assert/strict'
import test from 'node:test'
import vm from 'node:vm'
import { installCompletionProbe, parseNomiJourneySelection } from './nomi-next-workflow-probe.mjs'

test('narrow journey selection rejects every unknown, split or duplicate argument before setup', () => {
  assert.equal(parseNomiJourneySelection([]), false)
  assert.equal(parseNomiJourneySelection(['--only=storyboard.switch']), true)
  for (const args of [['--only=storyboard.swich'], ['--only', 'storyboard.switch'], ['--only=storyboard.switch', '--only=storyboard.switch'], ['--only=storyboard.switch', '--unknown'], ['--unknown']]) assert.throws(() => parseNomiJourneySelection(args), /Unsupported Nomi journey arguments/)
})

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

test('selected design with target plus stale foreign content cannot complete a switch', () => {
  const listeners = {}
  let now = 0, callback, selected = 'design-a', content = 'unique-shot-a'
  const box = { width: 100, height: 100, right: 100, bottom: 100, left: 0, top: 0 }
  const context = {
    args: { id: 'switch', triggerSelector: '[data-storyboard-id="design-b"]', conditions: [
      { selector: '[data-storyboard-id][data-active="true"]', attribute: 'data-storyboard-id', value: 'design-b' },
      { selector: '.workbench-storyboard', text: 'unique-shot-b', textNot: ['unique-shot-a'] },
    ] }, window: {}, crypto: { randomUUID: () => 'document' }, performance: { now: () => now }, innerWidth: 1280, innerHeight: 933,
    PerformanceObserver: class { observe() {} takeRecords() { return [] } disconnect() {} },
    requestAnimationFrame: (fn) => { callback = fn; return 1 }, cancelAnimationFrame() {},
    document: { addEventListener: (name, fn) => { listeners[name] = fn }, removeEventListener() {},
      querySelector: (selector) => ({ checkVisibility: () => true, getBoundingClientRect: () => box,
        getAttribute: () => selected, textContent: selector === '.workbench-storyboard' ? content : '' }) },
  }
  vm.runInNewContext(`(${installCompletionProbe.toString()})(args)`, context)
  now = 10; listeners.pointerdown({ isTrusted: true, target: { closest: () => true } })
  // The active production row has changed while the old editor content remains.
  selected = 'design-b'; now = 20; callback()
  assert.equal(context.window.__nomiCompletion.completedAt, null)
  // Even if the target text arrives, stale content must not impersonate completion.
  content = 'unique-shot-a unique-shot-b'; now = 30; callback()
  assert.equal(context.window.__nomiCompletion.completedAt, null)
  selected = 'design-a'; content = 'unique-shot-b'; now = 40; callback()
  assert.equal(context.window.__nomiCompletion.completedAt, null, 'Target content cannot replace selected design identity')
  selected = 'design-b'; now = 50; callback()
  assert.equal(context.window.__nomiCompletion.completedAt, 50)
  context.window.__nomiCompletion.stop()
})
