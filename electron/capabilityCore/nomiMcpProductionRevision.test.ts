import { describe, expect, it, vi } from 'vitest'

import { createMcpProtocol, type McpTransport } from './mcpProtocol'

type Frame = { id?: unknown; result?: unknown; error?: { code?: number; message?: string } }

function harness() {
  const frames: Frame[] = []
  const invoke = vi.fn(async (method: string, params: Record<string, unknown>) => {
    if (method === 'production.artifact.revise') {
      return {
        projectId: params.projectId, runId: params.runId, artifactId: 'artifact-script-v3',
        parentArtifactId: params.artifactId, sourceVersion: params.expectedVersion,
        kind: params.kind, status: 'candidate', version: 3, contentHash: 'hash-v3',
        content: { title: '雨夜找猫（修订候选）' },
        openInNomi: `nomi://project/${params.projectId}/run/${params.runId}?artifact=artifact-script-v3`,
      }
    }
    if (method === 'production.artifact.review') {
      return {
        projectId: params.projectId, runId: params.runId, artifactId: params.artifactId,
        status: params.decision === 'approved' ? 'adopted' : 'candidate',
        version: params.expectedVersion, contentHash: 'hash-v2',
        openInNomi: `nomi://project/${params.projectId}/run/${params.runId}?artifact=${params.artifactId}`,
      }
    }
    throw new Error(`unexpected invoke: ${method}`)
  })
  const protocol = createMcpProtocol({
    send: (message) => frames.push(message as Frame),
    invoke: invoke as McpTransport['invoke'],
    isAppOpen: () => true,
  })
  return { frames, invoke, protocol }
}

async function settle() {
  await new Promise((resolve) => setTimeout(resolve, 0))
}

function response(frames: Frame[], id: number): Frame {
  const frame = frames.find((item) => item.id === id)
  if (!frame) throw new Error(`missing response ${id}`)
  return frame
}

describe('external MCP production artifact revisions', () => {
  it('creates script and storyboard revisions as candidates against an expected version', async () => {
    const { protocol, frames, invoke } = harness()
    protocol.handleIncoming({
      jsonrpc: '2.0', id: 1, method: 'tools/call',
      params: {
        name: 'nomi_artifact_review',
        arguments: { action: 'revise', kind: 'script', projectId: 'project-1', runId: 'run-1', artifactId: 'artifact-script-v2', expectedVersion: 2, instruction: '把结尾改得更温暖' },
      },
    })
    protocol.handleIncoming({
      jsonrpc: '2.0', id: 2, method: 'tools/call',
      params: {
        name: 'nomi_artifact_review',
        arguments: { action: 'revise', kind: 'storyboard', projectId: 'project-1', runId: 'run-1', artifactId: 'artifact-storyboard-v2', expectedVersion: 2, instruction: '将第三镜改为近景' },
      },
    })
    await settle()

    expect(invoke).toHaveBeenNthCalledWith(1, 'production.artifact.revise', expect.objectContaining({
      projectId: 'project-1', runId: 'run-1', artifactId: 'artifact-script-v2', expectedVersion: 2, kind: 'script',
    }))
    expect(invoke).toHaveBeenNthCalledWith(2, 'production.artifact.revise', expect.objectContaining({
      projectId: 'project-1', runId: 'run-1', artifactId: 'artifact-storyboard-v2', expectedVersion: 2, kind: 'storyboard',
    }))
    for (const id of [1, 2]) {
      const result = response(frames, id).result as { content: Array<{ text: string }>; structuredContent?: { nomiOutcome?: Record<string, unknown> } }
      expect(result.content[0].text).toMatch(/candidate|候选/i)
      expect(result.content[0].text).toContain('nomi://project/project-1/run/run-1?artifact=artifact-script-v3')
      expect(result.structuredContent?.nomiOutcome).toMatchObject({ status: 'candidate', version: 3 })
    }
  })

  it('reviews only the current artifact version and returns an adopted/rejected receipt', async () => {
    const { protocol, frames, invoke } = harness()
    protocol.handleIncoming({
      jsonrpc: '2.0', id: 3, method: 'tools/call',
      params: {
        name: 'nomi_artifact_review',
        arguments: { action: 'approve', projectId: 'project-1', runId: 'run-1', artifactId: 'artifact-script-v2', expectedVersion: 2 },
      },
    })
    await settle()

    expect(invoke).toHaveBeenCalledWith('production.artifact.review', {
      projectId: 'project-1', runId: 'run-1', artifactId: 'artifact-script-v2', expectedVersion: 2, decision: 'approved',
    })
    const result = response(frames, 3).result as { content: Array<{ text: string }>; structuredContent?: { nomiOutcome?: Record<string, unknown> } }
    expect(result.content[0].text).toMatch(/adopted|批准/i)
    expect(result.structuredContent?.nomiOutcome).toMatchObject({ artifactId: 'artifact-script-v2', version: 2 })
  })

  it('turns stale revisions, wrong project/run, and malformed resource scope into safe MCP errors', async () => {
    const { protocol, frames, invoke } = harness()
    invoke.mockRejectedValueOnce(new Error('Artifact revision is stale: expected version 1, current version 2'))
    protocol.handleIncoming({
      jsonrpc: '2.0', id: 4, method: 'tools/call',
      params: {
        name: 'nomi_artifact_review',
        arguments: { action: 'revise', kind: 'script', projectId: 'project-1', runId: 'run-1', artifactId: 'artifact-script-v2', expectedVersion: 1, instruction: '过时修改' },
      },
    })
    protocol.handleIncoming({
      jsonrpc: '2.0', id: 5, method: 'resources/read',
      params: { uri: 'nomi://project/other/run/run-1/artifact/artifact-script-v2' },
    })
    await settle()

    expect(response(frames, 4).result).toMatchObject({ isError: true })
    expect(JSON.stringify(response(frames, 4).result)).toMatch(/stale|version/i)
    expect(response(frames, 5).error?.code).toBe(-32602)
    expect(JSON.stringify(response(frames, 5).error)).not.toMatch(/\/Users\/|apiKey|providerUrl/i)
  })
})
