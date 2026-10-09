#!/usr/bin/env node
import { makeTempDir } from './_test-temp.mjs'
// 「动手那一刻」两个提醒的行为测试：判决（给不给提醒）+ 真跑 hook 看它吐的 JSON。
//
// 为什么要真跑：这个 hook 的失效是静默的——机制不对（比如把提醒写到普通 stdout，PreToolUse 不会把它送进上下文）时，
// 一切照常退出 0，只是 agent 什么也没看见。所以这里除了判决，还真起一个 `bash edit-time-reminder.sh`，
// 喂真实形状的 PreToolUse 载荷，断言 stdout 是官方文档规定的 hookSpecificOutput.additionalContext 形状。
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, test } from 'node:test'
import { countRecentFixes, decideEditTimeReminder, FIX_THRESHOLD, isWatchedSource } from './edit-time-reminder.mjs'
import { loadRegistries } from './build-capability-index.mjs'

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const HOOK = path.join(repo, 'scripts', 'claude-hooks', 'edit-time-reminder.sh')
const registries = loadRegistries(repo)

const env = (over = {}) => ({
  root: repo,
  exists: () => false,
  registries: () => registries,
  churn: () => ({ hot: false }),
  ...over,
})
const write = (rel, tool = 'Write') => ({ tool_name: tool, tool_input: { file_path: path.join(repo, rel) } })

describe('哪些文件归它管', () => {
  test('src/ 与 electron/ 的源码归它管；测试、生成物、文档、脚本不归', () => {
    assert.equal(isWatchedSource('electron/agentLane/laneHost.mts'), true)
    assert.equal(isWatchedSource('src/workbench/ai/Foo.tsx'), true)
    for (const rel of ['electron/agentLane/laneHost.test.ts', 'src/a/b.node-test.mjs', 'electron/x.generated.ts', 'electron/types.d.ts', 'docs/plan/x.md', 'scripts/x.mjs', 'src/styles/a.css', 'docs/engineering/concept-owners/catalog.vendor-landing.json']) {
      assert.equal(isWatchedSource(rel), false, rel)
    }
  })
})

describe('(a) 新建文件', () => {
  test('文件不存在 → 给能力清单并要一行「已查」', () => {
    const result = decideEditTimeReminder(write('electron/agentLane/laneContextFit.ts'), env())
    assert.equal(result.kind, 'new-file')
    assert.match(result.message, /已查：X、Y；没找到：Z/)
    assert.match(result.message, /设计卡 ★3/)
    assert.match(result.message, /context-compaction/)
    assert.ok(result.indexBytes <= 2500)
  })

  test('文件已存在 → 不当新建', () => {
    assert.equal(decideEditTimeReminder(write('electron/agentLane/laneHost.mts'), env({ exists: () => true })), null)
  })

  test('不归它管的路径、别的工具、路径在仓库外 → 不提醒', () => {
    assert.equal(decideEditTimeReminder(write('docs/plan/new.md'), env()), null)
    assert.equal(decideEditTimeReminder(write('electron/agentLane/laneNew.test.ts'), env()), null)
    assert.equal(decideEditTimeReminder({ tool_name: 'Bash', tool_input: { command: 'ls' } }, env()), null)
    assert.equal(decideEditTimeReminder({ tool_name: 'Write', tool_input: { file_path: path.join(os.tmpdir(), 'electron', 'x.ts') } }, env()), null)
  })
})

describe('(b) 同一文件反复修', () => {
  const hotEntry = (fixes) => ({ path: 'x', hot: true, file: { fixes, reverts: 0 }, reasons: [`文件近 14 天已有 ${fixes} 个 fix，这一刀是第 ${fixes + 1} 个`] })
  test(`churn 命中 → 提醒方向检查（类根因复盘）；未命中不提醒；阈值 = 已有 ${FIX_THRESHOLD} 个 fix`, () => {
    const file = 'electron/agentLane/laneHost.mts'
    const hit = decideEditTimeReminder(write(file, 'Edit'), env({ exists: () => true, churn: () => hotEntry(FIX_THRESHOLD) }))
    assert.equal(hit.kind, 'repeat-fix')
    assert.match(hit.message, /方向检查/)
    assert.match(hit.message, /类根因复盘/)
    assert.match(hit.message, new RegExp(`第 ${FIX_THRESHOLD + 1} 个`))
    assert.equal(decideEditTimeReminder(write(file, 'Edit'), env({ exists: () => true, churn: () => ({ hot: false }) })), null)
    assert.equal(FIX_THRESHOLD, 2)
  })

  test('只数 fix / hotfix 开头的提交，不数 feat / docs / 合并', () => {
    const git = () => ['fix(agent): a', 'feat: b', 'docs: c', 'hotfix: d', 'Fix: e', 'refactor: f', 'chore(fix): g']
      .map((s, i) => `\x01h${i}\x022099-01-01T00:00:00Z\x02${s}\na.ts\n`).join('')
    assert.equal(countRecentFixes('/x', 'a.ts', { git }), 3)
  })

  test('git 失败 → 0（fail-open）', () => {
    assert.equal(countRecentFixes('/x', 'a.ts', { git: () => { throw new Error('boom') } }), 0)
  })

  test('真 git：三次 fix 提交的文件被数出 3（共享计数器 fix-churn）', () => {
    const dir = makeTempDir('nomi-fixcount-')
    try {
      const git = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
      git('init', '-q')
      git('config', 'user.email', 't@t')
      git('config', 'user.name', 't')
      fs.mkdirSync(path.join(dir, 'electron'))
      const file = path.join(dir, 'electron', 'a.ts')
      for (const [i, subject] of ['feat: add', 'fix: one', 'fix(x): two', 'fix: three', 'docs: note'].entries()) {
        fs.writeFileSync(file, `export const v = ${i}\n`)
        git('add', '-A')
        git('commit', '-q', '-m', subject)
      }
      assert.equal(countRecentFixes(dir, 'electron/a.ts'), 3)
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('真跑 hook：输出必须是官方规定的形状', () => {
  const run = (payload, sessionId) => spawnSync('bash', [HOOK], {
    input: Buffer.from(typeof payload === 'string' ? payload : JSON.stringify({ session_id: sessionId, cwd: repo, ...payload }), 'utf8'),
    env: { ...process.env, CLAUDE_PROJECT_DIR: repo },
    encoding: 'utf8',
  })
  const session = `test-${process.pid}-${Date.now()}`

  test('新建文件 → stdout 是 hookSpecificOutput.additionalContext，退出 0；同一会话第二次不重复', () => {
    const payload = write('electron/agentLane/laneContextFitProbe.ts')
    const first = run(payload, session)
    assert.equal(first.status, 0)
    const parsed = JSON.parse(first.stdout)
    assert.equal(parsed.hookSpecificOutput.hookEventName, 'PreToolUse')
    assert.match(parsed.hookSpecificOutput.additionalContext, /【已有能力 · 新建文件前】/)
    assert.match(parsed.hookSpecificOutput.additionalContext, /context-compaction/)
    const second = run(payload, session)
    assert.equal(second.status, 0)
    assert.equal(second.stdout, '')
  })

  test('不相干的写入、坏载荷 → 静默放行（退出 0、什么也不吐）', () => {
    const unrelated = run(write('docs/plan/probe.md'), `${session}-b`)
    assert.equal(unrelated.status, 0)
    assert.equal(unrelated.stdout, '')
    const broken = run('{not json', `${session}-c`)
    assert.equal(broken.status, 0)
    assert.equal(broken.stdout, '')
  })
})
