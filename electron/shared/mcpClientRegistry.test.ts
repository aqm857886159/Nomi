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

import { DEFAULT_AUTOMATION_POLICY_SETTINGS } from '../settings/automationPolicyContract'
import {
  BUILTIN_MCP_CLIENTS,
  DEFAULT_TRUSTED_MCP_CLIENTS,
  MCP_CLIENT_REGISTRY,
  isBuiltinMcpClient,
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
