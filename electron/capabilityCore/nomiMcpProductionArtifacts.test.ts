import { describe, expect, it, vi } from 'vitest'

import { createMcpProtocol, MCP_TOOL_NAMES, type McpTransport } from './mcpProtocol'

type Frame = {
  id?: unknown
  method?: string
  params?: Record<string, unknown>
  result?: unknown
  error?: { code?: number; message?: string }
}

function harness() {
  const frames: Frame[] = []
  const invoke = vi.fn(async (method: string, params: Record<string, unknown>) => {
    if (method === 'production.artifact.read') {
      if (params.projectId === 'other') throw new Error('Production run project mismatch')
      return {
        artifactId: params.artifactId,
        projectId: params.projectId,
        runId: params.runId,
        kind: 'script',
        status: 'adopted',
        version: 2,
        contentHash: 'hash-script-v2',
        source: 'external-mcp',
        content: { title: '雨夜找猫', scenes: [{ id: 's1', text: '便利店门口' }] },
        nomiUri: `nomi://project/${params.projectId}/run/${params.runId}/artifact/${params.artifactId}`,
        openInNomi: `nomi://project/${params.projectId}/run/${params.runId}?artifact=${params.artifactId}`,
      }
    }
    throw new Error(`unexpected invoke: ${method}`)
  })
  const transport: McpTransport = {
    send: (message) => frames.push(message as Frame),
    invoke: invoke as McpTransport['invoke'],
    isAppOpen: () => true,
  }
  const protocol = createMcpProtocol(transport)
  return { frames, invoke, protocol }
}

function nextFrame(frames: Frame[], id: number): Frame {
  const frame = frames.find((item) => item.id === id)
  if (!frame) throw new Error(`missing response ${id}`)
  return frame
}

describe('external MCP production artifact reads', () => {
  it('publishes versioned artifact read tools and the resource template', async () => {
    const { protocol, frames } = harness()
    protocol.handleIncoming({ jsonrpc: '2.0', id: 1, method: 'tools/list' })
    protocol.handleIncoming({ jsonrpc: '2.0', id: 2, method: 'resources/templates/list' })
    await new Promise((resolve) => setTimeout(resolve, 0))

    const tools = (nextFrame(frames, 1).result as { tools: Array<{ name: string; annotations?: { readOnlyHint?: boolean } }> }).tools
    // 面收敛：get/read artifact 并入 nomi_read（整体只读）；script/storyboard revision + review 并入 nomi_artifact_review（写）。
    expect(MCP_TOOL_NAMES).toEqual(expect.arrayContaining(['nomi_read', 'nomi_artifact_review']))
    expect(tools.find((tool) => tool.name === 'nomi_read')?.annotations?.readOnlyHint).toBe(true)
    expect(tools.find((tool) => tool.name === 'nomi_artifact_review')?.annotations?.readOnlyHint).toBeUndefined()

    const templates = (nextFrame(frames, 2).result as { resourceTemplates: Array<{ uriTemplate: string }> }).resourceTemplates
    expect(templates.some((template) => template.uriTemplate === 'nomi://project/{projectId}/run/{runId}/artifact/{artifactId}')).toBe(true)
  })

  it('reads complete structured artifact content with version/hash and a safe deep link', async () => {
    const { protocol, frames, invoke } = harness()
    protocol.handleIncoming({
      jsonrpc: '2.0', id: 3, method: 'tools/call',
      params: { name: 'nomi_read', arguments: { target: 'artifact_content', projectId: 'project-1', runId: 'run-1', artifactId: 'artifact-script-v2' } },
    })
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(invoke).toHaveBeenCalledWith('production.artifact.read', {
      projectId: 'project-1', runId: 'run-1', artifactId: 'artifact-script-v2',
    })
    const result = nextFrame(frames, 3).result as { content: Array<{ type: string; text: string }>; structuredContent?: { nomiOutcome?: Record<string, unknown> } }
    expect(result.content[0].text).toContain('hash-script-v2')
    expect(result.content[0].text).toContain('雨夜找猫')
    expect(result.content[0].text).toContain('nomi://project/project-1/run/run-1?artifact=artifact-script-v2')
    expect(result.structuredContent?.nomiOutcome).toMatchObject({ artifactId: 'artifact-script-v2', version: 2 })
    expect(result.content[0].text).not.toMatch(/\/Users\/|apiKey|providerUrl|https:\/\//i)
  })

  it('reads the same artifact through the versioned nomi resource URI', async () => {
    const { protocol, frames, invoke } = harness()
    protocol.handleIncoming({
      jsonrpc: '2.0', id: 4, method: 'resources/read',
      params: { uri: 'nomi://project/project-1/run/run-1/artifact/artifact-script-v2' },
    })
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(invoke).toHaveBeenCalledWith('production.artifact.read', {
      projectId: 'project-1', runId: 'run-1', artifactId: 'artifact-script-v2',
    })
    const result = nextFrame(frames, 4).result as { contents: Array<{ uri: string; mimeType: string; text: string }> }
    expect(result.contents[0]).toMatchObject({
      uri: 'nomi://project/project-1/run/run-1/artifact/artifact-script-v2',
      mimeType: 'application/json',
    })
    expect(result.contents[0].text).toContain('hash-script-v2')
  })

  it('sanitizes legacy secrets and local paths in resource payloads', async () => {
    const { protocol, frames, invoke } = harness()
    invoke.mockResolvedValueOnce({
      artifactId: 'artifact-script-v2', projectId: 'project-1', runId: 'run-1', kind: 'script', version: 2,
      content: { title: 'safe', sourcePath: '/Users/aoqimin/private/script.json', providerUrl: 'https://provider.example/run' },
      apiKey: 'do-not-leak', authorization: 'Bearer secret',
    })
    protocol.handleIncoming({
      jsonrpc: '2.0', id: 5, method: 'resources/read',
      params: { uri: 'nomi://project/project-1/run/run-1/artifact/artifact-script-v2' },
    })
    await new Promise((resolve) => setTimeout(resolve, 0))

    const result = nextFrame(frames, 5).result as { contents: Array<{ text: string }> }
    expect(result.contents[0].text).toContain('"sourcePath": "[redacted]"')
    expect(result.contents[0].text).not.toContain('do-not-leak')
    expect(result.contents[0].text).not.toContain('provider.example')
    expect(result.contents[0].text).not.toContain('/Users/aoqimin')
  })

  it('does not trust a forged openInNomi value from a legacy projection', async () => {
    const { protocol, frames, invoke } = harness()
    invoke.mockResolvedValueOnce({
      artifactId: 'artifact-script-v2', projectId: 'project-1', runId: 'run-1', kind: 'script', status: 'adopted',
      version: 2, contentHash: 'hash-script-v2', content: { title: 'safe' }, openInNomi: 'javascript:alert(1)',
    })
    protocol.handleIncoming({
      jsonrpc: '2.0', id: 6, method: 'tools/call',
      params: { name: 'nomi_read', arguments: { target: 'artifact_content', projectId: 'project-1', runId: 'run-1', artifactId: 'artifact-script-v2' } },
    })
    await new Promise((resolve) => setTimeout(resolve, 0))
    const result = nextFrame(frames, 6).result as { content: Array<{ text: string }>; structuredContent?: { nomiOutcome?: { openInNomi?: unknown } } }
    expect(result.content[0].text).not.toContain('javascript:')
    expect(result.structuredContent?.nomiOutcome?.openInNomi).toBeUndefined()
  })
})
