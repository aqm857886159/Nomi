#!/usr/bin/env node
// 方向检查（RW）的唯一计数器：数「同一文件 / 同一概念目录」近 14 天的 fix 与「revert 一个 fix」提交。
// 谁都会走到这里：Claude 编辑提醒（edit-time-reminder）、git commit-msg（check-direction-trailer）、
// 派工前（node scripts/fix-churn.mjs <路径>）、CI 警告（--range）。别处不许再写第二份数法（P1）。
//
// 命中（hot）：
//   · 文件：近 14 天已有 ≥2 个 fix（这一刀是第 3 个），或出现过 ≥1 次 revert fix；
//   · 目录：同上，但只认「概念大小」的目录——近 14 天 fix 提交碰过的不同源码文件 ≤ DIR_MAX_FILES。
//     忙碌的大目录（几十个文件、每天都有无关 fix）不当整体算，否则每个 fix 都命中、规则变噪音（2026-10-04 回测：
//     origin/main 最近 15 个合并里，不设上限时 38 个 fix 提交几乎全命中）。
// 例外：locale 词典（src/i18n/locales/*.ts）什么功能都要改它，按「文件」数一碰就响（2026-10-05 generationCommon.ts 近 14 天 30 个 fix），
//   真正重复的那类反而被淹掉。词典文件改按「文件#顶层功能键」各数各的（中英两段同名键算同一个；一个提交改到几个键各计一次；
//   落在键之外的行——文件头、export 行、顶层单句——归「文件#(根)」），阈值和窗口不变，且不再投目录那一票（词典目录不是一个概念）。
//   盲区：同一类错（例如「界面谈钱」）若散在不同功能键里，这里数不到一起——由 check:i18n 的文案扫描补。
// 再加两种「按概念数」的单位（scripts/fix-churn-units.mjs 定义哪些单位、各含哪些文件）：
//   · 自写登记条目（self-written.json 的一条 entry，paths 下的文件合起来）：status 为 under-review / to-replace，
//     或 justified 但落在 genericZones 的通用能力——窗口 30 天，第 2 个 fix 就命中，提示「先评估接入现成方案」；
//   · 概念（concept-owners.json 的一个 concept，owner + write_api 的文件合起来，≥2 个文件才单列）——14 天 / 第 3 个，
//     同样有「概念大小」上限（fix 碰过的不同源码文件 ≤ CONCEPT_MAX_FILES）。
//   原因：MCP 的修补一个月 14 次、散在 6 个文件，按文件 / 目录都凑不够 3 个。
// 另外三条触发（评测分数回滚、同线第 3 轮修补、第三个特例分支）没有 git 上的可算信号，靠派工书 / 复盘模板人工判。
//
// 用法：
//   node scripts/fix-churn.mjs src/a/b.ts src/c        # 查给定路径（文件或目录）
//   node scripts/fix-churn.mjs --staged                # 查暂存区
//   node scripts/fix-churn.mjs --range origin/main..HEAD [--warn]   # 逐个 fix 提交回看：当时是不是热点、有没有带 trailer
//   加 --json 输出机器可读；有命中且未加 --warn 时退出码 1（派工脚本可据此改派复盘）。
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { gitPaths } from './lib/gitPaths.mjs'
import { loadUnits, SELF_WRITTEN_WINDOW_DAYS, unitMatches } from './fix-churn-units.mjs'

export const FIX_WINDOW_DAYS = 14
/** 近 14 天已有的 fix 数达到它，这一刀就是第 3 个。 */
export const PRIOR_FIX_THRESHOLD = 2
/** 目录算「同一概念」的上限：fix 提交碰过的不同源码文件数。 */
export const DIR_MAX_FILES = 6
export const TRAILER_KEY = 'Direction-Check'
export const FIX_SUBJECT = /^(fix|hotfix)(\(|:|!)/i
export const REVERT_OF_FIX = /^revert\b.*?["']?(fix|hotfix)(\(|:|!)/i
const SOURCE_FILE = /\.(ts|tsx|mts|cts|mjs)$/
const NOT_SOURCE = /\.(test|spec|node-test|e2e\.test)\.[cm]?[jt]sx?$|\.generated\.|\.d\.ts$/
const SEP1 = String.fromCharCode(1)
const SEP2 = String.fromCharCode(2)

const norm = (p) => String(p || '').split('\\').join('/')

/** 要不要管这个文件：src/、electron/ 下的非测试、非生成的源码。 */
export function isWatchedSource(rel) {
  const r = norm(rel)
  return (r.startsWith('src/') || r.startsWith('electron/')) && SOURCE_FILE.test(r) && !NOT_SOURCE.test(r)
}

/** 单位里的文件要不要管：src/、electron/、scripts/ 下的非测试、非生成源码（自写登记里有 scripts 下的机制）。 */
export function isUnitSource(rel) {
  const r = norm(rel)
  // 词典（locale）按「文件#功能键」另数，不进单位（否则每个 fix 都命中）
  return /^(src|electron|scripts)\//.test(r) && SOURCE_FILE.test(r) && !NOT_SOURCE.test(r) && !r.startsWith('src/i18n/locales/')
}

export const isFixSubject = (s) => FIX_SUBJECT.test(String(s || '').trim())
export const isRevertOfFix = (s) => REVERT_OF_FIX.test(String(s || '').trim())

const LOCALE_DICT = /^src\/i18n\/locales\/[^/]+\.ts$/
export const isLocaleDict = (rel) => LOCALE_DICT.test(norm(rel))
export const ROOT_NS = '(根)'
const NS_OPEN = /^  (?:([A-Za-z0-9_$]+)|'([^']+)'|"([^"]+)")\s*:\s*[{[]\s*(?:\/\/.*)?$/
const NS_CLOSE = /^  [}\]][,)]*\s*(?:\/\/.*)?$/

/** 词典源码 → 每一行（1 起算）所属的顶层功能键。顶层 = 缩进 2 格、值是 { 或 [ 的键；其余（文件头、export 行、顶层单句、闭合后的空隙）= (根)。 */
export function namespaceLines(source) {
  const lines = String(source || '').split(/\r?\n/)
  const out = [null]
  let cur = ROOT_NS
  for (const line of lines) {
    if (cur === ROOT_NS) {
      const m = NS_OPEN.exec(line)
      if (m) cur = m[1] || m[2] || m[3]
      out.push(cur)
    } else {
      out.push(cur)
      if (NS_CLOSE.test(line)) cur = ROOT_NS
    }
  }
  return out
}

/** 解析 git diff -U0 的 hunk 头，返回 [{ oldStart, oldCount, newStart, newCount }]。 */
export function parseHunks(diffText) {
  const hunks = []
  for (const m of String(diffText || '').matchAll(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/gm)) {
    hunks.push({ oldStart: +m[1], oldCount: m[2] === undefined ? 1 : +m[2], newStart: +m[3], newCount: m[4] === undefined ? 1 : +m[4] })
  }
  return hunks
}

/** 一次改动（hunks + 旧 / 新源码）碰到的功能键集合：删掉 / 改掉的行按旧源码归属，新增 / 改后的行按新源码归属。 */
export function touchedNamespaces(hunks, oldSource, newSource) {
  const oldMap = namespaceLines(oldSource)
  const newMap = namespaceLines(newSource)
  const out = new Set()
  for (const h of hunks) {
    for (let i = 0; i < h.oldCount; i++) out.add(oldMap[h.oldStart + i] || ROOT_NS)
    for (let i = 0; i < h.newCount; i++) out.add(newMap[h.newStart + i] || ROOT_NS)
  }
  return out
}

/** 词典计数上下文：按 提交 + 文件 缓存「这个提交改到了哪些功能键」。git 失败 = 空集（fail-open）。 */
export function makeNsCtx(root, git = defaultGit) {
  const cache = new Map()
  const show = (spec) => { try { return git(root, ['show', spec]) } catch { return '' } }
  return {
    touched: new Map(),
    nsOf(commit, file) {
      const key = `${commit.sha}#${file}`
      if (!cache.has(key)) {
        let diff = ''
        try { diff = git(root, ['show', '-U0', '--no-renames', '--format=', commit.sha, '--', file]) } catch { diff = '' }
        cache.set(key, touchedNamespaces(parseHunks(diff), show(`${commit.sha}^:${file}`), show(`${commit.sha}:${file}`)))
      }
      return cache.get(key)
    },
  }
}

/** 暂存区对词典文件的改动 → Map(文件 → 功能键集合)，给 commit-msg 校验用。 */
export function stagedNamespaces(root, files, git = defaultGit) {
  const map = new Map()
  for (const f of files.map(norm).filter(isLocaleDict)) {
    const show = (spec) => { try { return git(root, ['show', spec]) } catch { return '' } }
    let diff = ''
    try { diff = git(root, ['diff', '--cached', '-U0', '--no-renames', '--', f]) } catch { diff = '' }
    map.set(f, touchedNamespaces(parseHunks(diff), show(`HEAD:${f}`), show(`:${f}`)))
  }
  return map
}

/** 在更老的提交里（14 天窗口内）数「文件#功能键」各自被 fix / revert-fix 碰过几次。返回 Map(ns → {fixes, reverts})。 */
export function tallyNamespaces(history, afterIndex, nowMs, file, ctx) {
  const cutoff = nowMs - FIX_WINDOW_DAYS * 86400000
  const counts = new Map()
  for (let i = afterIndex + 1; i < history.length; i++) {
    const c = history[i]
    if (c.ms < cutoff || !c.files.includes(file)) continue
    const fix = isFixSubject(c.subject)
    if (!fix && !isRevertOfFix(c.subject)) continue
    for (const ns of ctx.nsOf(c, file)) {
      const e = counts.get(ns) || { fixes: 0, reverts: 0 }
      if (fix) e.fixes++; else e.reverts++
      counts.set(ns, e)
    }
  }
  return counts
}

/** 判一个词典文件：只看被这一刀碰到的功能键（touched 未知 = 报告该文件里所有已达阈值的功能键）。 */
function evaluateLocale(history, afterIndex, nowMs, file, ctx, touched) {
  const counts = tallyNamespaces(history, afterIndex, nowMs, file, ctx)
  const base = path.posix.basename(file)
  const names = touched ? [...touched] : [...counts.keys()]
  const reasons = []
  for (const ns of names) {
    const e = counts.get(ns) || { fixes: 0, reverts: 0 }
    if (e.fixes >= PRIOR_FIX_THRESHOLD) reasons.push(`${base}#${ns} 近 ${FIX_WINDOW_DAYS} 天已有 ${e.fixes} 个 fix，这一刀是第 ${e.fixes + 1} 个（词典按功能键计数）`)
    if (e.reverts >= 1) reasons.push(`${base}#${ns} 近 ${FIX_WINDOW_DAYS} 天出现过 ${e.reverts} 次 revert fix`)
  }
  return { path: file, dir: path.posix.dirname(file), file: { fixes: 0, reverts: 0, fixFiles: 0 }, dirCounts: { fixes: 0, reverts: 0, fixFiles: 0 }, namespaces: Object.fromEntries(counts), hot: reasons.length > 0, reasons }
}

function defaultGit(root, args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', timeout: 20000, maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true })
}

/** 读一遍日志（新→旧）：[{ sha, ms, subject, files }]。pathspecs 为空 = 全仓。git 失败 = []（fail-open）。 */
export function loadHistory(root, { ref = 'HEAD', since, days = FIX_WINDOW_DAYS, pathspecs = [], git = defaultGit } = {}) {
  let out = ''
  try {
    const args = ['-c', 'core.quotePath=false', 'log', '--no-merges', `--since=${since || `${days} days ago`}`, '--no-renames', '--name-only', `--format=${SEP1}%H${SEP2}%cI${SEP2}%s`, ref]
    if (pathspecs.length) args.push('--', ...pathspecs)
    out = git(root, args)
  } catch { return [] }
  return out.split(SEP1).filter(Boolean).map((blk) => {
    const [head, ...files] = blk.split('\n')
    const [sha, iso, subject] = head.split(SEP2)
    return { sha, ms: Date.parse(iso), subject: (subject || '').trim(), files: files.map((f) => norm(f.trim())).filter(Boolean) }
  })
}

/** 在 history[afterIndex+1..]（比这一刀老）里、14 天窗口内，数触及 scope 的 fix / revert-fix，并收集 fix 碰过的源码文件。 */
export function tally(history, afterIndex, nowMs, scope) {
  const isDir = !/\.[a-z0-9]+$/i.test(scope)
  const prefix = scope.replace(/\/?$/, '/')
  const touches = (f) => (isDir ? f.startsWith(prefix) : f === scope)
  const cutoff = nowMs - FIX_WINDOW_DAYS * 86400000
  let fixes = 0
  let reverts = 0
  const fixFiles = new Set()
  for (let i = afterIndex + 1; i < history.length; i++) {
    const c = history[i]
    if (c.ms < cutoff || !c.files.some(touches)) continue
    if (isFixSubject(c.subject)) { fixes++; for (const f of c.files) if (touches(f) && isWatchedSource(f)) fixFiles.add(f) }
    else if (isRevertOfFix(c.subject)) reverts++
  }
  return { fixes, reverts, fixFiles: fixFiles.size }
}

/** 判一个文件：文件 + 所在目录各一票，返回命中原因。 */
export function evaluate(history, afterIndex, nowMs, rel, nsCtx) {
  const file = norm(rel)
  if (isLocaleDict(file) && nsCtx) {
    // 历史里的提交：取它自己改到的功能键；实时（暂存区 / 只给路径）：用 nsCtx.touched 里登记的，没有就报全部达标的键
    const own = afterIndex >= 0 ? nsCtx.nsOf(history[afterIndex], file) : nsCtx.touched.get(file)
    return evaluateLocale(history, afterIndex, nowMs, file, nsCtx, own)
  }
  const dir = path.posix.dirname(file)
  const f = tally(history, afterIndex, nowMs, file)
  const d = dir && dir !== '.' ? tally(history, afterIndex, nowMs, dir) : { fixes: 0, reverts: 0, fixFiles: 0 }
  const dirNarrow = d.fixFiles <= DIR_MAX_FILES
  const reasons = []
  if (f.fixes >= PRIOR_FIX_THRESHOLD) reasons.push(`文件近 ${FIX_WINDOW_DAYS} 天已有 ${f.fixes} 个 fix，这一刀是第 ${f.fixes + 1} 个`)
  if (f.reverts >= 1) reasons.push(`文件近 ${FIX_WINDOW_DAYS} 天出现过 ${f.reverts} 次 revert fix`)
  if (dirNarrow && d.fixes >= PRIOR_FIX_THRESHOLD) reasons.push(`目录 ${dir}/ 近 ${FIX_WINDOW_DAYS} 天已有 ${d.fixes} 个 fix（只涉及 ${d.fixFiles} 个文件，算同一概念），这一刀是第 ${d.fixes + 1} 个`)
  if (dirNarrow && d.reverts >= 1) reasons.push(`目录 ${dir}/ 近 ${FIX_WINDOW_DAYS} 天出现过 ${d.reverts} 次 revert fix`)
  return { path: file, dir, file: f, dirCounts: d, hot: reasons.length > 0, reasons }
}

/** 单位（登记条目 / 概念）在 history[afterIndex+1..] 里、自己的窗口内被 fix / revert-fix 碰了几次。 */
export function tallyUnit(history, afterIndex, nowMs, unit) {
  const cutoff = nowMs - unit.windowDays * 86400000
  let fixes = 0
  let reverts = 0
  const fixFiles = new Set()
  for (let i = afterIndex + 1; i < history.length; i++) {
    const c = history[i]
    if (c.ms < cutoff) continue
    const mine = c.files.filter((f) => unitMatches(unit, f))
    if (!mine.length) continue
    if (isFixSubject(c.subject)) { fixes++; for (const f of mine) if (isUnitSource(f)) fixFiles.add(f) }
    else if (isRevertOfFix(c.subject)) reverts++
  }
  return { fixes, reverts, fixFiles: fixFiles.size }
}

/** 这一刀碰到的文件属于哪些单位，逐个单位判一次（一个提交碰到单位里几个文件也只算一票）。返回 hit 形状同 evaluate（path = 单位名）。 */
export function evaluateUnits(history, afterIndex, nowMs, files, units) {
  const hits = []
  const mine = [...new Set(files.map(norm))].filter(isUnitSource)
  for (const unit of units ?? []) {
    if (!mine.some((f) => unitMatches(unit, f))) continue
    const t = tallyUnit(history, afterIndex, nowMs, unit)
    if (unit.maxFiles && t.fixFiles > unit.maxFiles) continue
    const reasons = []
    if (t.fixes >= unit.prior) {
      reasons.push(unit.kind === 'self-written'
        ? `状态 ${unit.status}，近 ${unit.windowDays} 天已有 ${t.fixes} 个 fix，这一刀是第 ${t.fixes + 1} 个——先评估接入现成方案（P0）；要继续补，必须在复盘里写清为什么现在换不了、哪天换`
        : `含 ${unit.patterns.length} 个文件，近 ${unit.windowDays} 天已有 ${t.fixes} 个 fix，这一刀是第 ${t.fixes + 1} 个`)
    }
    if (t.reverts >= 1) reasons.push(`近 ${unit.windowDays} 天出现过 ${t.reverts} 次 revert fix`)
    if (reasons.length) hits.push({ path: unit.label, unit: { kind: unit.kind, id: unit.id }, reasons, hot: true })
  }
  return hits
}

/** 兼容旧调用：文件近 N 天 fix 数。 */
export function countRecentFixes(root, rel, opts = {}) {
  const file = norm(rel)
  return tally(loadHistory(root, { ...opts, pathspecs: [file] }), -1, Date.now(), file).fixes
}

/** 单个路径的体检（给 edit-time-reminder 用）。 */
export function churnFor(root, rel, opts = {}) {
  const file = norm(rel)
  const dir = path.posix.dirname(file)
  const hit = evaluate(loadHistory(root, { ...opts, pathspecs: [dir === '.' ? file : dir] }), -1, Date.now(), file, makeNsCtx(root, opts.git))
  const units = opts.units ?? loadUnits(root)
  if (!units.some((u) => unitMatches(u, file))) return hit
  const unitHits = evaluateUnits(loadHistory(root, { ...opts, days: SELF_WRITTEN_WINDOW_DAYS }), -1, Date.now(), [file], units)
  return unitHits.length ? { ...hit, hot: true, reasons: [...hit.reasons, ...unitHits.flatMap((h) => h.reasons)] } : hit
}

/** 批量：只看 src/ electron/ 的源码（测试、生成物、文档不算）；只读一遍日志。 */
export function findHotspots(root, paths, opts = {}) {
  const all = [...new Set(paths.map(norm))]
  const files = all.filter(isWatchedSource)
  // 单位（登记条目 / 概念）：只有这一刀碰到了某个单位的文件，才多读一遍 30 天的全仓日志
  const units = (opts.units ?? loadUnits(root)).filter((u) => all.some((f) => isUnitSource(f) && unitMatches(u, f)))
  const unitHits = units.length ? evaluateUnits(loadHistory(root, { ...opts, days: SELF_WRITTEN_WINDOW_DAYS }), -1, Date.now(), all, units) : []
  if (!files.length) return unitHits
  const dirs = [...new Set(files.map((f) => path.posix.dirname(f)))]
  const history = loadHistory(root, { ...opts, pathspecs: dirs })
  const now = Date.now()
  const nsCtx = makeNsCtx(root, opts.git)
  if (opts.touched) for (const [f, set] of opts.touched) nsCtx.touched.set(f, set)
  return [...files.map((f) => evaluate(history, -1, now, f, nsCtx)).filter((e) => e.hot), ...unitHits]
}

export const directionMessage = (hits) => [
  '【方向检查 · RW】这一刀碰的地方已经被反复修，先别再补：',
  ...hits.flatMap((h) => h.reasons.map((r) => `  · ${h.path}：${r}`)),
  ...(hits.some((h) => h.unit?.kind === 'self-written')
    ? ['自写通用能力连修第 2 次：复盘 §5 / §6 第一个选项是「接入现成方案」（写清哪个库或标准、给出处）；只要成熟方案存在，推荐项默认是接入，除非有领域约束。复盘文档里要写出该登记条目的 id。']
    : []),
  '动作：停止派 / 打修补，先做「类根因复盘」（模板 docs/engineering/direction-check-template.md，产出一页文档），结构性结论交用户拍板；复盘前先写特征测试钉住现状。',
  `提交 fix 时在信息里加一行 \`${TRAILER_KEY}: <复盘文档路径>\`（git commit-msg 会校验）。`,
].join('\n')

/** 提交信息 trailer：取 `Direction-Check: path`（最后一个，忽略 # 注释行）。 */
export function parseDirectionTrailer(message) {
  const lines = String(message || '').split(/\r?\n/).filter((l) => !l.startsWith('#'))
  let value = null
  for (const l of lines) {
    const m = l.match(new RegExp(`^${TRAILER_KEY}:\\s*(\\S.*?)\\s*$`, 'i'))
    if (m) value = m[1]
  }
  return value
}

// ── CLI ──────────────────────────────────────────────────────────────────────────────────
export function rangeReport(root, range, git = defaultGit, units = loadUnits(root)) {
  const inRange = new Set(git(root, ['log', '--no-merges', '--format=%H', range]).split('\n').filter(Boolean))
  if (!inRange.size) return []
  const head = range.includes('..') ? range.split('..')[1] || 'HEAD' : 'HEAD'
  const oldest = Math.min(...[...inRange].map((sha) => Date.parse(git(root, ['log', '-1', '--format=%cI', sha]).trim())))
  const history = loadHistory(root, { ref: head, since: new Date(oldest - SELF_WRITTEN_WINDOW_DAYS * 86400000).toISOString(), git })
  const rows = []
  const nsCtx = makeNsCtx(root, git)
  history.forEach((c, idx) => {
    if (!inRange.has(c.sha) || !isFixSubject(c.subject)) return
    const hits = [...new Set(c.files)].filter(isWatchedSource).map((f) => evaluate(history, idx, c.ms, f, nsCtx)).filter((e) => e.hot)
    hits.push(...evaluateUnits(history, idx, c.ms, c.files, units))
    if (!hits.length) return
    const trailer = parseDirectionTrailer(git(root, ['log', '-1', '--format=%B', c.sha]))
    let docOk = false
    if (trailer) { try { git(root, ['cat-file', '-e', `${head}:${trailer}`]); docOk = true } catch { docOk = false } }
    rows.push({ sha: c.sha.slice(0, 9), subject: c.subject, hits, trailer, docOk })
  })
  return rows
}

function main(argv) {
  const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim()
  const flags = new Set(argv.filter((a) => a.startsWith('--') && a !== '--range'))
  const rangeIdx = argv.indexOf('--range')
  const json = flags.has('--json')
  if (rangeIdx >= 0) {
    const rows = rangeReport(root, argv[rangeIdx + 1])
    const bad = rows.filter((r) => !r.trailer || !r.docOk)
    if (json) console.log(JSON.stringify({ rows, missing: bad.length }, null, 2))
    else if (!bad.length) console.log(`方向检查：范围内 ${rows.length} 个热点 fix 提交，全部带了有效 ${TRAILER_KEY}。`)
    else {
      console.log(`方向检查（只警告）：${bad.length} 个 fix 提交碰了反复修的地方，却没带有效 ${TRAILER_KEY}：`)
      for (const r of bad) console.log(`  · ${r.sha} ${r.subject}\n      ${r.hits.flatMap((h) => h.reasons.map((x) => `${h.path}：${x}`)).slice(0, 2).join('；')}`)
      console.log('请先做类根因复盘（docs/engineering/direction-check-template.md），再在提交信息加 trailer。')
    }
    process.exit(flags.has('--warn') || !bad.length ? 0 : 1)
  }
  let paths = argv.filter((a) => !a.startsWith('--'))
  if (flags.has('--staged')) paths = gitPaths(['diff', '--cached', '--name-only', '--no-renames'], { cwd: root })
  // 传了目录就展开成该目录下 14 天内被 fix 碰过的源码文件，再判
  const expanded = paths.flatMap((p) => (/\.[a-z0-9]+$/i.test(p) ? [p] : [...new Set(loadHistory(root, { pathspecs: [p] }).flatMap((c) => c.files))].filter(isWatchedSource)))
  const hits = findHotspots(root, expanded)
  if (json) console.log(JSON.stringify(hits, null, 2))
  else console.log(hits.length ? directionMessage(hits) : '方向检查：未命中热点。')
  process.exit(hits.length && !flags.has('--warn') ? 1 : 0)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2))
