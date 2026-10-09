import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useProductionStatus } from './useProductionStatus'

const mocks = vi.hoisted(() => ({
  command: vi.fn(), notify: vi.fn(), confirm: vi.fn(), loadRun: vi.fn(),
  run: { projectId: 'project-1', runId: 'run-1', revision: 1, jobs: [], gates: [] },
}))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('../../design', () => ({ confirmDialog: mocks.confirm, alertDialog: vi.fn() }))
vi.mock('../../ui/notificationPolicy', () => ({ notify: mocks.notify }))
vi.mock('../generationCanvas/store/generationCanvasStore', () => ({ useGenerationCanvasStore: {} }))
vi.mock('../generationCanvas/spend/spendConfirm', () => ({ useSpendConfirmStore: {} }))
vi.mock('../generationCanvas/spend/productionContractView', () => ({ buildProductionContractView: vi.fn() }))
vi.mock('../generationCanvas/spend/anchorCheckpointView', () => ({ buildAnchorCheckpointCard: vi.fn() }))
vi.mock('../workbenchStore', () => ({ useWorkbenchStore: {} }))
vi.mock('./productionRunApi', () => ({ productionRunApi: { read: vi.fn(), command: vi.fn() } }))
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
