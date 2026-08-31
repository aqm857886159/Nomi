import { afterEach, describe, expect, it, vi } from 'vitest'
import { createMcpProtocol, type McpTransport } from './mcpProtocol'

// MCP 协议层把 Nomi「导演/编剧技能库」暴露成 resources + prompts（渐进披露）。
// 验证：initialize 广告 resources/prompts 能力；resources/list 与 prompts/list 只吃 skills.list 元数据、
// 不载正文；resources/read 与 prompts/get 才经 skills.read 载正文；未知 uri/name 回 error。
// 直接驱动纯协议层（注入假 transport，invoke 返回 canned 技能数据）——不碰 electron/fs/进程。

type RpcMessage = { jsonrpc?: string; id?: unknown; method?: string; params?: Record<string, unknown>; result?: unknown; error?: { code?: number; message?: string } }

const PACKAGE_VERSION = 'nomi-skill-v1'
const DIRECTOR_HASH = 'a'.repeat(64)
const WRITER_HASH = 'b'.repeat(64)
const SKILLS = [
  { name: 'director.cinematography', directoryName: 'director-cinematography', description: '镜头语言与摄影技法方法论。', packageVersion: PACKAGE_VERSION, contentHash: DIRECTOR_HASH },
  { name: 'writer.dialogue', directoryName: 'writer-dialogue', description: '对白专家（David Mamet 方法论）。', packageVersion: PACKAGE_VERSION, contentHash: WRITER_HASH },
]
const BODIES: Record<string, string> = {
  'director-cinematography': '# 镜头语言\n景别体系 / 构图 / 打光…',
  'writer-dialogue': '# 对白\n潜台词 / 节拍 / 沉默…',
}

/** 充当 MCP 客户端 + 能力核：收集服务端帧；invoke 只认 skills.list / skills.read。 */
class SkillsHarness {
  readonly invoke = vi.fn(async (method: string, params: Record<string, unknown>) => {
    if (method === 'skills.list') return { skills: SKILLS }
    if (method === 'skills.read') {
      const key = String(params.name || params.directoryName || '')
      const meta = SKILLS.find((s) => s.directoryName === key || s.name === key)
      if (!meta) return null
      if (params.packageVersion !== undefined && params.packageVersion !== meta.packageVersion) return null
      if (params.contentHash !== undefined && params.contentHash !== meta.contentHash) return null
      return { ...meta, body: BODIES[meta.directoryName] }
    }
    throw new Error(`意外的 invoke: ${method}`)
  })
  private protocol: ReturnType<typeof createMcpProtocol>
  private queue: RpcMessage[] = []
  private waiters: Array<(msg: RpcMessage) => void> = []

  constructor() {
    const transport: McpTransport = {
      send: (message) => {
        const msg = message as RpcMessage
        const waiter = this.waiters.shift()
        if (waiter) waiter(msg)
        else this.queue.push(msg)
      },
      invoke: this.invoke,
      isAppOpen: () => false,
    }
    this.protocol = createMcpProtocol(transport)
  }

  send(msg: RpcMessage): void {
    this.protocol.handleIncoming(msg)
  }

  next(timeoutMs = 5000): Promise<RpcMessage> {
    const queued = this.queue.shift()
    if (queued) return Promise.resolve(queued)
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('等待 MCP 消息超时')), timeoutMs)
      this.waiters.push((msg) => {
        clearTimeout(timer)
        resolve(msg)
      })
    })
  }

  async call(id: number, method: string, params?: Record<string, unknown>): Promise<RpcMessage> {
    this.send({ jsonrpc: '2.0', id, method, params })
    const res = await this.next()
    expect(res.id).toBe(id)
    return res
  }
}

let harness: SkillsHarness | null = null
afterEach(() => {
  harness = null
})

describe('nomi-mcp · 技能库经 resources + prompts 暴露（渐进披露）', () => {
  it('initialize 广告 tools + resources + prompts 能力', async () => {
    harness = new SkillsHarness()
    const res = await harness.call(1, 'initialize', { protocolVersion: '2025-11-25', capabilities: {} })
    const caps = (res.result as { capabilities?: Record<string, unknown> }).capabilities || {}
    expect(caps).toHaveProperty('tools')
    expect(caps).toHaveProperty('resources')
    expect(caps).toHaveProperty('prompts')
  })

  it('resources/list 把技能映射成 nomi-skill:// 资源，只吃元数据不载正文', async () => {
    harness = new SkillsHarness()
    const res = await harness.call(2, 'resources/list')
    const resources = (res.result as { resources: Array<{ uri: string; name: string; mimeType: string }> }).resources
    // 列表含活 widget 资源（ui://）+ 技能资源（nomi-skill://）——这里只校技能映射。
    const skillResources = resources.filter((r) => r.uri.startsWith('nomi-skill://'))
    expect(skillResources).toHaveLength(2)
    expect(skillResources[0]).toMatchObject({
      uri: `nomi-skill://director-cinematography/${PACKAGE_VERSION}/${DIRECTOR_HASH}`,
      name: 'director.cinematography',
      mimeType: 'text/markdown',
    })
    // 渐进披露：列表阶段只调 skills.list，绝不调 skills.read（不载正文）。
    expect(harness.invoke).toHaveBeenCalledWith('skills.list', {})
    expect(harness.invoke).not.toHaveBeenCalledWith('skills.read', expect.anything())
  })

  it('resources/read 按 uri 载入技能正文', async () => {
    harness = new SkillsHarness()
    const uri = `nomi-skill://writer-dialogue/${PACKAGE_VERSION}/${WRITER_HASH}`
    const res = await harness.call(3, 'resources/read', { uri })
    const contents = (res.result as { contents: Array<{ uri: string; text: string; mimeType: string }> }).contents
    expect(contents[0].uri).toBe(uri)
    expect(contents[0].text).toContain('潜台词')
    expect(harness.invoke).toHaveBeenCalledWith('skills.read', {
      directoryName: 'writer-dialogue',
      packageVersion: PACKAGE_VERSION,
      contentHash: WRITER_HASH,
    })
  })

  it('resources/read rejects raw, malformed, stale, unknown, and foreign URIs', async () => {
    harness = new SkillsHarness()
    const raw = await harness.call(4, 'resources/read', { uri: 'nomi-skill://writer-dialogue' })
    expect((raw.error as { message: string }).message).toContain('无效')
    const malformed = await harness.call(5, 'resources/read', {
      uri: `nomi-skill://writer-dialogue/${PACKAGE_VERSION}/not-a-hash`,
    })
    expect((malformed.error as { message: string }).message).toContain('无效')
    const stale = await harness.call(6, 'resources/read', {
      uri: `nomi-skill://writer-dialogue/${PACKAGE_VERSION}/${'c'.repeat(64)}`,
    })
    expect((stale.error as { message: string }).message).toContain('未找到')
    const unknown = await harness.call(7, 'resources/read', {
      uri: `nomi-skill://nope/${PACKAGE_VERSION}/${WRITER_HASH}`,
    })
    expect((unknown.error as { message: string }).message).toContain('未找到')
    const wrong = await harness.call(8, 'resources/read', { uri: 'file:///etc/passwd' })
    expect((wrong.error as { message: string }).message).toContain('未知资源')
  })

  it('prompts/list 用 directoryName 当命令名（斜杠友好）', async () => {
    harness = new SkillsHarness()
    const res = await harness.call(9, 'prompts/list')
    const prompts = (res.result as { prompts: Array<{ name: string; title: string; packageVersion: string; contentHash: string }> }).prompts
    expect(prompts.map((p) => p.name)).toEqual(['director-cinematography', 'writer-dialogue'])
    expect(prompts[0].title).toBe('director.cinematography')
    expect(prompts[0]).toMatchObject({ packageVersion: PACKAGE_VERSION, contentHash: DIRECTOR_HASH })
  })

  it('prompts/get 返回技能正文作为 user 消息', async () => {
    harness = new SkillsHarness()
    const res = await harness.call(10, 'prompts/get', { name: 'director-cinematography' })
    const result = res.result as { description: string; messages: Array<{ role: string; content: { type: string; text: string } }> }
    expect(result.messages[0].role).toBe('user')
    expect(result.messages[0].content.text).toContain('景别体系')
    expect(harness.invoke).toHaveBeenCalledWith('skills.read', {
      directoryName: 'director-cinematography',
      packageVersion: PACKAGE_VERSION,
      contentHash: DIRECTOR_HASH,
    })
  })

  it('prompts/get rejects an explicitly stale content identity', async () => {
    harness = new SkillsHarness()
    const stale = await harness.call(12, 'prompts/get', {
      name: 'director-cinematography', packageVersion: PACKAGE_VERSION, contentHash: 'c'.repeat(64),
    })
    expect((stale.error as { message: string }).message).toContain('已变化')
    expect(harness.invoke).not.toHaveBeenCalledWith('skills.read', expect.anything())
  })

  it('prompts/get 未知 name → error', async () => {
    harness = new SkillsHarness()
    const bad = await harness.call(11, 'prompts/get', { name: 'nope' })
    expect((bad.error as { message: string }).message).toContain('未找到')
  })
})
