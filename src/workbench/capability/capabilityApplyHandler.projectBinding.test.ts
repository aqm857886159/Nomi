// 2026-09-06 根因回归：MCP lease 绑的项目 vs Nomi 里打开的项目。
// 根因合同：docs/fixes/2026-09-06-mcp-lease-project-binding.root-cause.json
//
// 主进程在 lease 校验后已经把 lease.projectId 放进渲染层 payload（rpcServer.ts rendererPayload），
// 渲染层这一族适配器过去把它丢了、改读 GUI 当前项目。两种失败各写一条：
//   · 可寻址面（asset.read / export.read）——必须**照用 lease 的 projectId**，GUI 开着谁都无关。
//   · 实时面（timeline.read / timeline.write）——必须拒，且错误点名两个项目 + 给下一步。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { setActiveWorkbenchProjectSaveTarget } from '../project/workbenchProjectSession'
import { handleCapabilityApply } from './capabilityApplyHandler'

vi.mock('../timeline/agent/phase4CapabilityTargets', () => ({
  executeAssetReadTarget: vi.fn(async (request: { projectId?: string; input?: unknown }) => ({ forwardedProjectId: request.projectId ?? null, forwardedInput: request.input })),
  executeExportReadTarget: vi.fn(async (request: { projectId?: string }) => ({ forwardedProjectId: request.projectId ?? null })),
  executeExportWriteTarget: vi.fn(),
}))
vi.mock('../timeline/agent/timelineCapabilityTarget', () => ({
  executeTimelineReadTarget: vi.fn(() => ({ operation: 'read_timeline' })),
  executeTimelineWriteTarget: vi.fn(() => ({ applied: true })),
}))

const { executeTimelineReadTarget, executeTimelineWriteTarget } = await import('../timeline/agent/timelineCapabilityTarget')

function openProject(projectId: string | null): void {
  setActiveWorkbenchProjectSaveTarget(projectId
    ? {
        projectId,
        projectName: projectId,
        canPersist: () => false,
        saveProject: (async () => null) as never,
        onSaved: () => undefined,
      } as never
    : null)
}

beforeEach(() => vi.clearAllMocks())
afterEach(() => openProject(null))

describe('MCP lease project binding at the renderer capability boundary', () => {
  it.each([
    ['no project open', null],
    ['a different project open', 'project-Q'],
  ])('addresses asset.read and export.read by the lease project with %s', async (_label, open) => {
    openProject(open as string | null)
    await expect(handleCapabilityApply('asset.read', { projectId: 'project-P', operation: 'list' }))
      .resolves.toMatchObject({ forwardedProjectId: 'project-P' })
    await expect(handleCapabilityApply('export.read', { projectId: 'project-P', jobId: 'job-1' }))
      .resolves.toEqual({ forwardedProjectId: 'project-P' })
  })

  // 载荷是传输形状（leaseHandle/projectId/operation:'list'），语义 schema 是 strict 的。
  // 整包 spread 会把 operation 覆盖回 'list' 并带进 leaseHandle/projectId → capability_input_invalid，
  // 也就是 nomi_media_query 在真宿主上从来没成功过的那条（真机旅程当场撞出来的）。
  it.each([
    [{ operation: 'list', limit: 5 }, { operation: 'search_media', query: '', limit: 5 }],
    [{ operation: 'get', assetId: 'asset-1' }, { operation: 'get_media', assetId: 'asset-1' }],
    [{ operation: 'waveform', assetId: 'asset-1', buckets: 8 }, { operation: 'read_waveform', assetId: 'asset-1', buckets: 8 }],
  ])('builds a strict semantic asset.read input from the transport payload (%o)', async (payload, expected) => {
    openProject('project-P')
    const result = await handleCapabilityApply('asset.read', {
      ...payload, projectId: 'project-P', leaseHandle: 'lease-handle-value',
    }) as { forwardedInput: Record<string, unknown> }
    expect(result.forwardedInput).toEqual(expected)
  })

  it.each([
    ['no project open', null],
    ['a different project open', 'project-Q'],
  ])('refuses realtime timeline routes with an actionable error when there is %s', async (_label, open) => {
    openProject(open as string | null)
    for (const op of ['timeline.read', 'timeline.write'] as const) {
      const failure = await handleCapabilityApply(op, { projectId: 'project-P', operation: 'preview' }).catch((error: unknown) => error)
      expect(failure).toBeInstanceOf(Error)
      const error = failure as Error & { code?: string }
      expect(error.code).toBe('project_binding_mismatch')
      // 可行动：点名 lease 绑的项目、现在打开的项目、下一步。不是裸 project_scope_required。
      expect(error.message).toContain('project-P')
      expect(error.message).toContain(open ?? '没有打开任何项目')
      expect(error.message).not.toContain('project_scope_required')
    }
    expect(executeTimelineReadTarget).not.toHaveBeenCalled()
    expect(executeTimelineWriteTarget).not.toHaveBeenCalled()
  })

  it('passes the lease project into the timeline write target once the bound project is the open one', async () => {
    openProject('project-P')
    await expect(handleCapabilityApply('timeline.write', {
      projectId: 'project-P', operation: 'apply', plan: { planId: 'plan-1', baseRevision: 'rev-1' },
    })).resolves.toEqual({ applied: true })
    expect(executeTimelineWriteTarget).toHaveBeenCalledWith(expect.objectContaining({ projectId: 'project-P' }))
  })
})
