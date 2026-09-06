#!/usr/bin/env node
// 依赖能力清单的生成器与漂移门岗（R29 上游，2026-09-07）。判据住在 dependency-capabilities-lib.mjs。
//
// 干什么：对 docs/engineering/framework-boundaries.json 的 `capabilityInventory.packages` 里
// 登记的每个依赖，从 node_modules 里机器抽「导出符号 + README 标题」→ 能力词表 →
// 落到 docs/engineering/dependency-capabilities.generated.json。
//
// 为什么要它（和人手写的登记表的分工）：登记表只覆盖「已经出过四列表的那几项能力」，
// 天生只包含已知的东西；本清单覆盖「这个依赖到底导出了些什么」，是给还不知道自己不知道的人看的。
//
// 门岗语义（--check）：
//   · 装了的包：版本或词表指纹与清单不符 → 红，逼你重跑生成器（版本升级必然带来能力面变化，
//     这条就是「升级了但没人看新增能力」的拦截点）。
//   · 没装的包：只出 warning，不红。没装 = 抽不出来，红了也只能靠删规则解决，那是假门岗。
//   · 清单里有、登记表里没有的条目：红（陈旧登记会让人以为查过了）。
//
// 用法：
//   node scripts/gen-dependency-capabilities.mjs           重新生成清单
//   node scripts/gen-dependency-capabilities.mjs --check   只比对、不写盘
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  capabilityWords,
  comparePackages,
  extractExportSymbols,
  extractReadmeHeadings,
  fingerprintOf,
} from './dependency-capabilities-lib.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const REGISTRY_FILE = path.join(repoRoot, 'docs/engineering/framework-boundaries.json')
const OUTPUT_FILE = path.join(repoRoot, 'docs/engineering/dependency-capabilities.generated.json')
const DECLARATION = /\.d\.[cm]?ts$/
const MAX_DECLARATION_FILES = 500
const SKIP_DIRECTORIES = new Set(['node_modules', '.bin', '__tests__', 'test', 'tests'])

const rel = (file) => path.relative(repoRoot, file).split(path.sep).join('/')

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}

/** pnpm 的 node_modules 是符号链接森林，resolve 交给 Node 自己做：只找 package.json 的真实位置。 */
function packageDir(name) {
  const direct = path.join(repoRoot, 'node_modules', name)
  return fs.existsSync(path.join(direct, 'package.json')) ? direct : null
}

function declarationFiles(dir) {
  const found = []
  const walk = (current) => {
    if (found.length >= MAX_DECLARATION_FILES) return
    let entries
    try {
      entries = fs.readdirSync(current, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (found.length >= MAX_DECLARATION_FILES) return
      if (entry.name.startsWith('.') || SKIP_DIRECTORIES.has(entry.name)) continue
      const full = path.join(current, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (DECLARATION.test(entry.name)) found.push(full)
    }
  }
  walk(dir)
  return found.sort()
}

function inventoryPackages(registry) {
  const declared = registry?.capabilityInventory?.packages
  if (!Array.isArray(declared) || declared.length === 0) {
    console.error(`✖ ${rel(REGISTRY_FILE)} 缺少 capabilityInventory.packages（要抽哪些依赖的能力词表）`)
    process.exit(1)
  }
  return [...new Set(declared)].sort()
}

function harvest(name) {
  const dir = packageDir(name)
  if (!dir) return { name, status: 'absent' }
  const manifest = readJson(path.join(dir, 'package.json'))
  const files = declarationFiles(dir)
  const symbols = new Set()
  for (const file of files) {
    for (const symbol of extractExportSymbols(fs.readFileSync(file, 'utf8'))) symbols.add(symbol)
  }
  const readmeFile = ['README.md', 'readme.md', 'Readme.md']
    .map((candidate) => path.join(dir, candidate))
    .find((candidate) => fs.existsSync(candidate))
  const headings = readmeFile ? extractReadmeHeadings(fs.readFileSync(readmeFile, 'utf8')) : []
  const words = capabilityWords({ symbols: [...symbols], headings })
  return {
    name,
    status: 'present',
    version: String(manifest.version ?? ''),
    declarationFiles: files.length,
    exportedSymbols: symbols.size,
    readmeHeadings: headings.length,
    capabilityWords: words,
    fingerprint: fingerprintOf({ version: manifest.version, words }),
  }
}

const registry = readJson(REGISTRY_FILE)
const names = inventoryPackages(registry)
const harvested = names.map(harvest)
const present = harvested.filter((entry) => entry.status === 'present')
const absent = harvested.filter((entry) => entry.status === 'absent').map((entry) => entry.name)

const isCheck = process.argv.includes('--check')

if (!isCheck) {
  const stored = fs.existsSync(OUTPUT_FILE) ? readJson(OUTPUT_FILE).packages ?? [] : []
  const byName = new Map(stored.map((entry) => [entry.name, entry]))
  for (const entry of present) byName.set(entry.name, entry)
  // 没装的包保留旧条目：一台没装全的机器不该把别人抽好的词表洗掉。
  const packages = names.map((name) => byName.get(name)).filter(Boolean)
  fs.writeFileSync(OUTPUT_FILE, `${JSON.stringify({
    _comment: [
      '依赖能力清单（R29 上游）：由 scripts/gen-dependency-capabilities.mjs 从 node_modules 机器抽取，请勿手改。',
      '抽的是每个依赖的 .d.ts 导出符号 + README 标题 → 去噪后的「能力词表」。',
      '它回答的问题只有一个：「这个词是不是这个依赖已经管的事」——写四列表（R29）前先看一眼，',
      '别把依赖已经有的能力又写一遍。check:dependency-capabilities 在版本或词表变化时逼你重生成。',
    ],
    generator: 'scripts/gen-dependency-capabilities.mjs',
    packages,
  }, null, 2)}\n`)
  console.log(`✅ 已重写 ${rel(OUTPUT_FILE)}：${present.length} 个包已抽取${absent.length ? `，${absent.length} 个未安装（保留旧条目）：${absent.join(', ')}` : ''}`)
  process.exit(0)
}

if (!fs.existsSync(OUTPUT_FILE)) {
  console.error(`✖ 缺少 ${rel(OUTPUT_FILE)} —— 跑 pnpm run gen:dependency-capabilities`)
  process.exit(1)
}
const stored = readJson(OUTPUT_FILE).packages ?? []
const errors = comparePackages({ generated: present, stored })
for (const entry of stored) {
  if (!names.includes(entry.name)) {
    errors.push(`${entry.name}: 清单里有它，登记表里没有 —— 陈旧登记会让人以为查过了，删掉或补进 capabilityInventory.packages`)
  }
}
for (const name of absent) {
  console.warn(`⚠️ ${name} 未安装，本次跳过比对（抽不出来的东西不该报红，那是假门岗）`)
}
if (errors.length > 0) {
  console.error('✖ 依赖能力清单已过期（R29：依赖升级必然带来能力面变化，重生成一次才看得见）：')
  for (const error of errors) console.error(`  - ${error}`)
  console.error('\n  → 跑 `pnpm run gen:dependency-capabilities`，然后**人眼过一遍 diff**：新增的词就是这次升级多出来的能力。')
  process.exit(1)
}
console.log(`✅ 依赖能力清单：${present.length} 个包与 node_modules 一致${absent.length ? `，${absent.length} 个未安装已跳过` : ''}`)
