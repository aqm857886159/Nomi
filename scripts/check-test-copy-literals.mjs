#!/usr/bin/env node
// 测试抄文案门岗（2026-10-09，复盘见 docs/engineering/direction-check-2026-10-09-copy-literals-in-tests.md）。
//
// 抓的是：测试 / 走查 / 冒烟（含 tests/ 下的 json 豁免表）里，字符串或正则字面量**一字不差地等于**词典里某条界面文案。
// 为什么拦：文案是产品决策，会改；测试手抄一份，就有两份真相——#1099「界面不谈钱」改词时，别处手抄的旧文案
// 一轮一轮撞红，一个 PR 拖到第 9 轮。测试要守的是「界面显示的 = 词典里那条键的值」，不是某句话的字面。
//
// 改法只有一种：从词典按键取值——
//   · 渲染层文案：uiText(locale, '键')（tests/ux/full-walk/invariants.mjs）；
//   · 主进程文案：desktopT('键', 值)（electron/desktopStrings.ts）；
//   · 按钮 / 控件：toHaveAccessibleName(uiText(...)) 按名字认，别拿整段可见文字比（里面可能有键帽、图标字）。
//
// 按棘轮跑：存量按文件计数进基线，只减不增；新文件、或某个文件变多就红。describe / it / test 的标题不算。
// 允许清单只给词表测试本身（它们要拿真实说法验词表会红）。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
export const BASELINE_FILE = path.join(repoRoot, 'scripts', 'test-copy-literals-baseline.json')

/** 词表测试：拿真实说法验「词表会红 / 不误报」，抄文案是它的本职。只此几份，不许往里加普通测试。 */
export const ALLOWLIST = Object.freeze([
  'tests/ux/full-walk/outcomeText.test.mjs',
  'scripts/check-i18n-no-cost-claims.node-test.mjs',
  'scripts/check-test-copy-literals.node-test.mjs',
])

export const FIX_HINT = [
  '  → 别抄文案，按键从词典取值：',
  "    渲染层 uiText(locale, '键')（tests/ux/full-walk/invariants.mjs）；主进程 desktopT('键', 值)（electron/desktopStrings.ts）；",
  '    按钮 / 控件用 toHaveAccessibleName(uiText(...)) 按名字认，不拿整段可见文字比。',
].join('\n')

const SKIP_DIRS = new Set(['node_modules', 'dist', 'dist-electron', '.git', 'artifacts', 'outputs', 'release', '.tmp'])
const TEST_FILE = /\.(?:test|spec|node-test)\.[cm]?[jt]sx?$/
const UNDER_TESTS = /^tests\/.*\.(?:[cm]?[jt]sx?|json)$/

/** 测试 / 走查 / 冒烟文件（相对仓库根、正斜杠）。 */
export function collectTestFiles(root = repoRoot) {
  const files = []
  const walk = (dir) => {
    if (!fs.existsSync(dir)) return
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (SKIP_DIRS.has(entry.name)) continue
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) { walk(full); continue }
      const rel = path.relative(root, full).replaceAll('\\', '/')
      if (TEST_FILE.test(rel) || UNDER_TESTS.test(rel)) files.push(rel)
    }
  }
  for (const top of ['src', 'electron', 'scripts', 'tests', 'evals', 'packages']) walk(path.join(root, top))
  return files.sort()
}

const CJK = /[㐀-鿿]/
/** 够长才算「一句文案」：中文 ≥4 个字（不算标点空白），英文 ≥14 个字符且有空格。短词（「设置」「Save」）分不清是文案还是数据，不管。 */
export function isSentence(text) {
  if (CJK.test(text)) return [...text.replace(/[\s\p{P}\p{S}]/gu, '')].length >= 4
  return text.length >= 14 && /\s/.test(text) && /[a-z]/i.test(text)
}

/**
 * 词典 → { 文案片段 → 键 }。整条值和按 `{{占位}}` 切开的每一段都算（测试常抄占位前后那一截）。
 * sources = [[键前缀, 词典], …]：渲染层前缀为空，主进程用 `desktop:`。
 */
export function buildCopyIndex(sources) {
  const index = new Map()
  const add = (text, key) => { const value = text.trim(); if (value && isSentence(value) && !index.has(value)) index.set(value, key) }
  const visit = (node, prefix) => {
    for (const [name, value] of Object.entries(node ?? {})) {
      const key = `${prefix}${name}`
      if (typeof value === 'string') {
        const plain = value.replace(/\*\*/g, '')
        add(plain, key)
        for (const part of plain.split(/\{\{\s*\w+\s*\}\}/)) add(part, key)
      } else if (value && typeof value === 'object') visit(value, `${key}.`)
    }
  }
  for (const [prefix, dictionary] of sources) visit(dictionary, prefix)
  return index
}

const LITERAL = /'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"|`((?:[^`\\\n]|\\.)*)`|(?:toMatch|match|test|toHaveText|toContainText|getByText|toHaveAccessibleName)\(\s*\/((?:[^/\\\n]|\\.)+)\/[a-z]*/g
const TITLE_CALL = /\b(?:describe|it|test|suite|bench)(?:\.(?:only|skip|todo|concurrent|sequential|fails|each\([^)]*\)))*\(\s*$/
const unescape = (text) => text.replace(/\\(.)/g, '$1')

/** 一个文件里抄了词典文案的地方：[{ line, literal, key }]。 */
export function scanSource(source, index) {
  const hits = []
  source.split('\n').forEach((line, i) => {
    if (/^\s*(?:\/\/|\*|\/\*)/.test(line)) return
    for (const match of line.matchAll(LITERAL)) {
      if (TITLE_CALL.test(line.slice(0, match.index))) continue
      let candidates
      if (match[4] !== undefined) candidates = match[4].replace(/\\(.)/g, '$1').replace(/[()^$?]/g, '').split('|')
      else if (match[3] !== undefined) candidates = match[3].split(/\$\{[^}]*\}/).map(unescape)
      else candidates = [unescape(match[1] ?? match[2])]
      for (const candidate of candidates) {
        const literal = candidate.trim()
        const key = literal && index.get(literal)
        if (key) hits.push({ line: i + 1, literal, key })
      }
    }
  })
  return hits
}

/** 棘轮：返回变多 / 新冒出来的文件。 */
export function regressionsAgainst(byFile, baseline) {
  const regressions = []
  for (const [file, count] of byFile) {
    const allowed = Number.isFinite(baseline[file]) ? baseline[file] : 0
    if (count > allowed) regressions.push({ file, count, allowed })
  }
  return regressions.sort((a, b) => a.file.localeCompare(b.file, 'en'))
}

/** 收紧基线：只取 min(基线, 现在)，清掉降到 0 的；任何文件变多都拒绝（只减不增）。 */
export function tightenBaseline(byFile, baseline) {
  const regressions = regressionsAgainst(byFile, baseline)
  if (regressions.length) return { ok: false, regressions }
  const next = {}
  for (const [file, count] of [...byFile.entries()].sort((a, b) => a[0].localeCompare(b[0], 'en'))) if (count > 0) next[file] = count
  return { ok: true, next }
}

async function loadCopySources() {
  const { loadDictionaries } = await import('../tests/ux/full-walk/invariants.mjs')
  const { require: tsxRequire } = await import('tsx/cjs/api')
  const ui = loadDictionaries()
  const { desktopTranslations } = tsxRequire('../electron/desktopStrings.ts', import.meta.url)
  return [['', ui['zh-CN']], ['', ui.en], ['desktop:', desktopTranslations['zh-CN']], ['desktop:', desktopTranslations.en]]
}

async function main() {
  const mode = process.argv.includes('--tighten') ? 'tighten' : process.argv.includes('--init') ? 'init' : 'check'
  const index = buildCopyIndex(await loadCopySources())
  const byFile = new Map()
  const found = []
  const files = collectTestFiles().filter((file) => !ALLOWLIST.includes(file))
  // 并发读：两千多个文件逐个同步读，在 Windows（杀毒逐个扫）上要好几秒。
  const sources = await Promise.all(files.map((file) => fs.promises.readFile(path.join(repoRoot, file), 'utf8')))
  for (const [i, file] of files.entries()) {
    const hits = scanSource(sources[i], index)
    if (!hits.length) continue
    byFile.set(file, hits.length)
    for (const hit of hits) found.push({ file, ...hit })
  }
  const total = found.length

  if (mode === 'init') {
    if (fs.existsSync(BASELINE_FILE)) { console.error('✖ 基线已存在；只能 --tighten（只减不增）'); process.exit(1) }
    const { next } = tightenBaseline(byFile, Object.fromEntries(byFile))
    fs.writeFileSync(BASELINE_FILE, `${JSON.stringify(next, null, 2)}\n`)
    console.log(`✅ 已写入测试抄文案基线：${byFile.size} 文件 / ${total} 处`)
    return
  }
  const baseline = JSON.parse(fs.readFileSync(BASELINE_FILE, 'utf8'))
  if (mode === 'tighten') {
    const result = tightenBaseline(byFile, baseline)
    if (!result.ok) { report(result.regressions, found); process.exit(1) }
    fs.writeFileSync(BASELINE_FILE, `${JSON.stringify(result.next, null, 2)}\n`)
    console.log(`✅ 基线已收紧：${Object.keys(result.next).length} 文件 / ${total} 处`)
    return
  }
  const regressions = regressionsAgainst(byFile, baseline)
  if (regressions.length) { report(regressions, found); process.exit(1) }
  const shrinkable = Object.entries(baseline).filter(([file, count]) => (byFile.get(file) ?? 0) < count).length
  console.log(`✅ 测试抄文案门岗通过：存量 ${total} 处（${byFile.size} 文件），棘轮只减不增${shrinkable ? `；${shrinkable} 个文件已变少，跑 node scripts/check-test-copy-literals.mjs --tighten 收紧基线` : ''}。`)
}

function report(regressions, found) {
  console.error('✖ 测试抄文案门岗未通过——测试里新写了和词典一字不差的文案（棘轮只减不增）：')
  for (const { file, count, allowed } of regressions) {
    console.error(`- ${file}  基线 ${allowed} → 现在 ${count}`)
    for (const hit of found.filter((entry) => entry.file === file).slice(0, 8)) {
      console.error(`    :${hit.line}  「${hit.literal.slice(0, 40)}」= 词典键 ${hit.key}`)
    }
  }
  console.error(FIX_HINT)
  console.error('  基线：scripts/test-copy-literals-baseline.json；改少了跑 --tighten 收紧（变多会被拒）')
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main()
