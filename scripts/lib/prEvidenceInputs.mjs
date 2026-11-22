// 「证据判对不对」要的本地输入（2026-10-21）：PR 当前 head、报告 / 原始结果怎么读、拍板图清单。
// 判据在 scripts/pr-body-criteria.mjs（纯函数，输入由调用方给）；这里只是 CI / 推送前（check-pr-judgement）没有显式注入时的默认取法，
// 合并前扫描（scripts/merge-preflight.mjs）用 gh 取数，自己注入同形状的对象。
//
// 谁能读什么（CI 能核什么 / 本机核什么）：
//   · 仓库内的文件（docs/…、tests/perf/results/…）：CI 与本机都从 PR head（git show <headSha>:路径，和 headSha 同源）读；
//   · 协调目录里的验收报告（D:/Nomi-coord-state/reports/…，绝对路径）和外部链接：CI 读不到 → 返回 undefined（只核正文贴的首行 / HEAD / 验收线，
//     提示「本机核」）；合并前扫描在协调会话本机跑，会读报告本体，读不到就红（那边自己的 readReport 对读不到返回 null）。
//   · PR 当前 head：pull_request 事件的 pull_request.head.sha（CI 检出的 HEAD 是合并提交，不是 PR head）；没有事件就取本地 HEAD。
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { loadManifests } from '../check-board-parity.mjs'
import { ciApprovals, pushApprovals, SUPPRESSIONS_FILE } from './coordApprovals.mjs'

const defaultRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

/**
 * 报告引用是仓库内相对路径（CI 与本机都能读）还是本机绝对路径 / 外部链接（CI 读不到）。
 * 合并前扫描（scripts/merge-preflight.mjs）与 CI 默认取法共用这一个分类，Windows 分隔符、父目录一并认（V-gates S7）。
 */
export const isRepoRelativeRef = (ref) => {
  const text = String(ref)
  return !/^(?:https?:|[a-z]:[\\/]|[\\/])/i.test(text) && !text.split(/[\\/]/).includes('..')
}

/**
 * CI / 推送前（check-pr-judgement 没有显式注入时）的默认取法。读文件统一取 PR head（git show <headSha>:路径），和 headSha 同源——
 * CI 的检出是合并提交，不是 PR head，直接读工作树会读到另一个版本。取不到 PR head 的对象（浅克隆）= 读不到。
 */
export function localEvidenceInputs({ root = process.env.PR_JUDGEMENT_REPO_ROOT || defaultRoot, env = process.env, stage = 'merge' } = {}) {
  const git = (args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] })
  const headFromEvent = () => {
    if (!env.GITHUB_EVENT_PATH) return null
    try { return JSON.parse(fs.readFileSync(env.GITHUB_EVENT_PATH, 'utf8'))?.pull_request?.head?.sha ?? null } catch { return null }
  }
  const headSha = (() => {
    const fromEvent = headFromEvent()
    if (fromEvent) return fromEvent
    try { return git(['rev-parse', 'HEAD']).trim() || null } catch { return null }
  })()
  const showAt = (sha, ref) => {
    if (!sha) return null
    try { return git(['show', `${sha}:${String(ref).split('\\').join('/')}`]) } catch { return null }
  }
  const showAtHead = (ref) => showAt(headSha, ref)
  let cachedBaseSha = undefined
  const baseSha = () => {
    if (cachedBaseSha !== undefined) return cachedBaseSha
    const explicit = env.PR_JUDGEMENT_BASE_REF?.trim()
    for (const ref of [explicit && !/^0+$/.test(explicit) ? explicit : null, 'origin/main']) {
      if (!ref) continue
      try { cachedBaseSha = git(['merge-base', headSha, ref]).trim(); return cachedBaseSha } catch { /* 往下找 */ }
    }
    cachedBaseSha = null
    return null
  }
  const manifestsAt = (sha) => { try { return sha ? boardsAtHead({ git, sha }) : null } catch { return null } }
  return {
    headSha,
    // 拍板清单：PR head 上的内容；base 上的内容用来判「哪些板 / 元素是 PR 新增的」（新增的要协调确认，CI 只提示）
    boards: () => manifestsAt(headSha),
    baseBoards: () => manifestsAt(baseSha()),
    // ESLint 批量抑制：非 CI 本机推送档与 lint:changed 共用 pushApprovals + checkSuppressionContracts，CI / merge 档用 ciApprovals
    suppressions: () => suppressionsAt({ git, sha: headSha }),
    baseSuppressions: () => suppressionsAt({ git, sha: baseSha() }),
    suppressionApprovals: stage === 'push' && !env.CI && !env.GITHUB_ACTIONS ? pushApprovals({ pr: null, env }) : ciApprovals,
    approvals: ciApprovals,
    headRelation: (accepted, head) => checkHeadAncestry({ git, accepted, head }),
    readRaw: (ref) => (isRepoRelativeRef(ref) ? showAtHead(ref) : null),
    readReport: (ref) => (isRepoRelativeRef(ref) ? showAtHead(ref) : undefined),
  }
}

/**
 * 验收的版本和 PR 当前 head 的关系（2026-10-21 协调审后）：严格相等会逼人绕门岗——验收后 PR 和 main 冲突，协调要合一次 main，head 就变了。
 * 放行的只有：accepted == head；或 accepted 是 head 的祖先，且 head 沿第一父链上、accepted 之后的提交只有两类：
 *   · 从 main 合进来的合并提交，而且是干净的自动合并（树 == git merge-tree --write-tree <M^1> <M^2> 的结果；树不同 = 有人工解过冲突，要重验）；
 *   · 只改 docs/evidence/** 下图片 / 数据 / 文本（png jpg webp gif json md txt csv log）的提交（附验收证据用，不许可执行类型和符号链接）。
 * 分支自己任何别的非合并提交 → 红（要重验）。
 * git(args) → 标准输出，失败抛错（错误带 status）。返回 { ok: true, note } | { ok: false, reason } | { unknown: true, reason }；
 * unknown = 算不了（浅克隆 / 没有这个提交 / 没有 main 引用）：CI 提示「本机核」，合并前扫描把它当红。
 */
/** 验收之后允许附在 docs/evidence/ 下的文件类型：图片 / 数据 / 文本，不含任何可执行类型。 */
export const EVIDENCE_EXTENSIONS = /\.(?:png|jpe?g|webp|gif|json|md|txt|csv|log)$/i

export function checkHeadAncestry({ git, accepted, head, mainRef = 'origin/main', evidencePrefix = 'docs/evidence/' }) {
  const run = (args) => { try { return { ok: true, out: String(git(args)).trim() } } catch (error) { return { ok: false, status: error?.status } } }
  const shallow = run(['rev-parse', '--is-shallow-repository'])
  if (shallow.ok && shallow.out === 'true') return { unknown: true, reason: '浅克隆，算不了祖先关系' }
  const resolve = (sha) => run(['rev-parse', '--verify', '--quiet', `${sha}^{commit}`])
  const a = resolve(accepted)
  const h = resolve(head)
  if (!h.ok) return { unknown: true, reason: `本地没有 PR head ${String(head).slice(0, 9)}（先 fetch）` }
  if (!a.ok) return { ok: false, reason: `本仓库里没有验收 HEAD ${String(accepted).slice(0, 12)} 这个提交` }
  if (a.out === h.out) return { ok: true, note: '验收 HEAD = PR 当前 head' }
  if (!run(['merge-base', '--is-ancestor', a.out, h.out]).ok) return { ok: false, reason: `验收 HEAD ${a.out.slice(0, 9)} 不是 PR 当前 head ${h.out.slice(0, 9)} 的祖先（分支被改写过？）：要重验` }
  const listed = run(['rev-list', '--first-parent', '--parents', `${a.out}..${h.out}`])
  if (!listed.ok) return { unknown: true, reason: '取不到验收之后的提交列表' }
  const commits = listed.out.split('\n').filter(Boolean).map((row) => row.split(' '))
  let merges = 0
  let evidenceCommits = 0
  for (const [sha, ...parents] of commits) {
    const short = sha.slice(0, 9)
    if (parents.length === 2) {
      const [first, second] = parents
      const onMain = run(['merge-base', '--is-ancestor', second, mainRef])
      if (!onMain.ok && onMain.status === 1) return { ok: false, reason: `验收之后的合并提交 ${short} 合进来的不是 main（${second.slice(0, 9)} 不在 ${mainRef} 上）：要重验` }
      if (!onMain.ok) return { unknown: true, reason: `没有 ${mainRef} 引用，核不了 ${short} 合的是不是 main` }
      const merged = run(['merge-tree', '--write-tree', first, second])
      if (!merged.ok) return merged.status === 1 ? { ok: false, reason: `验收之后的合并提交 ${short} 合 main 时有冲突、被人工解过：要重验` } : { unknown: true, reason: 'git merge-tree 不可用（需要 git ≥ 2.38）' }
      const actual = run(['rev-parse', `${sha}^{tree}`])
      if (!actual.ok || merged.out.split('\n')[0] !== actual.out) return { ok: false, reason: `验收之后的合并提交 ${short} 不是干净的自动合并（树和 merge-tree 的结果不同，有人工改动）：要重验` }
      merges += 1
    } else if (parents.length === 1) {
      const files = run(['diff-tree', '-z', '--raw', '--no-commit-id', '-r', sha])
      if (!files.ok) return { unknown: true, reason: `取不到提交 ${short} 的改动文件` }
      // 附验收证据只许放不可执行的数据 / 文档类型，且不许是符号链接：可执行内容（.mjs 等）可能被别处 import，路径前缀证明不了行为不变（S1）
      const tokens = files.out.split(String.fromCharCode(0)).filter(Boolean)
      const outside = []
      for (let i = 0; i + 1 < tokens.length; i += 2) {
        const file = tokens[i + 1]
        const symlink = /^:\d+ 120000 /.test(tokens[i]) || /^:120000 /.test(tokens[i])
        if (!file.startsWith(evidencePrefix) || !EVIDENCE_EXTENSIONS.test(file) || symlink) outside.push(file)
      }
      if (outside.length) return { ok: false, reason: `验收之后分支又加了非合并提交 ${short}（改了 ${outside.slice(0, 2).join('、')}${outside.length > 2 ? ' 等' : ''}，不只是 ${evidencePrefix}**）：要重验` }
      evidenceCommits += 1
    } else return { ok: false, reason: `验收之后的提交 ${short} 是根提交或多路合并：要重验` }
  }
  return { ok: true, note: `验收 HEAD 是 PR head 的祖先，之后只有 ${merges} 次干净合并 main、${evidenceCommits} 个 ${evidencePrefix} 提交` }
}

/** PR head 上的拍板图清单（合并前扫描用：PR 自己新增的板在 main 检出里读不到）。git show 到临时目录再走同一个 loadManifests。 */
/** 某个提交上的 eslint-suppressions.json：文件不存在 = {}（还没有存量）；提交本身取不到 = null。 */
export function suppressionsAt({ git, sha }) {
  if (!sha) return null
  try { git(['rev-parse', '--verify', '--quiet', `${sha}^{commit}`]) } catch { return null }
  let text
  try { text = git(['show', `${sha}:${SUPPRESSIONS_FILE}`]) } catch { return {} }
  try { return JSON.parse(text) } catch { return null }
}

export function boardsAtHead({ git, sha }) {
  const tmp = fs.mkdtempSync(path.join(process.env.TEMP || os.tmpdir(), 'pr-boards-'))
  try {
    const names = String(git(['ls-tree', '-r', '-z', '--name-only', sha, 'docs/design/boards/'])).split(String.fromCharCode(0)).filter((name) => name.endsWith('.board.json'))
    for (const name of names) {
      const target = path.join(tmp, name)
      fs.mkdirSync(path.dirname(target), { recursive: true })
      fs.writeFileSync(target, git(['show', `${sha}:${name}`]))
    }
    return loadManifests(path.join(tmp, 'docs/design/boards/2026-10-08'))
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true })
  }
}
