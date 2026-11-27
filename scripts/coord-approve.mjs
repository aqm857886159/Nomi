#!/usr/bin/env node
// 协调确认记录（只给协调会话用，2026-10-21；背景见 scripts/lib/coordApprovals.mjs）：
// 合同类数据——拍板清单里 PR 新增 / 改了合同的元素、性能场景的政策字段——不能由 PR 自己批准。
// 协调会话看过 PR head 上的内容觉得对，就在本机追加一条确认记录；merge-preflight 读它。内容之后又改了，哈希对不上，重新判红。
//
// 用法（环境变量 NOMI_COORD_APPROVALS = 本机 JSONL 文件路径，不进仓库）：
//   node scripts/coord-approve.mjs --pr <号> --board <板名> [--note 说明]
//   node scripts/coord-approve.mjs --pr <号> --perf <场景 id> [--note 说明]
//   node scripts/coord-approve.mjs [--pr <号>] --suppressions [--note 说明]
//     ESLint 批量抑制冻结数上涨（eslint-suppressions.json）：确认绑上涨那部分 diff 的哈希。还没开 PR 时不带 --pr，
//     按本地 HEAD 对 origin/main 的 merge-base 算（协调推送前在任务分支的工作树里跑）。
// 哈希从 PR head 算（git fetch origin main pull/<号>/head 之后读 git 对象），不读工作树。
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { allowlistApprovalSubject, APPROVAL_ENV, boardApprovalSubject, describeBoardDiff, describeSuppressionGrowth, GENERATED_ALLOWLIST_PATH, suppressionApprovalSubject, SUPPRESSIONS_FILE } from './lib/coordApprovals.mjs'
import { boardsAtHead } from './lib/prEvidenceInputs.mjs'
import { scenarioPolicyHash, scenarioRemovedHash } from './perf-scenarios-lib.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const realGit = (args) => execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] })

const argValue = (argv, name) => { const index = argv.indexOf(name); return index >= 0 ? argv[index + 1] : undefined }

/** 算出要写的那条记录（纯逻辑，git 与时间可注入，测试用）。取不到内容 / 没有要确认的东西 → 抛出带人话的错误。 */
export function buildApproval({ argv, git = realGit, now = () => new Date().toISOString(), fetch = true }) {
  const prArg = argValue(argv, '--pr')
  const pr = prArg === undefined ? null : Number(prArg)
  const board = argValue(argv, '--board')
  const perf = argValue(argv, '--perf')
  const suppressions = argv.includes('--suppressions')
  const allowlist = argv.includes('--allowlist')
  const usage = '用法：node scripts/coord-approve.mjs --pr <号> (--board <板名> | --perf <场景 id>) [--note 说明]；或 node scripts/coord-approve.mjs [--pr <号>] (--suppressions | --allowlist) [--note 说明]'
  if ([board, perf, suppressions, allowlist].filter(Boolean).length !== 1) throw new Error(usage)
  if (pr !== null && (!Number.isInteger(pr) || pr <= 0)) throw new Error(usage)
  if (pr === null && !suppressions && !allowlist) throw new Error(usage)
  if (suppressions) return buildSuppressionsApproval({ argv, pr, git, now, fetch })
  if (allowlist) return buildAllowlistApproval({ argv, pr, git, now, fetch })
  // --head <sha>：测试 / 已经 fetch 过时直接指定 PR head，不再去 fetch
  let headSha = argValue(argv, '--head')
  if (!headSha) {
    if (fetch) { git(['fetch', '--quiet', 'origin', 'main']); git(['fetch', '--quiet', 'origin', `pull/${pr}/head`]) }
    headSha = String(git(['rev-parse', 'FETCH_HEAD'])).trim()
  }
  const base = String(git(['merge-base', 'origin/main', headSha])).trim()
  let name
  let sha256
  if (board) {
    const heads = boardsAtHead({ git, sha: headSha })
    const bases = boardsAtHead({ git, sha: base })
    if (heads[board]?.ambiguous) throw new Error(`PR head 上板 ${board} 重名`)
    const subject = boardApprovalSubject(board, bases[board] ?? null, heads[board] ?? null)
    if (!subject.needsApproval) throw new Error(`板 ${board} 在 PR 里和 base 比没有合同差异，不需要确认`)
    name = board
    sha256 = subject.fingerprint
    console.error(`确认板 ${board}：${describeBoardDiff(subject)}`)
  } else {
    name = perf
    let text = null
    try { text = git(['show', `${headSha}:tests/perf/scenarios/${perf}.json`]) } catch { /* PR 删了这个场景 */ }
    if (text === null) {
      try { git(['show', `${base}:tests/perf/scenarios/${perf}.json`]) } catch { throw new Error(`PR head 和 base 上都没有场景 ${perf}`) }
      sha256 = scenarioRemovedHash(perf)
    } else sha256 = scenarioPolicyHash(JSON.parse(text))
  }
  return { pr, kind: board ? 'board' : 'perf-policy', name, sha256, at: now(), note: argValue(argv, '--note') ?? '', head: headSha }
}

/** --suppressions：PR head（或还没开 PR 时的本地 HEAD）对 merge-base 的冻结数上涨。没有上涨就不需要确认（抛错说明）。 */
function buildSuppressionsApproval({ argv, pr, git, now, fetch }) {
  let headSha = argValue(argv, '--head')
  if (!headSha) {
    if (fetch) git(['fetch', '--quiet', 'origin', 'main'])
    if (pr !== null) {
      if (fetch) git(['fetch', '--quiet', 'origin', `pull/${pr}/head`])
      headSha = String(git(['rev-parse', 'FETCH_HEAD'])).trim()
    } else headSha = String(git(['rev-parse', 'HEAD'])).trim()
  }
  const base = String(git(['merge-base', 'origin/main', headSha])).trim()
  const read = (sha) => { try { return JSON.parse(git(['show', `${sha}:${SUPPRESSIONS_FILE}`])) } catch { return {} } }
  const subject = suppressionApprovalSubject(read(base), read(headSha))
  if (!subject.needsApproval) throw new Error(`${SUPPRESSIONS_FILE} 在 ${String(headSha).slice(0, 9)} 上和 base 比冻结数没有上涨，不需要确认`)
  console.error(`确认 ${SUPPRESSIONS_FILE}：${describeSuppressionGrowth(subject)}`)
  return { pr, kind: 'eslint-suppressions', name: SUPPRESSIONS_FILE, sha256: subject.fingerprint, at: now(), note: argValue(argv, '--note') ?? '', head: headSha }
}

function buildAllowlistApproval({ argv, pr, git, now, fetch }) {
  let headSha = argValue(argv, '--head')
  if (!headSha) {
    if (fetch) git(['fetch', '--quiet', 'origin', 'main'])
    if (pr !== null) {
      if (fetch) git(['fetch', '--quiet', 'origin', `pull/${pr}/head`])
      headSha = String(git(['rev-parse', 'FETCH_HEAD'])).trim()
    } else headSha = String(git(['rev-parse', 'HEAD'])).trim()
  }
  const base = String(git(['merge-base', 'origin/main', headSha])).trim()
  const read = (sha) => { try { return JSON.parse(git(['show', `${sha}:${GENERATED_ALLOWLIST_PATH}`])) } catch { return [] } }
  const subject = allowlistApprovalSubject(read(base), read(headSha))
  if (!subject.needsApproval) throw new Error(`${GENERATED_ALLOWLIST_PATH} 在 ${String(headSha).slice(0, 9)} 上和 base 比没有新增豁免规则，不需要确认`)
  console.error(`确认 ${GENERATED_ALLOWLIST_PATH}：新增规则 ${subject.addedGlobs.join('、')}`)
  return { pr, kind: 'generated-allowlist', name: GENERATED_ALLOWLIST_PATH, sha256: subject.fingerprint, at: now(), note: argValue(argv, '--note') ?? '', head: headSha }
}

function main() {
  const file = process.env[APPROVAL_ENV]
  if (!file) { console.error(`✖ 环境变量 ${APPROVAL_ENV} 没设置（协调确认记录文件的路径，本机文件，不进仓库）`); return 1 }
  try {
    const record = buildApproval({ argv: process.argv.slice(2) })
    fs.appendFileSync(file, `${JSON.stringify(record)}\n`)
    console.log(`✅ 已记录：${JSON.stringify(record)}`)
    return 0
  } catch (error) {
    console.error(`✖ ${String(error?.message ?? error).split('\n')[0]}`)
    return 1
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exitCode = main()
