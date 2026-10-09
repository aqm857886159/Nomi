import assert from 'node:assert/strict'
import test from 'node:test'

import { LOCAL_PR_BODY_DRAFT, ghPullRequestBody, resolvePullRequestBody } from './lib/prBody.mjs'

// 这一组钉死的是 2026-09-18 之前那个坑的反面：正文**现取**，而且「取不到」和「正文是空的」
// 是两件不同的事。旧写法把 `github.event.pull_request.body`（push 那一刻的快照）当唯一来源，
// 于是 push 后补正文 = 判成没写 = 空提交重推换一轮 40 分钟（PR #804，正文比 push 晚 19 秒）。

test('正文不再来自事件负载：pull_request 事件里也是现取', () => {
  const calls = []
  const result = resolvePullRequestBody({
    env: { GITHUB_EVENT_NAME: 'pull_request', NOMI_PR_NUMBER: '812', PRIOR_ART_PR_BODY: '旧快照', DOOR_MAP_PR_BODY: '旧快照' },
    argv: ['node', 'check-prior-art.mjs'],
    fetchBody: (args) => {
      calls.push(args)
      return '现在的正文 docs/fixes/2026-09-18-x.root-cause.json'
    },
  })
  assert.equal(result.available, true)
  assert.match(result.body, /现在的正文/)
  assert.doesNotMatch(result.body, /旧快照/, '事件负载里的那份正文不许再被读到')
  assert.deepEqual(calls, [['pr', 'view', '812', '--json', 'body', '--jq', '.body']])
})

test('pull_request 事件里取不到正文 = 红，不是跳过（拿不到证据就说拿不到）', () => {
  const result = resolvePullRequestBody({
    env: { GITHUB_EVENT_NAME: 'pull_request', NOMI_PR_NUMBER: '812' },
    argv: ['node', 'check-prior-art.mjs'],
    fetchBody: () => { throw new Error('gh: not authenticated\nrun gh auth login') },
  })
  assert.equal(result.available, false)
  assert.equal(result.required, true)
  assert.match(result.reason, /gh pr view 取不到正文/)
  assert.doesNotMatch(result.reason, /gh auth login/, '只保留首行，别把多行报错灌进门岗输出')
})

test('本地默认跳过；加 --pr 才查，取不到也只是「今天没查成」', () => {
  const skipped = resolvePullRequestBody({ env: {}, argv: ['node', 'check-prior-art.mjs'], fetchBody: () => 'x' })
  assert.equal(skipped.available, false)
  assert.equal(skipped.required, false)

  const asked = resolvePullRequestBody({
    env: {},
    argv: ['node', 'check-prior-art.mjs', '--pr'],
    fetchBody: () => { throw new Error('gh: command not found') },
    readDraft: () => null,
  })
  assert.equal(asked.available, false)
  assert.equal(asked.required, false, '本地不是最后一道闸：CI 侧仍然 fail-closed')

  // 本地没有 PR 号：gh 从当前分支自己认。
  const calls = []
  const found = resolvePullRequestBody({
    env: {},
    argv: ['node', 'check-prior-art.mjs', '--pr'],
    fetchBody: (args) => { calls.push(args); return 'body' },
  })
  assert.equal(found.available, true)
  assert.deepEqual(calls, [['pr', 'view', '--json', 'body', '--jq', '.body']])
})

test('空正文是「查过了而且是空的」，不是「没查成」', () => {
  const result = resolvePullRequestBody({ env: { NOMI_PR_BODY: '' }, argv: ['node', 'x.mjs'] })
  assert.equal(result.available, true)
  assert.equal(result.body, '')
})

test('还没有 PR：本地 --pr 取不到时读 .tmp-pr-body.md 草稿，按合并前的标准提前判；CI 里不读草稿', () => {
  const failing = () => { throw new Error('no pull requests found for branch') }
  const local = resolvePullRequestBody({ env: {}, argv: ['node', 'x.mjs', '--pr'], fetchBody: failing, readDraft: () => '## 设计卡\n草稿' })
  assert.equal(local.available, true)
  assert.equal(local.source, LOCAL_PR_BODY_DRAFT)
  assert.match(local.body, /草稿/)
  const ci = resolvePullRequestBody({ env: { GITHUB_EVENT_NAME: 'pull_request' }, argv: ['node', 'x.mjs'], fetchBody: failing, readDraft: () => '草稿' })
  assert.equal(ci.available, false, 'CI 里取不到就是红，不能被一个本地草稿文件顶替')
  assert.equal(ci.required, true)
})

// ── 2026-10-09 手动跑挂死：gh 没有超时、NOMI_PR_BODY_FILE 不被认 ──────────────────────

test('NOMI_PR_BODY_FILE：从文件读正文；NOMI_PR_BODY 优先；读不了 = required 的红，不回落到 gh', () => {
  const fromFile = resolvePullRequestBody({ env: { NOMI_PR_BODY_FILE: 'b.md' }, argv: ['node', 'x.mjs'], readFile: () => '## 设计卡\n文件', fetchBody: () => { throw new Error('不该调 gh') } })
  assert.equal(fromFile.available, true)
  assert.equal(fromFile.source, 'NOMI_PR_BODY_FILE')
  assert.match(fromFile.body, /文件/)
  const both = resolvePullRequestBody({ env: { NOMI_PR_BODY: '直接给', NOMI_PR_BODY_FILE: 'b.md' }, argv: ['node', 'x.mjs'], readFile: () => '文件' })
  assert.equal(both.body, '直接给')
  const unreadable = resolvePullRequestBody({ env: { NOMI_PR_BODY_FILE: 'nope.md' }, argv: ['node', 'x.mjs'], readFile: () => { throw new Error('ENOENT') }, fetchBody: () => { throw new Error('不该调 gh') } })
  assert.equal(unreadable.available, false)
  assert.equal(unreadable.required, true)
  assert.match(unreadable.reason, /NOMI_PR_BODY_FILE/)
})

test('必红：gh 一直不返回 → 在超时内明确报错（required），不挂、不回落到草稿', () => {
  const started = Date.now()
  const result = resolvePullRequestBody({
    env: {},
    argv: ['node', 'x.mjs', '--pr'],
    fetchBody: (args, cwd) => ghPullRequestBody(args, cwd, { bin: process.execPath, args: ['-e', 'setInterval(() => {}, 1000)'], timeoutMs: 1500 }),
    readDraft: () => '草稿',
  })
  assert.ok(Date.now() - started < 15_000, '超时没生效')
  assert.equal(result.available, false)
  assert.equal(result.required, true)
  assert.match(result.reason, /超时/)
})
