#!/usr/bin/env node
// 数门门岗（R21 / R27，2026-09-11）。判据住在 scripts/door-map-lib.mjs；本文件只负责
// 取 diff 里的合同、取 PR 正文、报红。
//
// 合同侧的「doors 必填 + 每条 path:line 要解析得到」由 check:root-cause-contracts 验；
// 本门岗只管**派工侧**那一半：判为 recurring 的修复，PR 正文得指得到那份带门表的合同。
//
// PR 侧什么时候生效（fail-closed 的边界写死在这里，别靠猜）：
//   · CI 的 pull_request 事件：GITHUB_EVENT_NAME=pull_request 时**必查**，正文从 DOOR_MAP_PR_BODY
//     读（工作流在 contracts job 的 env 里注入）。正文为空 = 没引用 = 红。
//   · 本地：默认跳过（本地没有 PR 这个东西）；显式加 --pr 时用 `gh pr view --json body` 取正文，
//     取不到就明说「今天没查成」并跳过，不假装通过。
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { DOOR_MAP_THRESHOLD_DATE, evaluatePullRequest, governedContracts } from './door-map-lib.mjs'
import { gitPaths } from './lib/gitPaths.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function git(args) {
  return execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8' }).trim()
}

function baseRef() {
  const explicit = process.env.DOOR_MAP_BASE_REF?.trim() || process.env.ROOT_CAUSE_BASE_REF?.trim()
  if (explicit && !/^0+$/.test(explicit)) {
    try {
      git(['rev-parse', '--verify', `${explicit}^{commit}`])
      return explicit
    } catch {
      return null
    }
  }
  try {
    return git(['merge-base', 'HEAD', 'origin/main'])
  } catch {
    return null
  }
}

/** 本次 diff 里新增/修改的根因合同（含未跟踪文件）。取不到可信 base 就返回 null = 不判。 */
function changedContracts() {
  const base = baseRef()
  if (!base) return null
  const files = new Set([
    ...gitPaths(['diff', '--no-renames', '--name-only', base, '--', 'docs/fixes'], { cwd: repoRoot }),
    ...gitPaths(['ls-files', '--others', '--exclude-standard', '--', 'docs/fixes'], { cwd: repoRoot }),
  ])
  const contracts = []
  for (const file of [...files].sort()) {
    if (!file.endsWith('.root-cause.json')) continue
    const absolute = path.join(repoRoot, file)
    if (!fs.existsSync(absolute)) continue
    try {
      contracts.push({ file, contract: JSON.parse(fs.readFileSync(absolute, 'utf8')) })
    } catch (error) {
      console.error(`✖ 无法解析根因合同 ${file}：${error instanceof Error ? error.message : String(error)}`)
      process.exit(1)
    }
  }
  return contracts
}

function pullRequestBody() {
  if (process.env.GITHUB_EVENT_NAME === 'pull_request') {
    return { available: true, body: process.env.DOOR_MAP_PR_BODY ?? '' }
  }
  if (!process.argv.includes('--pr')) return { available: false, reason: '不在 pull_request 事件里，且未加 --pr' }
  try {
    return {
      available: true,
      body: execFileSync('gh', ['pr', 'view', '--json', 'body', '--jq', '.body'], {
        cwd: repoRoot,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      }),
    }
  } catch (error) {
    return { available: false, reason: `gh pr view 取不到正文：${error instanceof Error ? error.message.split('\n')[0] : String(error)}` }
  }
}

const contracts = changedContracts()
if (contracts === null) {
  console.log('⚠️ 数门门岗：拿不到可信 base，本次不判 —— 不拿算不出来当通过')
  process.exit(0)
}
const governed = governedContracts({ contracts })
const pr = pullRequestBody()
const errors = pr.available ? evaluatePullRequest({ body: pr.body, contracts }) : []

if (errors.length > 0) {
  console.error('✖ 数门门岗失败（R21：复发类修复必须先数门，门表必须在派工链上看得见）：')
  for (const error of errors) console.error(`  - ${error}`)
  console.error('\n  → 数门：node scripts/door-map.mjs <mutator 符号或文件>，输出直接粘进合同的 "doors"；')
  console.error('  → 修复任务书与 PR 正文都要引用那份合同路径（详见 docs/engineering-rules.md R21/R27）。')
  process.exit(1)
}

const note = pr.available ? 'PR 侧已查' : `PR 侧跳过（${pr.reason}）`
console.log(`✅ 数门门岗：本次 ${contracts.length} 份变化中的合同，${governed.length} 份受管`
  + `（阈值 ${DOOR_MAP_THRESHOLD_DATE}，只管 recurring）；${note}`)
