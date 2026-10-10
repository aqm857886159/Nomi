#!/usr/bin/env node
// 合并前扫描（协调会话的工具，2026-10-02）。输入 PR 号，用 gh 读 PR 正文和改动文件，只打印结论，**不合并**。
// 它取代原来的交工前评审收据：不再问「有没有跑过评审」，而是问两个暂停点有没有真的发生——
//   ① 暂停点①设计卡：PR 正文 `## 设计卡` 是否填全（四类 9 格，其余只查 ★ 格 1、2、3、4、9）；
//   ② 暂停点②独立验收：四类的 PR 正文 `## 独立验收` 是否带报告链接，且验收线编号不同于实现线；
//   ③ 本 PR 把逃逸账本条目转成 fixed 时，有没有带 detected_by 的根因合同（判据看账本状态转换，不看正文用词）。
// 判四类的字符串规则与设计卡模板末尾那段一致（docs/engineering/design-card.md），宁可多报；误报由协调会话人工划掉。
//
// 用法：node scripts/merge-preflight.mjs <PR 号> [--repo owner/name] [--enforce]
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { ESCAPE_LEDGER_DIR, assembleEscapeLedger, escapeIdOfPath } from './escape-ledger-lib.mjs'
import { META_FILE } from './lib/entryDirectory.mjs'
import { execGhReadSync } from './lib/transientRetry.mjs'
import { RULES_INTRODUCED_BY_PR, evaluatePrBody, ledgerChanges, mergeReport, settledContracts } from './pr-body-criteria.mjs'
import {
  PROTECTED_PATHS,
  SCOPE_SECTION,
  checkProtectedScope,
  extractSection,
  addedLinesByFile,
} from './pr-judgement-lib.mjs'

// 所有 PR 正文判据（设计卡 / 独立验收 / 逃逸合同 / 路由 / 规则与门岗范围）都在 scripts/pr-body-criteria.mjs 与
// scripts/pr-judgement-lib.mjs；推送前的 check:pr-judgement 调同一份（2026-10-08，#1094：两边口径不一）。这里只留 gh 取数。
export { PROTECTED_PATHS, SCOPE_SECTION, checkProtectedScope, extractSection }

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/**
 * pulls/<n>/files 的分页输出（每行 filename\tstatus\tadditions\tdeletions[\tprevious_filename]）→ 文件表。纯函数、可测。
 * 改名（renamed）的行带上旧路径：逃逸账本一条一个文件以后，条目文件改名 = 旧 id 消失，必须看得见。
 */
export function parsePullFileRows(text) {
  return String(text || '').split('\n').filter(Boolean).map((row) => {
    const [path, status, additions, deletions, previousPath] = row.split('\t')
    return { path, status, additions: Number(additions) || 0, deletions: Number(deletions) || 0, ...(previousPath ? { previousPath } : {}) }
  })
}

function gh(args, { repo } = {}) {
  const full = repo ? [...args, '--repo', repo] : args
  return execGhReadSync(full, { cwd: repoRoot, maxBuffer: 64 * 1024 * 1024 })
}

function ghApiFile(repoSlug, filePath, ref) {
  try {
    const raw = execGhReadSync(['api', `repos/${repoSlug}/contents/${filePath}?ref=${ref}`, '--jq', '.content'], { cwd: repoRoot })
    return Buffer.from(raw.replace(/\s/g, ''), 'base64').toString('utf8')
  } catch {
    return null
  }
}

/** 某个 ref 上一个目录里的文件名（contents API 列目录，一次请求，不取内容）；取不到 = null。 */
function ghApiDirectoryNames(repoSlug, dirPath, ref) {
  try {
    const raw = execGhReadSync(['api', `repos/${repoSlug}/contents/${dirPath}?ref=${ref}`, '--jq', '.[] | select(.type == "file") | .name'], { cwd: repoRoot })
    return raw.split('\n').filter(Boolean)
  } catch {
    return null
  }
}

/**
 * GraphQL 取回的目录（Tree.entries：[{ name, object: { text } }]）→ 整本逃逸账本；走同一个 assembleEscapeLedger
 * （文件名 ↔ id 的规则只此一份）。缺 _meta.json / 内容坏了 → null。纯函数、可测。
 */
export function escapeLedgerFromTree(entries) {
  if (!Array.isArray(entries)) return null
  const texts = new Map(entries.filter((entry) => typeof entry?.object?.text === 'string').map((entry) => [entry.name, entry.object.text]))
  if (!texts.has(META_FILE)) return null
  try {
    const names = [...texts.keys()].filter((file) => file !== META_FILE && file.endsWith('.json')).sort()
    return assembleEscapeLedger({ meta: JSON.parse(texts.get(META_FILE)), entries: names.map((file) => ({ name: file, value: JSON.parse(texts.get(file)) })) })
  } catch {
    return null
  }
}

/** 某个 ref 上的整本逃逸账本：一次 GraphQL 请求取回目录里所有文件的内容（不是几十次 REST）。只在「判已结账合同」时用；取不到 = null。 */
function ghEscapeLedger(repoSlug, ref) {
  const [owner, name] = String(repoSlug).split('/')
  const query = 'query($owner:String!,$name:String!,$expr:String!){repository(owner:$owner,name:$name){object(expression:$expr){... on Tree{entries{name object{... on Blob{text}}}}}}}'
  try {
    const raw = execGhReadSync(['api', 'graphql', '-f', `query=${query}`, '-F', `owner=${owner}`, '-F', `name=${name}`, '-f', `expr=${ref}:${ESCAPE_LEDGER_DIR}`], { cwd: repoRoot, maxBuffer: 64 * 1024 * 1024 })
    return escapeLedgerFromTree(JSON.parse(raw)?.data?.repository?.object?.entries)
  } catch {
    return null
  }
}

export function main(argv = process.argv.slice(2)) {
  const prArg = argv.find((arg) => /^\d+$/.test(arg))
  const repoIndex = argv.indexOf('--repo')
  const repo = repoIndex >= 0 ? argv[repoIndex + 1] : undefined
  if (!prArg) {
    console.error('用法：node scripts/merge-preflight.mjs <PR 号> [--repo owner/name]')
    return 2
  }
  const view = JSON.parse(gh(['pr', 'view', prArg, '--json', 'body,files,headRefOid,baseRefName,headRepository,headRepositoryOwner,createdAt'], { repo }))
  const slug = repo ?? (view.headRepositoryOwner?.login && view.headRepository?.name ? `${view.headRepositoryOwner.login}/${view.headRepository.name}` : null)
  const baseSlug = repo ?? slug
  // 文件表只取一次、要全量：gh pr view 的 files 最多 100 个、超过静默截断（#1048 有 129 个文件，账本排在
  // 100 名之后，于是误报「用户发现的问题没转 fixed」）。走分页的 pulls/<n>/files，取不到才退回 view.files。
  let apiRows = null
  if (baseSlug) {
    try {
      apiRows = parsePullFileRows(gh(['api', `repos/${baseSlug}/pulls/${prArg}/files`, '--paginate', '--jq', '.[] | [.filename, .status, .additions, .deletions, (.previous_filename // "")] | @tsv']))
    } catch { apiRows = null }
  }
  const files = apiRows
    ? apiRows.map((row) => ({ path: row.path, status: row.status === 'added' ? 'A' : 'M' }))
    : (view.files ?? []).map((file) => ({ path: file.path, status: file.additions > 0 && file.deletions === 0 ? 'A' : 'M' }))
  let diff = ''
  try {
    diff = gh(['pr', 'diff', prArg], { repo })
  } catch {
    diff = ''
  }
  const addedLines = diff.split('\n').filter((line) => line.startsWith('+') && !line.startsWith('+++')).join('\n')
  const addedByFile = addedLinesByFile(diff)
  const body = view.body ?? ''

  const contracts = []
  for (const file of files.filter((entry) => /^docs\/fixes\/.+\.root-cause\.json$/.test(entry.path))) {
    const text = slug ? ghApiFile(slug, file.path, view.headRefOid) : null
    try {
      contracts.push({ file: file.path, added: file.status === 'A', detected_by: text ? JSON.parse(text).detected_by : undefined })
    } catch {
      contracts.push({ file: file.path, added: file.status === 'A', detected_by: undefined })
    }
  }

  // 逃逸账本（一条一个文件）：只有本 PR 动了条目文件，才去取那几个文件的 base / head 两版（base 取当前基线分支末端）
  const ledger = { transitions: [], ids: [], removed: [], settledContracts: [] }
  const baseRef = view.baseRefName || 'main'
  const ledgerRows = apiRows
    ? apiRows.map((row) => ({ path: row.path, status: row.status, previousPath: row.previousPath }))
    : files.map((file) => ({ path: file.path, status: file.status }))
  if (slug && ledgerRows.some((row) => escapeIdOfPath(row.path) || (row.previousPath && escapeIdOfPath(row.previousPath)))) {
    // 「转成 fixed」和「条目被删」都对本 PR 自己的起点（merge-base）比，不对 main 末端比（10-07 #1055 / #1065）：
    // PR 文件表本来就是对 merge-base 算的，main 后来新加的条目根本不在表里；base 那一版也取 merge-base 上的。
    // 取不到 merge-base 就退回 base 分支末端（fail-closed 不变）。
    let forkRef = baseRef
    try {
      const forkSha = gh(['api', `repos/${slug}/compare/${baseRef}...${view.headRefOid}`, '--jq', '.merge_base_commit.sha']).trim()
      if (/^[0-9a-f]{40}$/.test(forkSha)) forkRef = forkSha
    } catch { forkRef = baseRef }
    const changes = ledgerChanges(ledgerRows, (file, side) => ghApiFile(slug, file, side === 'base' ? forkRef : view.headRefOid))
    ledger.transitions = changes.transitions
    ledger.removed = changes.removed
    // 正文提到的条目 id（只做提示）：列一次 head 目录的文件名，不取内容
    ledger.ids = (ghApiDirectoryNames(slug, ESCAPE_LEDGER_DIR, view.headRefOid) ?? []).map((name) => escapeIdOfPath(`${ESCAPE_LEDGER_DIR}/${name}`)).filter(Boolean)
  }
  // 「修订已结账的合同」才需要知道 base 上哪些合同已结账：只在这时取一次 base 整本账（一次 GraphQL）
  const amendsUserContract = contracts.some((contract) => !contract.added && ['user', 'post-release'].includes(contract.detected_by))
  if (slug && amendsUserContract && ledger.transitions.length === 0) ledger.settledContracts = settledContracts(ghEscapeLedger(slug, baseRef))

  // 规则与门岗的改动范围：要真实的文件状态（removed / modified）；取不到分页表就按 modified 算
  // （漏判整文件删除，但点名要求照旧）
  const statusFiles = apiRows
    ? apiRows.map((row) => ({ path: row.path, status: row.status }))
    : files.map((file) => ({ path: file.path, status: 'modified' }))
  const packageBlock = diff.split(/^diff --git /m).find((block) => block.startsWith('a/package.json b/package.json')) ?? ''
  const packageRemovedLines = packageBlock.split('\n').filter((line) => line.startsWith('-') && !line.startsWith('---')).map((line) => line.slice(1))

  const report = mergeReport(prArg, evaluatePrBody({
    body,
    files: statusFiles.map((file) => ({ path: file.path, status: file.status === 'added' ? 'A' : file.status })),
    addedLines,
    addedByFile,
    packageRemovedLines,
    contracts,
    ledger,
    // #961 自己是引入规则的 PR，不吃宽限（createdAt 取 null = 不宽限）
    createdAt: Number(prArg) === RULES_INTRODUCED_BY_PR ? null : view.createdAt,
    enforce: argv.includes('--enforce'), // --enforce：假设路由规则已生效，看这个 PR 会不会红（回放用）
  }))
  console.log(report.text)
  return report.blocked ? 1 : 0
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exitCode = main()
