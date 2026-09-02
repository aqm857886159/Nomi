import { describe, it, expect } from 'vitest'
import { createMcpProtocol, type McpTransport } from './mcpProtocol'

// 交付5 · locale 接线：协议层的结果/进度文案跟 transport.getLocale() 走（缺省 zh-CN）。
// 这里用假 transport 注入 getLocale，证明它真被读取并贯穿到 tool-result 文本（不再硬编码中文）。
type RpcMessage = { id?: unknown; method?: string; params?: Record<string, unknown>; result?: unknown }

function harness(getLocale?: () => 'zh-CN' | 'en') {
  const frames: RpcMessage[] = []
  const transport: McpTransport = {
    send: (m) => frames.push(m as RpcMessage),
    invoke: (async (method: string) => {
      if (method === 'models.list') return { models: [{ vendor: 'apimart', modelKey: 'seedream', label: 'Seedream', kind: 'image', keyStatus: 'ok', statusReason: '已接入且可用', references: { image: false, video: false, audio: false, multiImage: false, referenceModes: [] } }] }
      throw new Error(`unexpected ${method}`)
    }) as McpTransport['invoke'],
    isAppOpen: () => true,
    ...(getLocale ? { getLocale } : {}),
  }
  return { protocol: createMcpProtocol(transport), frames }
}

async function flush() {
  await new Promise((r) => setTimeout(r, 0))
}

function callListModels(protocol: ReturnType<typeof createMcpProtocol>) {
  protocol.handleIncoming({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'nomi_read', arguments: { target: 'models' } } } as never)
}

describe('locale 接线（transport.getLocale 贯穿到 tool-result 文本）', () => {
  it('getLocale=()=>"en" → list_models 转述是英文', async () => {
    const { protocol, frames } = harness(() => 'en')
    callListModels(protocol)
    await flush()
    const text = ((frames.find((f) => f.id === 1)?.result as { content?: Array<{ type?: string; text?: string }> })?.content?.find((c) => c.type === 'text')?.text) || ''
    expect(text).toContain('usable model(s)')
    expect(text).not.toContain('可用模型')
  })

  it('getLocale=()=>"zh-CN" → 中文转述', async () => {
    const { protocol, frames } = harness(() => 'zh-CN')
    callListModels(protocol)
    await flush()
    const text = ((frames.find((f) => f.id === 1)?.result as { content?: Array<{ type?: string; text?: string }> })?.content?.find((c) => c.type === 'text')?.text) || ''
    expect(text).toContain('可用模型')
  })

  it('未提供 getLocale → 缺省 zh-CN（不崩、不强行英文）', async () => {
    const { protocol, frames } = harness()
    callListModels(protocol)
    await flush()
    const text = ((frames.find((f) => f.id === 1)?.result as { content?: Array<{ type?: string; text?: string }> })?.content?.find((c) => c.type === 'text')?.text) || ''
    expect(text).toContain('可用模型')
  })
})
