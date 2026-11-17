import React from 'react'
import { createReactTestRenderer } from '../v4/testReactRenderer'
import { AgentPanelV4FocusTag } from '../v4/AgentPanelV4FocusTag'
import { useShotFocusTag } from '../../generationCanvas/nodes/director/panels/shotStrip/useShotFocusTag'
import { registerDirectorSession, readDirectorShotFocus, clearDirectorShotFocus } from '../../generationCanvas/nodes/director/directorSessionRegistry'
import type { DirectorShotFocus } from '../../generationCanvas/nodes/director/model/directorShotFocus'
import type { V4ComposerReference, V4Chip } from '../v4/agentPanelV4Types'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { useWorkbenchStore } from '../../workbenchStore'

beforeAll(() => {
  const original = globalThis.fetch
  vi.stubGlobal('fetch', (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) throw new Error('selection_probe_network_blocked')
    return original(input, init)
  })
  expect(() => fetch('https://selection-canary.invalid')).toThrow('selection_probe_network_blocked')
})
afterAll(() => vi.unstubAllGlobals())

beforeEach(() => useWorkbenchStore.setState({ selectedTimelineClipIds: ['a', 'b'], selectedTextClipId: 'caption' }))
describe('owner cancellation is atomic and idempotent, never toggles or clears the other subtype', () => {
  it('removes only one media id, preserves caption and source data, repeated × does not reselect', () => {
    const before = useWorkbenchStore.getState().timeline
    const cancel = () => useWorkbenchStore.getState().deselectTimelineItem('a', 'media', () => true)
    cancel(); cancel()
    const state = useWorkbenchStore.getState()
    expect(state.selectedTimelineClipIds).toEqual(['b'])
    expect(state.selectedTextClipId).toBe('caption')
    expect(state.timeline).toBe(before)
  })
  it('removes caption only, preserves both media ids, repeated × is a no-op', () => {
    const cancel = () => useWorkbenchStore.getState().deselectTimelineItem('caption', 'text', () => true)
    cancel(); cancel()
    expect(useWorkbenchStore.getState().selectedTimelineClipIds).toEqual(['a', 'b'])
    expect(useWorkbenchStore.getState().selectedTextClipId).toBe('')
  })
  it('a stale owner or nonmember changes nothing, including store identity', () => {
    const before = useWorkbenchStore.getState()
    before.deselectTimelineItem('a', 'media', () => false)
    before.deselectTimelineItem('caption', 'text', () => false)
    before.deselectTimelineItem('ghost', 'media', () => true)
    before.deselectTimelineItem('ghost', 'text', () => true)
    expect(useWorkbenchStore.getState()).toBe(before)
  })
})

it('positive: director focus tag calls its owner clear action directly; history remains read-only', () => {
  let focus: DirectorShotFocus | null = { directorNodeId: 'director', revision: '1', shots: [{ shotId: 's1', index: 1, measured: null }] }
  const off = registerDirectorSession('director', { store: {} as never, defaultSceneName: '', shotFocus: () => focus, clearShotFocus: () => { focus = null } })
  let clear: (() => void) | undefined
  const renderer = createReactTestRenderer({ createInstance: (type, props) => {
    if (type === 'button') clear = props.onClick as () => void
    return { props }
  } })
  function Harness() {
    const tag = useShotFocusTag()
    expect(tag?.onClear).toBe(clearDirectorShotFocus)
    return tag ? React.createElement(AgentPanelV4FocusTag, tag) : null
  }
  try {
    renderer.render(React.createElement(Harness))
    expect(clear).toBeTypeOf('function')
    clear!()
    expect(readDirectorShotFocus()).toBeNull()
  } finally { renderer.close(); off() }
  const history: V4Chip = { kind: 'clip', label: 'Read only' }
  expect(history).not.toHaveProperty('onRemove')
})

// 编译期反例随常规类型检查保留；独立 tsc 不带 expect-error 的红日志另存协调证据目录。
function currentReferenceTypeContract() {
  // @ts-expect-error 当前可移除引用必须有身份
  const noId: V4ComposerReference = { kind: 'clip', label: 'A', onRemove: () => undefined }
  // @ts-expect-error 当前可移除引用必须有动作
  const noAction: V4ComposerReference = { id: 'a', kind: 'clip', label: 'A' }
  return [noId, noAction]
}
void currentReferenceTypeContract
