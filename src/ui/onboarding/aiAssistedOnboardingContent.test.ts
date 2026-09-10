import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

import {
  ASSISTED_ONBOARDING_CLIENT_KEYS,
  ASSISTED_ONBOARDING_HOSTS,
  ASSISTED_ONBOARDING_SKILL_MARKDOWN,
  ASSISTED_ONBOARDING_SKILL_PATH,
  OTHER_ONE_CLICK_CLIENTS,
  assistedOnboardingMcpSnippet,
  buildAssistedOnboardingClipboard,
} from './aiAssistedOnboardingContent'
import { ASSISTANT_CLIENT_ORDER } from './assistantActivationState'

const headings = { prompt: '任务提示词', skill: '技能文件', mcp: 'MCP 配置片段' }
const prompt = '帮我把 X 接进 Nomi。'

describe('AI-assisted onboarding clipboard', () => {
  // 技能包是唯一真相源：卡里预览的、复制出去的、装进宿主的，必须是同一个字节流。
  it('reads the skill body straight from the shipped skill package', () => {
    const onDisk = fs.readFileSync(path.join(process.cwd(), 'skills/nomi-add-model/SKILL.md'), 'utf8').trim()
    expect(ASSISTED_ONBOARDING_SKILL_MARKDOWN).toBe(onDisk)
    expect(ASSISTED_ONBOARDING_SKILL_PATH).toBe('nomi-add-model/SKILL.md')
  })

  it('always ships the task prompt and the whole skill file', () => {
    for (const host of ASSISTED_ONBOARDING_HOSTS) {
      const text = buildAssistedOnboardingClipboard({ host, prompt, headings, mcpSnippet: null })
      expect(text, host).toContain(prompt)
      expect(text, host).toContain(ASSISTED_ONBOARDING_SKILL_MARKDOWN)
      expect(text, host).toContain(ASSISTED_ONBOARDING_SKILL_PATH)
    }
  })

  // 「MCP 配置片段只在选『其它』时带上」——那三家由 Nomi 一键写入，粘一份就是第二条路。
  it('only attaches the MCP snippet for the "other" host', () => {
    const snippet = assistedOnboardingMcpSnippet({ command: '/opt/nomi/node', args: ['mcp.mjs'], env: { NOMI_MCP_STDIO: '1' } })
    for (const host of ASSISTED_ONBOARDING_HOSTS) {
      const text = buildAssistedOnboardingClipboard({ host, prompt, headings, mcpSnippet: snippet })
      expect(text.includes(snippet), host).toBe(host === 'other')
      expect(text.includes(headings.mcp), host).toBe(host === 'other')
    }
  })

  it('emits the de-facto standard mcpServers shape and nothing else', () => {
    const snippet = assistedOnboardingMcpSnippet({ command: 'node', args: ['a.mjs'], env: { NOMI_MCP_STDIO: '1' } })
    expect(JSON.parse(snippet)).toEqual({ mcpServers: { nomi: { command: 'node', args: ['a.mjs'], env: { NOMI_MCP_STDIO: '1' } } } })
  })

  // 剪贴板里永远不该出现凭据：Key 只走 Nomi 本机安全页，全程不进任何要粘给助手的东西。
  it('never carries anything key-shaped', () => {
    const text = buildAssistedOnboardingClipboard({
      host: 'other',
      prompt,
      headings,
      mcpSnippet: assistedOnboardingMcpSnippet({ command: 'node', args: [], env: { NOMI_MCP_STDIO: '1' } }),
    })
    expect(text).not.toMatch(/\bsk-[A-Za-z0-9]/)
    expect(text.toLowerCase()).not.toContain('apikey')
    expect(text.toLowerCase()).not.toContain('api_key')
  })

  // 「其它」那一行点名的宿主必须从真实客户端表 derive——手列一份，加一个客户端就漏一个。
  it('derives the remaining one-click hosts from the real client table', () => {
    const shown = Object.values(ASSISTED_ONBOARDING_CLIENT_KEYS)
    expect([...OTHER_ONE_CLICK_CLIENTS].sort()).toEqual(ASSISTANT_CLIENT_ORDER.filter((key) => !shown.includes(key)).slice().sort())
    expect(OTHER_ONE_CLICK_CLIENTS.length).toBeGreaterThan(0)
  })
})
