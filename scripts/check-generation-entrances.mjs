#!/usr/bin/env node
// 生成入口门岗（棘轮：只减不增）——R17「能让门岗拦的别留给人」。
//
// 抓的是这一类：**有人新长出一条能发出供应商生成请求的路，而没有人去比它和别的入口发的是不是同一串字节。**
// 2026-09-21 两轮横扫的结论是「一个语义没有主人 ⇒ 每个需要它的地方各自重新回答一遍 ⇒ 重新回答不报错」。
// 对等矩阵（electron/parity/generationParity.matrix.test.ts）负责「发的是不是同一串」，
// 这个门岗负责「有没有第 N+1 条路，而矩阵不知道」。
//
// 三条判据：
//   ① 反向扫：`electron/` + `src/` 里所有能组装或发出生成请求的调用点（见 DISPATCH_SYMBOLS），
//      必须逐条出现在 scripts/generation-entrances-ledger.json 里。**新入口不登记 ⇒ 红。**
//      登记表里已经消失的条目也红（否则变成永久豁免）；调用次数只许减不许增。
//   ② 每条登记必须给出裁决：`entrances`（必须是 electron/parity/generationEntrances.ts 里真实存在的 id）
//      或 `reason`（为什么它不是一个用户可达的生成入口）。二选一，不许都空。
//   ③ 矩阵形状对账：登记表记着「几个入口 × 几个用例」，与那两个源文件里的真实条数必须相等。
//      加了入口不加用例覆盖、或加了入口忘了跑矩阵，都在这里红。
//
// 期望值（每格该发什么）**不在这个门岗里**——判对错是矩阵测试的事，门岗只数格子。
//
// 用法：node ./scripts/check-generation-entrances.mjs
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const LEDGER = path.join(repoRoot, 'scripts', 'generation-entrances-ledger.json')
const ENTRANCES_FILE = path.join(repoRoot, 'electron', 'parity', 'generationEntrances.ts')
const CASES_FILE = path.join(repoRoot, 'electron', 'parity', 'parityCases.ts')

/** 能组装或发出一次供应商生成请求的符号。加一个符号＝把一类门纳入视野，只增不减。 */
export const DISPATCH_SYMBOLS = ['runTask', 'runTaskFn', 'buildProfileHttpRequest', 'buildRequest', 'submitWithContext']
const ROOTS = ['electron', 'src']
const SKIP = /\.test\.tsx?$|\.test\.mts$|[\\/]parity[\\/]/

function* walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) { if (entry.name !== 'node_modules') yield* walk(full); continue }
    if (!/\.tsx?$/.test(entry.name) || SKIP.test(full)) continue
    yield full
  }
}

/** 扫出 `文件::被调用表达式` → 次数。身份存的是表达式文本（`deps.runTask`），不是行号：行号会随无关改动漂移。 */
export function scanDispatchSites(root = repoRoot) {
  const pattern = new RegExp(
    String.raw`(?:^|[^A-Za-z0-9_$])((?:[A-Za-z_$][A-Za-z0-9_$]*\.)?(?:${DISPATCH_SYMBOLS.join('|')}))\s*\(`,
    'g',
  )
  const hits = new Map()
  for (const dir of ROOTS) {
    const base = path.join(root, dir)
    if (!fs.existsSync(base)) continue
    for (const file of walk(base)) {
      const relative = path.relative(root, file).split(path.sep).join('/')
      for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
        if (/^\s*(\*|\/\/)/.test(line)) continue
        for (const match of line.matchAll(pattern)) {
          const callee = match[1]
          const escaped = callee.replace(/\./g, '\\.')
          if (new RegExp(String.raw`(function|async)\s+${escaped}\s*\(`).test(line)) continue
          const key = `${relative}::${callee}`
          hits.set(key, (hits.get(key) ?? 0) + 1)
        }
      }
    }
  }
  return hits
}

const countLiterals = (source, pattern) => [...source.matchAll(pattern)].length

export function checkGenerationEntrances(root = repoRoot) {
  const problems = []
  const ledger = JSON.parse(fs.readFileSync(path.join(root, 'scripts', 'generation-entrances-ledger.json'), 'utf8'))
  const entrancesSource = fs.readFileSync(path.join(root, 'electron', 'parity', 'generationEntrances.ts'), 'utf8')
  const casesSource = fs.readFileSync(path.join(root, 'electron', 'parity', 'parityCases.ts'), 'utf8')
  const entranceIds = new Set([...entrancesSource.matchAll(/^\s{4}id: "([^"]+)",$/gm)].map((m) => m[1]))
  const caseIds = new Set([...casesSource.matchAll(/^\s{4}id: "([^"]+)",$/gm)].map((m) => m[1]))

  // ① 反向扫
  const scanned = scanDispatchSites(root)
  const registered = new Map(ledger.sites.map((site) => [site.site, site]))
  for (const [key, count] of [...scanned].sort()) {
    const entry = registered.get(key)
    if (!entry) {
      problems.push(`未登记的生成调用点: ${key}（×${count}）—— 它能发出供应商生成请求，却不在对等矩阵的视野里。`
        + ' 到 scripts/generation-entrances-ledger.json 登记它：给 entrances（矩阵要跑的入口 id）或 reason（为什么它不是生成入口）。')
      continue
    }
    if (count > entry.count) problems.push(`${key} 的调用点从 ${entry.count} 涨到 ${count}：新长出来的那一处也要有裁决。`)
  }
  for (const [key, entry] of registered) {
    if (!scanned.has(key)) problems.push(`登记表里的 ${key} 已经不存在（${entry.entrances?.join('/') ?? entry.reason}）：同 commit 删掉这一行，别留成永久豁免。`)
  }

  // ② 每条登记都要有裁决
  for (const site of ledger.sites) {
    const hasEntrances = Array.isArray(site.entrances) && site.entrances.length > 0
    const hasReason = typeof site.reason === 'string' && site.reason.trim().length > 0
    if (!hasEntrances && !hasReason) problems.push(`${site.site} 既没有 entrances 也没有 reason：必须二选一。`)
    for (const id of site.entrances ?? []) {
      if (!entranceIds.has(id)) problems.push(`${site.site} 指向的入口 ${id} 不在 electron/parity/generationEntrances.ts 里。`)
    }
  }

  // ③ 矩阵形状对账
  if (ledger.matrix?.entrances !== entranceIds.size) {
    problems.push(`入口登记表有 ${entranceIds.size} 个入口，ledger.matrix.entrances 写的是 ${ledger.matrix?.entrances}：`
      + ' 新入口必须同时进矩阵，否则它发什么没人比。')
  }
  if (ledger.matrix?.cases !== caseIds.size) {
    problems.push(`用例表有 ${caseIds.size} 个用例，ledger.matrix.cases 写的是 ${ledger.matrix?.cases}。`)
  }
  for (const entrance of [...entranceIds]) {
    if (!entrancesSource.includes(`"${entrance}"`)) problems.push(`入口 ${entrance} 解析异常。`)
  }
  // 每个入口的 dispatchSite 文件必须是扫到过的那些文件之一（入口不能指向一个没人发请求的地方）。
  const dispatchFiles = new Set([...scanned.keys()].map((key) => key.split('::')[0]))
  for (const match of entrancesSource.matchAll(/dispatchSite: "([^":]+)/g)) {
    if (!dispatchFiles.has(match[1])) problems.push(`入口登记的 dispatchSite ${match[1]} 不在反向扫到的调用点文件里。`)
  }
  return problems
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const problems = checkGenerationEntrances()
  if (problems.length) {
    console.error('✗ 生成入口门岗（check:generation-entrances）：')
    for (const problem of problems) console.error(`  · ${problem}`)
    console.error(`\n  登记表：${path.relative(repoRoot, LEDGER)}`)
    console.error(`  入口表：${path.relative(repoRoot, ENTRANCES_FILE)}`)
    console.error(`  用例表：${path.relative(repoRoot, CASES_FILE)}`)
    process.exit(1)
  }
  console.log('✓ 生成入口门岗：每个能发出供应商生成请求的调用点都有裁决，矩阵形状对账一致。')
}
