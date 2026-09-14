import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  MAX_REVIEW_DIFF_BYTES,
  MAX_REVIEW_REPORT_BYTES,
  REVIEW_TIMEOUT_MS,
  buildReviewPrompt,
  chunkBranchDiff,
  classifyReviewOutput,
  deferredLogPath,
  isDeferRequested,
  readReceipt,
  receiptPath,
  resolveBranchRange,
  reviewChunk,
  runBranchReview,
  verifyPushReceipt,
} from './ponytail-review-branch.mjs'

const BASE_REF = 'review-base'

function git(cwd, args) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim()
}

/** 一棵有基线分支的真仓库：review:branch 的范围就是 merge-base(base, HEAD)..HEAD。 */
function makeRepository(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-ponytail-branch-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  git(root, ['init', '--quiet'])
  git(root, ['config', 'user.email', 'ponytail-test@example.invalid'])
  git(root, ['config', 'user.name', 'Ponytail Test'])
  fs.writeFileSync(path.join(root, 'tracked.txt'), 'initial\n')
  git(root, ['add', 'tracked.txt'])
  git(root, ['commit', '--quiet', '-m', 'fixture'])
  git(root, ['branch', BASE_REF])
  return root
}

function commit(root, file, contents, message) {
  fs.writeFileSync(path.join(root, file), contents)
  git(root, ['add', file])
  git(root, ['commit', '--quiet', '-m', message])
}

/** 确定性、不可压缩的文本块：让一次 diff 稳定越过单块上限。 */
function bulkText(lines, salt) {
  let out = ''
  for (let i = 0; i < lines; i += 1) out += `${salt} line ${i} ${(i * 2654435761) % 1_000_000_007}\n`
  return out
}

function envFor(root, extra = {}) {
  return {
    PONYTAIL_REVIEW_BASE_REF: BASE_REF,
    PONYTAIL_REVIEW_CODEX_BIN: 'codex',
    PONYTAIL_REVIEW_REPORT_DIR: path.join(root, 'reports'),
    ...extra,
  }
}

function fakeRunner({ report = 'Lean already. Ship.\nnet: -0 lines possible.\nPONYTAIL_REVIEW: PASS', status = 0, error } = {}) {
  const calls = []
  const spawnSyncImpl = (command, args, options) => {
    const reportPath = args[args.indexOf('--output-last-message') + 1]
    calls.push({ command, args, options, reportPath, reportMode: fs.statSync(reportPath).mode & 0o777 })
    const text = typeof report === 'function' ? report(calls.length) : report
    if (text !== null) fs.writeFileSync(reportPath, `${text}\n`)
    return { status, stdout: '', stderr: '', error }
  }
  return { calls, spawnSyncImpl }
}

test('评审范围是这条分支自己写的东西，不是整仓', (t) => {
  const root = makeRepository(t)
  commit(root, 'a.txt', 'a\n', 'branch work')
  const range = resolveBranchRange({ repoRoot: root, env: envFor(root) })
  assert.equal(range.mergeBase, git(root, ['rev-parse', BASE_REF]))
  assert.equal(range.headSha, git(root, ['rev-parse', 'HEAD']))
  assert.equal(range.treeSha, git(root, ['rev-parse', 'HEAD^{tree}']))
})

test('base ref 解析不出来时明说要 fetch，不静默退回整仓 diff', (t) => {
  const root = makeRepository(t)
  assert.throws(
    () => resolveBranchRange({ repoRoot: root, env: envFor(root, { PONYTAIL_REVIEW_BASE_REF: 'origin/does-not-exist' }) }),
    /merge-base.*fetch/s,
  )
})

test('装得下就一块；装不下按文件切同一段范围再贴着上限装回去，每块都在上限内', (t) => {
  const root = makeRepository(t)
  commit(root, 'small.txt', 'one line\n', 'small')
  const range = resolveBranchRange({ repoRoot: root, env: envFor(root) })
  const single = chunkBranchDiff({ repoRoot: root, mergeBase: range.mergeBase, headSha: range.headSha })
  assert.equal(single.length, 1, '全都装得下时 packUnits 自然只返回一块，不需要单独的快路径')
  assert.match(single[0].label, /small\.txt$/)

  commit(root, 'big-a.txt', bulkText(4000, 'alpha'), 'big a')
  commit(root, 'big-b.txt', bulkText(4000, 'beta'), 'big b')
  const wide = resolveBranchRange({ repoRoot: root, env: envFor(root) })
  const chunks = chunkBranchDiff({ repoRoot: root, mergeBase: wide.mergeBase, headSha: wide.headSha })
  assert.ok(chunks.length >= 2, `装不下应至少切 2 块，实得 ${chunks.length}`)
  for (const chunk of chunks) {
    assert.ok(Buffer.byteLength(chunk.text, 'utf8') <= MAX_REVIEW_DIFF_BYTES, `${chunk.label} 超过单块上限`)
  }
  // 标签必须是「范围 · 文件」而不是「提交」：按提交切会重审中间态，
  // 把「17 个提交审 17 遍」请回来——每个文件在一次评审里只许出现一次。
  assert.ok(chunks.every((chunk) => chunk.label.startsWith(`${wide.mergeBase}..${wide.headSha}`)))
  assert.ok(chunks.some((chunk) => chunk.label.includes('big-a.txt')) )
  const labelled = chunks.flatMap((chunk) => chunk.text.split('\n').filter((line) => line.startsWith('### ')))
  assert.equal(new Set(labelled).size, labelled.length, '同一个文件不许出现在两个单元里')
  // 装箱是有意的：一文件一次调用会让 20 个文件的改动变成 20 次模型调用，
  // 每次还只看得见一个文件。块数必须逼近「总字节 / 上限」的下界，不是单元个数。
  const totalBytes = chunks.reduce((sum, chunk) => sum + Buffer.byteLength(chunk.text, 'utf8'), 0)
  assert.ok(chunks.length <= Math.ceil(totalBytes / MAX_REVIEW_DIFF_BYTES) + 1,
    `块数 ${chunks.length} 远超装箱下界（${totalBytes} 字节）——单元没有装回去`)
})

test('单个提交太大按文件切；单个文件仍太大就截断——绝不再叫人去拆提交', (t) => {
  const root = makeRepository(t)
  fs.writeFileSync(path.join(root, 'one.txt'), bulkText(4000, 'one'))
  fs.writeFileSync(path.join(root, 'two.txt'), bulkText(4000, 'two'))
  git(root, ['add', 'one.txt', 'two.txt'])
  git(root, ['commit', '--quiet', '-m', 'one fat commit'])
  const range = resolveBranchRange({ repoRoot: root, env: envFor(root) })
  const chunks = chunkBranchDiff({ repoRoot: root, mergeBase: range.mergeBase, headSha: range.headSha })
  assert.ok(chunks.length >= 2)
  assert.ok(chunks.every((chunk) => chunk.label.includes('·')), '整段装不下时必须按文件切')
  for (const chunk of chunks) {
    assert.ok(Buffer.byteLength(chunk.text, 'utf8') <= MAX_REVIEW_DIFF_BYTES)
  }

  const huge = makeRepository(t)
  commit(huge, 'huge.txt', bulkText(12000, 'huge'), 'single huge file')
  const hugeRange = resolveBranchRange({ repoRoot: huge, env: envFor(huge) })
  const hugeChunks = chunkBranchDiff({ repoRoot: huge, mergeBase: hugeRange.mergeBase, headSha: hugeRange.headSha })
  assert.equal(hugeChunks.length, 1)
  assert.equal(hugeChunks[0].truncated, true)
  assert.match(hugeChunks[0].text, /TRUNCATED/)
  assert.ok(Buffer.byteLength(hugeChunks[0].text, 'utf8') <= MAX_REVIEW_DIFF_BYTES)
})

test('空范围不跑模型，但仍发一张收据', (t) => {
  const root = makeRepository(t)
  const outcome = runBranchReview({
    repoRoot: root,
    env: envFor(root),
    spawnSyncImpl: () => assert.fail('空范围不该调 runner'),
  })
  assert.equal(outcome.ok, true)
  assert.equal(outcome.status, 'pass')
  assert.equal(readReceipt(root).status, 'pass')
})

test('分块评审只读、有界，findings 落盘且收据齐全', (t) => {
  const root = makeRepository(t)
  commit(root, 'big-a.txt', bulkText(4000, 'alpha'), 'big a')
  commit(root, 'big-b.txt', bulkText(4000, 'beta'), 'big b')
  const fake = fakeRunner({
    report: (call) => (call === 1
      ? 'scripts/x.mjs:L3: delete wrapper. Inline it.\nnet: -9 lines possible.\nPONYTAIL_REVIEW: FINDINGS'
      : 'Lean already. Ship.\nnet: -0 lines possible.\nPONYTAIL_REVIEW: PASS'),
  })
  const outcome = runBranchReview({ repoRoot: root, env: envFor(root), spawnSyncImpl: fake.spawnSyncImpl })

  assert.equal(outcome.ok, true)
  assert.equal(outcome.status, 'findings', '任一块有发现，整条分支就是 findings')
  assert.ok(fake.calls.length >= 2, '每块各跑一次')
  assert.deepEqual(fake.calls[0].args.slice(0, 10), [
    '--ask-for-approval', 'never', '--cd', root,
    'exec', '--ephemeral', '--sandbox', 'read-only', '--ignore-rules', '--output-last-message',
  ])
  assert.deepEqual(fake.calls[0].options.stdio, ['pipe', 'ignore', 'ignore'])
  assert.equal(fake.calls[0].options.env.PONYTAIL_REVIEW_TIMEOUT_MS, String(REVIEW_TIMEOUT_MS))
  assert.equal(fake.calls[0].reportMode, 0o600)
  // 临时报告是当场删掉的；findings 只留在 worktree 自己的 .claude/ 下。
  assert.deepEqual(fs.readdirSync(path.join(root, 'reports')), [])

  const findings = fs.readFileSync(outcome.findingsFile, 'utf8')
  assert.match(findings, /delete wrapper/)
  assert.equal(fs.statSync(outcome.findingsFile).mode & 0o777, 0o600)

  const receipt = readReceipt(root)
  assert.equal(receipt.headSha, git(root, ['rev-parse', 'HEAD']))
  assert.equal(receipt.treeSha, git(root, ['rev-parse', 'HEAD^{tree}']))
  assert.equal(receipt.mergeBase, git(root, ['rev-parse', BASE_REF]))
  assert.match(receipt.diffDigest, /^[0-9a-f]{64}$/)
  assert.match(receipt.reviewedAt, /^\d{4}-\d{2}-\d{2}T/)
  assert.equal(receipt.status, 'findings')
  assert.equal(receipt.findingsPath, path.relative(root, outcome.findingsFile))
  assert.equal(receiptPath(root), path.join(root, '.claude', 'ponytail-receipt.json'))
})

test('任一块失败就整条失败，且不发收据', (t) => {
  const root = makeRepository(t)
  commit(root, 'a.txt', 'a\n', 'work')
  for (const runner of [
    fakeRunner({ report: 'no marker at all' }),
    fakeRunner({ status: 1 }),
    fakeRunner({ error: { code: 'ETIMEDOUT' } }),
  ]) {
    const outcome = runBranchReview({ repoRoot: root, env: envFor(root), spawnSyncImpl: runner.spawnSyncImpl })
    assert.equal(outcome.ok, false)
    assert.equal(fs.existsSync(receiptPath(root)), false, '失败的评审不许留下收据')
  }
})

test('诊断行只报字节数，不回显报告或进程输出', (t) => {
  const root = makeRepository(t)
  commit(root, 'a.txt', 'a\n', 'work')
  const secret = 'sk-live-secret-must-not-appear-in-logs'
  const fake = fakeRunner({ report: `finding: ${secret}\nnet: -1 lines possible.\nPONYTAIL_REVIEW: FINDINGS` })
  const result = reviewChunk({
    repoRoot: root,
    chunk: { label: 'unit', text: 'diff --git a b\n' },
    env: envFor(root),
    spawnSyncImpl: (command, args, options) => ({ ...fake.spawnSyncImpl(command, args, options), stdout: secret, stderr: secret }),
  })
  assert.equal(result.ok, true)
  // stdout/stderr 在 stdio 层就丢了，恒为 0，所以诊断行只报 report。
  assert.match(result.output, /^report=\d+B$/)
  assert.doesNotMatch(result.output, new RegExp(secret))
  assert.match(result.report, new RegExp(secret), 'findings 必须能被人读到——这正是这次改动的目的')
})

test('超大报告在读之前就被拒，临时目录仍然清干净', (t) => {
  const root = makeRepository(t)
  assert.throws(() => reviewChunk({
    repoRoot: root,
    chunk: { label: 'unit', text: 'diff\n' },
    env: envFor(root),
    spawnSyncImpl: (_command, args) => {
      fs.writeFileSync(args[args.indexOf('--output-last-message') + 1], 'x'.repeat(MAX_REVIEW_REPORT_BYTES + 1))
      return { status: 0, stdout: '', stderr: '' }
    },
  }), /review report .* limit/)
  assert.deepEqual(fs.readdirSync(path.join(root, 'reports')), [])
})

test('留痕延后：不跑模型，账本记一行，收据写 deferred 让 push 放行', (t) => {
  const root = makeRepository(t)
  commit(root, 'a.txt', 'a\n', 'work')
  const env = envFor(root, { PONYTAIL_REVIEW_DEFER: '1' })
  assert.equal(isDeferRequested({ env }), true)
  assert.equal(isDeferRequested({ env: {}, argv: ['--defer'] }), true)
  assert.equal(isDeferRequested({ env: {}, argv: [] }), false)

  const outcome = runBranchReview({
    repoRoot: root,
    env,
    spawnSyncImpl: () => assert.fail('延后不许调 runner'),
  })
  assert.equal(outcome.status, 'deferred')
  const row = fs.readFileSync(deferredLogPath(root, env), 'utf8').trim()
  // 格式逐字对齐 .claude/push-bypass.log：时间|种类|branch|sha|worktree|reason|状态
  assert.match(
    row,
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z\|deferred\|branch=[^|]*\|sha=[0-9a-f]{40}\|worktree=[^|]+\|reason=[^|]+\|reviewed=no$/,
  )
  // 分支级评审记的是**被评审的那个 head**，不再是「提交前的 HEAD」。
  assert.ok(row.includes(`sha=${git(root, ['rev-parse', 'HEAD'])}`))
  assert.equal(readReceipt(root).status, 'deferred')

  runBranchReview({ repoRoot: root, env, spawnSyncImpl: () => assert.fail('no runner') })
  assert.equal(fs.readFileSync(deferredLogPath(root, env), 'utf8').trim().split('\n').length, 2)
})

test('收据判的是树：rebase 放行，改一行就拦', (t) => {
  const root = makeRepository(t)
  commit(root, 'a.txt', 'a\n', 'work')
  runBranchReview({ repoRoot: root, env: envFor(root), spawnSyncImpl: fakeRunner().spawnSyncImpl })
  const head = git(root, ['rev-parse', 'HEAD'])
  const ranges = (sha) => [{ localRef: 'refs/heads/task', localSha: sha, remoteRef: 'refs/heads/task', remoteSha: '0'.repeat(40) }]

  assert.equal(verifyPushReceipt({ repoRoot: root, ranges: ranges(head) }).ok, true)

  // 改提交信息 = 新提交、同一棵树：内容没变，不该逼人重审。
  git(root, ['commit', '--quiet', '--amend', '-m', 'work (reworded)'])
  const reworded = git(root, ['rev-parse', 'HEAD'])
  assert.notEqual(reworded, head)
  assert.equal(verifyPushReceipt({ repoRoot: root, ranges: ranges(reworded) }).ok, true)

  // 改一行 = 树变了 = 收据失效。
  commit(root, 'a.txt', 'a changed\n', 'one more line')
  const changed = verifyPushReceipt({ repoRoot: root, ranges: ranges(git(root, ['rev-parse', 'HEAD'])) })
  assert.equal(changed.ok, false)
  assert.match(changed.reason, /树/)
})

test('没有收据、收据读不懂、mergeBase 不在历史里，都 fail-closed', (t) => {
  const root = makeRepository(t)
  commit(root, 'a.txt', 'a\n', 'work')
  const head = git(root, ['rev-parse', 'HEAD'])
  const ranges = [{ localRef: 'refs/heads/task', localSha: head, remoteRef: 'refs/heads/task', remoteSha: '0'.repeat(40) }]

  const missing = verifyPushReceipt({ repoRoot: root, ranges })
  assert.equal(missing.ok, false)
  assert.match(missing.reason, /收据/)

  runBranchReview({ repoRoot: root, env: envFor(root), spawnSyncImpl: fakeRunner().spawnSyncImpl })
  fs.writeFileSync(receiptPath(root), '{ not json')
  assert.equal(verifyPushReceipt({ repoRoot: root, ranges }).ok, false)

  // schema 也是判据，不是备忘录：版本对不上的收据当没有收据。
  runBranchReview({ repoRoot: root, env: envFor(root), spawnSyncImpl: fakeRunner().spawnSyncImpl })
  const wrongSchema = JSON.parse(fs.readFileSync(receiptPath(root), 'utf8'))
  wrongSchema.schema = 999
  fs.writeFileSync(receiptPath(root), JSON.stringify(wrongSchema))
  assert.equal(verifyPushReceipt({ repoRoot: root, ranges }).ok, false)

  runBranchReview({ repoRoot: root, env: envFor(root), spawnSyncImpl: fakeRunner().spawnSyncImpl })
  const doctored = JSON.parse(fs.readFileSync(receiptPath(root), 'utf8'))
  doctored.mergeBase = 'f'.repeat(40)
  fs.writeFileSync(receiptPath(root), JSON.stringify(doctored))
  const unreachable = verifyPushReceipt({ repoRoot: root, ranges })
  assert.equal(unreachable.ok, false)
  assert.match(unreachable.reason, /mergeBase/)
})

test('只删远端分支时没有要评审的树，不拦', (t) => {
  const root = makeRepository(t)
  const ranges = [{ localRef: '(delete)', localSha: '0'.repeat(40), remoteRef: 'refs/heads/gone', remoteSha: 'a'.repeat(40) }]
  assert.equal(verifyPushReceipt({ repoRoot: root, ranges }).ok, true)
})

test('提示词带技能触发词、范围与 diff 分隔符', () => {
  const prompt = buildReviewPrompt({ description: 'commit abc', diff: 'diff --git a b', diffHash: 'f'.repeat(64) })
  assert.match(prompt, /\/ponytail-review/)
  assert.match(prompt, /Scope: branch \(commit abc\)/)
  assert.match(prompt, /--- BEGIN REVIEW DIFF ---\ndiff --git a b\n--- END REVIEW DIFF ---/)
})

test('只认洁净报告与 findings 报告两种形状', () => {
  assert.equal(classifyReviewOutput('Lean already. Ship.'), 'pass')
  assert.equal(classifyReviewOutput('Lean already. Ship.\nnet: -0 lines possible.\nPONYTAIL_REVIEW: PASS'), 'pass')
  assert.equal(classifyReviewOutput('x.mjs:L1: delete it.\nnet: -4 lines possible.'), 'findings')
  assert.equal(classifyReviewOutput('x.mjs:L1: delete it.\nnet: -4 lines possible.\nPONYTAIL_REVIEW: FINDINGS'), 'findings')
  assert.equal(classifyReviewOutput('PONYTAIL_REVIEW: PASS\nsomething else'), 'unknown')
  assert.equal(classifyReviewOutput('net: -4 lines possible.'), 'unknown')
  assert.equal(classifyReviewOutput(''), 'unknown')
})

test('Claude 壳自限在被交给的预算之下，不许再写死第二份墙钟', async () => {
  // 壳曾写死 165s/175s。预算改成常量后那份常量依然是错的：它会把 600s 的预算提前砍掉。
  const { resolveTimeout } = await import('./ponytail-review-claude-shim.mjs')
  assert.equal(resolveTimeout({ PONYTAIL_REVIEW_TIMEOUT_MS: String(REVIEW_TIMEOUT_MS) }), REVIEW_TIMEOUT_MS - 15_000)
  // 缺预算（壳被手工调用）退回基线，绝不退回 0 或无限。
  assert.ok(resolveTimeout({}) > 0)
  // 人工 override 只能往小调，不许越过适配器的预算。
  assert.equal(
    resolveTimeout({ PONYTAIL_REVIEW_TIMEOUT_MS: '180000', PONYTAIL_REVIEW_CLAUDE_TIMEOUT_MS: '900000' }),
    180_000 - 15_000,
  )
})
