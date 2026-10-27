import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// tabbable 要真实布局（默认 displayCheck: 'full'），node 里算不出来：这里只替它回答「这一节第一个 Tab 得到的是谁」。
const tab = vi.hoisted(() => ({ first: null as unknown }))
vi.mock('tabbable', () => ({ tabbable: () => (tab.first ? [tab.first] : []) }))

import { focusSettingsSectionWhenReady, SECTION_FOCUS_FRAME_BUDGET, SECTION_FOCUS_TARGET_ATTRIBUTE } from './settingsSectionFocus'

const doc = { activeElement: null as unknown }

/** 够这一个模块用的 DOM：父子关系、contains、按属性 querySelector、focus（能聚焦才把 activeElement 换成自己）、scrollIntoView。 */
class FakeElement {
  parent: FakeElement | null = null
  children: FakeElement[] = []
  focusable = true
  readonly focus = vi.fn(() => { if (this.focusable) doc.activeElement = this })
  readonly scrollIntoView = vi.fn()
  constructor(readonly name: string, readonly attributes: string[] = []) {}
  append(...nodes: FakeElement[]): this {
    for (const node of nodes) { node.parent = this; this.children.push(node) }
    return this
  }
  contains(other: unknown): boolean {
    for (let node = other as FakeElement | null; node; node = node.parent) if (node === this) return true
    return false
  }
  querySelector(selector: string): FakeElement | null {
    const attribute = /^\[([\w-]+)\]$/.exec(selector)?.[1]
    if (!attribute) throw new Error(`fake querySelector 只认 [属性]：${selector}`)
    const walk = (node: FakeElement): FakeElement | null => {
      for (const child of node.children) {
        if (child.attributes.includes(attribute)) return child
        const found = walk(child)
        if (found) return found
      }
      return null
    }
    return walk(this)
  }
}

/** 交给被测函数时当成 HTMLElement（它只用到上面这几样）。 */
const el = (node: FakeElement): HTMLElement => node as unknown as HTMLElement

const frames = new Map<number, FrameRequestCallback>()
let nextFrame = 0
/** 推一帧：跑完这一帧之前排进来的回调（回调里再排的留到下一帧）。 */
function frame(count = 1) {
  for (let index = 0; index < count; index += 1) {
    const due = [...frames.values()]
    frames.clear()
    for (const callback of due) callback(0)
  }
}

function settingsWith(section: FakeElement) {
  const page = new FakeElement('page')
  const dialog = new FakeElement('dialog')
  const closeButton = new FakeElement('close')
  dialog.append(closeButton, section)
  doc.activeElement = page
  return { page, dialog, closeButton }
}

beforeEach(() => {
  frames.clear()
  tab.first = null
  vi.stubGlobal('document', doc)
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { nextFrame += 1; frames.set(nextFrame, callback); return nextFrame })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => { frames.delete(id) })
})
afterEach(() => vi.unstubAllGlobals())

describe('设置深链把焦点落进那一节：每帧试，焦点真的进了那一节才算数', () => {
  it('那一节晚几帧才挂出来：挂出来那一帧落在它声明的首要控件上，之后不再排帧', () => {
    const link = new FakeElement('get-key-link')
    const keyInput = new FakeElement('key-input', [SECTION_FOCUS_TARGET_ATTRIBUTE])
    const section = new FakeElement('section').append(link, keyInput)
    const { dialog } = settingsWith(section)
    tab.first = link
    let mounted = false
    focusSettingsSectionWhenReady({ dialog: () => el(dialog), section: () => (mounted ? el(section) : null) })

    frame(3)
    expect(keyInput.focus).not.toHaveBeenCalled()
    mounted = true
    frame()
    expect(doc.activeElement).toBe(keyInput)
    expect(link.focus).not.toHaveBeenCalled()
    expect(frames.size).toBe(0)
  })

  it('这一节没声明首要控件：落在第一个 Tab 得到的控件上（tabbable，不手写标签列表）', () => {
    const toggle = new FakeElement('toggle')
    const section = new FakeElement('section').append(toggle)
    const { dialog } = settingsWith(section)
    tab.first = toggle
    focusSettingsSectionWhenReady({ dialog: () => el(dialog), section: () => el(section) })

    frame()
    expect(doc.activeElement).toBe(toggle)
    expect(frames.size).toBe(0)
  })

  it('焦点已经在对话框里（人自己点了别处）：不抢，也不再排帧', () => {
    const keyInput = new FakeElement('key-input', [SECTION_FOCUS_TARGET_ATTRIBUTE])
    const section = new FakeElement('section').append(keyInput)
    const { dialog, closeButton } = settingsWith(section)
    doc.activeElement = closeButton
    focusSettingsSectionWhenReady({ dialog: () => el(dialog), section: () => el(section) })

    frame()
    expect(keyInput.focus).not.toHaveBeenCalled()
    expect(doc.activeElement).toBe(closeButton)
    expect(frames.size).toBe(0)
  })

  it('调了 focus 但没落上（控件这一刻还禁用着）：下一帧再试，落上为止；那一节只滚一次', () => {
    const keyInput = new FakeElement('key-input', [SECTION_FOCUS_TARGET_ATTRIBUTE])
    keyInput.focusable = false
    const section = new FakeElement('section').append(keyInput)
    const { dialog, page } = settingsWith(section)
    focusSettingsSectionWhenReady({ dialog: () => el(dialog), section: () => el(section) })

    frame(2)
    expect(keyInput.focus).toHaveBeenCalledTimes(2)
    expect(doc.activeElement).toBe(page)
    expect(frames.size).toBe(1)
    keyInput.focusable = true
    frame()
    expect(doc.activeElement).toBe(keyInput)
    expect(frames.size).toBe(0)
    expect(section.scrollIntoView).toHaveBeenCalledTimes(1)
  })

  it(`那一节一直不出来：试满 ${SECTION_FOCUS_FRAME_BUDGET} 帧就停，焦点留在原处`, () => {
    const dialog = new FakeElement('dialog')
    const page = new FakeElement('page')
    doc.activeElement = page
    focusSettingsSectionWhenReady({ dialog: () => el(dialog), section: () => null })

    frame(SECTION_FOCUS_FRAME_BUDGET - 1)
    expect(frames.size).toBe(1)
    frame()
    expect(frames.size).toBe(0)
    expect(doc.activeElement).toBe(page)
  })

  it('取消（对话框关了 / 换了一节）：不再试', () => {
    const keyInput = new FakeElement('key-input', [SECTION_FOCUS_TARGET_ATTRIBUTE])
    const section = new FakeElement('section').append(keyInput)
    const { dialog } = settingsWith(section)
    const cancel = focusSettingsSectionWhenReady({ dialog: () => el(dialog), section: () => el(section) })

    cancel()
    frame()
    expect(keyInput.focus).not.toHaveBeenCalled()
    expect(frames.size).toBe(0)
  })
})
