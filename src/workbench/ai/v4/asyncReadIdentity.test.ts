import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
import React from 'react'
import { describe, expect, it } from 'vitest'
import { createReactTestRenderer } from './testReactRenderer'

// Exercise the actual frozen hook bodies with React's installed renderer. No DOM/server,
// timers, copied controller, or simulated effect ordering replaces the production hooks.
function evaluate(source: string, globals: Record<string, unknown>) {
  const context = vm.createContext({ React, ...globals })
  vm.runInContext(ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText, context)
  return context
}
type ProbeProps = { historyError?: boolean; value?: { runs: Array<{ runId: string }> }; [key: string]: unknown }
type ScrollNode = { props: ProbeProps; scrollTop: number; scrollHeight: number; clientHeight: number;
  listeners: Set<() => void>; addEventListener(type: string, fn: () => void): void; removeEventListener(type: string, fn: () => void): void }
function harness(Component: React.ComponentType<ProbeProps>) {
  let node!: ScrollNode
  const renderer = createReactTestRenderer<ScrollNode>({
    createInstance: (_type, props) => node = { props: props as ProbeProps, scrollTop: 0, scrollHeight: 1000, clientHeight: 300,
      listeners: new Set<() => void>(), addEventListener(_type: string, fn: () => void) { this.listeners.add(fn) }, removeEventListener(_type: string, fn: () => void) { this.listeners.delete(fn) } },
    commitUpdate: (instance, props) => { instance.props = props as ProbeProps },
  })
  const render = (props: ProbeProps | null) => { renderer.render(props ? React.createElement(Component, props) : null); renderer.flushPassiveEffects() }
  return { render, node: () => node, scroll: () => { for (const fn of [...node.listeners] as (() => void)[]) fn() },
    async settle() { for (let i = 0; i < 8; i++) await Promise.resolve(); renderer.flushPassiveEffects() }, close: () => renderer.close() }
}
function deferred<T = unknown>() { let resolve!: (v: T) => void; let reject!: (e: Error) => void; const promise = new Promise<T>((a, b) => { resolve = a; reject = b }); return { promise, resolve, reject } }
// 跟到底归现成库（use-stick-to-bottom）；这里换成一个只报「跟没跟着底」的替身，让分页钉位那段真代码照常跑。
const stickDouble = (following: boolean) => function useStickToBottomDouble() {
  return React.useMemo(() => {
    const scrollRef = Object.assign((node: unknown) => { scrollRef.current = node }, { current: null as unknown })
    const contentRef = Object.assign((node: unknown) => { contentRef.current = node }, { current: null as unknown })
    return { scrollRef, contentRef, scrollToBottom: () => Promise.resolve(following), stopScroll: () => undefined, isAtBottom: following, state: { isAtBottom: following } }
  }, [])
}
class NoResizeObserver { observe() {} disconnect() {} }
function panel({ following = false }: { following?: boolean } = {}) {
  const source = readFileSync(new URL('./AgentPanelV4Panel.tsx', import.meta.url), 'utf8')
  const start = source.indexOf('  const stick = useStickToBottom(')
  if (start < 0) throw new Error('AgentPanelV4Panel.tsx 里找不到 useStickToBottom：钩子段的起点变了，这条测试要跟着改')
  const hooks = source.slice(start, source.indexOf('  return (\n    <section', start))
  const context = evaluate(`function Probe({flow,onLoadOlder,flowTail,slot,queue,historyIdentity,historyCursor,conversationKey,composer}) {${hooks}\nreturn React.createElement('scroll',{ref:scrollRef,historyError});}`, { useStickToBottom: stickDouble(following), ResizeObserver: NoResizeObserver })
  return harness(context.Probe)
}
const props = (id: string, load: () => Promise<unknown>) => ({ historyIdentity: id, historyCursor: id + '1', flow: [{ identity: id + '1' }], onLoadOlder: load })
describe('pagination lifecycle in actual Panel hooks', () => {
  it.each(['resolve', 'reject'] as const)('new short conversation starts immediately; old %s cannot settle its request', async outcome => {
    const h = panel(), a = deferred(), b = deferred(); let calls = 0
    h.render(props('A', () => a.promise)); h.scroll()
    h.node().scrollHeight = 100
    const next = props('B', () => { calls++; return b.promise })
    h.render(next)
    try {
      expect(calls).toBe(1)
      if (outcome === 'resolve') a.resolve('A0'); else a.reject(new Error('A failed'))
      await h.settle(); expect(h.node().props.historyError).toBe(false)
      h.render({ ...next, onLoadOlder: () => { calls++; return b.promise } }); h.scroll()
      expect(calls).toBe(1)
      b.resolve('B1'); await h.settle()
    } finally { h.close() }
  })
  it('same session in a new workspace and unmount invalidate old settlements', async () => {
    const h = panel(), old = deferred(), next = deferred(); let calls = 0
    h.render(props('w1/lane/session', () => old.promise)); h.scroll()
    h.render(props('w2/lane/session', () => { calls++; return next.promise })); h.scroll()
    expect(calls).toBe(1)
    old.reject(new Error('old workspace')); await h.settle()
    expect(h.node().props.historyError).toBe(false)
    h.close(); next.reject(new Error('unmounted')); await h.settle()
    h.render(props('w2/lane/session', () => Promise.resolve('w2/lane/session1')))
    expect(h.node().props.historyError).toBe(false); h.close()
  })
  it('current failure reports locally, retry and same-session rerenders keep one request', async () => {
    const h = panel(), page = deferred(); let calls = 0
    const p = props('A', () => { calls++; return page.promise })
    h.render(p); h.scroll(); h.render({ ...p, flow: [...p.flow] }); h.scroll()
    expect(calls).toBe(1)
    page.reject(new Error('current')); await h.settle(); expect(h.node().props.historyError).toBe(true)
    const retry = deferred(); h.render({ ...p, onLoadOlder: () => { calls++; return retry.promise } })
    expect(h.node().props.historyError).toBe(true)
    h.scroll(); await h.settle()
    expect(calls).toBe(2); expect(h.node().props.historyError).toBe(false)
    retry.resolve('A1'); await h.settle(); h.close()
  })
  it.each(['ack-first', 'commit-first'] as const)('preserves prepend geometry in %s order', async order => {
    const h = panel(), page = deferred(); const p = props('A', () => page.promise)
    h.render(p); h.node().scrollTop = 10; h.scroll()
    try {
      if (order === 'ack-first') { page.resolve('A0'); await h.settle() }
      h.node().scrollHeight = 1400
      h.render({ ...p, historyCursor: 'A0', flow: [{ identity: 'A0' }, ...p.flow] })
      expect(h.node().scrollTop).toBe(410)
      if (order === 'commit-first') { page.resolve('A0'); await h.settle() }
    } finally { h.close() }
  })
  it('leaves a reader who is following the bottom to the follow lock when older history prepends', async () => {
    const h = panel({ following: true }), page = deferred(); const p = props('A', () => page.promise)
    h.render(p); h.node().scrollTop = 10; h.scroll()
    try {
      page.resolve('A0'); await h.settle()
      h.node().scrollHeight = 1400
      h.render({ ...p, historyCursor: 'A0', flow: [{ identity: 'A0' }, ...p.flow] })
      expect(h.node().scrollTop, 'the anchor must not fight the follow lock for the same scrollTop').toBe(10)
    } finally { h.close() }
  })
  it('keeps the reading position when another scroll arrives between page ACK and flow commit', async () => {
    const h = panel(), first = deferred(), second = deferred(); let calls = 0
    const p = props('A', () => (++calls === 1 ? first.promise : second.promise))
    h.render(p); h.node().scrollTop = 10; h.scroll()
    try {
      first.resolve('A0'); await h.settle()
      // The authoritative cursor advanced, but the rendered flow still shows A1.
      h.scroll()
      const firstFlow = [{ identity: 'A0' }, ...p.flow]
      h.node().scrollHeight = 1400
      h.render({ ...p, historyCursor: 'A0', flow: firstFlow })
      expect(h.node().scrollTop).toBe(410)
      if (calls === 2) {
        // A second read was admitted against the not-yet-committed first prepend.
        second.resolve('A-1'); await h.settle()
        h.node().scrollHeight = 1800
        h.render({ ...p, historyCursor: 'A-1', flow: [{ identity: 'A-1' }, ...firstFlow] })
        expect(h.node().scrollTop, 'both prepends must preserve the originally visible row').toBe(810)
      } else {
        // Serializing until the first prepend commits is also a valid implementation.
        expect(calls).toBe(1)
      }
    } finally { h.close() }
  })
  it.each(['ack-first', 'commit-first'] as const)('releases filtered cursor advancement in %s order without moving the row', async order => {
    const h = panel(), first = deferred(), second = deferred(); let calls = 0
    const p = props('A', () => { calls++; return calls === 1 ? first.promise : second.promise })
    h.render(p); h.node().scrollTop = 10; h.scroll()
    try {
      if (order === 'ack-first') { first.resolve('A0'); await h.settle(); h.scroll(); expect(calls).toBe(1) }
      h.render({ ...p, historyCursor: 'A0' })
      if (order === 'commit-first') { h.scroll(); expect(calls).toBe(1); first.resolve('A0'); await h.settle() }
      expect(h.node().scrollTop).toBe(10)
      h.scroll(); expect(calls).toBe(2)
      second.resolve('A0'); await h.settle()
    } finally { h.close() }
  })
  it.each(['ack-first', 'commit-first'] as const)('continues a short filtered page automatically in %s order', async order => {
    const h = panel(), first = deferred(), second = deferred(); let calls = 0
    const p = props('A', () => (++calls === 1 ? first.promise : second.promise))
    h.render(p); h.node().scrollHeight = 100; h.scroll()
    try {
      if (order === 'ack-first') { first.resolve('A0'); await h.settle() }
      h.render({ ...p, historyCursor: 'A0' })
      if (order === 'commit-first') { expect(calls).toBe(1); first.resolve('A0'); await h.settle() }
      expect(calls).toBe(2)
      second.resolve('A0'); await h.settle()
      expect(calls, 'an unchanged cursor must not cause an automatic retry loop').toBe(2)
    } finally { h.close() }
  })
  it('A-B-A does not revive the old A token; empty ACK cannot anchor later reset', async () => {
    const h = panel(), old = deferred(), current = deferred(); let calls = 0
    const a = props('workspace1/A', () => old.promise)
    h.render(a); h.scroll(); h.render(props('B', () => Promise.resolve('B1')))
    h.render({ ...a, onLoadOlder: () => { calls++; return current.promise } }); h.scroll()
    try {
      expect(calls).toBe(1); old.reject(new Error('old')); await h.settle(); expect(h.node().props.historyError).toBe(false)
      current.resolve(a.historyCursor); await h.settle()
      h.node().scrollTop = 17; h.node().scrollHeight = 1800
      h.render({ ...a, flow: [{ identity: 'replacement' }], onLoadOlder: undefined })
      expect(h.node().scrollTop).toBe(17)
    } finally { h.close() }
  })
})
