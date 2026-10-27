import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const log = vi.hoisted(() => ({ warn: vi.fn() }))
vi.mock('../../desktop/rendererLog', () => ({ logRendererWarn: log.warn }))

import {
  COMPOSER_FOCUS_FRAME_BUDGET,
  requestResidentComposerFocus,
  residentComposerFocusStoreLifetime,
  useResidentComposerFocusRequest,
  useResidentComposerFocusStore,
} from './residentComposerFocus'

// 只挂 hook、不渲染 DOM 的 ReactDOM 宿主（同 composer/useComposerAttachments.behavior.test.tsx）；帧由测试一帧一帧推。
function browserContainer() {
  const document = { nodeType: 9, documentElement: { namespaceURI: 'http://www.w3.org/1999/xhtml' },
    addEventListener: () => undefined, removeEventListener: () => undefined,
    defaultView: null as unknown, activeElement: null as unknown }
  class HTMLElement {}
  class HTMLIFrameElement extends HTMLElement {}
  const window = { document, HTMLElement, HTMLIFrameElement, addEventListener: () => undefined,
    removeEventListener: () => undefined, localStorage: { getItem: () => null }, setInterval, clearInterval }
  document.defaultView = window
  const container = { nodeType: 1, nodeName: 'DIV', tagName: 'DIV', namespaceURI: 'http://www.w3.org/1999/xhtml',
    ownerDocument: document, addEventListener: () => undefined, removeEventListener: () => undefined, firstChild: null } as unknown as globalThis.HTMLElement
  document.activeElement = container
  vi.stubGlobal('window', window); vi.stubGlobal('document', document); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  return container
}

const frames = new Map<number, FrameRequestCallback>()
let nextFrame = 0
/** 推一帧：跑完这一帧之前排进来的回调（回调里再排的留到下一帧）。 */
async function frame(count = 1) {
  for (let index = 0; index < count; index += 1) {
    const due = [...frames.entries()]
    frames.clear()
    await act(async () => { for (const [, callback] of due) callback(0) })
  }
}

function Harness({ focus }: { focus: (() => boolean) | null }) {
  useResidentComposerFocusRequest(focus)
  return null
}

describe('常驻 Agent 输入框的聚焦请求：主人每帧试，焦点真的进了编辑器才算数', () => {
  let root: Root
  beforeEach(() => {
    frames.clear()
    log.warn.mockReset()
    useResidentComposerFocusStore.setState({ request: null })
    root = createRoot(browserContainer())
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { nextFrame += 1; frames.set(nextFrame, callback); return nextFrame })
    vi.stubGlobal('cancelAnimationFrame', (id: number) => { frames.delete(id) })
  })
  afterEach(async () => { await act(async () => root.unmount()); vi.unstubAllGlobals() })

  const mount = async (focus: (() => boolean) | null) => { await act(async () => root.render(<Harness focus={focus} />)) }
  const request = async () => { await act(async () => requestResidentComposerFocus()) }

  it('请求 → 下一帧主人落焦点 → 请求清掉，只调一次', async () => {
    const focus = vi.fn(() => true)
    await mount(focus)
    await request()
    expect(focus).not.toHaveBeenCalled()
    await frame()
    expect(focus).toHaveBeenCalledTimes(1)
    expect(useResidentComposerFocusStore.getState().request).toBeNull()
    await frame(3)
    expect(focus).toHaveBeenCalledTimes(1)
  })

  it('面板还在看不见的容器里（前几帧落空）→ 每帧再试，落上那一帧停', async () => {
    let visibleFrom = 4
    const focus = vi.fn(() => --visibleFrom <= 0)
    await mount(focus)
    await request()
    await frame(3)
    expect(focus).toHaveBeenCalledTimes(3)
    expect(useResidentComposerFocusStore.getState().request).not.toBeNull()
    await frame()
    expect(focus).toHaveBeenCalledTimes(4)
    expect(useResidentComposerFocusStore.getState().request).toBeNull()
    await frame(5)
    expect(focus).toHaveBeenCalledTimes(4)
    expect(log.warn).not.toHaveBeenCalled()
  })

  it(`试满 ${COMPOSER_FOCUS_FRAME_BUDGET} 帧还落不上：丢掉请求、记一条日志，之后不再抢焦点`, async () => {
    const focus = vi.fn(() => false)
    await mount(focus)
    await request()
    await frame(COMPOSER_FOCUS_FRAME_BUDGET - 1)
    expect(log.warn).not.toHaveBeenCalled()
    await frame()
    expect(focus).toHaveBeenCalledTimes(COMPOSER_FOCUS_FRAME_BUDGET)
    expect(useResidentComposerFocusStore.getState().request).toBeNull()
    expect(log.warn).toHaveBeenCalledTimes(1)
    expect(log.warn).toHaveBeenCalledWith('resident-composer-focus-expired', { attempts: COMPOSER_FOCUS_FRAME_BUDGET })
    await frame(10)
    expect(focus).toHaveBeenCalledTimes(COMPOSER_FOCUS_FRAME_BUDGET)
  })

  it('新请求顶掉旧请求：旧的那一轮停下，新的从头计帧', async () => {
    const focus = vi.fn(() => false)
    await mount(focus)
    await request()
    await frame(20)
    await request()
    await frame(COMPOSER_FOCUS_FRAME_BUDGET - 1)
    expect(log.warn).not.toHaveBeenCalled()
    expect(focus).toHaveBeenCalledTimes(20 + COMPOSER_FOCUS_FRAME_BUDGET - 1)
    await frame()
    expect(log.warn).toHaveBeenCalledTimes(1)
  })

  it('主人还没就绪（没有编辑器）时请求留着，就绪后再取', async () => {
    await mount(null)
    await request()
    await frame(COMPOSER_FOCUS_FRAME_BUDGET + 5)
    expect(useResidentComposerFocusStore.getState().request).not.toBeNull()
    expect(log.warn).not.toHaveBeenCalled()
    const focus = vi.fn(() => true)
    await mount(focus)
    await frame()
    expect(focus).toHaveBeenCalledTimes(1)
    expect(useResidentComposerFocusStore.getState().request).toBeNull()
  })

  it('切项目清掉还没取走的请求，那一轮不再试', async () => {
    const focus = vi.fn(() => false)
    await mount(focus)
    await request()
    await frame(2)
    await act(async () => residentComposerFocusStoreLifetime.releaseProject?.())
    expect(useResidentComposerFocusStore.getState().request).toBeNull()
    await frame(5)
    expect(focus).toHaveBeenCalledTimes(2)
    expect(log.warn).not.toHaveBeenCalled()
  })
})
