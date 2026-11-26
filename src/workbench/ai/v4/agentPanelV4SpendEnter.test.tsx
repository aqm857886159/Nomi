import React from 'react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import '../../../i18n'
import { zhAgentPanelV4 } from '../../../i18n/locales/agentPanelV4'
import type { PromptEditorProps } from '../../assets/PromptEditor'
import { AgentPanelV4Panel, type AgentPanelV4PanelProps } from './AgentPanelV4Panel'
import { V4SkillPopover } from './AgentPanelV4Composer'
import type { LibraryPickerHandle } from '../../library/LibraryPicker'
import { projectSpendCard } from './agentPanelSpendCard'
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
afterEach(() => {
  renderer?.close()
  vi.useRealTimers()
})

function offer(quoteId: string, retry = false) {
  return projectSpendCard({
    projectId: 'project', operationId: 'plan', runId: 'run', planVersion: 1, quoteId, currency: 'CNY',
    shots: [{ shotId: 'shot', index: 1, kind: 'video', nodeId: 'node', draftedModel: { providerId: 'p', modelId: 'model' }, offer: retry ? 'not_sent' : 'undecided' }],
  }, [{
    present: true, shotRef: '1', model: 'model', aspect: null, durationSec: 4, resolution: null,
    selected: null, price: { known: false },
  }], { busy: false, stopping: false }, key => key, { locale: 'zh-CN' })!.slot
}

function mount(text = '', composer: AgentPanelV4PanelProps['composer'] = {}, panel: Partial<AgentPanelV4PanelProps> = {}) {
  const onConfirm = vi.fn()
  const onSubmit = vi.fn()
  const root = createReactTestRenderer({
    createInstance: (_type, props) => ({
      props, get disabled() { return this.props.disabled === true }, addEventListener() {}, removeEventListener() {},
      click() {
        if (!this.disabled && typeof this.props.onClick === 'function') this.props.onClick()
      },
    }),
  })
  renderer = root
  const render = (nextPanel = panel, nextComposer = composer) => root.render(<AgentPanelV4Panel
    flow={[]} context={{}} emptyOverride={<span />}
    slot={offer('first')}
    slotHandlers={{ onConfirm, onPlanToggle: vi.fn(), onCollapsePlan: vi.fn() }}
    composer={{ draft: { subscribe: () => () => {}, getSnapshot: () => text, write: () => {} }, onSubmit, ...nextComposer }}
    {...nextPanel}
  />)
  render()
  return { onConfirm, onSubmit, render }
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

  it.each(['', 'pin'])('leaves keyCode 229 Enter to the IME after compositionend (draft %j)', text => {
    const { onSubmit, onConfirm } = mount(text)
    enter({ nativeEvent: { keyCode: 229, isComposing: false } as KeyboardEvent })
    expect(onSubmit).not.toHaveBeenCalled()
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it.each(['same quote', 'retry', 'next quote', 'delayed next quote'])('a second independent Enter after handoff cannot authorize the %s', next => {
    vi.useFakeTimers()
    const { onConfirm, render } = mount()
    enter({ repeat: false })
    expect(onConfirm).toHaveBeenCalledTimes(1)
    render({ slot: undefined })
    if (next === 'delayed next quote') vi.advanceTimersByTime(2000)
    const newQuote = next.endsWith('next quote')
    const nextSlot = offer(newQuote ? 'second' : 'first', next === 'retry')
    if (next === 'retry') expect(nextSlot.confirmLabel).toBe('agentPanelV4.spendCard.retry')
    render({ slot: nextSlot })
    vi.advanceTimersByTime(40)
    enter({ repeat: false })
    expect(onConfirm).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(1000)
    enter({ repeat: false })
    expect(onConfirm).toHaveBeenCalledTimes(newQuote ? 2 : 1)
  })

  it('keeps a bare slash with a skill chip out of both actions after Escape', () => {
    const chips = [{ id: 's', kind: 'skill' as const, label: '分镜规划', onRemove: vi.fn() }]
    const picker = React.createRef<LibraryPickerHandle>()
    const { onConfirm, onSubmit, render } = mount('/', { chips })
    const closePicker = vi.fn(() => render({}, { chips }))
    render({}, {
      chips, openPopover: 'skill',
      popover: <V4SkillPopover rows={[]} categories={[]} pickerRef={picker} onClose={closePicker} />,
      onPopoverKeyDown: event => picker.current!.handleKeyDown(event),
    })
    enter({ key: 'Escape' })
    expect(closePicker).toHaveBeenCalledOnce()
    enter()
    expect(onSubmit).not.toHaveBeenCalled()
    expect(onConfirm).not.toHaveBeenCalled()
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
