// 走查门岗基线的「只减不增」守卫 —— check-walkthroughs 用它，单独成模块只为可单测。
//
// 为什么要它（2026-10-09，#1136 评审阻断 2）：新规则 dead-data-attr 和它的基线在同一个 PR 里落地，
// 基线直接写成当下的 97——等于把新债一次性豁免，门岗却显示绿。棘轮只在「当前数 > 基线」时报红，
// 而基线本身可以被同一个 PR 随手上调，这道缝不堵，任何新规则都能这样开张。
//
// 判法：
//   - 已有规则：本 PR 的基线不得高于 merge-base 上的基线（只减不增）。
//   - 新规则（merge-base 上没有这个键）：首发基线不许自报——只认门岗在 merge-base 那棵树上用同一条规则
//     量出来的数；量不了的规则首发基线必须为 0。
import { execFileSync } from 'node:child_process'

export function judgeBaselineGrowth({ ruleIds, baseline, baseBaseline, measureOnBase }) {
  const errors = []
  for (const id of ruleIds) {
    const now = baseline[id] ?? 0
    if (Object.prototype.hasOwnProperty.call(baseBaseline, id)) {
      const before = baseBaseline[id] ?? 0
      if (now > before) errors.push(`「${id}」基线从 ${before} 上调到 ${now}（基线只减不增）`)
      continue
    }
    if (now === 0) continue
    const measured = measureOnBase ? measureOnBase(id) : undefined
    if (measured === undefined) errors.push(`新规则「${id}」首发基线写了 ${now}：门岗量不了 merge-base 上的数，首发基线只能是 0`)
    else if (now > measured) errors.push(`新规则「${id}」首发基线 ${now} 高于 merge-base 上同一规则实测的 ${measured}（新债不许靠基线豁免）`)
  }
  return errors
}

/**
 * merge-base 或它上面的基线拿不到时（浅克隆 / 没有 origin/main）的判法——**fail-closed**（#1136 复审阻断）。
 * 之前这里只打 warning 就跳过 judgeBaselineGrowth：提交者在没有 origin/main 的环境里把新规则的首发基线写成当前命中数，
 * 门岗照样放行。认不出「哪条规则是新的」时，只能把「带 merge-base 实测能力的规则」里基线非零的一律当作无法核对 → 红。
 * 基线为 0 的规则本来就没有可豁免的债，不拦。
 */
export function judgeBaseUnavailable({ rules, baseline }) {
  return rules
    .filter((rule) => rule.measurable && (baseline[rule.id] ?? 0) > 0)
    .map((rule) => `「${rule.id}」基线 ${baseline[rule.id]}：拿不到 merge-base（或它上面的走查基线），无法核对这是不是新规则的自报豁免。先 git fetch origin main 再跑`)
}

/** merge-base（HEAD 与 origin/main）；拿不到（浅克隆 / 没有 origin）返回 null，调用方走 judgeBaseUnavailable（红，不放行）。 */
export function resolveMergeBase(repoRoot) {
  try {
    return execFileSync('git', ['merge-base', 'HEAD', 'origin/main'], { cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || null
  } catch {
    return null
  }
}

export function readJsonAtRevision(repoRoot, rev, file) {
  try {
    return JSON.parse(execFileSync('git', ['show', `${rev}:${file}`], { cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024 }))
  } catch {
    return null
  }
}

/**
 * 读某个提交里一批路径下、文件名匹配 pattern 的全部文本：`git ls-tree` 拿 blob，再一次 `git cat-file --batch` 读完。
 * 不 checkout、不解包到临时目录。返回 [{ path, text }]。
 */
export function readTreeTexts(repoRoot, rev, prefixes, pattern) {
  const listing = execFileSync('git', ['ls-tree', '-r', '-z', rev, '--', ...prefixes], { cwd: repoRoot, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  const entries = listing.split('\0').filter(Boolean).map((line) => {
    const tab = line.indexOf('\t')
    const [, type, sha] = line.slice(0, tab).split(' ')
    return { type, sha, path: line.slice(tab + 1) }
  }).filter((entry) => entry.type === 'blob' && pattern.test(entry.path))
  if (!entries.length) return []
  const raw = execFileSync('git', ['cat-file', '--batch'], { cwd: repoRoot, input: entries.map((entry) => entry.sha).join('\n') + '\n', maxBuffer: 512 * 1024 * 1024 })
  const out = []
  let offset = 0
  for (const entry of entries) {
    const headerEnd = raw.indexOf(0x0a, offset)
    const header = raw.subarray(offset, headerEnd).toString('utf8').split(' ')
    const size = Number(header[2])
    out.push({ path: entry.path, text: raw.subarray(headerEnd + 1, headerEnd + 1 + size).toString('utf8') })
    offset = headerEnd + 1 + size + 1
  }
  return out
}
