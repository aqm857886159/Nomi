// 付费卡第 11 条：失败只给存在的出路（2026-09-30）。
// 用户那一幕：卡改不了，点下去却两次弹「这一步没成……可以改一下再按一次」。
import { describe, expect, it } from 'vitest'

import { spendActionFailureCopy } from './spendCardFailure'

describe('付费卡上一下没做成时说哪一句', () => {
  it('账本说可能已经发出去：只说「结果未知、先去核对」，不管种类、不管卡能不能改', () => {
    expect(spendActionFailureCopy({ ok: false, code: 'failed', message: 'generation_execution_failed', failure: 'provider_unavailable' }, true))
      .toBe('agentPanelV4.spendActionFailed')
  })

  it('调用本身抛了（不知道走到哪一步）：按「结果未知」说', () => {
    expect(spendActionFailureCopy(undefined, true)).toBe('agentPanelV4.spendActionFailed')
  })

  it('没发起、宿主认出了是哪一种：照它说（例：供应商没接好 → 去「模型接入」，不是「改一下再按」）', () => {
    expect(spendActionFailureCopy({ ok: false, code: 'failed', message: 'generation_not_started', failure: 'provider_unavailable' }, true))
      .toBe('generationCommon.production.canvasLanding.actionFailure.providerUnavailable')
    expect(spendActionFailureCopy({ ok: false, code: 'failed', message: 'generation_not_started', failure: 'approval_stale' }, true))
      .toBe('generationCommon.production.canvasLanding.actionFailure.approvalStale')
  })

  it('卡刚变了 / 这一张已经不在卡上 / 项目没打开 / 生成功能还没起来：各说各的', () => {
    expect(spendActionFailureCopy({ ok: false, code: 'failed', message: 'generation_quote_changed' }, true)).toBe('agentPanelV4.spendActionCardChanged')
    expect(spendActionFailureCopy({ ok: false, code: 'failed', message: 'generation_scope_invalid' }, true)).toBe('agentPanelV4.spendActionShotGone')
    expect(spendActionFailureCopy({ ok: false, code: 'failed', message: 'no pending generation to confirm' }, true)).toBe('agentPanelV4.spendActionShotGone')
    expect(spendActionFailureCopy({ ok: false, code: 'run_not_open' }, true)).toBe('generationCommon.production.canvasLanding.actionFailure.runNotOpen')
    expect(spendActionFailureCopy({ ok: false, code: 'unavailable' }, true)).toBe('generationCommon.production.canvasLanding.actionFailure.coreStarting')
  })

  it('认不出是哪一种：卡能改 → 「改一下再按」；卡改不了 → 说改不了、该怎么办（第 11 条）', () => {
    const unknown = { ok: false, code: 'failed' as const, message: 'generation_not_started', failure: 'internal_error' as const }
    expect(spendActionFailureCopy(unknown, true)).toBe('agentPanelV4.spendActionNotStarted')
    expect(spendActionFailureCopy(unknown, false)).toBe('agentPanelV4.spendActionNotStartedLocked')
    // 旧宿主不带 `failure` 也一样（只认得 message）。
    expect(spendActionFailureCopy({ ok: false, code: 'failed', message: 'generation_not_started' }, false)).toBe('agentPanelV4.spendActionNotStartedLocked')
  })

  it("宿主在本项目素材里认不出卡上的某张参考图（别的项目的 / 已经不在了）：点名是参考图、说拿掉它或用 @ 重选，不说「改一下再按」", () => {
    for (const reason of ["generation_reference_asset_unsupported", "generation_reference_asset_unavailable"]) {
      const outcome = { ok: false, code: "failed" as const, message: "generation_not_started", reason, failure: "internal_error" as const }
      expect(spendActionFailureCopy(outcome, true)).toBe("agentPanelV4.spendActionReferenceNotInProject")
      // 卡改不了：拿不掉它，照旧说改不了、该怎么办。
      expect(spendActionFailureCopy(outcome, false)).toBe("agentPanelV4.spendActionNotStartedLocked")
    }
  })
})
