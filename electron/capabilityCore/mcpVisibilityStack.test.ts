import { describe, expect, it, vi } from 'vitest'

import { createMcpProtocol, type McpTransport } from './mcpProtocol'

type RpcMessage = {
  jsonrpc?: string
  id?: unknown
  method?: string
  params?: Record<string, unknown>
  result?: unknown
  error?: { code?: number; message?: string }
}

function makeHarness(artifactResult: unknown) {
  const frames: RpcMessage[] = []
  const invoke = vi.fn(async (method: string) => {
    if (method === 'production.artifact') return artifactResult
    throw new Error(`unexpected invoke: ${method}`)
  })
  const transport: McpTransport = {
    send: (message) => frames.push(message as RpcMessage),
    invoke: invoke as McpTransport['invoke'],
    isAppOpen: () => true,
  }
  return { protocol: createMcpProtocol(transport), frames, invoke }
}

function callArtifact(protocol: ReturnType<typeof createMcpProtocol>) {
  protocol.handleIncoming({
    jsonrpc: '2.0',
    id: 43,
    method: 'tools/call',
    params: {
      name: 'nomi_read',
      arguments: { target: 'artifact', projectId: 'p1', runId: 'r9', artifactId: 'a1' },
    },
  })
}

async function flush() {
  await new Promise((resolve) => setTimeout(resolve, 0))
}

describe('ProductionRun artifact visibility', () => {
  const artifactProjection = (extra: Record<string, unknown> = {}) => ({
    artifactId: 'a1', runId: 'r9', projectId: 'p1', kind: 'image', status: 'ready',
    nomiUri: 'nomi://project/p1/run/r9/artifact/a1',
    openInNomi: 'nomi://project/p1/run/r9?artifact=a1',
    preview: {
      url: 'http://127.0.0.1:5/production-preview?preview=TOK',
      nomiUrl: 'nomi-local://production-preview/p1/r9/a1/thumb.jpg?preview=TOK',
      token: 'TOK', expiresAt: 'later',
    },
    ...extra,
  })

  it('emits one native image block while retaining the text fallback', async () => {
    const { protocol, frames } = makeHarness(artifactProjection({
      _nomiThumbnail: { data: 'QUJD', mimeType: 'image/jpeg' },
    }))
    callArtifact(protocol)
    await flush()

    const reply = frames.find((frame) => frame.id === 43)
    const content = (reply?.result as { content?: Array<Record<string, unknown>> })?.content || []
    expect(content.filter((item) => item.type === 'image')).toEqual([
      { type: 'image', data: 'QUJD', mimeType: 'image/jpeg' },
    ])
    expect(content.some((item) => item.type === 'text')).toBe(true)
  })

  it('does not duplicate internal enrichment fields in text or structured data', async () => {
    const { protocol, frames } = makeHarness(artifactProjection({
      _nomiThumbnail: { data: 'QUJD', mimeType: 'image/jpeg' },
    }))
    callArtifact(protocol)
    await flush()

    const reply = frames.find((frame) => frame.id === 43)
    const result = reply?.result as {
      content?: Array<{ type?: string; text?: string }>
      structuredContent?: { nomiRunData?: Record<string, unknown> }
    }
    const text = String(result.content?.find((item) => item.type === 'text')?.text)
    expect(text).not.toContain('_nomiThumbnail')
    expect(text).not.toContain('QUJD')
    expect(result.structuredContent?.nomiRunData).toMatchObject({ artifactId: 'a1' })
    expect(result.structuredContent?.nomiRunData).not.toHaveProperty('_nomiThumbnail')
    expect(result.structuredContent?.nomiRunData).not.toHaveProperty('_nomiPreviewUrl')
  })

  it('keeps video artifacts text-only and preserves the Run deep link', async () => {
    const { protocol, frames } = makeHarness(artifactProjection({
      kind: 'video',
      preview: {
        url: 'http://127.0.0.1:5/production-preview?preview=T',
        nomiUrl: 'nomi-local://production-preview/p1/r9/a1/clip.mp4?preview=T',
        token: 'T', expiresAt: 'later',
      },
    }))
    callArtifact(protocol)
    await flush()

    const reply = frames.find((frame) => frame.id === 43)
    const result = reply?.result as {
      content?: Array<{ type?: string }>
      structuredContent?: { nomiOutcome?: { openInNomi?: string } }
    }
    expect(result.content?.filter((item) => item.type === 'image')).toHaveLength(0)
    expect(result.structuredContent?.nomiOutcome?.openInNomi)
      .toBe('nomi://project/p1/run/r9?artifact=a1')
  })
})
