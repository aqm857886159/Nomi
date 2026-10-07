#!/usr/bin/env node
// 发给**外部 AI** 的说明书里点名的工具，必须真的存在（R17：防线建在最早能拦住的那层）。
//
// ── 抓的是哪一族退化 ────────────────────────────────────────────────────────────────
// 2026-09-21 实测：`agent-skills/nomi-add-model/SKILL.md` 整篇在讲 `nomi_integration` 的六个
// action，而那个工具 2026-09-18 随 #754 就退役了。它是**随包发的**——用户在设置里按一下
// 「复制指引」，拿到的就是这份文本，粘进自己的 Claude Code/Codex。于是用户的 AI 照着调一个
// 不存在的工具，失败，而我们这边一条红都没有：
//   · `check:tool-face` 管的是契约面（谁声明了什么），管不到散文；
//   · `check:rule-aliases` 管的是家规编号；
//   · 单测只核「复制出去的字节流 == 盘上那份」，两份一起错仍然全绿。
// 这一族的共性是「说明书与实现分两处、分歧不报错」，和本仓其它几条棘轮同源。
//
// ── 判据 ──────────────────────────────────────────────────────────────────────────
// 扫 SKILL.md 与给 agent 的接入文档，取出所有 `nomi_*` 形状的词，每一个都必须能在
// `MCP_TOOL_RESOLVER` 里解析到（或在下面的「不是工具名」白名单里，且理由写在旁边）。
// 棘轮：`scripts/agent-facing-tool-names-baseline.json` 只减不增。
//
// **加规则先验它会红**：落地时在 nomi-add-model/SKILL.md 里塞一个 `nomi_integration`，
// 实跑报 1 处红（命令与输出记在 scratchpad/report-lane-mcp.md）。
//
// 用法：node scripts/check-agent-facing-tool-names.mjs
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const BASELINE_FILE = path.join(repoRoot, 'scripts/agent-facing-tool-names-baseline.json')

/** 扫哪些文件：随包发给外部 AI 的说明书，以及那份「把它发给你的 agent」的文档。 */
const SCAN = [
  { dir: 'agent-skills', match: /(?:^|\/)SKILL\.md$/ },
  { dir: 'skills', match: /(?:^|\/)SKILL\.md$/ },
  { file: 'docs/integrate-with-your-agent.md' },
]

/**
 * 长得像工具名、但不是工具名的词。每一条都要写清它是什么——白名单一旦没有理由，
 * 下一个人就会把真的漏网之鱼加进来。
 */
const NOT_TOOL_NAMES = new Map([
  ['nomi_mcp_stdio', '环境变量 NOMI_MCP_STDIO 的小写形态'],
  ['nomi_projects_dir', '环境变量'],
  ['nomi_settings_dir', '环境变量'],
  ['nomi_capability_dir', '环境变量'],
  ['nomi_e2e', '环境变量'],
  ['nomi_run_data', 'structuredContent 里的投影字段名，不是工具'],
])

function listFiles() {
  const out = []
  for (const entry of SCAN) {
    if (entry.file) {
      if (fs.existsSync(path.join(repoRoot, entry.file))) out.push(entry.file)
      continue
    }
    const root = path.join(repoRoot, entry.dir)
    if (!fs.existsSync(root)) continue
    for (const found of fs.readdirSync(root, { recursive: true, encoding: 'utf8' })) {
      const relative = `${entry.dir}/${String(found).split(path.sep).join('/')}`
      if (entry.match.test(relative)) out.push(relative)
    }
  }
  return out
}

const TOOL_TOKEN = /\bnomi_[a-z0-9]+(?:_[a-z0-9]+)*\b/g

async function main() {
  const files = listFiles()
  console.log(`scanned=${files.length}`)
  const { MCP_TOOL_RESOLVER } = await import('../electron/capabilityCore/mcpToolCatalog.ts')
  const live = new Set(MCP_TOOL_RESOLVER.list().map((tool) => tool.name))
  const findings = []
  for (const relative of listFiles()) {
    const text = fs.readFileSync(path.join(repoRoot, relative), 'utf8')
    const seen = new Set()
    for (const match of text.matchAll(TOOL_TOKEN)) {
      const token = match[0]
      if (seen.has(token) || live.has(token) || NOT_TOOL_NAMES.has(token)) continue
      seen.add(token)
      const line = text.slice(0, match.index).split('\n').length
      findings.push(`${relative}:${line} 点名了 \`${token}\`，而 tools/list 上没有这个工具`)
    }
  }
  const baseline = fs.existsSync(BASELINE_FILE)
    ? JSON.parse(fs.readFileSync(BASELINE_FILE, 'utf8'))
    : { allowed: [] }
  const allowed = new Set(baseline.allowed || [])
  const fresh = findings.filter((finding) => !allowed.has(finding))
  if (fresh.length > 0) {
    console.error(`✖ check:agent-facing-tool-names：${fresh.length} 处说明书点名了不存在的工具：`)
    for (const finding of fresh) console.error(`   · ${finding}`)
    console.error('  这份文本是**随包发给用户的 AI** 的。修法是把名字改对，不是加进基线。')
    process.exitCode = 1
    return
  }
  const stale = [...allowed].filter((entry) => !findings.includes(entry))
  if (stale.length > 0) {
    console.error(`✖ check:agent-facing-tool-names：基线里有 ${stale.length} 条已经不成立（棘轮只减不增，请删掉它们）：`)
    for (const entry of stale) console.error(`   · ${entry}`)
    process.exitCode = 1
    return
  }
  console.log(`✅ check:agent-facing-tool-names 通过（扫 ${files.length} 份说明书，${live.size} 个在册工具，欠账 ${allowed.size}）。`)
}

void main()
