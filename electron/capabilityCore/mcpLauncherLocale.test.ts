import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createMcpProtocol, type McpTransport } from './mcpProtocol'
import { resolveLauncherLocale } from './mcpNodeLauncher'
import { readPersistedLocale } from '../settings/localePreference'

// Fix B · bare-Node launcher 的 locale 接线：生产 MCP 入口是 mcpNodeLauncher（ELECTRON_RUN_AS_NODE=1，无
// app.getLocale()），改从 OS locale（Intl.DateTimeFormat().resolvedOptions().locale，经 normalizeDesktopLocale）取语言。
// provider 可注入，证明它真被读取并贯穿到 tool-result 文本（不再永远 zh-CN）。

describe('resolveLauncherLocale（注入 provider → 归一 OS locale，缺省 zh-CN）', () => {
  it("provider 返回 'en-US' → 'en'", () => {
    expect(resolveLauncherLocale(() => 'en-US')).toBe('en')
  })
  it("provider 返回 'zh-CN' → 'zh-CN'", () => {
    expect(resolveLauncherLocale(() => 'zh-CN')).toBe('zh-CN')
  })
  it("持久化 preferences.language=zh-CN 覆盖 en-US 系统 locale", () => {
    expect(resolveLauncherLocale(() => 'en-US', () => 'zh-CN')).toBe('zh-CN')
  })
  it("没有持久化偏好时才回落到系统 locale", () => {
    expect(resolveLauncherLocale(() => 'en-US', () => null)).toBe('en')
  })
  it("en-US 机器上持久化选择 zh-CN → MCP 结果仍是中文", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-locale-'))
    try {
      fs.writeFileSync(path.join(root, 'preferences.json'), JSON.stringify({ preferences: { language: 'zh-CN' } }))
      const selected = resolveLauncherLocale(() => 'en-US', () => readPersistedLocale(root))
      const { protocol, frames } = harness(() => selected)
      protocol.handleIncoming({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'nomi_read', arguments: { target: 'models' } } } as never)
      await flush()
      expect(listModelsText(frames)).toContain('可用模型')
      protocol.dispose()
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })
  it("provider 抛错 → 缺省 zh-CN（不崩、不强行英文）", () => {
    expect(resolveLauncherLocale(() => { throw new Error('no Intl') })).toBe('zh-CN')
  })
  // 判据是「是不是中文」,不是「是不是英文」:非中文的可读 locale 一律落英文。
  // 旧口径把 tr-TR/de-DE 判成中文,与渲染层相反,土耳其语系统上 Agent 因此用中文作答(2026-08-28 实测)。
  it("provider 返回非中文串（含垃圾串）→ 归一到 en", () => {
    expect(resolveLauncherLocale(() => 'tr-TR')).toBe('en')
    expect(resolveLauncherLocale(() => 'de-DE')).toBe('en')
    expect(resolveLauncherLocale(() => 'garbage-locale')).toBe('en')
  })
  it("provider 返回中文串 → zh-CN", () => {
    expect(resolveLauncherLocale(() => 'zh-TW')).toBe('zh-CN')
    expect(resolveLauncherLocale(() => 'zh-Hans')).toBe('zh-CN')
  })
  it("provider 返回空串 → 无信号,回落缺省 zh-CN", () => {
    expect(resolveLauncherLocale(() => '')).toBe('zh-CN')
  })
  it("默认（不注入）读真实 OS locale → 合法双语枚举之一（不抛）", () => {
    expect(['en', 'zh-CN']).toContain(resolveLauncherLocale())
  })
})

// 与 mcpLocale.test.ts 同款假 transport：证明 launcher 解出的 locale 经 getLocale 贯穿到 tool-result 的 L() 文本。
type RpcMessage = { id?: unknown; method?: string; params?: Record<string, unknown>; result?: unknown }

function harness(getLocale: () => 'zh-CN' | 'en') {
  const frames: RpcMessage[] = []
  const transport: McpTransport = {
    send: (m) => frames.push(m as RpcMessage),
    invoke: (async (method: string) => {
      if (method === 'models.list') return { models: [{ vendor: 'apimart', modelKey: 'seedream', label: 'Seedream', kind: 'image', keyStatus: 'ok', statusReason: '已接入且可用', references: { image: false, video: false, audio: false, multiImage: false, referenceModes: [] } }] }
      throw new Error(`unexpected ${method}`)
    }) as McpTransport['invoke'],
    isAppOpen: () => true,
    getLocale,
  }
  return { protocol: createMcpProtocol(transport), frames }
}

const flush = () => new Promise((r) => setTimeout(r, 0))

function listModelsText(frames: RpcMessage[]): string {
  return ((frames.find((f) => f.id === 1)?.result as { content?: Array<{ type?: string; text?: string }> })?.content?.find((c) => c.type === 'text')?.text) || ''
}

describe('launcher locale → protocol getLocale → tool-result L() 文本', () => {
  it("OS locale='en-US' 经 resolveLauncherLocale 接进 protocol → list_models 转述是英文", async () => {
    const { protocol, frames } = harness(() => resolveLauncherLocale(() => 'en-US'))
    protocol.handleIncoming({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'nomi_read', arguments: { target: 'models' } } } as never)
    await flush()
    const text = listModelsText(frames)
    expect(text).toContain('usable model(s)')
    expect(text).not.toContain('可用模型')
  })

  it("OS locale 取不到（provider 抛错）→ 缺省 zh-CN → 中文转述", async () => {
    const { protocol, frames } = harness(() => resolveLauncherLocale(() => { throw new Error('no Intl') }))
    protocol.handleIncoming({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'nomi_read', arguments: { target: 'models' } } } as never)
    await flush()
    expect(listModelsText(frames)).toContain('可用模型')
  })
})
