import { describe, expect, it, vi } from 'vitest'

import { createMcpProtocol, MCP_TOOL_NAMES, type McpTransport } from './mcpProtocol'

type Frame = { id?: unknown; result?: unknown; error?: { message?: string } }

function harness() {
  const frames: Frame[] = []
  const invoke = vi.fn(async (method: string, params: Record<string, unknown>) => {
    if (method !== 'production.storyboard.materialize') throw new Error(`unexpected invoke: ${method}`)
    return {
      projectId: params.projectId, runId: params.runId, artifactId: params.artifactId,
      artifactVersion: params.expectedVersion, materialized: true, status: 'awaiting_contract',
      createdNodeIds: ['node-shot-1', 'node-shot-2'],
      bindings: [{ nodeId: 'node-shot-1' }, { nodeId: 'node-shot-2' }],
      openInNomi: 'nomi://project/project-1/run/run-1?artifact=artifact-storyboard-v1',
    }
  })
  const transport: McpTransport = {
    send: (message) => frames.push(message as Frame),
    invoke: invoke as McpTransport['invoke'],
    isAppOpen: () => true,
  }
  return { protocol: createMcpProtocol(transport), frames, invoke }
}

function response(frames: Frame[], id: number): Frame {
  const frame = frames.find((item) => item.id === id)
  if (!frame) throw new Error(`missing response ${id}`)
  return frame
}

describe('external storyboard materialization MCP seam', () => {
  it('publishes a write tool and forwards the versioned artifact handle', async () => {
    const { protocol, frames, invoke } = harness()
    protocol.handleIncoming({ jsonrpc: '2.0', id: 1, method: 'tools/list' })
    await new Promise((resolve) => setTimeout(resolve, 0))
    const tools = (response(frames, 1).result as { tools: Array<{ name: string; annotations?: { readOnlyHint?: boolean } }> }).tools
    // 面收敛：物化落地并入 nomi_run_gate（action=materialize），是写门（不标 readOnlyHint）。
    expect(MCP_TOOL_NAMES).toContain('nomi_run_gate')
    expect(tools.find((tool) => tool.name === 'nomi_run_gate')?.annotations?.readOnlyHint).toBeUndefined()

    protocol.handleIncoming({
      jsonrpc: '2.0', id: 2, method: 'tools/call',
      params: { name: 'nomi_run_gate', arguments: {
        action: 'materialize',
        projectId: 'project-1', runId: 'run-1', artifactId: 'artifact-storyboard-v1', expectedVersion: 1,
      } },
    })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(invoke).toHaveBeenCalledWith('production.storyboard.materialize', {
      projectId: 'project-1', runId: 'run-1', artifactId: 'artifact-storyboard-v1', expectedVersion: 1,
    })
    const result = response(frames, 2).result as { content: Array<{ type: string; text: string }>; structuredContent?: { nomiOutcome?: Record<string, unknown> } }
    expect(result.content[0].text).toContain('分镜已落到 Nomi 画布')
    expect(result.content[0].text).toContain('node-shot-1')
    expect(result.content[0].text).toContain('nomi://project/project-1/run/run-1?artifact=artifact-storyboard-v1')
    expect(result.structuredContent?.nomiOutcome).toMatchObject({ kind: 'storyboard_materialized', bindingCount: 2 })
  })
})
