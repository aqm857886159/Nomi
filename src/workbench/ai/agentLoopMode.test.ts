import { afterEach, describe, expect, it, vi } from 'vitest'

// 2026-09-05：single-shot 不再排成 Host 回合（那会把机器提示词写进用户的项目会话），
// 改走 Host 的临时执行路 projectAgentClient.runEphemeral：同一套运行时、同一套附件 claim 准入，
// 但不产生回合/item/账本，盘上快照前后不变。这里钉的就是这条路由与它的入参形状。
const runEphemeral = vi.fn(async (..._args: unknown[]) => ({ text: 'ok', usage: { totalTokens: 1 } }))
const snapshotState = {
  snapshot: { binding: { projectId: 'p1' } },
  subscriptionId: 'subscription-a',
}

vi.mock('./projectAgentClient', () => ({
  projectAgentClient: { runEphemeral: (...args: unknown[]) => runEphemeral(...args) },
}))
vi.mock('./projectAgentProjectionStore', () => ({
  projectAgentProjectionStore: { getState: () => snapshotState },
}))
vi.mock('./assistantModelPref', () => ({ getAssistantModelPref: () => null }))

import { runSingleShotAgent, AGENT_LOOP_MODE } from './agentLoopMode'

afterEach(() => vi.clearAllMocks())

describe('runSingleShotAgent', () => {
  it('declares both loop modes', () => {
    expect(AGENT_LOOP_MODE).toEqual({ singleShot: 'single-shot', multiTurn: 'multi-turn' })
  })

  it('runs one zero-tool ephemeral request through the Host, never as a persisted turn', async () => {
    await runSingleShotAgent({
      featureKey: 'nomi:production-directions:p1',
      prompt: 'hi',
      displayPrompt: 'plan direction',
      projectId: 'p1',
      skillKey: 'workbench.production.direction-planner',
      skillName: 'direction planner',
    })
    expect(runEphemeral).toHaveBeenCalledTimes(1)
    const [subscriptionId, request, claims] = runEphemeral.mock.calls[0] as [string, Record<string, unknown>, unknown[]]
    expect(subscriptionId).toBe('subscription-a')
    expect(claims).toEqual([])
    expect(request).toMatchObject({
      prompt: 'hi',
      displayPrompt: 'plan direction',
      featureKey: 'nomi:production-directions:p1',
      capability: 'single-shot',
      history: { kind: 'ephemeral' },
      projectId: 'p1',
      skillKey: 'workbench.production.direction-planner',
      skillName: 'direction planner',
      mode: 'chat',
    })
  })

  it('binds to the open subscription project and forwards attachments and claims', async () => {
    const attachments = [{
      url: 'nomi-local://x.png',
      contentType: 'image/png',
      fileName: 'shot-frame.png',
      kind: 'image' as const,
    }]
    const attachmentClaims = [{ assetId: 'asset-1', version: 1 as const }]
    await runSingleShotAgent({
      featureKey: 'nomi:shot-verify',
      prompt: 'judge',
      displayPrompt: 'judge',
      skillKey: 'workbench.shot-verify',
      skillName: 'shot verify',
      attachments,
      attachmentClaims,
    })
    const [, request, claims] = runEphemeral.mock.calls[0] as [string, Record<string, unknown>, unknown[]]
    // 判官靠 claim 让主进程把本地帧换成可读资产；丢了它本地帧准入就断（8447f868f 刚修好那条）。
    expect(claims).toEqual(attachmentClaims)
    expect(request.attachments).toEqual(attachments)
    // 调用方没给 projectId 时也必须绑定到当前订阅的项目——临时执行本来就只在该订阅范围内成立。
    expect(request.projectId).toBe('p1')
  })

  it('refuses to run when the request project disagrees with the open binding', async () => {
    await expect(runSingleShotAgent({
      featureKey: 'k', prompt: 'p', displayPrompt: 'd', projectId: 'other-project', skillKey: 'sk', skillName: 'sn',
    })).rejects.toThrow('project_binding_stale')
    expect(runEphemeral).not.toHaveBeenCalled()
  })

  it('returns the ephemeral response text as a finished single-shot result', async () => {
    runEphemeral.mockResolvedValueOnce({ text: 'candidate json', usage: { totalTokens: 5 } })
    const result = await runSingleShotAgent({
      featureKey: 'k', prompt: 'p', displayPrompt: 'd', skillKey: 'sk', skillName: 'sn',
    })
    expect(result).toMatchObject({ status: 'finished', text: 'candidate json', usage: { totalTokens: 5 }, toolCalls: [] })
  })
})
