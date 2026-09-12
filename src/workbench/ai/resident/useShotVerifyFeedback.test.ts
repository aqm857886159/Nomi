import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { setDesktopActiveProjectId } from '../../../desktop/activeProject'
import { useShotVerifyStore } from '../../generationCanvas/agent/shotVerifyStore'
import { AgentPanelV4Panel } from '../v4/AgentPanelV4Panel'
import { requestShotVerifyFix, useShotVerifyFeedback } from './useShotVerifyFeedback'
import type { ResidentSurface } from './residentShellDisplay'

// 介入槽的写口在生产里是必填（R28）。测试里显式给一份空壳，表示「这一格不验行为」。
const NO_HANDLERS = { onPlanToggle: () => undefined, onCollapsePlan: () => undefined }

const deviation = { kind: 'content' as const, where: '镜头 1', field: '构图', expected: '居中', actual: '偏左', reason: 'F_VERIFY_LOW' }
const findings = () => useShotVerifyStore.getState().setDeviations([deviation])
function deferred() {
  let resolve!: (accepted: boolean) => void
  const promise = new Promise<boolean>(done => { resolve = done })
  return { promise, resolve }
}
const context = { input: '1', output: '1', reasoning: '—', cache: '0', cost: '—' }

beforeAll(async () => { await import('../../../i18n/index') })
beforeEach(() => {
  useShotVerifyStore.getState().clear()
  setDesktopActiveProjectId('project-a')
  useShotVerifyStore.getState().activateProject('project-a')
  findings()
})

function FeedbackPanel({ surface }: { surface: ResidentSurface }) {
  const flowTail = useShotVerifyFeedback(surface, async () => false)
  return React.createElement(AgentPanelV4Panel, { slotHandlers: NO_HANDLERS, flow: [], context, surface, flowTail })
}

describe('verified shots use the existing domain card and admission budget', () => {
  it('renders current generation findings through the real hook, card and panel only', () => {
    const render = (surface: ResidentSurface) => renderToStaticMarkup(React.createElement(FeedbackPanel, { surface }))
    expect(render('generation')).toContain('F_VERIFY_LOW')
    expect(render('generation')).toContain('data-reconcile-ai-fix="true"')
    expect(render('creation')).not.toContain('data-reconcile-deviation-card')
    setDesktopActiveProjectId('project-b')
    expect(render('generation')).not.toContain('data-reconcile-deviation-card')
  })

  it.each([false, 'error'])('keeps findings and budget when admission returns %s', async outcome => {
    const before = useShotVerifyStore.getState()
    const send = vi.fn(async () => { if (outcome === 'error') throw new Error('missing skill'); return false })
    expect(await requestShotVerifyFix('project-a', send)).toBe(false)
    expect(send).toHaveBeenCalledOnce()
    expect(useShotVerifyStore.getState()).toBe(before)
  })

  it('keeps the card until ACK, suppresses duplicate clicks, and consumes one round after acceptance', async () => {
    const ack = deferred()
    const send = vi.fn((text: string) => { expect(text).toContain('F_VERIFY_LOW'); return ack.promise })
    const first = requestShotVerifyFix('project-a', send)
    expect(await requestShotVerifyFix('project-a', send)).toBe(false)
    expect(send).toHaveBeenCalledOnce()
    expect(send.mock.calls[0][0]).toContain('F_VERIFY_LOW')
    expect(useShotVerifyStore.getState().budget.roundsUsed).toBe(0)
    expect(useShotVerifyStore.getState().deviations).toEqual([deviation])
    ack.resolve(true)
    expect(await first).toBe(true)
    expect(useShotVerifyStore.getState()).toMatchObject({ status: 'verifying', deviations: [], budget: { roundsUsed: 1, maxRounds: 2 } })
  })

  it('uses the original two-round ceiling and renders the exhausted original card', async () => {
    const send = vi.fn(async () => true)
    expect(await requestShotVerifyFix('project-a', send)).toBe(true)
    findings()
    expect(await requestShotVerifyFix('project-a', send)).toBe(true)
    findings()
    expect(await requestShotVerifyFix('project-a', send)).toBe(false)
    expect(send).toHaveBeenCalledTimes(2)
    const markup = renderToStaticMarkup(React.createElement(FeedbackPanel, { surface: 'generation' }))
    expect(markup).toContain('data-reconcile-deviation-card="true"')
    expect(markup).not.toContain('data-reconcile-ai-fix')
    expect(useShotVerifyStore.getState().budget).toEqual({ roundsUsed: 2, maxRounds: 2 })
  })

  it.each(['project', 'new-verification', 'new-findings'])('ignores late accepted replies after %s changes', async change => {
    const ack = deferred()
    const pending = requestShotVerifyFix('project-a', () => ack.promise)
    if (change === 'project') {
      setDesktopActiveProjectId('project-b')
      useShotVerifyStore.getState().activateProject('project-b')
    } else if (change === 'new-verification') useShotVerifyStore.getState().beginVerify('project-a')
    useShotVerifyStore.getState().setDeviations([{ ...deviation, reason: 'NEW_RESULT' }])
    const next = useShotVerifyStore.getState()
    ack.resolve(true)
    expect(await pending).toBe(false)
    expect(useShotVerifyStore.getState()).toBe(next)
    expect(next.budget.roundsUsed).toBe(0)
  })
})
