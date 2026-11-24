import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../../../i18n/index'
import { createProjectSessionTestHarness, type ProjectSessionTestHarness } from '../../project/projectSessionTestHarness'
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
let projectSession: ProjectSessionTestHarness
afterEach(() => projectSession.dispose())
beforeEach(async () => {
  projectSession = createProjectSessionTestHarness()
  useShotVerifyStore.getState().clear()
  await projectSession.open('project-a')
  useShotVerifyStore.getState().activateProject('project-a')
  findings()
})

function FeedbackPanel({ surface }: { surface: ResidentSurface }) {
  const flowTail = useShotVerifyFeedback(surface, async () => false)
  return React.createElement(AgentPanelV4Panel, { slotHandlers: NO_HANDLERS, flow: [], context, surface, flowTail })
}

describe('verified shots use the existing domain card and admission budget', () => {
  it('renders current generation findings through the real hook, card and panel only', async () => {
    const render = (surface: ResidentSurface) => renderToStaticMarkup(React.createElement(FeedbackPanel, { surface }))
    expect(render('generation')).toContain('F_VERIFY_LOW')
    expect(render('generation')).toContain('data-reconcile-ai-fix="true"')
    expect(render('creation')).not.toContain('data-reconcile-deviation-card')
    await projectSession.open('project-b')
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
      await projectSession.open('project-b')
      useShotVerifyStore.getState().activateProject('project-b')
    } else if (change === 'new-verification') useShotVerifyStore.getState().beginVerify('project-a')
    useShotVerifyStore.getState().setDeviations([{ ...deviation, reason: 'NEW_RESULT' }])
    const next = useShotVerifyStore.getState()
    ack.resolve(true)
    expect(await pending).toBe(false)
    expect(useShotVerifyStore.getState()).toBe(next)
    expect(next.budget.roundsUsed).toBe(0)
  })

  it('renders single-shot unverified card with concise count header, collapsed Why toggle, and explicit Re-check + Use shot actions', () => {
    ;(useShotVerifyStore.getState().setDeviations as (d: unknown[], u?: unknown[]) => void)(
      [],
      [{ shotNodeId: 'shot-2', shotTitle: '镜头 2', reason: 'invalid_verdict_json' }],
    )
    const markup = renderToStaticMarkup(React.createElement(FeedbackPanel, { surface: 'generation' }))
    expect(markup).toContain('data-reconcile-deviation-card="true"')
    expect(markup).toContain('data-reconcile-unverified-item="shot-2"')
    expect(markup).toContain('镜头 2')
    expect(markup).toContain(i18n.t('generationCommon.reconcile.unverifiedOnlyCaption', { count: 1 }))
    expect(markup).toContain('data-reconcile-why-toggle="true"')
    expect(markup).toContain('aria-expanded="false"')
    expect(markup).toContain(i18n.t('generationCommon.reconcile.showReasons'))
    // 默认收起：不直接铺开模型报错原因
    expect(markup).not.toContain(i18n.t('generationCommon.reconcile.unverifiedReasons.invalid_verdict_json'))
    // 明确给出创作者可执行的两个动作（重新审片 + 照用此镜），不摆含糊的「确认」或不可用的「AI 修复」
    expect(markup).toContain(i18n.t('generationCommon.reconcile.recheckOne'))
    expect(markup).toContain(i18n.t('generationCommon.reconcile.acceptOne'))
    expect(markup).not.toContain(`>${i18n.t('generationCommon.reconcile.acknowledge')}<`)
    expect(markup).not.toContain('data-reconcile-ai-fix')
  })

  it('renders multi-shot unverified card (e.g. 5 shots) with compact per-row actions and batch footer', () => {
    ;(useShotVerifyStore.getState().setDeviations as (d: unknown[], u?: unknown[]) => void)(
      [],
      Array.from({ length: 5 }, (_, idx) => ({
        shotNodeId: `shot-${idx + 1}`,
        shotTitle: `镜 ${idx + 1} · 超长雨夜霓虹天桥特写镜头标题样本`,
        reason: 'invalid_verdict_json',
      })),
    )
    const markup = renderToStaticMarkup(React.createElement(FeedbackPanel, { surface: 'generation' }))
    expect(markup).toContain(i18n.t('generationCommon.reconcile.unverifiedOnlyCaption', { count: 5 }))
    expect(markup).toContain(i18n.t('generationCommon.reconcile.recheckShort'))
    expect(markup).toContain(i18n.t('generationCommon.reconcile.acceptShort'))
    expect(markup).toContain(i18n.t('generationCommon.reconcile.recheckAll'))
    expect(markup).toContain(i18n.t('generationCommon.reconcile.acceptAll', { count: 5 }))
  })

  it('does not claim other shots look normal when flagged and unverified shots coexist', () => {
    ;(useShotVerifyStore.getState().setDeviations as (d: unknown[], u?: unknown[]) => void)(
      [deviation],
      [{ shotNodeId: 'shot-2', shotTitle: '镜头 2', reason: 'judge_failed' }],
    )
    const markup = renderToStaticMarkup(React.createElement(FeedbackPanel, { surface: 'generation' }))
    expect(markup).toContain('F_VERIFY_LOW')
    expect(markup).toContain('data-reconcile-unverified-item="shot-2"')
    expect(markup).toContain(`镜头 2 · ${i18n.t('generationCommon.reconcile.unverifiedShotStatus')}`)
    expect(markup).toContain('data-reconcile-why-toggle="true"')
    expect(markup).not.toContain(i18n.t('generationCommon.reconcile.unverifiedReasons.judge_failed'))
    expect(markup).toContain('data-reconcile-footer-actions="true"')
    expect(markup).not.toContain(i18n.t('generationCommon.reconcile.contentCaption'))
  })
})
