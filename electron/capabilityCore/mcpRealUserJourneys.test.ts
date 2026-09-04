import { describe, expect, it, vi } from 'vitest'

import { createMcpProtocol, type McpTransport } from './mcpProtocol'

type Frame = {
  id?: number
  result?: {
    isError?: boolean
    content?: Array<{ type?: string; text?: string }>
    structuredContent?: { nomiOutcome?: Record<string, unknown> }
  }
  error?: { code?: number; message?: string }
}

async function settle() {
  await new Promise<void>((resolve) => setImmediate(resolve))
}

function responseFor(frames: Frame[], id: number): Frame {
  const response = frames.find((frame) => frame.id === id)
  if (!response) throw new Error(`missing MCP response ${id}`)
  return response
}

function resultFor(frames: Frame[], id: number) {
  return responseFor(frames, id).result
}

function errorCode(result: Frame['result']): unknown {
  return result?.structuredContent?.nomiOutcome?.errorCode
}

function createTransportHarness(failures: Map<string, Error> = new Map()) {
  const frames: Frame[] = []
  const calls: Array<{ method: string; params: Record<string, unknown> }> = []
  const projects: Array<Record<string, unknown>> = []
  let projectSequence = 0

  const invoke = vi.fn(async (method: string, params: Record<string, unknown>) => {
    calls.push({ method, params })
    const failure = failures.get(method)
    if (failure) throw failure

    if (method === 'project.create') {
      const project = {
        id: `project-${++projectSequence}`,
        name: typeof params.name === 'string' && params.name ? params.name : '未命名项目',
        revision: 1,
      }
      projects.push(project)
      return project
    }
    if (method === 'project.list') return { projects }
    if (method === 'nomi_operation_create') {
      return {
        operation: {
          operationId: 'operation-1',
          projectId: params.projectId,
          state: 'draft',
          candidate: { prompt: params.prompt, revision: 1 },
        },
        nextAction: 'preview',
      }
    }
    if (method === 'nomi_preview_execution') {
      return { operationId: params.operationId, candidateRevision: 1, nextAction: 'request_gate' }
    }
    if (method === 'production.artifact.review') {
      return {
        projectId: params.projectId,
        runId: params.runId,
        artifactId: params.artifactId,
        status: 'adopted',
        version: params.expectedVersion,
      }
    }
    throw new Error(`unexpected production MCP invoke: ${method}`)
  })

  const protocol = createMcpProtocol({
    send: (frame) => frames.push(frame as Frame),
    invoke: invoke as McpTransport['invoke'],
    isAppOpen: () => false,
  })
  return { calls, frames, invoke, protocol }
}

async function callTool(
  protocol: ReturnType<typeof createMcpProtocol>,
  frames: Frame[],
  id: number,
  name: string,
  args: unknown,
) {
  protocol.handleIncoming({
    jsonrpc: '2.0',
    id,
    method: 'tools/call',
    params: { name, arguments: args },
  })
  await settle()
  return resultFor(frames, id)
}

describe('MCP production entrypoint user journeys', () => {
  it('accepts a max-length Unicode instruction through tools/call', async () => {
    const frames: Frame[] = []
    const invoke = vi.fn(async () => ({
      projectId: 'project-1',
      runId: 'run-1',
      artifactId: 'artifact-script-v2',
      status: 'candidate',
      version: 2,
    }))
    const protocol = createMcpProtocol({
      send: (frame) => frames.push(frame as Frame),
      invoke: invoke as McpTransport['invoke'],
      isAppOpen: () => false,
    })

    protocol.handleIncoming({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: {
        name: 'nomi_artifact_review',
        arguments: {
          projectId: 'project-1',
          runId: 'run-1',
          artifactId: 'artifact-script-v1',
          expectedVersion: 1,
          action: 'revise',
          kind: 'script',
          instruction: '😀'.repeat(4_000),
        },
      },
    })
    await settle()

    expect(frames).toHaveLength(1)
    expect(frames[0].result?.isError).not.toBe(true)
    expect(invoke).toHaveBeenCalledWith('production.artifact.revise', expect.objectContaining({
      expectedVersion: 1,
      instruction: '😀'.repeat(4_000),
    }))
    protocol.dispose()
  })

  it('completes a project, read, plan, and preview journey through production tools', async () => {
    const { calls, frames, protocol } = createTransportHarness()
    try {
      protocol.handleIncoming({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'CI MCP user' } },
      })
      await settle()
      expect((responseFor(frames, 1).result as unknown as { protocolVersion?: string })?.protocolVersion).toBe('2025-11-25')

      protocol.handleIncoming({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} })
      await settle()
      const tools = (resultFor(frames, 2) as { tools?: Array<{ name: string }> })?.tools || []
      expect(tools.map((tool) => tool.name)).toEqual(expect.arrayContaining([
        'nomi_project_create', 'nomi_read', 'nomi_operation_plan', 'nomi_operation_preview',
      ]))

      const created = await callTool(protocol, frames, 3, 'nomi_project_create', { name: '湖边🎬用户旅程' })
      expect(created?.isError).not.toBe(true)
      expect(calls[0]).toEqual({ method: 'project.create', params: { name: '湖边🎬用户旅程' } })

      const listed = await callTool(protocol, frames, 4, 'nomi_read', { target: 'projects' })
      expect(listed?.isError).not.toBe(true)
      expect(calls[1]).toEqual({ method: 'project.list', params: {} })
      expect(JSON.stringify(listed)).toContain('湖边🎬用户旅程')

      const planned = await callTool(protocol, frames, 5, 'nomi_operation_plan', {
        projectId: 'project-1',
        leaseHandle: 'lease-1',
        prompt: '让纸船在月光里慢慢靠岸',
      })
      expect(planned?.isError).not.toBe(true)
      expect(calls[2]).toEqual({
        method: 'nomi_operation_create',
        params: { projectId: 'project-1', leaseHandle: 'lease-1', prompt: '让纸船在月光里慢慢靠岸' },
      })

      const preview = await callTool(protocol, frames, 6, 'nomi_operation_preview', {
        projectId: 'project-1', leaseHandle: 'lease-1', operationId: 'operation-1',
      })
      expect(preview?.isError).not.toBe(true)
      expect(calls[3]).toEqual({
        method: 'nomi_preview_execution',
        params: { projectId: 'project-1', leaseHandle: 'lease-1', operationId: 'operation-1' },
      })

      const repeated = await callTool(protocol, frames, 7, 'nomi_project_create', { name: '湖边🎬用户旅程' })
      expect(repeated?.isError).not.toBe(true)
      expect(calls.filter(({ method, params }) => method === 'project.create' && params.name === '湖边🎬用户旅程')).toHaveLength(2)
    } finally {
      protocol.dispose()
    }
  })

  it('keeps empty, long, and Unicode inputs at the production schema boundary', async () => {
    const { calls, frames, protocol } = createTransportHarness()
    try {
      const empty = await callTool(protocol, frames, 11, 'nomi_operation_plan', { leaseHandle: 'lease-1', prompt: '' })
      expect(empty?.isError).not.toBe(true)

      const longUnicodePrompt = '重复的镜头意图😀'.repeat(1_000)
      const long = await callTool(protocol, frames, 12, 'nomi_operation_plan', {
        leaseHandle: 'lease-1', prompt: longUnicodePrompt,
      })
      expect(long?.isError).not.toBe(true)
      expect(calls.filter(({ method }) => method === 'nomi_operation_create').at(-1)?.params.prompt).toBe(longUnicodePrompt)

      const tooLong = await callTool(protocol, frames, 13, 'nomi_artifact_review', {
        projectId: 'project-1', runId: 'run-1', artifactId: 'artifact-1', expectedVersion: 1,
        action: 'revise', kind: 'script', instruction: '界'.repeat(4_001),
      })
      expect(tooLong?.isError).toBe(true)
      expect(errorCode(tooLong)).toBe('capability_input_invalid')
      expect(calls.some(({ method }) => method === 'production.artifact.revise')).toBe(false)
    } finally {
      protocol.dispose()
    }
  })

  it('returns recoverable tool errors for malformed arguments and unknown operations', async () => {
    const { calls, frames, protocol } = createTransportHarness()
    try {
      const cases: Array<{ id: number; name: string; args: unknown }> = [
        { id: 21, name: 'nomi_operation_plan', args: {} },
        { id: 22, name: 'nomi_operation_plan', args: { leaseHandle: 'lease-1', unexpected: true } },
        { id: 23, name: 'nomi_operation_control', args: { leaseHandle: 'lease-1', operationId: 'operation-1', action: 'explode' } },
        { id: 24, name: 'nomi_read', args: null },
      ]

      for (const testCase of cases) {
        const result = await callTool(protocol, frames, testCase.id, testCase.name, testCase.args)
        expect(result?.isError).toBe(true)
        expect(errorCode(result)).toBe('capability_input_invalid')
      }
      expect(calls).toHaveLength(0)
    } finally {
      protocol.dispose()
    }
  })

  it('projects a stale revision as a typed safe error at the MCP entrypoint', async () => {
    const stale = Object.assign(new Error('artifact revision is stale: current=2'), { code: 'capability_policy_stale' })
    const { frames, protocol } = createTransportHarness(new Map([['production.artifact.review', stale]]))
    try {
      const result = await callTool(protocol, frames, 31, 'nomi_artifact_review', {
        projectId: 'project-1', runId: 'run-1', artifactId: 'artifact-1', expectedVersion: 1, action: 'approve',
      })
      expect(result?.isError).toBe(true)
      expect(errorCode(result)).toBe('capability_policy_stale')
      expect(JSON.stringify(result)).not.toContain('current=2')
    } finally {
      protocol.dispose()
    }
  })

  it.each([
    ['timeout', 'nomi_operation_preview', 'nomi_preview_execution', 'capability_timeout'],
    ['network failure', 'nomi_operation_plan', 'nomi_operation_create', 'capability_execution_failed'],
    ['provider failure', 'nomi_operation_plan', 'nomi_operation_create', 'capability_execution_failed'],
  ])('returns a deterministic %s without leaking edge details', async (_label, toolName, method, code) => {
    const failure = Object.assign(new Error(`${_label} at https://provider.invalid using apiKey=fixture-secret`), { code })
    const { frames, protocol } = createTransportHarness(new Map([[method, failure]]))
    try {
      const args = toolName === 'nomi_operation_preview'
        ? { leaseHandle: 'lease-1', operationId: 'operation-1' }
        : { leaseHandle: 'lease-1', prompt: _label }
      const result = await callTool(protocol, frames, 41, toolName, args)
      expect(result?.isError).toBe(true)
      expect(errorCode(result)).toBe(code)
      expect(JSON.stringify(result)).not.toContain('fixture-secret')
      expect(JSON.stringify(result)).not.toContain('provider.invalid')
    } finally {
      protocol.dispose()
    }
  })
})
