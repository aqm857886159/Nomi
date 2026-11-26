import React from 'react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import '../../../i18n'
import { zhAgentPanelV4 } from '../../../i18n/locales/agentPanelV4'
import type { PromptEditorProps } from '../../assets/PromptEditor'
import { AgentPanelV4Panel, type AgentPanelV4PanelProps } from './AgentPanelV4Panel'
import { createReactTestRenderer } from './testReactRenderer'

let editor: PromptEditorProps
vi.mock('../../assets/PromptEditor', () => ({
  default: (props: PromptEditorProps) => { editor = props; return null },
}))
vi.mock('../../../design/tooltip', () => {
  const pass = ({ children }: { children: React.ReactNode }) => children
  return { TooltipProvider: pass, Tooltip: pass, TooltipTrigger: pass, TooltipContent: () => null }
})
vi.mock('use-stick-to-bottom', () => ({
  useStickToBottom: () => ({
    scrollRef: { current: null }, contentRef: { current: null }, scrollToBottom: () => {},
    state: { isAtBottom: true }, isAtBottom: true,
  }),
}))

beforeAll(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
})
let renderer: ReturnType<typeof createReactTestRenderer> | undefined
afterEach(() => renderer?.close())

function mount(text = '', composer: AgentPanelV4PanelProps['composer'] = {}, panel: Partial<AgentPanelV4PanelProps> = {}) {
  const onConfirm = vi.fn()
  const onSubmit = vi.fn()
  renderer = createReactTestRenderer({
    createInstance: (_type, props) => ({
      props, addEventListener() {}, removeEventListener() {},
      click() {
        if (!props.disabled && typeof props.onClick === 'function') props.onClick()
      },
    }),
  })
  renderer.render(<AgentPanelV4Panel
    flow={[]} context={{}} emptyOverride={<span />}
    slot={{ kind: 'spend', title: '' }}
    slotHandlers={{ onConfirm, onPlanToggle: vi.fn(), onCollapsePlan: vi.fn() }}
    composer={{ draft: { subscribe: () => () => {}, getSnapshot: () => text, write: () => {} }, onSubmit, ...composer }}
    {...panel}
  />)
  return { onConfirm, onSubmit }
}

function enter(overrides: Partial<React.KeyboardEvent> = {}, isComposing = false) {
  editor.onKeyDownCapture!({
    key: 'Enter', nativeEvent: { isComposing }, preventDefault: vi.fn(), stopPropagation: vi.fn(), ...overrides,
  } as React.KeyboardEvent<HTMLDivElement>)
}

describe('Agent spend bar and composer share Enter', () => {
  it('confirms an empty draft once, including when the key is held', () => {
    const { onConfirm, onSubmit } = mount()
    enter()
    enter({ repeat: true })
    expect(onConfirm).toHaveBeenCalledTimes(1)
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it.each(['text', 'chip'])('sends a %s draft without confirming', kind => {
    const chip = { id: 's', kind: 'skill' as const, label: '分镜规划', onRemove: vi.fn() }
    const { onConfirm, onSubmit } = mount(kind === 'text' ? '改第二镜' : '', { chips: kind === 'chip' ? [chip] : [] })
    enter()
    expect(onSubmit).toHaveBeenCalledExactlyOnceWith('primary')
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it.each(['', 'pin'])('leaves composing Enter to the IME (draft %j)', text => {
    const onPopoverKeyDown = vi.fn()
    const { onConfirm, onSubmit } = mount(text, { onPopoverKeyDown })
    enter({}, true)
    expect(onConfirm).not.toHaveBeenCalled()
    expect(onSubmit).not.toHaveBeenCalled()
    expect(onPopoverKeyDown).not.toHaveBeenCalled()
  })

  it.each(['dismissed', 'no selection', 'selected'])('reserves bare slash for the picker (%s)', state => {
    const pick = vi.fn(() => state === 'selected')
    const { onConfirm, onSubmit } = mount('/', state === 'dismissed' ? {} : { openPopover: 'skill', onPopoverKeyDown: pick })
    enter()
    expect(onSubmit).not.toHaveBeenCalled()
    expect(onConfirm).not.toHaveBeenCalled()
    expect(pick).toHaveBeenCalledTimes(state === 'dismissed' ? 0 : 1)
  })

  it.each<Partial<AgentPanelV4PanelProps>>([
    { slotWaiting: false }, { slot: undefined }, { slot: { kind: 'spend', title: '', actionsDisabled: true } },
    { slot: { kind: 'spend', title: '', progress: { hint: zhAgentPanelV4.spendBatchProgressImage } } },
    { slot: { kind: 'approval-reversible', title: '切换权限' } },
  ])('requires a waiting spend button for %j', panel => {
    const { onConfirm, onSubmit } = mount('', {}, panel)
    enter()
    expect(onConfirm).not.toHaveBeenCalled()
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it.each([{ shiftKey: true }, { altKey: true }, { metaKey: true }, { ctrlKey: true }])('requires plain Enter (%j)', modifiers => {
    const { onConfirm } = mount()
    enter(modifiers)
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it.each([' ', '\n'])('does not confirm whitespace still in the draft (%j)', text => {
    const { onConfirm } = mount(text)
    enter()
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('leaves an unselected open picker in control even with an empty editor', () => {
    const { onConfirm, onSubmit } = mount('', { openPopover: 'skill', onPopoverKeyDown: () => false })
    enter()
    expect(onConfirm).not.toHaveBeenCalled()
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('does not confirm a draft during message admission', () => {
    const { onConfirm, onSubmit } = mount('修改', { admitting: true })
    enter()
    expect(onConfirm).not.toHaveBeenCalled()
    expect(onSubmit).not.toHaveBeenCalled()
  })
})
