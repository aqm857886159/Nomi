import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'

import {
  ADVISORY_CORE_SMOKE_OWNER,
  auditCiAnnotations,
  collectRunAnnotations,
  evaluateAnnotations,
} from './ci-annotation-hygiene.mjs'
import { CORE_SMOKE_ADVISORY_CHECK_NAMES, CORE_SMOKE_BLOCKING_CHECK_NAMES } from './validation-policy.mjs'

function response(body, { ok = true, status = 200 } = {}) {
  return { ok, status, json: async () => body }
}

test('collects annotations only from completed jobs in the exact workflow run', async () => {
  const requested = []
  const fetchImpl = async (url, options) => {
    requested.push({ url, authorization: options.headers.Authorization })
    if (url.includes('/actions/runs/123/jobs')) {
      return response({
        jobs: [
          { id: 10, name: 'Contracts', status: 'completed', conclusion: 'success' },
          { id: 11, name: 'E2E Walkthroughs (Linux)', status: 'completed', conclusion: 'success' },
          { id: 12, name: 'Quality Gate', status: 'in_progress', conclusion: null },
        ],
      })
    }
    if (url.includes('/check-runs/10/annotations')) {
      return response([{ annotation_level: 'warning', path: '.github', message: 'deprecated action' }])
    }
    if (url.includes('/check-runs/11/annotations')) return response([])
    throw new Error(`Unexpected URL: ${url}`)
  }

  const result = await collectRunAnnotations({
    repository: 'owner/repo',
    runId: '123',
    token: 'test-token',
    fetchImpl,
  })

  assert.deepEqual(result.jobs, [
    { id: 10, name: 'Contracts', conclusion: 'success' },
    { id: 11, name: 'E2E Walkthroughs (Linux)', conclusion: 'success' },
  ])
  assert.equal(result.annotations[0].message, 'deprecated action')
  assert.ok(requested.every((request) => request.authorization === 'Bearer test-token'))
  assert.ok(requested.every((request) => !request.url.includes('/check-runs/12/')))
})

test('rejects warnings by default and requires documented, unexpired exceptions', () => {
  const annotations = [
    { jobName: 'Contracts', path: '.github', message: 'Node.js 20 is deprecated', level: 'warning' },
    { jobName: 'Contracts', path: 'src/a.ts', message: 'Unexpected any', level: 'warning' },
    { jobName: 'Contracts', path: 'src/b.ts', message: 'Compile failed', level: 'failure' },
    { jobName: 'Unit', path: 'src/a.ts', message: 'informational', level: 'notice' },
  ]
  const strict = evaluateAnnotations(annotations, { schemaVersion: 1, entries: [] }, new Date('2026-08-30T00:00:00Z'))
  assert.equal(strict.delegated.length, 1)
  assert.equal(strict.delegated[0].owner, 'lint:ci warning budget')
  assert.equal(strict.unexpected.length, 2)

  const allowlisted = evaluateAnnotations(
    annotations,
    {
      schemaVersion: 1,
      entries: [
        {
          jobPattern: '^Contracts$',
          messagePattern: 'Node\\.js 20 is deprecated',
          reason: 'Temporary upstream migration window',
          expires: '2026-09-01',
        },
      ],
    },
    new Date('2026-08-30T00:00:00Z'),
  )
  assert.equal(allowlisted.allowed.length, 1)
  assert.equal(allowlisted.delegated.length, 1)
  assert.equal(allowlisted.unexpected.length, 1)
  assert.equal(allowlisted.expiredAllowlistEntries.length, 0)

  const expired = evaluateAnnotations(
    annotations,
    {
      schemaVersion: 1,
      entries: [
        {
          messagePattern: 'deprecated',
          reason: 'Expired migration window',
          expires: '2026-08-29',
        },
      ],
    },
    new Date('2026-08-30T00:00:00Z'),
  )
  assert.equal(expired.delegated.length, 1)
  assert.equal(expired.unexpected.length, 2)
  assert.equal(expired.expiredAllowlistEntries.length, 1)
})

test('fails closed with machine-readable context when GitHub evidence is unavailable', async () => {
  const report = await auditCiAnnotations({
    repository: 'owner/repo',
    runId: '123',
    runAttempt: '2',
    token: 'test-token',
    allowlist: { schemaVersion: 1, entries: [] },
    now: new Date('2026-08-30T00:00:00Z'),
    fetchImpl: async () => response({}, { ok: false, status: 403 }),
  })

  assert.equal(report.passed, false)
  assert.equal(report.runId, '123')
  assert.equal(report.runAttempt, '2')
  assert.match(report.error.message, /HTTP 403/)
})

test('rejects malformed allowlist expiry instead of creating a permanent warning bypass', () => {
  assert.throws(
    () =>
      evaluateAnnotations(
        [],
        {
          schemaVersion: 1,
          entries: [{ messagePattern: 'warning', reason: 'Invalid expiry', expires: 'later' }],
        },
        new Date('2026-08-30T00:00:00Z'),
      ),
    /invalid YYYY-MM-DD expiry/,
  )
})

test('advisory 文档门的 warning 委派给 docs-autosync，而不是当成意外警告', () => {
  // gates:contracts 把 check:docs-index / doc-status / ledger 的失败降成一条注解
  // （标题固定 docs-autosync），补齐由 main 上的 docs-autosync 工作流做。
  // 它有真实 owner，所以不该出现在 unexpected 里逼作者去修——那样等于 advisory 白降。
  const annotations = [
    {
      jobName: 'Contracts',
      path: '.github',
      title: 'docs-autosync',
      message: 'check:docs-index 未通过：合入 main 后自动补齐',
      level: 'warning',
    },
    { jobName: 'Contracts', path: '.github', title: '', message: 'Node.js 20 is deprecated', level: 'warning' },
  ]
  const result = evaluateAnnotations(annotations, { schemaVersion: 1, entries: [] }, new Date('2026-09-05T00:00:00Z'))

  assert.equal(result.delegated.length, 1)
  assert.equal(result.delegated[0].owner, 'docs-autosync workflow on main')
  // 委派**只认这一个标题**：别的无路径 warning 照样是 unexpected，不许顺手放行一片。
  assert.equal(result.unexpected.length, 1)
  assert.match(result.unexpected[0].message, /Node\.js 20/)
})

test('取消的 Mac Package 超时注解归 workflow 编排 owner', () => {
  const result = evaluateAnnotations([
    {
      jobName: 'Mac Package', jobConclusion: 'cancelled', path: '.github',
      level: 'failure', message: 'The operation was canceled.',
    },
  ], { schemaVersion: 1, entries: [] }, new Date('2026-09-05T00:00:00Z'))

  assert.equal(result.delegated.length, 1)
  assert.equal(result.delegated[0].owner, 'workflow orchestration cancellation')
  assert.equal(result.unexpected.length, 0)
})

// ── 非阻断核心冒烟格（2026-09-22 用户拍板）────────────────────────────────────
// job 级 continue-on-error 只放过 needs.core-smoke.result，注解还在：advisory 格红了会留下
// 一条 `##[error]Process completed with exit code 1.`（annotation_level=failure）。此前本环把它
// 判成 unexpected，Quality Gate 汇总的第一行 `test ci-hygiene.outcome = success` 就把 advisory
// 重新变回阻断门（main ffffadc7d 实测：16 annotations / 10 delegated / 0 allowed / 1 unexpected）。

const advisoryFailure = (jobName) => ({
  jobName,
  jobConclusion: 'success', // continue-on-error 把 conclusion 抹成 success，注解仍是 failure
  path: '.github',
  title: '',
  message: 'Process completed with exit code 1.',
  level: 'failure',
})

test('advisory 冒烟格的失败注解委派给 T-QA-23，阻断档同一条注解仍然是 unexpected', () => {
  const advisoryNames = [...CORE_SMOKE_ADVISORY_CHECK_NAMES]
  const blockingNames = [...CORE_SMOKE_BLOCKING_CHECK_NAMES]
  assert.ok(advisoryNames.length > 0 && blockingNames.length > 0)

  // (a) 非阻断格：委派，不进 unexpected，并且单列进 advisorySmoke 看得见它红了。
  const advisory = evaluateAnnotations(
    advisoryNames.map(advisoryFailure),
    { schemaVersion: 1, entries: [] },
    new Date('2026-09-22T00:00:00Z'),
  )
  assert.equal(advisory.unexpected.length, 0)
  assert.equal(advisory.delegated.length, advisoryNames.length)
  assert.ok(advisory.delegated.every((entry) => entry.owner === ADVISORY_CORE_SMOKE_OWNER))
  assert.equal(advisory.advisorySmoke.length, advisoryNames.length)

  // (b) 阻断档（Core Flow Smoke (empty)）：**逐字相同**的注解不许被这条规则吞掉。
  const blocking = evaluateAnnotations(
    blockingNames.map(advisoryFailure),
    { schemaVersion: 1, entries: [] },
    new Date('2026-09-22T00:00:00Z'),
  )
  assert.equal(blocking.delegated.length, 0)
  assert.equal(blocking.advisorySmoke.length, 0)
  assert.equal(blocking.unexpected.length, blockingNames.length)
  assert.match(blocking.unexpected[0].message, /exit code 1/)
})

test('advisory 委派派生自 CORE_SMOKE_ADVISORY_CHECK_NAMES：把 used 挪出名单，同一条注解立刻翻红', async () => {
  // 规则若写死了 'Core Flow Smoke (used)'，名单和判据就会各走各的，升阻断（T-QA-23）当天
  // 这条委派会继续放行一个已经该阻断的格子。这里把**真实源文件**里的名单改掉再跑一遍来证伪：
  // validation-policy.mjs 只依赖 docs/engineering/test-routing.json（花钱路径与花钱走查的唯一登记），
  // 所以临时目录按仓库布局摆：scripts/ 放两份脚本、docs/engineering/ 放路由表，相对路径照常解析。
  const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'advisory-smoke-derivation-'))
  try {
    const scriptsDir = path.dirname(fileURLToPath(import.meta.url))
    const policySource = fs.readFileSync(path.join(scriptsDir, 'validation-policy.mjs'), 'utf8')
    // 模拟 T-QA-23 升阻断：used 进阻断名单，advisory 名单随之变空。
    const promoted = policySource.replace(
      "export const CORE_SMOKE_BLOCKING_FIXTURES = Object.freeze(['empty'])",
      "export const CORE_SMOKE_BLOCKING_FIXTURES = Object.freeze(['empty', 'used'])",
    )
    assert.notEqual(promoted, policySource, '没能改到 CORE_SMOKE_BLOCKING_FIXTURES：名单写法变了，这条派生证明已失效')
    const routing = path.join(scriptsDir, '..', 'docs', 'engineering', 'test-routing.json')
    const layOut = (root, policy) => {
      fs.mkdirSync(path.join(root, 'scripts'), { recursive: true })
      fs.mkdirSync(path.join(root, 'docs', 'engineering'), { recursive: true })
      fs.writeFileSync(path.join(root, 'scripts', 'validation-policy.mjs'), policy)
      fs.copyFileSync(path.join(scriptsDir, 'ci-annotation-hygiene.mjs'), path.join(root, 'scripts', 'ci-annotation-hygiene.mjs'))
      fs.copyFileSync(routing, path.join(root, 'docs', 'engineering', 'test-routing.json'))
    }
    layOut(fixtureDir, promoted)

    // 对照组：同一套临时复制手法、名单**不改**，必须仍然委派——否则翻红只是复制本身出的错。
    layOut(path.join(fixtureDir, 'unchanged'), policySource)
    const controlModule = await import(
      pathToFileURL(path.join(fixtureDir, 'unchanged', 'scripts', 'ci-annotation-hygiene.mjs')).href
    )
    const control = controlModule.evaluateAnnotations(
      [...CORE_SMOKE_ADVISORY_CHECK_NAMES].map(advisoryFailure),
      { schemaVersion: 1, entries: [] },
      new Date('2026-09-22T00:00:00Z'),
    )
    assert.equal(control.unexpected.length, 0)
    assert.equal(control.advisorySmoke.length, CORE_SMOKE_ADVISORY_CHECK_NAMES.length)

    const promotedModule = await import(pathToFileURL(path.join(fixtureDir, 'scripts', 'ci-annotation-hygiene.mjs')).href)
    const result = promotedModule.evaluateAnnotations(
      [...CORE_SMOKE_ADVISORY_CHECK_NAMES].map(advisoryFailure),
      { schemaVersion: 1, entries: [] },
      new Date('2026-09-22T00:00:00Z'),
    )
    assert.equal(result.delegated.length, 0)
    assert.equal(result.advisorySmoke.length, 0)
    assert.equal(result.unexpected.length, CORE_SMOKE_ADVISORY_CHECK_NAMES.length)
  } finally {
    fs.rmSync(fixtureDir, { recursive: true, force: true })
  }
})

test('「疑似不稳定」warning 委派给 vitest 重试提示；同路径同级别的别的 warning 与同标题的 failure 照样是意外', () => {
  const annotations = [
    { jobName: 'Unit', path: 'src/a.test.ts', title: '疑似不稳定', message: 'x 重试 1 次后才通过', level: 'warning' },
    { jobName: 'Unit', path: 'src/a.test.ts', title: '别的警告', message: 'other', level: 'warning' },
    { jobName: 'Unit', path: 'src/a.test.ts', title: '疑似不稳定', message: 'really failed', level: 'failure' },
  ]
  const result = evaluateAnnotations(annotations, { schemaVersion: 1, entries: [] }, new Date('2026-09-05T00:00:00Z'))
  assert.equal(result.delegated.length, 1)
  assert.equal(result.delegated[0].owner, 'vitest retry flaky hint')
  assert.equal(result.unexpected.length, 2)
})
