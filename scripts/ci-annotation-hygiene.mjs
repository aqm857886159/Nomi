import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { fetchWithRetry } from './lib/transientRetry.mjs'
import { CORE_SMOKE_ADVISORY_CHECK_NAMES } from './validation-policy.mjs'

const API_ROOT = 'https://api.github.com'
const REJECTED_LEVELS = new Set(['warning', 'failure'])

// 非阻断（advisory）核心冒烟格的 owner：TODO 的 T-QA-23（`used` 升阻断）。
export const ADVISORY_CORE_SMOKE_OWNER = 'T-QA-23 core smoke advisory fixture'
// 名单**派生自 scripts/validation-policy.mjs 的单一 owner**，不写死格子名：
// 那里把 'used' 移进 CORE_SMOKE_BLOCKING_FIXTURES（T-QA-23 升阻断）的当天，
// 这条委派规则自动失效，used 的失败注解立刻变回 unexpected，不必也不许再改这里。
const ADVISORY_CORE_SMOKE_JOB_NAMES = new Set(CORE_SMOKE_ADVISORY_CHECK_NAMES)

function matchesPattern(value, pattern) {
  return pattern === undefined || new RegExp(pattern, 'u').test(value || '')
}

function delegatedOwner(annotation) {
  // A cancelled package job can emit a failure annotation when GitHub's six-hour
  // execution ceiling is reached. The cancellation is owned by workflow
  // orchestration (and is already reflected in the job conclusion), rather than
  // being an unowned product failure that should block annotation hygiene.
  if (
    annotation.level === 'failure' &&
    annotation.jobName === 'Mac Package' &&
    annotation.jobConclusion === 'cancelled' &&
    annotation.path === '.github'
  ) {
    return 'workflow orchestration cancellation'
  }
  if (
    annotation.level === 'warning' &&
    annotation.jobName === 'Contracts' &&
    annotation.path &&
    annotation.path !== '.github'
  ) {
    return 'lint:ci warning budget'
  }
  // 文档/生成物门在 PR 上是 advisory：失败变成一条带 docs-autosync 标题的 warning 注解，
  // 补齐由 .github/workflows/docs-autosync.yml 在 main 上做（见 scripts/run-gates-contracts.mjs）。
  // 它**有主体、且主体真的会跑**，所以是「委派」而不是「豁免」——因此不进需要写过期日期的
  // allowlist：allowlist 是给临时状况用的，给一条永久且有 owner 的机制配过期日只会到期再红一次。
  if (annotation.level === 'warning' && annotation.title === 'docs-autosync') {
    return 'docs-autosync workflow on main'
  }
  // 「疑似不稳定」：vitest 重试后才通过的测试，由 scripts/vitest-flaky-reporter.mjs 打成 warning——只提示、不阻断，
  // 有主体（那份 reporter）、主体真的会跑，所以是委派不是豁免。真失败是 failure 注解，不受这条影响。
  if (annotation.level === 'warning' && annotation.title === '疑似不稳定') {
    return 'vitest retry flaky hint'
  }
  // 非阻断的核心冒烟格（2026-09-22 用户拍板，docs/plan/2026-09-22-core-flow-smoke-three-defenses.md）：
  // 它红了 job 级 continue-on-error 只放过 needs.core-smoke.result，**注解还在**——
  // `##[error]Process completed with exit code 1.` 会以 failure 注解进到本环，
  // 于是 Quality Gate 汇总的第一行 `test ci-hygiene.outcome = success` 把它重新变回阻断门
  // （2026-09-22 main ffffadc7d 实测：1 unexpected → 汇总红 → 收据出不来）。
  // 这一格有主体、且主体是登记在案的 TODO（T-QA-23：三条布局 bug 修完 + used 连跑 5 次全绿后升阻断），
  // 所以是「委派」而不是「豁免」，同 docs-autosync 那条的理由——不进要写过期日的 allowlist。
  // 只认非阻断名单里的格子：阻断档 Core Flow Smoke (empty) 不在 ADVISORY 名单里，它的注解照旧是 unexpected。
  if (annotation.level === 'failure' && ADVISORY_CORE_SMOKE_JOB_NAMES.has(annotation.jobName)) {
    return ADVISORY_CORE_SMOKE_OWNER
  }
  return null
}

function validateAllowlist(allowlist) {
  if (allowlist?.schemaVersion !== 1 || !Array.isArray(allowlist.entries)) {
    throw new Error('CI annotation allowlist must use schemaVersion 1 with an entries array')
  }
  for (const [index, entry] of allowlist.entries.entries()) {
    if (typeof entry.reason !== 'string' || entry.reason.trim() === '' || typeof entry.expires !== 'string') {
      throw new Error(`CI annotation allowlist entry ${index} requires reason and expires`)
    }
    const expiration = new Date(`${entry.expires}T00:00:00.000Z`)
    if (
      !/^\d{4}-\d{2}-\d{2}$/u.test(entry.expires) ||
      Number.isNaN(expiration.valueOf()) ||
      expiration.toISOString().slice(0, 10) !== entry.expires
    ) {
      throw new Error(`CI annotation allowlist entry ${index} has an invalid YYYY-MM-DD expiry`)
    }
    if (!entry.jobPattern && !entry.pathPattern && !entry.messagePattern) {
      throw new Error(`CI annotation allowlist entry ${index} requires at least one match pattern`)
    }
    for (const key of ['jobPattern', 'pathPattern', 'messagePattern']) {
      if (entry[key] !== undefined && typeof entry[key] !== 'string') {
        throw new Error(`CI annotation allowlist entry ${index} ${key} must be a string`)
      }
      if (entry[key] !== undefined) new RegExp(entry[key], 'u')
    }
  }
  return allowlist.entries
}

async function requestJson(url, { token, fetchImpl, retryOptions }) {
  // 去 GitHub API 取注解是网络调用：一次 `fetch failed` / 5xx 不许直接把 Quality Gate 判红（2026-10 main 事故），走共用重试边界。
  const response = await fetchWithRetry(
    url,
    {
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'X-GitHub-Api-Version': '2022-11-28',
      },
    },
    { fetchImpl, ...retryOptions },
  )
  if (!response.ok) throw new Error(`GitHub API request failed with HTTP ${response.status}: ${url}`)
  return response.json()
}

async function listRunJobs({ repository, runId, token, fetchImpl, retryOptions }) {
  const jobs = []
  for (let page = 1; ; page += 1) {
    const payload = await requestJson(
      `${API_ROOT}/repos/${repository}/actions/runs/${runId}/jobs?per_page=100&page=${page}`,
      { token, fetchImpl, retryOptions },
    )
    if (!Array.isArray(payload.jobs)) throw new Error('GitHub Actions jobs response omitted jobs')
    jobs.push(...payload.jobs)
    if (payload.jobs.length < 100) return jobs
  }
}

async function listJobAnnotations({ repository, job, token, fetchImpl, retryOptions }) {
  const annotations = []
  for (let page = 1; ; page += 1) {
    const payload = await requestJson(
      `${API_ROOT}/repos/${repository}/check-runs/${job.id}/annotations?per_page=100&page=${page}`,
      { token, fetchImpl, retryOptions },
    )
    if (!Array.isArray(payload)) throw new Error(`Check annotations response for ${job.name} was not an array`)
    annotations.push(
      ...payload.map((annotation) => ({
        jobId: job.id,
        jobName: job.name,
        jobConclusion: job.conclusion,
        level: annotation.annotation_level,
        path: annotation.path || '',
        startLine: annotation.start_line ?? null,
        endLine: annotation.end_line ?? null,
        title: annotation.title || '',
        message: annotation.message || '',
      })),
    )
    if (payload.length < 100) return annotations
  }
}

export async function collectRunAnnotations({ repository, runId, token, fetchImpl, retryOptions }) {
  const jobs = await listRunJobs({ repository, runId, token, fetchImpl, retryOptions })
  const completedJobs = jobs.filter((job) => job.status === 'completed')
  const annotationsByJob = await Promise.all(
    completedJobs.map((job) => listJobAnnotations({ repository, job, token, fetchImpl, retryOptions })),
  )
  return {
    jobs: completedJobs.map((job) => ({ id: job.id, name: job.name, conclusion: job.conclusion })),
    annotations: annotationsByJob.flat(),
  }
}

export function evaluateAnnotations(annotations, allowlist, now = new Date()) {
  const entries = validateAllowlist(allowlist)
  const today = now.toISOString().slice(0, 10)
  const expiredAllowlistEntries = entries.filter((entry) => entry.expires < today)
  const activeEntries = entries.filter((entry) => entry.expires >= today)
  const delegated = []
  const allowed = []
  const unexpected = []

  for (const annotation of annotations.filter((entry) => REJECTED_LEVELS.has(entry.level))) {
    const owner = delegatedOwner(annotation)
    if (owner) {
      delegated.push({ annotation, owner })
      continue
    }
    const rule = activeEntries.find(
      (entry) =>
        matchesPattern(annotation.jobName, entry.jobPattern) &&
        matchesPattern(annotation.path, entry.pathPattern) &&
        matchesPattern(annotation.message, entry.messagePattern),
    )
    if (rule) allowed.push({ annotation, reason: rule.reason, expires: rule.expires })
    else unexpected.push(annotation)
  }

  // advisory 冒烟格单列出来：它不判，但必须**看得见它红了**——否则「不阻断」就滑成「没发生过」，
  // T-QA-23 也就永远等不到「连跑 5 次全绿」的观测面。
  const advisorySmoke = delegated.filter((entry) => entry.owner === ADVISORY_CORE_SMOKE_OWNER)

  return { delegated, allowed, unexpected, advisorySmoke, expiredAllowlistEntries }
}

export async function auditCiAnnotations({
  repository,
  runId,
  runAttempt = '',
  token,
  allowlist,
  fetchImpl,
  retryOptions,
  now = new Date(),
}) {
  const base = {
    schemaVersion: 1,
    repository,
    runId: String(runId || ''),
    runAttempt: String(runAttempt || ''),
    generatedAt: now.toISOString(),
  }
  try {
    if (!repository || !runId || !token) throw new Error('GITHUB_REPOSITORY, GITHUB_RUN_ID, and GITHUB_TOKEN are required')
    const collected = await collectRunAnnotations({ repository, runId, token, fetchImpl, retryOptions })
    const evaluation = evaluateAnnotations(collected.annotations, allowlist, now)
    return {
      ...base,
      ...collected,
      ...evaluation,
      passed: evaluation.unexpected.length === 0 && evaluation.expiredAllowlistEntries.length === 0,
      error: null,
    }
  } catch (error) {
    return {
      ...base,
      jobs: [],
      annotations: [],
      delegated: [],
      allowed: [],
      unexpected: [],
      advisorySmoke: [],
      expiredAllowlistEntries: [],
      passed: false,
      error: { message: error instanceof Error ? error.message : String(error) },
    }
  }
}

function writeReport(outputPath, report) {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true })
  fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`)
}

async function main() {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
  const allowlistPath = path.join(repoRoot, 'scripts', 'ci-annotation-allowlist.json')
  const outputPath = path.join(repoRoot, 'outputs', 'ci-hygiene', 'ci-annotations.json')
  let allowlist
  try {
    allowlist = JSON.parse(fs.readFileSync(allowlistPath, 'utf8'))
  } catch (error) {
    allowlist = { schemaVersion: 0, entries: [], loadError: String(error) }
  }
  const report = await auditCiAnnotations({
    repository: process.env.GITHUB_REPOSITORY,
    runId: process.env.GITHUB_RUN_ID,
    runAttempt: process.env.GITHUB_RUN_ATTEMPT,
    token: process.env.GITHUB_TOKEN,
    allowlist,
  })
  writeReport(outputPath, report)
  console.log(
    `CI annotation hygiene: ${report.annotations.length} annotations, ${report.delegated.length} delegated, ${report.allowed.length} allowed, ${report.unexpected.length} unexpected`,
  )
  // 单列一行：advisory 冒烟格红了不判，但要在日志里看得见（owner 是 T-QA-23）。
  const advisoryJobs = [...new Set(report.advisorySmoke.map((entry) => entry.annotation.jobName))]
  console.log(
    `advisory-smoke: ${report.advisorySmoke.length}${advisoryJobs.length > 0 ? ` (${advisoryJobs.join(', ')} -> ${ADVISORY_CORE_SMOKE_OWNER})` : ''}`,
  )
  if (!report.passed) {
    console.error(`CI annotation hygiene failed; inspect ${path.relative(repoRoot, outputPath)}`)
    process.exitCode = 1
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main()
