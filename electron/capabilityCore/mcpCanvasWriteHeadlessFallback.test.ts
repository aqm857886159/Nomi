// canvas.write 的**兜底不许吞掉未知/不可用 operation**（2026-09-05 外部宿主探针 c-2 根因 B）。
//
// 修复前：dispatcher 只原生实现 3 个 operation，剩下 6 个一律递给 ctx.generationPlanning
// （一个只认 create/preview/gate_request/start 的**生成**处理器）。它收到 `tidy_canvas` 会铸一个
// op-<uuid> 再去查一个不存在的 production run，宿主拿到 `Production run not found: op-…` ——
// 一句像内部崩溃的话。而 dispatcher 自己本来就写好了正确的 501 文案，只因函数接着就永远看不到。
//
// 这两条测试钉住的是：① 未知 operation 必须回可自纠的输入错误并**列出全部合法值**；
// ② 渲染层拥有的 operation 必须回 capability_unsupported + 说清「现在这条传输上能用哪些」，
// 并且**一次都不碰 generationPlanning**。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { CANVAS_WRITE_OPERATIONS } from '../shared/agentCapabilities/canvasWrite'
import { dispatch } from './dispatcher'
import type { McpConnectionContext } from './mcpConnectionContext'
import { createMcpGenerationPolicy } from './mcpGenerationPolicy'
import { createProjectLeaseAuthority } from './projectLease'
import { createProjectLeaseStore } from './projectLeaseStore'
import { createProjectSessionAuthority } from './projectSessionAuthority'

const tempDirs: string[] = []
afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

const connection: McpConnectionContext = Object.freeze({
  authenticatedClient: 'codex',
  principal: 'mcp:codex',
  sessionId: 'mcp-session:canvas-fallback',
  connectionNonce: 'connection-canvas-fallback',
})

async function leasedContext() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-canvas-fallback-'))
  tempDirs.push(dir)
  const identity = {
    projectId: 'project-1',
    immutableProjectUuid: 'uuid-1',
    projectGeneration: 1,
    canonicalRootDigest: 'root-digest-1',
    manifestDigest: 'manifest-audit-1',
  }
  const generationPolicy = createMcpGenerationPolicy({ env: {}, checkpoints: {} })
  const leaseAuthority = createProjectLeaseAuthority({
    macKey: 'canvas-fallback-authority-key',
    store: createProjectLeaseStore({ filePath: path.join(dir, 'leases.json'), macKey: 'canvas-fallback-store-key' }),
    verifyProjectIdentity: async () => ({
      projectId: identity.projectId,
      immutableProjectUuid: identity.immutableProjectUuid,
      projectGeneration: identity.projectGeneration,
      canonicalRootDigest: identity.canonicalRootDigest,
    }),
  })
  const authority = createProjectSessionAuthority({
    leaseAuthority,
    generationPolicy,
    resolveProjectSelection: async () => identity,
  })
  const opened = await authority.open({ bootstrap: { mode: 'current_project' } }, connection)
  const generationPlanning = vi.fn()
  return {
    leaseHandle: opened.leaseHandle,
    generationPlanning,
    ctx: {
      runTask: vi.fn(),
      makeGateway: vi.fn(),
      productionRuns: {},
      generationPolicy,
      generationPlanning,
      projectSession: { authority, connection },
    },
  }
}

describe('canvas.write headless fallback', () => {
  it('rejects an unknown operation by listing every legal one, not by inventing a generation plan', async () => {
    const { ctx, leaseHandle, generationPlanning } = await leasedContext()
    const failure = await dispatch('canvas.write', {
      projectId: 'project-1', leaseHandle, operation: 'reticulate_splines',
    }, ctx as never).catch((error: unknown) => error as { code?: string; nextAction?: string; message?: string })

    expect(failure?.message).toContain('reticulate_splines')
    expect(failure?.code).toBe('capability_input_invalid')
    const nextAction = String(failure?.nextAction ?? '')
    for (const operation of CANVAS_WRITE_OPERATIONS) {
      expect(nextAction, `${operation} must be listed so the model can self-correct`).toContain(operation)
    }
    expect(generationPlanning).not.toHaveBeenCalled()
  })

  it('tells the host that a renderer-owned operation needs the Nomi creation surface', async () => {
    const { ctx, leaseHandle, generationPlanning } = await leasedContext()
    const failure = await dispatch('canvas.write', {
      projectId: 'project-1', leaseHandle, operation: 'tidy_canvas',
    }, ctx as never).catch((error: unknown) => error as { code?: string; nextAction?: string; message?: string })

    expect(failure?.code).toBe('capability_unsupported')
    expect(String(failure?.message)).not.toMatch(/Production run not found/)
    const nextAction = String(failure?.nextAction ?? '')
    expect(nextAction).toContain('create_canvas_nodes')
    expect(nextAction).not.toContain('tidy_canvas')
    // 关键：一次都不许递给生成处理器——那正是把画布动作洗成 `Production run not found` 的那一步。
    expect(generationPlanning).not.toHaveBeenCalled()
  })
})
