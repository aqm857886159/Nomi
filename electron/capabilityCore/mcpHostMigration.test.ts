// 第 3 段（宿主配置迁移到本机 HTTP）的必红测试。合同见 docs/plan/2026-10-09-mcp-host-migration.md。
// 全部走临时 HOME / 临时 APPDATA / 临时 capability 目录；不碰任何真实宿主配置。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let homeDir = ''
const originalExecPath = process.execPath

vi.mock('electron', () => ({
  app: { getAppPath: () => path.join(homeDir, 'repo'), getPath: () => homeDir, getVersion: () => '9.9.9', get isPackaged() { return true } },
}))
vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>()
  return { ...actual, default: { ...actual, homedir: () => homeDir }, homedir: () => homeDir }
})

import { installMcp, readMcpInfo, repairStaleMcpConfigs } from './mcpConfig'
import {
  listMigratableMcpHosts,
  migrateMcpHostsToHttp,
  restorePreMigrationMcpConfig,
} from './mcpHostMigration'
import { builtinMcpClientConfigPath } from './mcpDetectedClients'
import { MCP_HTTP_DEFAULT_PORT, mcpHttpUrl, writeMcpHttpEndpoint } from './mcpHttpEndpoint'
import { CAPABILITY_DIR_ENV, MCP_CLIENT_ENV, MCP_CLIENT_PROOF_ENV, ensureToken, verifyMcpClient } from './security'
import { BUILTIN_MCP_CLIENTS, type BuiltinMcpClient } from '../shared/mcpClientRegistry'

const PREMIGRATE = '.nomi-backup-premigrate'
const EIO = () => Object.assign(new Error('io'), { code: 'EIO' })
const roots: string[] = []
/** 本平台真有配置路径的内置宿主（Linux 没有 Claude Desktop）。 */
const HOSTS = BUILTIN_MCP_CLIENTS.filter((c) => c !== 'claude-desktop' || process.platform !== 'linux')

function cfg(client: BuiltinMcpClient): string {
  // 路径解析跟着 beforeEach 里替换过的 HOME / APPDATA 走
  return builtinMcpClientConfigPath(client)!
}
function bytes(file: string): Buffer | null {
  return fs.existsSync(file) ? fs.readFileSync(file) : null
}
/** 摆好一个「装过、且已写着 Nomi 旧 stdio 条目、并带一个别的服务器」的宿主。 */
function seedStdioHost(client: BuiltinMcpClient): void {
  const target = cfg(client)
  fs.mkdirSync(path.dirname(target), { recursive: true })
  if (client !== 'claude') fs.writeFileSync(path.join(path.dirname(target), 'installed-marker'), '1')
  if (client === 'codex') {
    fs.writeFileSync(target, '[mcp_servers.other]\ncommand = "npx"\nargs = ["x"]\n\n[profiles.p]\nmodel = "m"\n')
  } else {
    fs.writeFileSync(target, JSON.stringify({ theme: 'keep', mcpServers: { other: { command: 'npx', args: ['x'] } } }, null, 2))
  }
  expect(installMcp(client).ok).toBe(true)
}
function seedAll(): void {
  for (const c of HOSTS) seedStdioHost(c)
}
function snapshotAll(): Map<string, Buffer | null> {
  return new Map(HOSTS.map((c) => [c, bytes(cfg(c))]))
}
function noPremigrateFiles(): boolean {
  return HOSTS.every((c) => !fs.existsSync(`${cfg(c)}${PREMIGRATE}`))
}

beforeEach(() => {
  homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-mcpmig-'))
  roots.push(homeDir)
  const appCommand = path.join(homeDir, process.platform === 'win32' ? 'Nomi.exe' : 'Nomi')
  Object.defineProperty(process, 'execPath', { value: appCommand, configurable: true })
  // 打包态：启动修复只在有可持久的打包启动器时才会重写（开发态启动器直接跳过）
  const script = process.platform === 'darwin'
    ? path.join(homeDir, 'Current Nomi.app', 'Contents', 'Resources', 'app.asar', 'dist-electron', 'capabilityCore', 'mcpNodeLauncher.js')
    : path.join(homeDir, 'resources', 'app.asar', 'dist-electron', 'capabilityCore', 'mcpNodeLauncher.js')
  for (const file of [appCommand, script]) {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, '', { mode: 0o755 })
  }
  vi.stubEnv(CAPABILITY_DIR_ENV, path.join(homeDir, '.nomi-cap'))
  vi.stubEnv('APPDATA', path.join(homeDir, 'AppData', 'Roaming'))
  vi.stubEnv('XDG_CONFIG_HOME', path.join(homeDir, '.config'))
  // 服务端自己选端口的函数认显式覆盖；本进程在这个端口上「活着」= 端点文件指向它且 pid 是自己
  vi.stubEnv('NOMI_MCP_HTTP_PORT', String(MCP_HTTP_DEFAULT_PORT))
  writeMcpHttpEndpoint(MCP_HTTP_DEFAULT_PORT)
  fs.mkdirSync(path.join(homeDir, '.claude'), { recursive: true })
  fs.writeFileSync(path.join(homeDir, '.claude', 'installed-marker'), '1')
  ensureToken()
})
afterEach(() => {
  Object.defineProperty(process, 'execPath', { value: originalExecPath, configurable: true })
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  for (const r of roots.splice(0)) fs.rmSync(r, { recursive: true, force: true })
})

describe('不点同意 = 零改动', () => {
  it('读状态、列可迁移宿主、启动修复：五个宿主配置的字节一个都不变，也不产生迁移前备份', () => {
    seedAll()
    const before = snapshotAll()
    readMcpInfo(0)
    listMigratableMcpHosts()
    repairStaleMcpConfigs()
    for (const c of HOSTS) expect(bytes(cfg(c)), c).toEqual(before.get(c))
    expect(noPremigrateFiles()).toBe(true)
  })

  it('启动修复永远不把 stdio 改成 HTTP：条目过期被修时仍是 stdio 形状', () => {
    seedAll()
    // 把条目的身份印记换成错的 → auth-stale，启动修复会重写它们
    for (const c of HOSTS) {
      const file = cfg(c)
      const text = fs.readFileSync(file, 'utf8')
      const tampered = text.replace(/(NOMI_MCP_CLIENT_PROOF"?\s*[:=]\s*")[^"]+/, '$1tampered')
      expect(tampered, c).not.toBe(text)
      fs.writeFileSync(file, tampered)
    }
    const result = repairStaleMcpConfigs()
    expect(result.changed).toBe(true) // 确实走了重写路径，下面的断言才有意义
    for (const c of HOSTS) {
      const text = fs.readFileSync(cfg(c), 'utf8')
      expect(text, c).not.toContain(mcpHttpUrl(MCP_HTTP_DEFAULT_PORT))
      expect(text, c).not.toMatch(/http_headers|"headers"|"type"\s*:\s*"http"/)
      expect(text, c).toContain('NOMI_MCP_STDIO')
    }
    expect(noPremigrateFiles()).toBe(true)
  })
})

describe('同意后：按宿主写不同形状，保留别的服务器', () => {
  it('列出的是真有旧 stdio 条目、能迁移的宿主；WorkBuddy 不在其中，没有 Nomi 条目的宿主也不在', () => {
    seedAll()
    const listed = listMigratableMcpHosts()
    expect(listed).not.toContain('workbuddy')
    for (const c of ['claude', 'codex', 'cursor'] as const) expect(listed).toContain(c)
    fs.rmSync(cfg('cursor'))
    expect(listMigratableMcpHosts()).not.toContain('cursor')
  })

  it('Claude Code / Cursor：url + 身份头，proof 验得过；其它服务器与顶层字段原样保留', () => {
    seedAll()
    const results = migrateMcpHostsToHttp(['claude', 'cursor'])
    expect(results.map((r) => r.ok)).toEqual([true, true])
    const claude = JSON.parse(fs.readFileSync(cfg('claude'), 'utf8'))
    expect(claude.theme).toBe('keep')
    expect(claude.mcpServers.other).toEqual({ command: 'npx', args: ['x'] })
    expect(claude.mcpServers.nomi.type).toBe('http')
    expect(claude.mcpServers.nomi.url).toBe(mcpHttpUrl(MCP_HTTP_DEFAULT_PORT))
    expect(claude.mcpServers.nomi.command).toBeUndefined()
    const h = claude.mcpServers.nomi.headers
    expect(verifyMcpClient(h['x-nomi-mcp-client'], h['x-nomi-mcp-client-proof'])).toBe('claude')
    const cursor = JSON.parse(fs.readFileSync(cfg('cursor'), 'utf8'))
    expect(cursor.mcpServers.other).toEqual({ command: 'npx', args: ['x'] })
    expect(cursor.mcpServers.nomi.url).toBe(mcpHttpUrl(MCP_HTTP_DEFAULT_PORT))
    expect(cursor.mcpServers.nomi.command).toBeUndefined()
    const ch = cursor.mcpServers.nomi.headers
    expect(verifyMcpClient(ch['x-nomi-mcp-client'], ch['x-nomi-mcp-client-proof'])).toBe('cursor')
  })

  it('Codex：TOML url + http_headers，不再有 command；其它表保留', () => {
    seedAll()
    expect(migrateMcpHostsToHttp(['codex'])[0].ok).toBe(true)
    const text = fs.readFileSync(cfg('codex'), 'utf8')
    expect(text).toContain('[mcp_servers.other]')
    expect(text).toContain('[profiles.p]')
    const block = text.slice(text.indexOf('[mcp_servers.nomi]'))
    expect(block).toContain(`url = "${mcpHttpUrl(MCP_HTTP_DEFAULT_PORT)}"`)
    expect(block).toMatch(/http_headers = \{[^}]*x-nomi-mcp-client/)
    expect(block).not.toMatch(/^command\s*=/m)
    expect(text.match(/\[mcp_servers\.nomi\]/g)).toHaveLength(1)
  })

  it.skipIf(!HOSTS.includes('claude-desktop'))('Claude Desktop：写 stdio→HTTP 转发口，不写 url', () => {
    seedAll()
    expect(migrateMcpHostsToHttp(['claude-desktop'])[0]).toMatchObject({ ok: true, client: 'claude-desktop' })
    const entry = JSON.parse(fs.readFileSync(cfg('claude-desktop'), 'utf8')).mcpServers.nomi
    expect(entry.url).toBeUndefined()
    expect(entry.args.join(' ')).toMatch(/mcpHttpForwarder\.js/)
    expect(entry.env.ELECTRON_RUN_AS_NODE).toBe('1')
    expect(entry.env.NOMI_MCP_APP_COMMAND).toBeUndefined() // 转发口不冷启 Nomi
    expect(verifyMcpClient(entry.env[MCP_CLIENT_ENV], entry.env[MCP_CLIENT_PROOF_ENV])).toBe('claude-desktop')
  })

  it('WorkBuddy 保持 stdio：请求迁移被拒，文件字节不变', () => {
    seedAll()
    const before = bytes(cfg('workbuddy'))
    expect(migrateMcpHostsToHttp(['workbuddy'])[0]).toMatchObject({ ok: false, reason: 'not-migratable' })
    expect(bytes(cfg('workbuddy'))).toEqual(before)
  })
})

describe('新连接方式此刻用不了：拒绝迁移，宿主保持 stdio', () => {
  it('端点文件不存在（服务没起来 / 端口被占没记下）：全部报 http-unavailable，字节不变，没有备份', () => {
    seedAll()
    fs.rmSync(path.join(homeDir, '.nomi-cap', 'mcp-http.json'))
    const before = snapshotAll()
    const results = migrateMcpHostsToHttp(['claude', 'codex', 'cursor'])
    expect(results.map((r) => (r.ok ? 'ok' : r.reason))).toEqual(['http-unavailable', 'http-unavailable', 'http-unavailable'])
    for (const c of HOSTS) expect(bytes(cfg(c)), c).toEqual(before.get(c))
    expect(noPremigrateFiles()).toBe(true)
  })

  it('端点文件指向别的端口，或写它的进程已经死了：同样拒绝', () => {
    seedAll()
    const before = bytes(cfg('claude'))
    writeMcpHttpEndpoint(MCP_HTTP_DEFAULT_PORT + 1)
    expect(migrateMcpHostsToHttp(['claude'])[0]).toMatchObject({ ok: false, reason: 'http-unavailable' })
    const file = path.join(homeDir, '.nomi-cap', 'mcp-http.json')
    fs.writeFileSync(file, JSON.stringify({ url: mcpHttpUrl(MCP_HTTP_DEFAULT_PORT), port: MCP_HTTP_DEFAULT_PORT, pid: 2147483000 }))
    expect(migrateMcpHostsToHttp(['claude'])[0]).toMatchObject({ ok: false, reason: 'http-unavailable' })
    expect(bytes(cfg('claude'))).toEqual(before)
  })

  it('显式要随机端口（0）不是稳定地址：拒绝，绝不把临时端口写进宿主', () => {
    seedAll()
    vi.stubEnv('NOMI_MCP_HTTP_PORT', '0')
    const before = bytes(cfg('claude'))
    expect(migrateMcpHostsToHttp(['claude'])[0]).toMatchObject({ ok: false, reason: 'http-unavailable' })
    expect(bytes(cfg('claude'))).toEqual(before)
  })
})

describe('失败只影响那一个宿主，且原文件一个字节都不动', () => {
  it('配置不是合法 JSON：拒绝，原样保留，结果里有原因；别的宿主照常迁移', () => {
    seedAll()
    fs.writeFileSync(cfg('cursor'), '{ not json')
    const before = bytes(cfg('cursor'))
    const results = migrateMcpHostsToHttp(['cursor', 'claude'])
    expect(results[0]).toMatchObject({ client: 'cursor', ok: false, reason: 'config-unreadable' })
    expect(results[1]).toMatchObject({ client: 'claude', ok: true })
    expect(bytes(cfg('cursor'))).toEqual(before)
    expect(fs.existsSync(`${cfg('cursor')}.nomi-tmp`)).toBe(false)
  })

  it('迁移前备份写不出来：不改原文件，报 backup-failed', () => {
    seedAll()
    const before = bytes(cfg('claude'))
    const real = fs.copyFileSync
    vi.spyOn(fs, 'copyFileSync').mockImplementation(((src: fs.PathLike, dest: fs.PathLike, ...rest: never[]) => {
      if (String(dest).endsWith(PREMIGRATE)) throw EIO()
      return real(src, dest, ...rest)
    }) as typeof fs.copyFileSync)
    expect(migrateMcpHostsToHttp(['claude'])[0]).toMatchObject({ ok: false, reason: 'backup-failed' })
    expect(bytes(cfg('claude'))).toEqual(before)
  })

  it('临时文件换名失败：不改原文件，报 write-failed，不留临时文件', () => {
    seedAll()
    const before = bytes(cfg('codex'))
    vi.spyOn(fs, 'renameSync').mockImplementation(() => { throw EIO() })
    expect(migrateMcpHostsToHttp(['codex'])[0]).toMatchObject({ ok: false, reason: 'write-failed' })
    expect(bytes(cfg('codex'))).toEqual(before)
    expect(fs.existsSync(`${cfg('codex')}.nomi-tmp`)).toBe(false)
  })
})

describe('迁移前备份与恢复', () => {
  it('备份是迁移前逐字节原文；之后再写（重装、再迁移）不覆盖它', () => {
    seedAll()
    const original = bytes(cfg('claude'))!
    expect(migrateMcpHostsToHttp(['claude'])[0].ok).toBe(true)
    expect(bytes(`${cfg('claude')}${PREMIGRATE}`)).toEqual(original)
    expect(installMcp('claude').ok).toBe(true) // 用户之后又点了「重新连接」，.nomi-backup 会被换掉
    expect(migrateMcpHostsToHttp(['claude'])[0].ok).toBe(true)
    expect(bytes(`${cfg('claude')}${PREMIGRATE}`)).toEqual(original)
  })

  it('恢复后与迁移前逐字节一致（JSON 和 TOML 各一）', () => {
    seedAll()
    const originals = new Map<string, Buffer | null>([['claude', bytes(cfg('claude'))], ['codex', bytes(cfg('codex'))]])
    migrateMcpHostsToHttp(['claude', 'codex'])
    expect(bytes(cfg('claude'))).not.toEqual(originals.get('claude'))
    for (const c of ['claude', 'codex'] as const) {
      expect(restorePreMigrationMcpConfig(c)).toMatchObject({ ok: true })
      expect(bytes(cfg(c)), c).toEqual(originals.get(c))
    }
  })

  it('恢复也是原子写：换名失败时迁移后的文件原样保留，如实报错', () => {
    seedAll()
    migrateMcpHostsToHttp(['claude'])
    const migrated = bytes(cfg('claude'))
    vi.spyOn(fs, 'renameSync').mockImplementation(() => { throw EIO() })
    expect(restorePreMigrationMcpConfig('claude')).toMatchObject({ ok: false, reason: 'write-failed' })
    expect(bytes(cfg('claude'))).toEqual(migrated)
  })

  it('没有迁移前备份：报 no-backup，文件不动', () => {
    seedAll()
    const before = bytes(cfg('claude'))
    expect(restorePreMigrationMcpConfig('claude')).toMatchObject({ ok: false, reason: 'no-backup' })
    expect(bytes(cfg('claude'))).toEqual(before)
  })
})
