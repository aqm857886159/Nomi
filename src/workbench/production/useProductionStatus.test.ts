import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useProductionStatus } from './useProductionStatus'

const mocks = vi.hoisted(() => ({
  command: vi.fn(), notify: vi.fn(), confirm: vi.fn(), loadRun: vi.fn(), read: vi.fn(), selectNode: vi.fn(), workspace: vi.fn(), runNode: vi.fn(),
  decide: vi.fn(), release: vi.fn(), resendConfirm: vi.fn(),
  run: { projectId: 'project-1', runId: 'run-1', revision: 1, jobs: [], gates: [] },
}))
vi.mock('react-i18next', async original => ({ ...await original<typeof import('react-i18next')>(), useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('../../design', () => ({ confirmDialog: mocks.confirm, alertDialog: vi.fn() }))
vi.mock('../../ui/notificationPolicy', () => ({ notify: mocks.notify }))
vi.mock('../generationCanvas/store/generationCanvasStore', () => ({ useGenerationCanvasStore: { getState: () => ({ selectNode: mocks.selectNode, nodes: [{id:'canvas-origin-node',kind:'image'}] }) } }))
vi.mock('../generationCanvas/spend/spendConfirm', () => ({ useSpendConfirmStore: {}, confirmGenerationResend: mocks.resendConfirm }))
vi.mock('../api/taskApi', () => ({ canvasResendDecide: mocks.decide }))
vi.mock('./releaseUnknownSubmission', async (importOriginal) => ({ ...(await importOriginal<typeof import('./releaseUnknownSubmission')>()), releaseUnknownSubmission: mocks.release }))
vi.mock('../generationCanvas/spend/productionContractView', () => ({ buildProductionContractView: vi.fn() }))
vi.mock('../generationCanvas/spend/anchorCheckpointView', () => ({ buildAnchorCheckpointCard: vi.fn() }))
vi.mock('../workbenchStore', () => ({ useWorkbenchStore: { getState: () => ({ setWorkspaceMode: mocks.workspace }) } }))
vi.mock('./productionRunApi', () => ({ productionRunApi: { read: mocks.read, command: vi.fn() } }))
vi.mock('./productionRunCommands', async (importOriginal) => ({ ...(await importOriginal<typeof import('./productionRunCommands')>()), executeProductionRunCommand: mocks.command }))
vi.mock('./productionRunStore', () => ({ useProductionRunStore: { getState: () => ({ loadRun: mocks.loadRun }) } }))
vi.mock('./productionRunView', () => ({ buildProductionRunView: () => ({ targetId: null }), gateKindOf: vi.fn() }))
vi.mock('./useActiveProductionRun', () => ({ useActiveProductionRun: () => ({ run: mocks.run, navigationTarget: null }) }))

function mount() {
  let result!: ReturnType<typeof useProductionStatus>
  function Host() { result = useProductionStatus(); return null }
  renderToStaticMarkup(React.createElement(Host))
  return result
}

describe('production command feedback', () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.command.mockRejectedValue(new Error('Revision changed; retry')) })
  it('reports resume and pause failures at the requesting run without a modal', async () => {
    const status = mount()
    await status.onPrimaryAction('resume-run')
    await status.onControl('pause')
    expect(mocks.notify).toHaveBeenCalledTimes(2)
    for (const [input] of mocks.notify.mock.calls) {
      expect(input).toMatchObject({ identity: 'production-run:project-1:run-1', level: 'inline', type: 'error' })
      expect(input.message).toContain('Revision changed; retry')
      expect(input.present).toBeTypeOf('function')
    }
    expect(mocks.confirm).not.toHaveBeenCalled()
  })
  // #1139 V-1139c：主进程的唯一判定说「继续了也一镜都不会派」——制作面板的「从断点继续」说那句真话，不报「操作失败」、不贴原文。
  it('resume with nothing to continue says so, not "action failed" with raw text', async () => {
    mocks.command.mockRejectedValueOnce(new Error("Error invoking remote method 'nomi:production-runs:command': NothingToResumeError: nothing_to_resume: removed=shot-2 canvas=- failed=-"))
    const status = mount()
    await status.onPrimaryAction('resume-run')
    expect(mocks.notify).toHaveBeenCalledTimes(1)
    const [input] = mocks.notify.mock.calls[0]
    expect(input).toMatchObject({ reason: 'generationCommon.production.canvasLanding.actionFailure.nothingToResume', message: 'generationCommon.production.canvasLanding.actionFailure.nothingToResume' })
    expect(input.message).not.toContain('nothing_to_resume')
  })
  it('still confirms cancellation before executing it', async () => {
    const status = mount()
    mocks.confirm.mockResolvedValue(false)
    await status.onControl('cancel')
    expect(mocks.confirm).toHaveBeenCalledWith(expect.objectContaining({ danger: true }))
    expect(mocks.command).not.toHaveBeenCalled()
    expect(mocks.notify).not.toHaveBeenCalled()
  })
})

vi.mock('../generationCanvas/runner/generationRunController', () => ({ confirmAndRunNode: mocks.runNode }))

it('C4: task-center release delegates its node to the same resend-confirmation route', async () => {
  vi.clearAllMocks()
  Object.assign(mocks.run, { origin: { host: 'canvas', nodeId: 'canvas-origin-node' }, jobs: [{ jobId: 'unknown-job', status: 'submission_unknown', updatedAt: '2026-11-02T00:00:00.000Z' }] })
  mocks.read.mockResolvedValue(mocks.run)
  mocks.command.mockResolvedValue({ run: mocks.run })
  mocks.confirm.mockResolvedValue(true)
  mocks.loadRun.mockResolvedValue(mocks.run)
  mocks.runNode.mockResolvedValue('started')
  const status = mount()
  await status.onPrimaryAction('release-unknown')
  await vi.waitFor(() => expect(mocks.runNode).toHaveBeenCalledWith('canvas-origin-node', { initiator: 'user', resend: true }))
  expect(mocks.selectNode).toHaveBeenCalledWith('canvas-origin-node')
  expect(mocks.workspace).toHaveBeenCalledWith('generation')
  expect(mocks.confirm).not.toHaveBeenCalled()
  expect(mocks.command).not.toHaveBeenCalled() // The shared single-node route owns confirmation before release.
})

// 任务中心那一笔没有节点：入口只报「我想再发一次」和那一笔是谁；问不问、放哪几笔只听主进程，卡只问「是否再花一次」。
describe('task-center release without a canvas node', () => {
  async function releaseWith(decision: unknown, confirmed: boolean) {
    vi.clearAllMocks()
    Object.assign(mocks.run, { origin: { host: 'canvas', nodeId: 'node-gone' }, jobs: [{ jobId: 'unknown-job', status: 'submission_unknown', updatedAt: '2026-11-02T00:00:00.000Z' }] })
    mocks.decide.mockResolvedValue(decision)
    mocks.resendConfirm.mockResolvedValue(confirmed)
    mocks.release.mockResolvedValue(undefined)
    await mount().onPrimaryAction('release-unknown')
  }
  const ask = { action: 'ask', decisionId: 'decision-1', resultUnknown: true, release: [{ runId: 'run-1', jobId: 'unknown-job' }], open: [] }

  it('asks main, shows the card once, and releases only what the decision lists', async () => {
    await releaseWith(ask, true)
    expect(mocks.decide).toHaveBeenCalledWith({ projectId: 'project-1', resend: true, initiator: 'user', resultUnknown: true, production: { runId: 'run-1', jobId: 'unknown-job' } })
    expect(mocks.resendConfirm).toHaveBeenCalledTimes(1)
    expect(mocks.resendConfirm).toHaveBeenCalledWith({ resultUnknown: true, kind: 'other' })
    expect(mocks.release.mock.calls).toEqual([['project-1', 'run-1', 'unknown-job', expect.anything(), 'decision-1']])
    expect(mocks.runNode).not.toHaveBeenCalled()
  })
  it('cancel on the card releases nothing', async () => {
    await releaseWith(ask, false)
    expect(mocks.resendConfirm).toHaveBeenCalledTimes(1)
    expect(mocks.release).not.toHaveBeenCalled()
  })
  it.each([{ action: 'send' }, { action: 'refuse', reason: 'not-user' }])('main says $action: no card, no release', async (decision) => {
    await releaseWith(decision, true)
    expect(mocks.resendConfirm).not.toHaveBeenCalled()
    expect(mocks.release).not.toHaveBeenCalled()
  })
})
