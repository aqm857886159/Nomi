// 内置 MCP 客户端注册表 = 全仓唯一 owner。这条测试是它的门岗：
//   ① 每个客户端的每个事实都齐（规范链接 / 配置路径 / 安装痕迹）；
//   ② 默认可信名单从注册表 derive，不再手抄；
//   ③ **仓库里不许再出现第二份名单**——任何 src/electron 生产文件里把 ≥3 个内置 key（可夹着发起方
//      通用词 nomi / external）摆成一个数组/集合，就是又抄了一份（2026-09-14 前有 5 份 + 2 份漏抄；
//      漏抄的那两份让 WorkBuddy 的 handoff 永远 "Invalid handoff owner"）。含别的字面量（如「用 AI 帮我
//      接入」卡的 'other' 分段）的是**按设计挑出的子集**，类型已钉在注册表 key 上，不算抄。
//      check:vocabularies 只扫状态/阶段词表，扫不到客户端名单，故在这里钉。
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

import { DEFAULT_AUTOMATION_POLICY_SETTINGS } from './contracts/automationPolicyContract'
import {
  BUILTIN_MCP_CLIENTS,
  DEFAULT_TRUSTED_MCP_CLIENTS,
  MCP_CLIENT_HOST_ENV_VARS,
  MCP_CLIENT_REGISTRY,
  isBuiltinMcpClient,
  mcpClientConfigFile,
  mcpClientInstallTraces,
  mcpClientLocations,
  resolveMcpClientHostRoot,
  resolveMcpClientPath,
  type McpClientPathContext,
} from './mcpClientRegistry'

const repoRoot = process.cwd()
const REGISTRY_FILE = 'electron/shared/mcpClientRegistry.ts'

function* walk(dir: string): Generator<string> {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) yield* walk(full)
    else if (/\.(ts|tsx|mts)$/.test(entry.name) && !/\.(test|spec|e2e)\./.test(entry.name)) yield full
  }
}

describe('MCP client registry is the only owner of the builtin client list', () => {
  it('registers every fact a client needs, and nothing for pi (official: no built-in MCP)', () => {
    expect(BUILTIN_MCP_CLIENTS.length).toBeGreaterThanOrEqual(5)
    expect(isBuiltinMcpClient('pi')).toBe(false)
    for (const key of BUILTIN_MCP_CLIENTS) {
      const spec = MCP_CLIENT_REGISTRY[key]
      expect(key, key).toMatch(/^[a-z0-9][a-z0-9-]{0,63}$/)
      expect(spec.label.trim(), key).not.toBe('')
      expect(spec.spec, key).toMatch(/^https:\/\//)
      const platforms = Object.keys(spec.configPath) as Array<keyof typeof spec.configPath>
      expect(platforms.length, key).toBeGreaterThan(0)
      for (const platform of platforms) {
        expect(spec.configPath[platform]?.segments.length, `${key}/${platform} config path`).toBeGreaterThan(0)
        expect(spec.installMarkers[platform]?.length, `${key}/${platform} install markers`).toBeGreaterThan(0)
      }
    }
  })

  it('derives the default trusted initiators from the registry', () => {
    expect(DEFAULT_AUTOMATION_POLICY_SETTINGS.trustedHosts).toEqual(['nomi', ...DEFAULT_TRUSTED_MCP_CLIENTS])
    expect(DEFAULT_TRUSTED_MCP_CLIENTS).toEqual(BUILTIN_MCP_CLIENTS.filter((key) => MCP_CLIENT_REGISTRY[key].defaultTrusted))
  })

  it('has no second hand-written copy of the client list anywhere in src/ or electron/', () => {
    const keys = new Set<string>(BUILTIN_MCP_CLIENTS)
    const offenders: string[] = []
    for (const root of ['src', 'electron']) {
      for (const file of walk(path.join(repoRoot, root))) {
        const relative = path.relative(repoRoot, file).split(path.sep).join('/')
        if (relative === REGISTRY_FILE) continue
        const source = fs.readFileSync(file, 'utf8')
        for (const match of source.matchAll(/\[([^[\]]*)\]/g)) {
          const literals = [...match[1].matchAll(/['"]([a-z0-9-]+)['"]/g)].map((m) => m[1])
          const hits = new Set(literals.filter((literal) => keys.has(literal)))
          const onlyHostWords = literals.every((literal) => keys.has(literal) || literal === 'nomi' || literal === 'external')
          if (hits.size >= 3 && onlyHostWords) offenders.push(`${relative}: [${[...hits].join(', ')}]`)
        }
      }
    }
    expect(offenders, 'derive from electron/shared/mcpClientRegistry.ts instead of listing clients again').toEqual([])
  })
})

// R5.5：宿主自己的配置位置变量。用户设了它，宿主读写那个位置——Nomi 必须读写同一处（2026-10-24 前只认主目录）。
describe('host config location follows the host’s own variable', () => {
  const posix = (env: Record<string, string | undefined> = {}, platform: McpClientPathContext['platform'] = 'linux'): McpClientPathContext => ({
    platform,
    env,
    homedir: '/home/u',
    join: path.posix.join,
  })

  it('Claude Code: .claude.json sits in the home dir by default and inside CLAUDE_CONFIG_DIR when it is set', () => {
    expect(mcpClientConfigFile('claude', posix())).toBe('/home/u/.claude.json')
    expect(mcpClientConfigFile('claude', posix({ CLAUDE_CONFIG_DIR: '/work/claude' }))).toBe('/work/claude/.claude.json')
    expect(mcpClientInstallTraces('claude', posix())).toEqual(['/home/u/.claude', '/home/u/.claude.json'])
    expect(mcpClientInstallTraces('claude', posix({ CLAUDE_CONFIG_DIR: '/work/claude' }))).toEqual(['/work/claude', '/work/claude/.claude.json'])
  })

  it('Codex: config.toml sits in ~/.codex by default and in CODEX_HOME when it is set', () => {
    expect(mcpClientConfigFile('codex', posix())).toBe('/home/u/.codex/config.toml')
    expect(mcpClientConfigFile('codex', posix({ CODEX_HOME: '/work/codex' }))).toBe('/work/codex/config.toml')
    expect(mcpClientInstallTraces('codex', posix({ CODEX_HOME: '/work/codex' }))).toEqual(['/work/codex'])
  })

  it('Codex host root follows CODEX_HOME and keeps the documented default for unset or empty values', () => {
    expect(resolveMcpClientHostRoot('codex', posix())).toBe('/home/u/.codex')
    expect(resolveMcpClientHostRoot('codex', posix({ CODEX_HOME: '/work/codex' }))).toBe('/work/codex')
    expect(resolveMcpClientHostRoot('codex', posix({ CODEX_HOME: '' }))).toBe('/home/u/.codex')
  })

  it('an empty variable counts as unset (both hosts: Codex filters empty, Claude Code uses `configDir || home`)', () => {
    expect(mcpClientConfigFile('claude', posix({ CLAUDE_CONFIG_DIR: '' }))).toBe('/home/u/.claude.json')
    expect(mcpClientConfigFile('codex', posix({ CODEX_HOME: '' }))).toBe('/home/u/.codex/config.toml')
  })

  it('every location that names a host variable resolves under it when set, and to the plain default when not', () => {
    for (const { client, platform, location } of mcpClientLocations()) {
      if (!location.hostEnv) continue
      const set = posix({ [location.hostEnv.name]: '/var-root' }, platform)
      expect(resolveMcpClientPath(location, set), `${client}/${platform}`).toBe(path.posix.join('/var-root', ...location.hostEnv.segments))
      expect(resolveMcpClientPath(location, posix({}, platform)), `${client}/${platform}`).toBe(path.posix.join('/home/u', ...location.segments))
    }
  })

  it('names exactly the variables the hosts document; hosts without one stay on their fixed location', () => {
    expect(MCP_CLIENT_HOST_ENV_VARS).toEqual(['CLAUDE_CONFIG_DIR', 'CODEX_HOME'])
    // Claude Desktop / Cursor / WorkBuddy 的官方文档只给固定位置（规范链接在注册表头注释）——加变量要先有出处。
    const fixedOnly = BUILTIN_MCP_CLIENTS.filter((client) => mcpClientLocations().every((entry) => entry.client !== client || !entry.location.hostEnv))
    expect(fixedOnly).toEqual(['claude-desktop', 'cursor', 'workbuddy'])
  })

  it('appData hosts keep the platform rule (macOS Application Support, Windows %APPDATA%)', () => {
    expect(mcpClientConfigFile('claude-desktop', posix({}, 'darwin'))).toBe('/home/u/Library/Application Support/Claude/claude_desktop_config.json')
    expect(mcpClientConfigFile('claude-desktop', { platform: 'win32', env: { APPDATA: 'C:\\Users\\u\\AppData\\Roaming' }, homedir: 'C:\\Users\\u', join: path.win32.join }))
      .toBe('C:\\Users\\u\\AppData\\Roaming\\Claude\\claude_desktop_config.json')
    expect(mcpClientConfigFile('claude-desktop', posix({}, 'linux'))).toBeNull()
  })
})
