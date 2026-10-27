#!/usr/bin/env node
// 合并前扫描（协调会话的工具，2026-10-02）。输入 PR 号，读 PR 正文、在本地 git 里算这个 PR 改了什么，只打印结论，**不合并**。
// 它取代原来的交工前评审收据：不再问「有没有跑过评审」，而是问两个暂停点有没有真的发生——
//   ① 暂停点①设计卡：PR 正文 `## 设计卡` 是否填全（四类 9 格，其余只查 ★ 格 1、2、3、4、9）；
//   ② 暂停点②独立验收：四类的 PR 正文 `## 独立验收` 是否带报告链接，且验收线编号不同于实现线；
//   ③ 本 PR 把逃逸账本条目转成 fixed 时，有没有带 detected_by 的根因合同（判据看账本状态转换，不看正文用词）；
//   ④ 路径推出「花钱」类的 PR，`## 验收证据` 里有没有 `spend-paid-sample：<运行号 / 报告链接>` 或 `spend-paid-sample：协调豁免：<理由>`（不接受「未验证」）。
// 判四类的字符串规则与设计卡模板末尾那段一致（docs/engineering/design-card.md），宁可多报；误报由协调会话人工划掉。
//
// 取数（2026-10-24 起）：远程只剩两次——gh pr view 读正文 / head / 基线分支名 / 创建时间，git fetch 取基线分支末端与 pull/<n>/head。
// 改了什么（文件表、新增行、package.json 被删行）、PR 头和基线上的文件内容、merge-base 都在本地对 fetch 到的提交算。
// 原来这些走 GitHub API，各有上限：PR diff 超过 300 个文件就 406（#1269 改了 321 个，扫描只能打「取不到 PR diff」），
// 文件表 3000 个、列目录 1000 个、GraphQL 大 Blob 截断——本地 git 没有这些上限。
//
// 用法：node scripts/merge-preflight.mjs <PR 号> [--repo owner/name] [--enforce]
//   --repo 只给 gh pr view 用；本地 diff 永远从当前仓库的 origin fetch（origin 不是这个 PR 的仓库时 pull/<n>/head 对不上 head，判取数失败）。
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { ESCAPE_LEDGER_DIR, escapeIdOfPath, loadEscapeLedger } from './escape-ledger-lib.mjs'
import { localApprovals } from './lib/coordApprovals.mjs'
import { prChanges } from './lib/prChanges.mjs'
import { boardsAtHead, checkHeadAncestry, isRepoRelativeRef, suppressionsAt } from './lib/prEvidenceInputs.mjs'
import { execGhReadSync, retryTransientSync } from './lib/transientRetry.mjs'
import { RULES_INTRODUCED_BY_PR, evaluatePrBody, ledgerChanges, mergeReport, settledContracts } from './pr-body-criteria.mjs'
import { SCENARIO_DIR, knownScenarios, scenarioEntriesFromReader } from './perf-scenarios-lib.mjs'
import {
  PROTECTED_PATHS,
  SCOPE_SECTION,
  checkProtectedScope,
  deriveUiVerification,
  extractSection,
} from './pr-judgement-lib.mjs'

// 所有 PR 正文判据（设计卡 / 独立验收 / 逃逸合同 / 路由 / 规则与门岗范围）都在 scripts/pr-body-criteria.mjs 与
// scripts/pr-judgement-lib.mjs；推送前的 check:pr-judgement 调同一份（2026-10-08，#1094：两边口径不一）。这里只留取数。
export { PROTECTED_PATHS, SCOPE_SECTION, checkProtectedScope, extractSection }

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/**
 * 取数失败 = 没有结论。合并前扫描的每一个输入（文件表、diff、合同、账本）取不到都**不许**退到「少看一点」的口径继续判：
 * 少看一点既会误报（10-11 #1166：文件表分页偶发失败，退回只含前 100 个文件的 view.files，看不到排在后面的账本条目，
 * 判「没转 fixed」，下一轮取数成功又判通过），也会漏报（被截掉的文件里恰好有该拦的东西）。
 * main() 把它转成一行「结论：✖ 取不到……」——合并循环只认「结论：✖」，所以任何取数失败都会停手而不是放行。
 */
export class PreflightDataError extends Error {
  constructor(what, cause) {
    super(`取不到${what}${cause?.message ? `：${String(cause.message).split('\n')[0]}` : ''}`)
    this.name = 'PreflightDataError'
  }
}

function must(what, run) {
  try {
    return run()
  } catch (error) {
    if (error instanceof PreflightDataError) throw error
    throw new PreflightDataError(what, error)
  }
}

/**
 * fetch 基线分支末端与 PR head，返回这次 fetch 拿到的两个提交号。从 FETCH_HEAD 按引用名认
 * （「branch '<基线>' of …」「'refs/pull/<n>/head' of …」），不靠行序；认不出（同一工作树里并发的 fetch 把它覆盖了、
 * 远端没有这个引用）就抛错 = 取数失败。--write-fetch-head 钉死：fetch.writeFetchHead=false 时不写，读到的会是上一次的旧内容。
 * fetch 是网络调用，瞬断重试同 gh 的只读调用（scripts/lib/transientRetry.mjs）。
 */
function fetchPrCommits(git, pr, baseBranch) {
  retryTransientSync(() => git(['fetch', '--quiet', '--no-tags', '--write-fetch-head', 'origin', `refs/heads/${baseBranch}`, `refs/pull/${pr}/head`]), { retryTimeouts: true })
  const rows = fs.readFileSync(git(['rev-parse', '--path-format=absolute', '--git-path', 'FETCH_HEAD']).trim(), 'utf8').split('\n').map((line) => line.split('\t'))
  const shaOf = (name) => rows.find(([sha, , what]) => /^[0-9a-f]{40,64}$/.test(sha ?? '') && String(what ?? '').startsWith(`${name} of `))?.[0] ?? null
  const baseSha = shaOf(`branch '${baseBranch}'`)
  const headSha = shaOf(`'refs/pull/${pr}/head'`)
  if (!baseSha || !headSha) throw new Error(`FETCH_HEAD 里认不出 ${[baseSha ? null : baseBranch, headSha ? null : `pull/${pr}/head`].filter(Boolean).join('、')}（同一工作树里有别的 fetch 同时在跑？）`)
  return { baseSha, headSha }
}

/** 报告引用是仓库内相对路径（不是链接、不是绝对路径、不含 ..）。 */
const isRepoRef = isRepoRelativeRef

/** 合并前扫描读验收报告：本机绝对路径直接读；仓库内相对路径从 PR 头读；外部链接读不了。读不到一律 null（判据按红处理）。 */
export function readReportRef(ref, readRepoFile, readLocal = (file) => fs.readFileSync(file, 'utf8')) {
  try {
    if (/^https?:/i.test(ref)) return null
    if (isRepoRef(ref)) return readRepoFile(ref) ?? null
    return readLocal(ref)
  } catch { return null }
}

/** 本机 git（fetch、diff、读提交里的文件）；测试注入临时仓库。stderr 要接住：瞬断重试靠它认出网络错误。 */
const realGit = (args) => execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] })

/** 对外入口：任何取数失败都收成一行「结论：✖」，退出码 1。exec（gh）、git 与仓库根（读整本逃逸账本用）可注入（测试用）。 */
export function main(argv = process.argv.slice(2), exec = execGhReadSync, git = realGit, root = repoRoot) {
  try {
    return run(argv, exec, git, root)
  } catch (error) {
    if (!(error instanceof PreflightDataError)) throw error
    console.log(`✖ ${error.message}——取数不全就不下结论，重跑一次；反复失败再查网络 / gh 登录 / 本机 git 仓库`)
    console.log('结论：✖ 有项没过，先别合（取数失败，不是 PR 的问题；脚本只打印结论，不合并）')
    return 1
  }
}

function run(argv, exec, git, root) {
  const gh = (args, { repo } = {}) => exec(repo ? [...args, '--repo', repo] : args, { cwd: repoRoot, maxBuffer: 64 * 1024 * 1024 })
  const prArg = argv.find((arg) => /^\d+$/.test(arg))
  const repoIndex = argv.indexOf('--repo')
  const repo = repoIndex >= 0 ? argv[repoIndex + 1] : undefined
  if (!prArg) {
    console.error('用法：node scripts/merge-preflight.mjs <PR 号> [--repo owner/name]')
    return 2
  }
  const view = must('PR 基本信息', () => JSON.parse(gh(['pr', 'view', prArg, '--json', 'body,headRefOid,baseRefName,createdAt'], { repo })))
  const body = view.body ?? ''

  // 「这个 PR 改了什么」只来自本地 git：fetch 基线分支末端和 PR head，本地算 merge-base 与 diff。
  // 判据代码与政策表仍取本检出（main），数据取 PR 头 / 本 PR 的 diff（「政策取 main、数据取 PR 头」不变）。
  const baseBranch = view.baseRefName || 'main'
  const { baseSha, headSha } = must('PR head 与基线分支的提交（git fetch）', () => fetchPrCommits(git, prArg, baseBranch))
  // fetch 到的必须就是正文对应的那一版：取数这几秒里 PR 又推了，就不拿新 head 去判旧正文
  if (headSha !== view.headRefOid) {
    throw new PreflightDataError('和正文同一版的 PR head', new Error(`fetch 到的 pull/${prArg}/head 是 ${headSha.slice(0, 12)}，gh pr view 给的是 ${String(view.headRefOid).slice(0, 12)}（取数这几秒里 PR 又推了？）`))
  }
  // 浅克隆里 merge-base 可能算不出或算错，不能当真
  if (must('本机仓库是不是浅克隆', () => git(['rev-parse', '--is-shallow-repository']).trim()) === 'true') {
    throw new PreflightDataError('完整的提交历史', new Error('本机仓库是浅克隆，merge-base 算不准'))
  }
  const forkSha = must('merge-base', () => git(['merge-base', baseSha, headSha]).trim())
  const { files, addedByFile, packageRemovedLines } = must('PR 改动（本地 git diff）', () => prChanges({ git, base: forkSha, head: headSha }))

  /** 某个提交上的文件内容：这个提交上确实没有这个路径 → null；别的失败（对象缺失、是目录、读不出来）一律抛出，不当作「没有」。 */
  const showAt = (sha, file) => {
    const what = `${file}@${String(sha).slice(0, 9)} 的内容`
    let oid
    try {
      oid = git(['rev-parse', '--verify', '--quiet', `${sha}:${file}`]).trim()
    } catch (error) {
      if (error?.status === 1) return null
      throw new PreflightDataError(what, error)
    }
    return must(what, () => git(['cat-file', 'blob', oid]))
  }
  /** 某个提交上一个目录里这一层的文件名（不取内容）。 */
  const fileNamesAt = (sha, dir) => must(`${dir} 的文件列表`, () => git(['ls-tree', '-z', sha, '--', `${dir}/`])
    .split('\0').filter(Boolean).map((row) => row.split('\t'))
    .filter(([meta]) => meta.split(' ')[1] === 'blob').map(([, file]) => file.slice(dir.length + 1)))

  const contracts = []
  for (const file of files.filter((entry) => entry.status !== 'D' && /^docs\/fixes\/.+\.root-cause\.json$/.test(entry.path))) {
    const text = showAt(headSha, file.path)
    try {
      contracts.push({ file: file.path, added: file.status === 'A', detected_by: text ? JSON.parse(text).detected_by : undefined })
    } catch {
      contracts.push({ file: file.path, added: file.status === 'A', detected_by: undefined })
    }
  }

  // 逃逸账本（一条一个文件）：只有本 PR 动了条目文件，才去取那几个文件的 base / head 两版
  const ledger = { transitions: [], ids: [], removed: [], settledContracts: [] }
  if (files.some((file) => escapeIdOfPath(file.path))) {
    // 「转成 fixed」和「条目被删」都对本 PR 自己的起点（merge-base）比，不对 main 末端比（10-07 #1055 / #1065）：
    // main 后来新加的条目不在本 PR 的文件表里。条目文件改名在文件表里是「旧路径 D + 新路径 A」，旧 id 照样算被删。
    const changes = ledgerChanges(files, (file, side) => showAt(side === 'base' ? forkSha : headSha, file))
    ledger.transitions = changes.transitions
    ledger.removed = changes.removed
    // 正文提到的条目 id（只做提示）：列一次 head 目录的文件名，不取内容
    ledger.ids = fileNamesAt(headSha, ESCAPE_LEDGER_DIR).map((name) => escapeIdOfPath(`${ESCAPE_LEDGER_DIR}/${name}`)).filter(Boolean)
  }
  // 「修订已结账的合同」才需要知道基线上哪些合同已结账：只在这时读一次基线分支末端的整本账（唯一加载函数 loadEscapeLedger）
  const amendsUserContract = contracts.some((contract) => !contract.added && ['user', 'post-release'].includes(contract.detected_by))
  if (amendsUserContract && ledger.transitions.length === 0) {
    ledger.settledContracts = settledContracts(must('基线上的整本逃逸账本', () => {
      const whole = loadEscapeLedger(root, { ref: baseSha })
      if (!whole) throw new Error('账本目录读不出来')
      return whole
    }))
  }

  // 性能场景 id（G-perfreg，2026-10-15）：已知 = (基线登记表 − 本 PR 删掉的) ∪ 本 PR 新增 / 改动的文件（PR 头内容）。
  // 只核证据行的 id；场景文件结构以 CI 的 check:perf-scenarios（合并引用上）为准，这里不拿检出的 DRIVERS 校验 PR 文件。
  const scenarioRe = /^tests\/perf\/scenarios\/[^/]+\.json$/
  const scenarioRows = files.filter((row) => scenarioRe.test(row.path))
  const baseScenarioNames = fileNamesAt(baseSha, SCENARIO_DIR).filter((name) => name.endsWith('.json'))
  const scenarios = knownScenarios({
    baseEntries: scenarioEntriesFromReader(baseScenarioNames, (name) => showAt(baseSha, `${SCENARIO_DIR}/${name}`)),
    prFiles: scenarioRows.filter((row) => row.status !== 'D').map((row) => ({ file: row.path, content: showAt(headSha, row.path) })),
    removedFiles: scenarioRows.filter((row) => row.status === 'D').map((row) => row.path),
  })

  const report = mergeReport(prArg, evaluatePrBody({
    body,
    files,
    addedByFile,
    packageRemovedLines,
    contracts,
    ledger,
    // #961 自己是引入规则的 PR，不吃宽限（createdAt 取 null = 不宽限）
    createdAt: Number(prArg) === RULES_INTRODUCED_BY_PR ? null : view.createdAt,
    enforce: argv.includes('--enforce'), // --enforce：假设路由规则已生效，看这个 PR 会不会红（回放用）
    scenarios,
    // 花钱类的真付费抽检只在这一道严格判：「未验证」与裸 PR 号都不放行（#1203 就是这样被合进来的）
    paidStrict: true,
    // 证据判「对不对」的输入（取数在这里，判据在 pr-body-criteria）：PR 当前 head、报告 / 原始结果怎么读、拍板图清单
    evidence: {
      headSha,
      // 协调目录的报告在本机读（读不到 = null = 红）；仓库内路径从 PR 头读；外部链接读不了
      readReport: (ref) => readReportRef(ref, (file) => showAt(headSha, file)),
      readRaw: (ref) => (isRepoRef(ref) ? showAt(headSha, ref) : null),
      // 拍板图清单和提交历史都取 PR head（PR 自己新增的板在 main 检出里读不到）；规则与判据仍从 base 读。取不到 = 取数失败（红）
      headRelation: (accepted, head) => {
        const result = checkHeadAncestry({ git, accepted, head })
        // 本机必须算得出：算不了（浅克隆、没有历史）不能当通过
        return result.unknown ? { ok: false, reason: `读不到提交历史：${result.reason}` } : result
      },
      // 批准身份看 base（merge-base）或协调确认记录（NOMI_COORD_APPROVALS，本机、不进仓库）：PR 自己新增的板 / 元素 / 政策字段没有记录就红
      approvals: localApprovals({ pr: Number(prArg) }),
      baseBoards: () => must('base 上的拍板图清单', () => boardsAtHead({ git, sha: forkSha })),
      boards: () => must('PR 头上的拍板图清单', () => boardsAtHead({ git, sha: headSha })),
      // 短档的界面核实与正文判据共用这次 base/head 取数；任何取不到都由判据升严。
      uiVerification: deriveUiVerification({
        files,
        baseBoards: () => must('base 上的拍板图清单', () => boardsAtHead({ git, sha: forkSha })),
        headBoards: () => must('PR 头上的拍板图清单', () => boardsAtHead({ git, sha: headSha })),
      }),
      // ESLint 批量抑制的冻结数上涨：没有协调确认记录就红
      suppressions: () => must('PR 头上的 eslint-suppressions.json', () => suppressionsAt({ git, sha: headSha })),
      baseSuppressions: () => must('base 上的 eslint-suppressions.json', () => suppressionsAt({ git, sha: forkSha })),
    },
  }))
  console.log(report.text)
  return report.blocked ? 1 : 0
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exitCode = main()
