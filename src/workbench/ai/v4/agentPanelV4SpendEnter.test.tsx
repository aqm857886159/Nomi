import React from 'react'
import { productionRunApi } from '../../production/productionRunApi'
import { useAgentPanelSpendCard, type AgentPanelSpendCard } from './useAgentPanelSpendCard'
import type { PendingSpendConfirm } from '../../../desktop/productionRunBridgeTypes'
import { spendWorld, shotsDraft, resetSpendFixture, settleMicrotasks } from '../../../../electron/capabilityCore/agentPanelSpendConfirmTestUtils'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import '../../../i18n'
import { zhAgentPanelV4 } from '../../../i18n/locales/agentPanelV4'
import type { PromptEditorProps } from '../../assets/PromptEditor'
import { AgentPanelV4Panel, type AgentPanelV4PanelProps } from './AgentPanelV4Panel'
import { V4SkillPopover } from './AgentPanelV4Composer'
import type { LibraryPickerHandle } from '../../library/LibraryPicker'
import { projectSpendCard } from './agentPanelSpendCard'
import { createReactTestRenderer } from './testReactRenderer'

vi.mock('../../generation/list/generationListModelLabels', () => ({ useNodeModelOption: () => () => undefined }))
vi.mock('../../../ui/toast', async (original) => ({ ...await original<object>(), toast: vi.fn() }))
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
  vi.stubGlobal('IntersectionObserver', class {
    constructor(private readonly emit: (entries: Partial<IntersectionObserverEntry>[]) => void) {}
    observe(target: Element) { this.emit([{ target, isIntersecting: true, intersectionRatio: 1 }]) }
    disconnect() {}
  })
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
})
let renderer: ReturnType<typeof createReactTestRenderer> | undefined
afterEach(() => {
  renderer?.close()
  vi.useRealTimers()
})

function offer(quoteId: string, retry = false) {
  return projectSpendCard({
    projectId: 'project', operationId: 'plan', runId: 'run', planVersion: 1, quoteId, handOverRevision: 0, currency: 'CNY',
    shots: [{ shotId: 'shot', index: 1, kind: 'video', nodeId: 'node', draftedModel: { providerId: 'p', modelId: 'model' }, offer: retry ? 'not_sent' : 'undecided' }],
  }, [{
    present: true, shotRef: '1', model: 'model', aspect: null, durationSec: 4, resolution: null,
    selected: null, price: { known: false },
  }], { busy: false, stopping: false }, key => key, { locale: 'zh-CN' })!.slot
}

function mount(text = '', composer: AgentPanelV4PanelProps['composer'] = {}, panel: Partial<AgentPanelV4PanelProps> = {}) {
  const onConfirm = vi.fn()
  const onSubmit = vi.fn()
  let primaryButton: { click(): void } | undefined
  const root = createReactTestRenderer({
    createInstance: (_type, props) => {
      const instance = {
        ownerDocument: { visibilityState: 'visible', addEventListener() {}, removeEventListener() {} },
        props, get disabled() { return this.props.disabled === true }, addEventListener() {}, removeEventListener() {},
        click() {
          if (!this.disabled && typeof this.props.onClick === 'function') this.props.onClick()
        },
      }
      if (props['data-v4-control'] === 'confirm') primaryButton = instance
      return instance
    },
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
  return { onConfirm, onSubmit, render, clickPrimary: () => primaryButton!.click() }
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

  it('rejects stale Enter after a clicked generation was not sent and accepts the explicit retry click', async () => {
    const world = spendWorld()
    const ipc = vi.spyOn(productionRunApi, 'handOverSpend').mockImplementation(world.card.handOverShots)
    const hook = createReactTestRenderer()
    let card!: AgentPanelSpendCard
    function ProjectCard({ shown }: { shown: PendingSpendConfirm }) {
      card = useAgentPanelSpendCard({ surface: 'ready', rows: [shown] })
      return null
    }
    try {
      await shotsDraft(world, [{}])
      world.renderer.setHandOverFailing(true)
      const display = () => hook.render(<ProjectCard shown={world.pending()!} />)
      display()
      const handlers = { onConfirm: () => card.primary(), onPlanToggle: vi.fn(), onCollapsePlan: vi.fn() }
      const panel = mount('', {}, { slot: card.slot, slotHandlers: handlers })
      panel.clickPrimary()
      const initial = ipc.mock.results[0]!.value
      await initial
      await settleMicrotasks()
      hook.flushPassiveEffects()
      expect(world.pending()?.shots[0]?.offer).toBe('not_sent')
      expect(world.renderer.handOverCalls).toHaveLength(1)

      // IPC has unlocked. Keep the old card painted until its replacement snapshot arrives.
      enter()
      expect(ipc).toHaveBeenCalledTimes(2)
      const replay = await ipc.mock.results[1]!.value
      await settleMicrotasks()
      expect(world.renderer.handOverCalls, 'stale Enter started a second handoff').toHaveLength(1)
      expect(replay).toMatchObject({ ok: false })
      display()
      expect(card.slot?.confirmLabel).toBe(zhAgentPanelV4.spendCard.retry)
      panel.render({ slot: card.slot, slotHandlers: handlers })
      enter()
      expect(ipc).toHaveBeenCalledTimes(2)
      world.renderer.setHandOverFailing(false)
      panel.clickPrimary()
      await ipc.mock.results[2]!.value
      await world.renderer.drain()
      expect(world.renderer.handOverCalls).toHaveLength(2)
      expect(world.sentShots()).toEqual(['shot-1'])
    } finally {
      hook.close()
      ipc.mockRestore()
      resetSpendFixture()
    }
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
