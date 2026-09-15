#!/usr/bin/env node
// 规则编号解析门岗（2026-09-14，随 R 索引 30→17 合并一起装）。守一条不变量：
// **家规文件里出现的任何 `R<数字>` 都必须解析得到**——要么是 L1 索引里的现役主号，
// 要么是 L2 里的一行别名节（`## R29 → 见 R5.4`），要么是主号下的子节（`### R5.4`）。
//
// 为什么需要它：这轮把 13 个旧号合进了同族主号。合并的代价是**引用悬空**——
// 旧 PR、根因合同、教训、任务书里全是旧号，如果 L2 不留别名，「R29」就会变成一个
// 谁都查不到的字符串，而查不到的规则等于不存在。审计里那句「不丢东西的机械保证」
// 不能是承诺（R17：登记不是防线），必须是一条会红的判据。
//
// 扫哪些文件：**家规本体 + 每轮注入的 hook + 常驻工程文档**。
// 不扫 docs/plan、docs/research、docs/audit、docs/lessons、docs/fixes 这些**带日期的历史记录**：
// 它们写的是当时的编号，改了就是改历史；它们的换算走 L2 的「编号别名表」和 lessons INDEX 的映射表。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const L1_FILE = 'CLAUDE.md'
const L2_FILE = 'docs/engineering-rules.md'

/** 家规面：这些文件是「现在照着做」的，不是历史记录。 */
const SCANNED = [
  'CLAUDE.md',
  'AGENTS.md',
  'docs/engineering-rules.md',
  'docs/lessons/INDEX.md',
  'docs/engineering/acceptance-walkthrough-doctrine.md',
  'docs/engineering/agent-orchestration-playbook.md',
  'scripts/claude-hooks/self-check.sh',
  'scripts/claude-hooks/completion-check.sh',
  'scripts/claude-hooks/model-doc-check.sh',
]

/**
 * 蓄意不在本仓定义的号——每条写清为什么。
 * 这是本门岗唯一的逃生口，所以它必须小、必须带理由。
 */
const RESERVED = new Map([
  ['R24', 'PR #223 的能力完整性合同保留号；本仓不定义也不复制，避免与 Agent Host 规则形成第二套旁路'],
  ['R27', '多智能体编排手册，正文住 docs/engineering/agent-orchestration-playbook.md（L1 索引有行）'],
  ['R32', '2026-09-14 提案里的「真实测试」没有独立编号，见 L2 的 `## R32 → 见 R13「四件真实」`'],
])

export function parseDefinitions({ l1, l2 }) {
  const l1Numbers = new Set()
  for (const m of l1.matchAll(/^\|\s*(R\d+)\s*\|/gm)) l1Numbers.add(m[1])
  const l2Sections = new Set()
  for (const m of l2.matchAll(/^##\s+(R\d+)\b/gm)) l2Sections.add(m[1])
  const l2Sub = new Set()
  for (const m of l2.matchAll(/^#{3,5}\s+(R\d+(?:\.\d+)+)/gm)) l2Sub.add(m[1])
  const aliases = new Map()
  for (const m of l2.matchAll(/^##\s+(R\d+)\s*→\s*见\s*(R\d+(?:\.\d+)?)?/gm)) aliases.set(m[1], m[2] ?? null)
  const aliasTable = new Set()
  for (const m of l2.matchAll(/^\|\s*(R\d+)\b[^|]*\|/gm)) aliasTable.add(m[1])
  return { l1Numbers, l2Sections, l2Sub, aliases, aliasTable }
}

export function evaluate({ defs, references }) {
  const errors = []
  const { l1Numbers, l2Sections, l2Sub, aliases } = defs

  // ① L1 索引里的每个主号都要有 L2 正文（R27 这类另有正文出处的走 RESERVED）
  for (const n of l1Numbers) {
    if (!l2Sections.has(n) && !RESERVED.has(n)) {
      errors.push(`${L1_FILE} 的索引里有 ${n}，但 ${L2_FILE} 里既没有 \`## ${n}\` 正文也没有别名节`)
    }
  }

  // ② 每条别名都要指到真实存在的落点
  for (const [from, to] of aliases) {
    if (!to) {
      errors.push(`${L2_FILE}：\`## ${from} → 见 …\` 没写清指向哪个号`)
      continue
    }
    const ok = to.includes('.') ? l2Sub.has(to) : l2Sections.has(to) || l1Numbers.has(to)
    if (!ok) errors.push(`${L2_FILE}：${from} 的别名指向 ${to}，但 ${to} 不存在（别名指空 = 引用悬空）`)
  }

  // ③ 家规文件里引用到的每个号都要解析得到
  for (const { file, line, token } of references) {
    const base = token.split('.')[0]
    const resolvable =
      l1Numbers.has(base) || l2Sections.has(base) || RESERVED.has(base) || (token.includes('.') && l2Sub.has(token))
    if (!resolvable) {
      errors.push(
        `${file}:${line} 引用了 ${token}，它既不在 ${L1_FILE} 的索引里、也不是 ${L2_FILE} 的节或别名` +
          `——合并规则时漏了一行别名，或者写错了号`,
      )
    }
    if (token.includes('.') && !l2Sub.has(token)) {
      errors.push(`${file}:${line} 引用了子节 ${token}，但 ${L2_FILE} 里没有 \`### ${token}\``)
    }
  }
  return errors
}

export function collectReferences(readFile, files = SCANNED) {
  const refs = []
  for (const file of files) {
    const text = readFile(file)
    if (text === null) continue
    text.split('\n').forEach((line, i) => {
      for (const m of line.matchAll(/\bR(\d{1,2})(\.\d)?\b/g)) {
        refs.push({ file, line: i + 1, token: `R${m[1]}${m[2] ?? ''}` })
      }
    })
  }
  return refs
}

function main() {
  const read = (file) => {
    const full = path.join(repoRoot, file)
    return fs.existsSync(full) ? fs.readFileSync(full, 'utf8') : null
  }
  const l1 = read(L1_FILE)
  const l2 = read(L2_FILE)
  if (l1 === null || l2 === null) {
    console.error(`✖ 读不到 ${L1_FILE} 或 ${L2_FILE}`)
    process.exit(1)
  }
  const defs = parseDefinitions({ l1, l2 })
  const references = collectReferences(read)
  const errors = evaluate({ defs, references })
  if (errors.length > 0) {
    console.error(`\n✖ check:rule-aliases 红了（${errors.length} 条）：`)
    for (const e of [...new Set(errors)]) console.error(`  - ${e}`)
    console.error(`\n合并规则时的规矩：旧号在 ${L2_FILE} 留一行 \`## R<旧> → 见 R<新>\`，并同步「编号别名表」。`)
    process.exit(1)
  }
  console.log(
    `✔ check:rule-aliases：L1 ${defs.l1Numbers.size} 个主号、L2 ${defs.aliases.size} 条别名、${defs.l2Sub.size} 个子节，${references.length} 处引用全部解析得到`,
  )
}

if (import.meta.url === `file://${process.argv[1]}`) main()
