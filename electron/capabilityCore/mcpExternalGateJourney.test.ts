import { describe, expect, it, vi } from 'vitest'

import { createMcpProtocol, type McpTransport } from './mcpProtocol'

type Frame = {
  id?: unknown
  method?: string
  result?: { isError?: boolean; content?: Array<{ text?: string }> }
}

function makeExternalGateProtocol(gateId: string, scope: string) {
  const frames: Frame[] = []
  let protocol: ReturnType<typeof createMcpProtocol> | null = null
  const projection = {
    projectId: 'project-1',
    runId: 'run-1',
    revision: 7,
    status: 'awaiting_contract',
    gates: [{
      gateId,
      scope,
      status: 'waiting',
      title: '确认制作策略',
      summary: '批准本次制作所需的预算和模型。',
      planHash: 'plan-hash',
      jobIds: scope === 'job_set' ? ['job-1'] : [],
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    }],
    jobs: [],
    artifacts: [],
  }
  const invoked: Array<{ method: string; params: Record<string, unknown> }> = []
  const transport: McpTransport = {
    send: (message) => {
      const frame = message as Frame
      frames.push(frame)
      if (frame.method === 'elicitation/create' && frame.id != null) {
        queueMicrotask(() => protocol?.handleIncoming({
          jsonrpc: '2.0',
          id: frame.id,
          result: { action: 'accept', content: { confirm: true } },
        }))
      }
    },
    isAppOpen: () => true,
    invoke: async (method, params) => {
      invoked.push({ method, params })
      if (method === 'production.get') return projection
      if (method === 'production.decide-gate') return { ...projection, gates: [{ ...projection.gates[0], status: 'approved' }] }
      throw new Error(`unexpected method: ${method}`)
    },
  }
  protocol = createMcpProtocol(transport)
  async function call(): Promise<Frame> {
    protocol?.handleIncoming({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'nomi_decide_gate', arguments: { projectId: 'project-1', runId: 'run-1', gateId, decision: 'approved' } },
    })
    await vi.waitFor(() => expect(frames.some((frame) => frame.id === 1)).toBe(true), { timeout: 1000 })
    return frames.find((frame) => frame.id === 1)!
  }
  protocol.handleIncoming({
    jsonrpc: '2.0',
    id: 0,
    method: 'initialize',
    params: { protocolVersion: '2025-11-25', capabilities: { elicitation: {} }, clientInfo: { name: 'codex' } },
  })
  return { call, frames, invoked }
}

describe('external Agent single-surface gate decisions', () => {
  it.each([
    ['gate-contract-v1', 'budget_envelope'],
    ['gate-shot-v1-job-1', 'job_set'],
    ['gate-export-v1', 'export'],
  ])('lets an external Agent decide %s through elicitation', async (gateId, scope) => {
    const { call, frames, invoked } = makeExternalGateProtocol(gateId, scope)
    const result = await call()
    expect(result.result?.isError).not.toBe(true)
    expect(frames.some((frame) => frame.method === 'elicitation/create')).toBe(true)
    expect(invoked.map((item) => item.method)).toEqual(['production.get', 'production.decide-gate'])
  })

  it('requires an Agent-side elicitation before approving a script or storyboard artifact', async () => {
    const frames: Frame[] = []
    let protocol: ReturnType<typeof createMcpProtocol> | null = null
    const invoked: string[] = []
    const transport: McpTransport = {
      send: (message) => {
        const frame = message as Frame
        frames.push(frame)
        if (frame.method === 'elicitation/create' && frame.id != null) {
          queueMicrotask(() => protocol?.handleIncoming({ jsonrpc: '2.0', id: frame.id, result: { action: 'accept', content: { confirm: true } } }))
        }
      },
      isAppOpen: () => true,
      invoke: async (method) => {
        invoked.push(method)
        if (method === 'production.artifact.review') return { status: 'approved' }
        throw new Error(`unexpected method: ${method}`)
      },
    }
    protocol = createMcpProtocol(transport)
    protocol.handleIncoming({ jsonrpc: '2.0', id: 0, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: { elicitation: {} }, clientInfo: { name: 'claude-code' } } })
    protocol.handleIncoming({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'nomi_review_artifact', arguments: { projectId: 'project-1', runId: 'run-1', artifactId: 'artifact-script-v1', expectedVersion: 1, decision: 'approved' } },
    })
    await vi.waitFor(() => expect(frames.some((frame) => frame.id === 1)).toBe(true), { timeout: 1000 })
    expect(frames.some((frame) => frame.method === 'elicitation/create')).toBe(true)
    expect(invoked).toEqual(['production.artifact.review'])
  })

  it('keeps rough-cut approval in the Agent and leaves export as a separate gate', async () => {
    const frames: Frame[] = []
    let protocol: ReturnType<typeof createMcpProtocol> | null = null
    const invoked: string[] = []
    const transport: McpTransport = {
      send: (message) => {
        const frame = message as Frame
        frames.push(frame)
        if (frame.method === 'elicitation/create' && frame.id != null) {
          queueMicrotask(() => protocol?.handleIncoming({ jsonrpc: '2.0', id: frame.id, result: { action: 'accept', content: { confirm: true } } }))
        }
      },
      isAppOpen: () => true,
      invoke: async (method) => {
        invoked.push(method)
        if (method === 'production.approve-rough-cut') return { projectId: 'project-1', runId: 'run-1', status: 'awaiting_export' }
        throw new Error(`unexpected method: ${method}`)
      },
    }
    protocol = createMcpProtocol(transport)
    protocol.handleIncoming({ jsonrpc: '2.0', id: 0, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: { elicitation: {} }, clientInfo: { name: 'codex' } } })
    protocol.handleIncoming({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'nomi_approve_rough_cut', arguments: { projectId: 'project-1', runId: 'run-1' } },
    })
    await vi.waitFor(() => expect(frames.some((frame) => frame.id === 1)).toBe(true), { timeout: 1000 })
    expect(frames.some((frame) => frame.method === 'elicitation/create')).toBe(true)
    expect(invoked).toEqual(['production.approve-rough-cut'])
  })
})
