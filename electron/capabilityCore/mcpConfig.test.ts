import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let homeDir = ''
let isPackaged = false

vi.mock('electron', () => ({
  app: { getAppPath: () => '/fake/repo', getPath: () => homeDir, get isPackaged() { return isPackaged } },
}))
vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>()
  return { ...actual, default: { ...actual, homedir: () => homeDir }, homedir: () => homeDir }
})

import {
  MCP_CONFIG_KIND_ENV,
  MCP_CONFIG_VERSION,
  MCP_CONFIG_VERSION_ENV,
  installMcp,
  listCustomMcpProfiles,
  packagedMcpLauncherAvailable,
  readMcpInfo,
  registerCustomMcpProfile,
  uninstallMcp,
} from './mcpConfig'
import { recordDetectedMcpClient } from './mcpDetectedClients'
import {
  MCP_CLIENT_ENV,
  MCP_CLIENT_PROOF_ENV,
  ensureToken,
  verifyMcpClient,
} from './security'

const roots: string[] = []
function tempHome(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-mcpcfg-'))
  roots.push(dir)
  return dir
}
function claudeJson(): string {
  return path.join(homeDir, '.claude.json')
}

beforeEach(() => {
  homeDir = tempHome()
  isPackaged = false
  ensureToken()
})
afterEach(() => {
  for (const r of roots.splice(0)) fs.rmSync(r, { recursive: true, force: true })
})

describe('capabilityCore/mcpConfig', () => {
  it('does not treat an older installed app without the v3 Helper script as reusable', () => {
    const appRoot = path.join(homeDir, 'Old Nomi.app')
    const appCommand = process.platform === 'darwin'
      ? path.join(appRoot, 'Contents', 'MacOS', 'Nomi')
      : path.join(appRoot, process.platform === 'win32' ? 'Nomi.exe' : 'Nomi')
    const runtime = process.platform === 'darwin'
      ? path.join(appRoot, 'Contents', 'Frameworks', 'Nomi Helper.app', 'Contents', 'MacOS', 'Nomi Helper')
      : appCommand
    const launcher = process.platform === 'darwin'
      ? path.join(appRoot, 'Contents', 'Resources', 'app.asar', 'dist-electron', 'capabilityCore', 'mcpNodeLauncher.js')
      : path.join(appRoot, 'resources', 'app.asar', 'dist-electron', 'capabilityCore', 'mcpNodeLauncher.js')
    fs.mkdirSync(path.dirname(appCommand), { recursive: true })
    fs.mkdirSync(path.dirname(runtime), { recursive: true })
    fs.writeFileSync(appCommand, '')
    if (runtime !== appCommand) fs.writeFileSync(runtime, '')

    expect(packagedMcpLauncherAvailable(appCommand)).toBe(false)
    fs.mkdirSync(path.dirname(launcher), { recursive: true })
    fs.writeFileSync(launcher, '')
    expect(packagedMcpLauncherAvailable(appCommand)).toBe(true)
  })

  it('install 合并进已有 mcpServers——保留 cocos-creator，不覆盖整个文件', () => {
    fs.writeFileSync(
      claudeJson(),
      JSON.stringify({ theme: 'dark', mcpServers: { 'cocos-creator': { command: 'x' } } }, null, 2),
    )
    const result = installMcp()
    expect(result.ok).toBe(true)
    expect(result.backupPath).toBeTruthy()
    expect(fs.existsSync(result.backupPath!)).toBe(true)

    const after = JSON.parse(fs.readFileSync(claudeJson(), 'utf8'))
    expect(after.theme).toBe('dark') // 其它字段原样保留
    expect(after.mcpServers['cocos-creator']).toEqual({ command: 'x' }) // 别人的 server 没被动
    // 启动条目 = Electron 自带 Node runtime + 纯 Node MCP 桥；不注册第二个 NSApplication。
    expect(after.mcpServers.nomi.command).toBe(process.execPath)
    expect(after.mcpServers.nomi.env.ELECTRON_RUN_AS_NODE).toBe('1')
    expect(after.mcpServers.nomi.env.NOMI_MCP_STDIO).toBe('1')
    expect(after.mcpServers.nomi.env.NOMI_MCP_APP_COMMAND).toBe(process.execPath)
    expect(JSON.parse(after.mcpServers.nomi.env.NOMI_MCP_APP_ARGS)).toEqual(['/fake/repo'])
    expect(after.mcpServers.nomi.env[MCP_CONFIG_VERSION_ENV]).toBe(MCP_CONFIG_VERSION)
    expect(after.mcpServers.nomi.env[MCP_CONFIG_KIND_ENV]).toBe('development')
    expect(after.mcpServers.nomi.env[MCP_CLIENT_ENV]).toBe('claude')
    expect(verifyMcpClient(
      after.mcpServers.nomi.env[MCP_CLIENT_ENV],
      after.mcpServers.nomi.env[MCP_CLIENT_PROOF_ENV],
    )).toBe('claude')
    expect(after.mcpServers.nomi.args[0]).toBe('/fake/repo/dist-electron/capabilityCore/mcpNodeLauncher.js')
  })

  it('install 在 ~/.claude.json 不存在时也能建出来', () => {
    expect(fs.existsSync(claudeJson())).toBe(false)
    const result = installMcp()
    expect(result.ok).toBe(true)
    expect(result.backupPath).toBeNull() // 原文件不存在 → 无备份
    const after = JSON.parse(fs.readFileSync(claudeJson(), 'utf8'))
    expect(after.mcpServers.nomi).toBeTruthy()
  })

  it('uninstall 只删 nomi，保留 cocos-creator', () => {
    fs.writeFileSync(claudeJson(), JSON.stringify({ mcpServers: { 'cocos-creator': { command: 'x' } } }))
    installMcp()
    uninstallMcp()
    const after = JSON.parse(fs.readFileSync(claudeJson(), 'utf8'))
    expect(after.mcpServers.nomi).toBeUndefined()
    expect(after.mcpServers['cocos-creator']).toEqual({ command: 'x' })
  })

  it('readMcpInfo 反映 installed 状态 + 给出可复制片段', () => {
    expect(readMcpInfo(0).clients.claude.installed).toBe(false)
    installMcp()
    const info = readMcpInfo(17371)
    expect(info.clients.claude.installed).toBe(true)
    expect(info.rpcRunning).toBe(true)
    expect(info.clients.claude.snippet).toContain('"nomi"')
    expect(info.clients.claude.snippet).toContain('NOMI_MCP_STDIO')
  })

  it('codex：install 写 TOML [mcp_servers.nomi]，保留已有表；uninstall 只删本块', () => {
    const codexPath = path.join(homeDir, '.codex', 'config.toml')
    fs.mkdirSync(path.dirname(codexPath), { recursive: true })
    fs.writeFileSync(codexPath, '[mcp_servers.other]\ncommand = "x"\n')
    installMcp('codex')
    let text = fs.readFileSync(codexPath, 'utf8')
    expect(text).toContain('[mcp_servers.nomi]')
    expect(text).toContain('NOMI_MCP_STDIO = "1"')
    expect(text).toContain(`${MCP_CLIENT_ENV} = "codex"`)
    expect(text).toContain(`${MCP_CLIENT_PROOF_ENV} = "`)
    expect(text).toContain('[mcp_servers.other]') // 别人的块没被动
    expect(readMcpInfo(0).clients.codex.installed).toBe(true)
    uninstallMcp('codex')
    text = fs.readFileSync(codexPath, 'utf8')
    expect(text).not.toContain('[mcp_servers.nomi]')
    expect(text).toContain('[mcp_servers.other]')
    expect(readMcpInfo(0).clients.codex.installed).toBe(false)
  })

  it('codex：升级旧 env 子表时删净整个 nomi 表族，避免生成不可解析的重复 env 键', () => {
    const codexPath = path.join(homeDir, '.codex', 'config.toml')
    fs.mkdirSync(path.dirname(codexPath), { recursive: true })
    fs.writeFileSync(
      codexPath,
      [
        '[mcp_servers.nomi]',
        'command = "/Applications/Old Nomi.app/Contents/MacOS/Nomi"',
        '',
        '[mcp_servers.nomi.env]',
        'NOMI_MCP_STDIO = "1"',
        '',
        '[[notifications]]',
        'kind = "desktop"',
        '',
        '[projects."/Users/example"]',
        'trust_level = "trusted"',
        '',
      ].join('\n'),
    )

    installMcp('codex')
    let text = fs.readFileSync(codexPath, 'utf8')
    expect(text.match(/^\s*\[\s*mcp_servers\.nomi\s*\]\s*$/gm)).toHaveLength(1)
    expect(text).not.toContain('[mcp_servers.nomi.env]')
    expect(text.match(/^env\s*=/gm)).toHaveLength(1)
    expect(text).toContain('[[notifications]]\nkind = "desktop"')
    expect(text).toContain('[projects."/Users/example"]')

    uninstallMcp('codex')
    text = fs.readFileSync(codexPath, 'utf8')
    expect(text).not.toContain('[mcp_servers.nomi')
    expect(text).toContain('[[notifications]]\nkind = "desktop"')
    expect(text).toContain('[projects."/Users/example"]')
  })

  // Codex 的三个默认值对 Nomi 都不成立，漏写任何一个 = 一种「看着接上了其实用不了」：
  // startup 10s 兜不住 Electron 冷启（server 被静默丢弃）｜tool 60s 兜不住真出视频（发消息没反应）｜
  // approval 不写则连「列一下项目」都要人点一次同意。删掉其中任何一行这条测试必红。
  it('codex：必须写足 startup/tool 超时与审批模式（缺任一都会让接入形同虚设）', () => {
    const codexPath = path.join(homeDir, '.codex', 'config.toml')
    installMcp('codex')
    const text = fs.readFileSync(codexPath, 'utf8')
    expect(Number(text.match(/^startup_timeout_sec = (\d+)$/m)![1])).toBeGreaterThan(10)
    expect(Number(text.match(/^tool_timeout_sec = (\d+)$/m)![1])).toBeGreaterThan(60)
    // "writes" = 只对没标 readOnlyHint 的工具弹确认；不可改成 "auto" 绕过写入确认。
    expect(text).toContain('default_tools_approval_mode = "writes"')
  })

  it('cursor：install 写 ~/.cursor/mcp.json 的 mcpServers.nomi（目录/文件自动建），互不影响 claude', () => {
    const cursorPath = path.join(homeDir, '.cursor', 'mcp.json')
    expect(fs.existsSync(cursorPath)).toBe(false)
    installMcp('cursor')
    const after = JSON.parse(fs.readFileSync(cursorPath, 'utf8'))
    expect(after.mcpServers.nomi.command).toBe(process.execPath)
    expect(after.mcpServers.nomi.env.NOMI_MCP_STDIO).toBe('1')
    expect(after.mcpServers.nomi.env[MCP_CLIENT_ENV]).toBe('cursor')
    expect(verifyMcpClient(
      after.mcpServers.nomi.env[MCP_CLIENT_ENV],
      after.mcpServers.nomi.env[MCP_CLIENT_PROOF_ENV],
    )).toBe('cursor')
    expect(readMcpInfo(0).clients.cursor.installed).toBe(true)
    expect(readMcpInfo(0).clients.claude.installed).toBe(false) // 各客户端独立
  })

  it('binds each installed entry to its client instead of trusting a renamed label', () => {
    installMcp('cursor')
    const cursorPath = path.join(homeDir, '.cursor', 'mcp.json')
    const entry = JSON.parse(fs.readFileSync(cursorPath, 'utf8')).mcpServers.nomi
    expect(verifyMcpClient('cursor', entry.env[MCP_CLIENT_PROOF_ENV])).toBe('cursor')
    expect(verifyMcpClient('codex', entry.env[MCP_CLIENT_PROOF_ENV])).toBeNull()
  })

  it('known legacy Claude entry auto-upgrades with backup and preserves unrelated configuration', () => {
    isPackaged = true
    fs.writeFileSync(claudeJson(), JSON.stringify({
      theme: 'dark',
      mcpServers: {
        other: { command: 'other-server' },
        nomi: { command: 'node', args: ['/old/Nomi/scripts/nomi-mcp.mjs'], env: {} },
      },
    }, null, 2))

    const info = readMcpInfo(0)
    expect(info.clients.claude).toMatchObject({
      installed: true,
      configState: 'current',
      launcherKind: 'packaged',
      migration: 'upgraded',
    })
    expect(info.clients.claude.backupPath).toBe(`${claudeJson()}.nomi-backup`)
    const backup = JSON.parse(fs.readFileSync(`${claudeJson()}.nomi-backup`, 'utf8'))
    expect(backup.mcpServers.nomi.args[0]).toContain('scripts/nomi-mcp.mjs')
    const after = JSON.parse(fs.readFileSync(claudeJson(), 'utf8'))
    expect(after.theme).toBe('dark')
    expect(after.mcpServers.other).toEqual({ command: 'other-server' })
    expect(after.mcpServers.nomi.env[MCP_CONFIG_VERSION_ENV]).toBe(MCP_CONFIG_VERSION)
    expect(readMcpInfo(0).clients.claude.migration).toBe('none')
  })

  it('auto-upgrades the direct packaged launcher written by the previous Nomi release', () => {
    isPackaged = true
    fs.writeFileSync(claudeJson(), JSON.stringify({
      mcpServers: {
        nomi: {
          command: '/Applications/Nomi.app/Contents/MacOS/Nomi',
          args: [],
          env: {
            NOMI_MCP_STDIO: '1',
            [MCP_CLIENT_ENV]: 'claude',
            [MCP_CLIENT_PROOF_ENV]: 'previous-release-proof',
          },
        },
      },
    }, null, 2))

    const info = readMcpInfo(0)
    expect(info.clients.claude).toMatchObject({ configState: 'current', migration: 'upgraded' })
    const after = JSON.parse(fs.readFileSync(claudeJson(), 'utf8')).mcpServers.nomi
    expect(after.command).toBe(info.server.command)
    expect(after.args).toEqual(info.server.args)
    expect(after.args[0]).toContain('mcpNodeLauncher.js')
  })

  it('known legacy Codex entry auto-upgrades only the nomi table family', () => {
    isPackaged = true
    const target = path.join(homeDir, '.codex', 'config.toml')
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, [
      '[mcp_servers.other]',
      'command = "keep-me"',
      '',
      '[mcp_servers.nomi]',
      'command = "node"',
      'args = ["/old/Nomi/scripts/nomi-mcp.mjs"]',
      '',
    ].join('\n'))

    const info = readMcpInfo(0)
    expect(info.clients.codex).toMatchObject({ configState: 'current', migration: 'upgraded' })
    const after = fs.readFileSync(target, 'utf8')
    expect(after).toContain('[mcp_servers.other]\ncommand = "keep-me"')
    expect(after).toContain(`${MCP_CONFIG_VERSION_ENV} = "${MCP_CONFIG_VERSION}"`)
    expect(fs.readFileSync(`${target}.nomi-backup`, 'utf8')).toContain('/old/Nomi/scripts/nomi-mcp.mjs')
  })

  it('auto-upgrades a previous packaged Codex entry that uses an env subtable', () => {
    isPackaged = true
    const target = path.join(homeDir, '.codex', 'config.toml')
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, [
      '[mcp_servers.nomi]',
      'command = "/Applications/Nomi.app/Contents/MacOS/Nomi"',
      'args = []',
      '',
      '[mcp_servers.nomi.env]',
      'NOMI_MCP_STDIO = "1"',
      '',
      '[projects."/Users/example"]',
      'trust_level = "trusted"',
      '',
    ].join('\n'))

    const info = readMcpInfo(0)
    expect(info.clients.codex).toMatchObject({ configState: 'current', migration: 'upgraded' })
    const after = fs.readFileSync(target, 'utf8')
    expect(after).not.toContain('[mcp_servers.nomi.env]')
    expect(after).toContain('[projects."/Users/example"]\ntrust_level = "trusted"')
    expect(after).toContain('NOMI_MCP_CONFIG_VERSION = "3"')
  })

  it('unknown custom nomi entry is classified but never silently overwritten', () => {
    isPackaged = true
    const original = JSON.stringify({ mcpServers: { nomi: { command: 'custom-nomi-proxy', args: ['serve'] } } }, null, 2)
    fs.writeFileSync(claudeJson(), original)

    const info = readMcpInfo(0)
    expect(info.clients.claude).toMatchObject({ installed: true, configState: 'custom', migration: 'none' })
    expect(fs.readFileSync(claudeJson(), 'utf8')).toBe(original)
    expect(fs.existsSync(`${claudeJson()}.nomi-backup`)).toBe(false)
  })

  it('does not claim a custom proxy merely because it forwards the old Nomi env marker', () => {
    isPackaged = true
    const original = JSON.stringify({
      mcpServers: {
        nomi: { command: 'custom-nomi-proxy', args: ['serve'], env: { NOMI_MCP_STDIO: '1' } },
      },
    }, null, 2)
    fs.writeFileSync(claudeJson(), original)

    const info = readMcpInfo(0)
    expect(info.clients.claude).toMatchObject({ configState: 'custom', migration: 'none' })
    expect(fs.readFileSync(claudeJson(), 'utf8')).toBe(original)
  })
})

describe('custom MCP client profiles', () => {
  it('records a detected external client with a derived key and empty path', () => {
    recordDetectedMcpClient('WorkBuddy')
    const profiles = listCustomMcpProfiles()
    expect(profiles).toHaveLength(1)
    expect(profiles[0]).toMatchObject({ key: 'workbuddy', label: 'WorkBuddy', detected: true, configPath: '' })
  })

  it('is idempotent for repeated detection of the same name', () => {
    recordDetectedMcpClient('WorkBuddy')
    recordDetectedMcpClient('WorkBuddy')
    expect(listCustomMcpProfiles()).toHaveLength(1)
  })

  it('does not overwrite an already-registered profile with the same key', () => {
    const configuredPath = path.join(homeDir, 'wb.json')
    registerCustomMcpProfile({ key: 'workbuddy', label: 'WorkBuddy', format: 'json', configPath: configuredPath })
    recordDetectedMcpClient('WorkBuddy')
    const profiles = listCustomMcpProfiles()
    expect(profiles).toHaveLength(1)
    expect(profiles[0]).toMatchObject({ detected: false, configPath: configuredPath })
  })
})
