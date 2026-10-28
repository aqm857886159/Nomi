#!/usr/bin/env node
/**
 * 重新生成流程分档的历史回放夹具 scripts/fixtures/process-tiering-replay.json。
 *
 * 夹具只存「输入」：每个历史 PR 的完整文件清单（状态 A / M / D，不截断）、main 的 diff 规则要读的新增行、
 * 让逃逸账本转 fixed 的条目 id。不存任何期望——没有档位、没有严档数、没有必须严名单；期望由
 * scripts/process-tier.node-test.mjs 当场用 inferRoutes 现算。
 *
 * 取数口径和 CI 的 check:pr-judgement 一致，不另起一套：
 *   · PR 窗口：从 WINDOW_HEAD 出发的首父链上 `Merge pull request #N` 的合并提交，N 在 [FIRST_PR, LAST_PR] 内（没合并的号不在首父链上，自然跳过）；
 *   · 每个合并提交 M：base = merge-base(M^1, M^2)，head = M^2；文件表和逐文件新增行用 scripts/lib/prChanges.mjs 的
 *     prChanges（git diff --no-renames，输出格式钉死）；
 *   · 逃逸账本转 fixed：scripts/pr-body-criteria.mjs 的 ledgerChanges（同一个函数）在 base / head 两版条目文件上算。
 *
 * 新增行只存命中 main 的 diff 规则（docs/engineering/test-routing.json 的 abortSignal）的那几行；生成时会逐 PR 核对：
 * 只用这几行跑 inferRoutes，结果必须和用全部新增行跑的完全一致，不一致就抛错，不落盘。
 *
 * 用法：node scripts/generate-process-tiering-replay.mjs [--ref <提交>] [--out scripts/fixtures/process-tiering-replay.json]
 * 需要完整 git 历史（浅克隆算不出 merge-base）。同一段历史重跑，输出逐字节相同（没有时间戳）。
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { escapeIdOfPath } from './escape-ledger-lib.mjs'
import { prChanges } from './lib/prChanges.mjs'
import { ledgerChanges } from './pr-body-criteria.mjs'
import { inferRoutes, loadRoutingTable } from './pr-judgement-lib.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

export const FIXTURE_FILE = 'scripts/fixtures/process-tiering-replay.json'
/** 窗口：WINDOW_HEAD（PR #1355 的合并提交）之前已经合进 main 的 PR，且 PR 号在 [FIRST_PR, LAST_PR] 内。要换窗口先改这里，再重跑，并在提交说明里写理由。 */
export const WINDOW_HEAD = 'b518359904ff09eed9abdfe3bf616d377e6427fa'
export const FIRST_PR = 1142
export const LAST_PR = 1358

export const FIXTURE_COMMENT = [
  '流程分档的历史回放夹具，只存输入：窗口内每个已合并 PR 的完整文件清单（状态 A / M / D，不截断）。没有任何期望——没有档位、没有严档数、没有必须严名单。',
  '护栏在 scripts/process-tier.node-test.mjs 里当场用 inferRoutes 现算，夹具只给输入；谁要往这里补一个「期望」字段，等于把基准又变回手填的。',
  '生成：node scripts/generate-process-tiering-replay.mjs（需要完整 git 历史）。从 window.head 出发，在首父链上认 `Merge pull request #N` 的合并提交，N 在 [firstPr, lastPr] 内；',
  '每个 PR 取 base = merge-base(M^1, M^2)、head = M^2，用 scripts/lib/prChanges.mjs 的 prChanges（git diff --no-renames，和 check:pr-judgement 同一个函数）取文件表。',
  'files：「状态 路径」。added：main 的 diff 规则（test-routing.json 的 abortSignal）要读的新增行——只存命中该规则正则的行，按文件分；别的新增行不存。生成时已核对，只用这几行和用全部新增行跑 inferRoutes 结果完全一致。',
  'ledgerFixed：该 PR 里状态转成 fixed 的逃逸账本条目 id（pr-body-criteria 的 ledgerChanges 同一个函数算）。prCount 是生成时记下的 PR 数，护栏会核对它和 prs 的长度。',
  '什么时候要重生成：test-routing.json 的 abortSignal 规则变了（护栏里的 diffRule 对账会红）；要移动或扩大窗口；prChanges 的取数口径变了。',
  '改动规矩：只许重跑脚本，不许手改；提交说明写明为什么重生成、窗口或口径变了什么。',
]

const plainGit = (args) => execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8', maxBuffer: 1024 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] })

/** 首父链上窗口内的 PR 合并提交：[{ number, commit, parents: [M^1, M^2] }]，按 PR 号升序。 */
export function windowMerges(git, ref, { first = FIRST_PR, last = LAST_PR } = {}) {
  const merges = []
  for (const line of git(['log', '--first-parent', '--format=%H%x09%P%x09%s', ref]).split('\n').filter(Boolean)) {
    const [commit, parents, subject] = line.split('\t')
    const match = /^Merge pull request #(\d+) /.exec(subject)
    if (!match) continue
    const number = Number(match[1])
    if (number < first || number > last) continue
    const parentList = parents.split(' ').filter(Boolean)
    if (parentList.length !== 2) throw new Error(`#${number} 的合并提交 ${commit} 不是两个父提交（${parentList.length} 个），不是 merge commit 合并的，取数口径不适用`)
    if (merges.some((item) => item.number === number)) throw new Error(`#${number} 在首父链上出现了两次`)
    merges.push({ number, commit, parents: parentList })
  }
  return merges.sort((a, b) => a.number - b.number)
}

export function buildFixture({ git = plainGit, ref = WINDOW_HEAD, table = loadRoutingTable(repoRoot) } = {}) {
  const abort = table.abortSignal
  if (!abort?.pattern) throw new Error('test-routing.json 没有 abortSignal 规则，夹具不知道要存哪些新增行')
  const abortPattern = new RegExp(abort.pattern)
  const abortScope = abort.scope ? new RegExp(abort.scope) : null
  const show = (sha, file) => { try { return git(['show', `${sha}:${file}`]) } catch { return null } }

  const prs = []
  for (const merge of windowMerges(git, ref)) {
    const [mainParent, head] = merge.parents
    const base = git(['merge-base', mainParent, head]).trim()
    const { files, addedByFile } = prChanges({ git, base, head })
    const added = {}
    for (const file of files) {
      if (abortScope && !abortScope.test(file.path)) continue
      const matching = (addedByFile.get(file.path) ?? '').split('\n').filter((line) => abortPattern.test(line))
      if (matching.length) added[file.path] = matching
    }
    // 压缩必须无损：只用存下来的几行，inferRoutes 的结论要和用全部新增行时完全一致
    const verdictOf = (addedOf) => {
      const result = inferRoutes(files.map((file) => ({ ...file, added: addedOf(file.path) })), '', table)
      return JSON.stringify({ fourClass: result.fourClass, classes: result.classes, categories: result.categories })
    }
    if (verdictOf((file) => addedByFile.get(file) ?? '') !== verdictOf((file) => (added[file] ?? []).join('\n'))) {
      throw new Error(`#${merge.number}：只存命中 diff 规则的新增行后，inferRoutes 的结论变了，夹具压缩不无损`)
    }
    const ledgerFixed = files.some((file) => escapeIdOfPath(file.path))
      ? ledgerChanges(files, (file, side) => show(side === 'base' ? base : head, file)).transitions
      : []
    const entry = { number: merge.number, mergeCommit: merge.commit, files: files.map((file) => `${file.status} ${file.path}`) }
    if (Object.keys(added).length) entry.added = added
    if (ledgerFixed.length) entry.ledgerFixed = ledgerFixed
    prs.push(entry)
  }
  return {
    _comment: FIXTURE_COMMENT,
    schemaVersion: 1,
    generatedBy: 'scripts/generate-process-tiering-replay.mjs',
    window: { head: ref, firstPr: FIRST_PR, lastPr: LAST_PR },
    prCount: prs.length,
    diffRule: { source: 'docs/engineering/test-routing.json abortSignal', pattern: abort.pattern, scope: abort.scope ?? null },
    prs,
  }
}

function main(argv) {
  const option = (name, fallback) => { const index = argv.indexOf(name); return index >= 0 && argv[index + 1] ? argv[index + 1] : fallback }
  const out = path.resolve(repoRoot, option('--out', FIXTURE_FILE))
  const fixture = buildFixture({ ref: option('--ref', WINDOW_HEAD) })
  fs.writeFileSync(out, `${JSON.stringify(fixture, null, 1)}\n`)
  console.log(`写入 ${path.relative(repoRoot, out)}：${fixture.prCount} 个 PR（#${FIRST_PR}–#${LAST_PR} 内已合并的），${fixture.prs.reduce((sum, pr) => sum + pr.files.length, 0)} 条文件记录`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main(process.argv.slice(2))
