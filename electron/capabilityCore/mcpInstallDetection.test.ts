import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// 2026-09-17 走查 W-15 的回归：走查在隔离 HOME 里只建了 5 个**空目录**，
// 5 个客户端就全都以「可一键接入」出现。用户机器上一个卸载后残留的 `~/.cursor` 同样如此。
describe('MCP 客户端安装检测：要真实痕迹，不是「路径存在」', () => {
  let home: string
  let spy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-mcp-install-'))
    spy = vi.spyOn(os, 'homedir').mockReturnValue(home)
    vi.resetModules()
  })
  afterEach(() => {
    spy.mockRestore()
    fs.rmSync(home, { recursive: true, force: true })
  })

  async function installed(client: string): Promise<boolean> {
    const { isMcpClientAppInstalled } = await import('./mcpDetectedClients')
    return isMcpClientAppInstalled(client)
  }

  it('空目录不算装了（阳性对照：同一条路径放进一个文件就算了）', async () => {
    fs.mkdirSync(path.join(home, '.cursor'))
    expect(await installed('cursor')).toBe(false)
    fs.writeFileSync(path.join(home, '.cursor', 'mcp.json'), '{}')
    vi.resetModules()
    expect(await installed('cursor')).toBe(true)
  })

  it('零字节的配置文件不算装了', async () => {
    fs.writeFileSync(path.join(home, '.claude.json'), '')
    expect(await installed('claude')).toBe(false)
    fs.writeFileSync(path.join(home, '.claude.json'), '{"x":1}')
    vi.resetModules()
    expect(await installed('claude')).toBe(true)
  })

  it('什么都没有就是没装', async () => {
    for (const client of ['claude', 'codex', 'cursor', 'workbuddy']) {
      expect(await installed(client), client).toBe(false)
    }
  })
})
