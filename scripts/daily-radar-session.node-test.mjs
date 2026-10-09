#!/usr/bin/env node
import { makeTempDir } from './_test-temp.mjs'
// 每日雷达 hook 的行为测试。最要紧的几条：
//  · 脚本跑败时输出必须明说「今天没查成」，绝不出现会被读成「没有新东西」的措辞；
//  · 同一天两个不同工作树先后开会话，第二个拿到第一个的摘要（含新增数），不再跑（否则「新反馈」被先开的会话吃掉，
//    后开的协调会话看到「新增 0」）；
//  · hook 不许动工作树里任何文件（git status --porcelain 为空）；
//  · hook 路径里没有扣费请求（模型雷达带 --no-liveness）。
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, test } from 'node:test'
import { RADARS, localDate, radarStateFile, runDailyRadar, runSession, skillExists, tryLock, unlock } from './daily-radar-session.mjs'

const NOW = new Date(2026, 9, 2, 9, 5) // 2026-10-02 09:05 本机时间
const LATER = new Date(2026, 9, 2, 14, 30)
const allSkills = () => true
const noSkills = () => false
const tmp = (prefix) => makeTempDir(prefix)
const cleanup = (...dirs) => dirs.forEach((dir) => fs.rmSync(dir, { recursive: true, force: true }))

const okRun = (outputs = {}) => async (_root, radar) => ({ status: 0, stdout: outputs[radar.key] ?? `${radar.script} 结果行\n新增 0` })
const failRun = (status = 1, stderr = 'boom') => async () => ({ status, stdout: '', stderr })

describe('成功', () => {
  test('两个脚本都成功 → 带出结果与「分诊只由协调会话做」，状态记下今天与摘要', async () => {
    const { text, state } = await runDailyRadar({ root: '/x', now: NOW, run: okRun(), hasSkill: allSkills })
    assert.match(text, /【用户反馈雷达】已跑/)
    assert.match(text, /intake:radar 结果行/)
    assert.match(text, /【供应商模型雷达】已跑/)
    assert.match(text, /分诊只由协调会话做；其他会话看到不动手、不写待办/)
    assert.equal(state.date, localDate(NOW))
    assert.equal(state.intake.ok, true)
    assert.match(state.intake.text, /intake:radar 结果行/)
  })
})

describe('失败必须明说，不许说成没有新东西', () => {
  for (const [name, run, expectWhy] of [
    ['退出码非 0', failRun(2), /脚本退出码 2/],
    ['超时', async () => ({ status: null, signal: 'SIGTERM', stdout: '', stderr: '' }), /超时/],
    ['没能启动', async () => ({ status: null, stdout: '', stderr: '', error: Object.assign(new Error('spawn ENOENT'), { code: 'ENOENT' }) }), /没能启动/],
  ]) {
    test(name, async () => {
      const { text, state } = await runDailyRadar({ root: '/x', now: NOW, run })
      assert.match(text, /【用户反馈雷达】今天没查成/)
      assert.match(text, /【供应商模型雷达】今天没查成/)
      assert.match(text, expectWhy)
      assert.match(text, /不是没有新东西/)
      assert.doesNotMatch(text, /没有新反馈了|没有新模型了|无新增|一切正常/)
      assert.equal(state.intake.ok, false)
    })
  }

  test('失败时把脚本自己的报错尾巴带出来，别吞', async () => {
    const { text } = await runDailyRadar({ root: '/x', now: NOW, run: failRun(1, 'Cloudflare token missing') })
    assert.match(text, /Cloudflare token missing/)
  })
})

describe('两个雷达并行', () => {
  test('两个都先开始、再有任何一个结束', async () => {
    const events = []
    const run = (_root, radar) => new Promise((resolve) => {
      events.push(`start:${radar.key}`)
      setTimeout(() => { events.push(`end:${radar.key}`); resolve({ status: 0, stdout: 'ok' }) }, 20)
    })
    await runDailyRadar({ root: '/x', now: NOW, run })
    assert.deepEqual(events.slice(0, 2).sort(), ['start:intake', 'start:models'])
    assert.ok(events.indexOf('end:intake') > 1 && events.indexOf('end:models') > 1)
  })
})

describe('一台机器一天一次：缓存摘要放仓库外，后开的会话直接拿', () => {
  test('同一天两个不同工作树先后开会话 → 第二个拿到第一个的摘要（含新增数），不再跑脚本', async () => {
    const cache = tmp('nomi-radar-cache-')
    const wtA = tmp('nomi-wt-a-')
    const wtB = tmp('nomi-wt-b-')
    try {
      const env = { NOMI_INTAKE_CACHE: cache }
      const first = await runSession({ root: wtA, env, now: () => NOW, run: okRun({ intake: '新增反馈 3 条\n错误码排行 …' }) })
      assert.match(first, /新增反馈 3 条/)

      const calls = []
      const second = await runSession({
        root: wtB, env, now: () => LATER,
        run: async (_root, radar) => { calls.push(radar.key); return { status: 0, stdout: '新增反馈 0 条' } },
      })
      assert.deepEqual(calls, [], '第二个会话不该再跑')
      assert.match(second, /今天 09:05 已在本机跑过/)
      assert.match(second, /新增反馈 3 条/, '后开的会话必须看得到当天的「新增 3 条」，而不是被覆盖成 0')
      assert.doesNotMatch(second, /新增反馈 0 条/)
    } finally { cleanup(cache, wtA, wtB) }
  })

  test('失败的下次会话重试，成功的不重跑；隔天全部重跑', async () => {
    const cache = tmp('nomi-radar-cache-')
    try {
      const env = { NOMI_INTAKE_CACHE: cache }
      await runSession({ root: '/a', env, now: () => NOW,
        run: async (_r, radar) => (radar.key === 'intake' ? { status: 0, stdout: 'A' } : { status: 1, stdout: '', stderr: 'down' }) })
      const calls = []
      const retry = await runSession({ root: '/b', env, now: () => LATER, run: async (_r, radar) => { calls.push(radar.key); return { status: 0, stdout: 'B' } } })
      assert.deepEqual(calls, ['models'])
      assert.match(retry, /今天 09:05 已在本机跑过/)

      const nextDay = [];
      await runSession({ root: '/c', env, now: () => new Date(2026, 9, 3, 8, 0), run: async (_r, radar) => { nextDay.push(radar.key); return { status: 0, stdout: 'C' } } })
      assert.deepEqual(nextDay.sort(), ['intake', 'models'])
    } finally { cleanup(cache) }
  })

  test('标记与摘要在 NOMI_INTAKE_CACHE 指的目录里，不在工作树里', async () => {
    const cache = tmp('nomi-radar-cache-')
    try {
      assert.equal(radarStateFile({ NOMI_INTAKE_CACHE: cache }), path.join(cache, 'daily-radar.json'))
      await runSession({ root: '/x', env: { NOMI_INTAKE_CACHE: cache }, now: () => NOW, run: okRun() })
      assert.ok(fs.existsSync(path.join(cache, 'daily-radar.json')))
      assert.ok(!fs.existsSync(`${path.join(cache, 'daily-radar.json')}.lock`), '锁用完要放手')
    } finally { cleanup(cache) }
  })
})

describe('hook 不许动工作树', () => {
  test('在一个干净的 git 仓库里跑完，git status --porcelain 为空', async () => {
    const repo = tmp('nomi-radar-repo-')
    const cache = tmp('nomi-radar-cache-')
    try {
      const git = (...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
      git('init', '-q')
      git('config', 'user.email', 't@t')
      git('config', 'user.name', 't')
      fs.writeFileSync(path.join(repo, 'README.md'), 'x\n')
      git('add', '-A')
      git('commit', '-q', '-m', 'init')
      await runSession({ root: repo, env: { NOMI_INTAKE_CACHE: cache }, now: () => NOW, run: okRun() })
      await runSession({ root: repo, env: { NOMI_INTAKE_CACHE: cache }, now: () => LATER, run: failRun() })
      assert.equal(git('status', '--porcelain').trim(), '')
    } finally { cleanup(repo, cache) }
  })

  test('模型雷达在 hook 路径里带 --no-liveness（没有任何扣费请求）；模型雷达脚本把结果写到仓库外', () => {
    const models = RADARS.find((radar) => radar.key === 'models')
    assert.ok(models.argv.includes('--no-liveness'))
    const source = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'model-radar.ts'), 'utf8')
    assert.match(source, /--no-liveness/)
    assert.doesNotMatch(source, /SNAPSHOT_DIR,\s*"latest\.json"/, 'latest.json 不能再写进仓库')
    assert.doesNotMatch(source, /SNAPSHOT_DIR,\s*"liveness\.json"/, 'liveness.json 不能再写进仓库')
  })
})

describe('锁', () => {
  test('同一时刻只有一个拿到；放手后下一个能拿；过期的锁被清掉', () => {
    const dir = tmp('nomi-radar-lock-')
    const lock = path.join(dir, 'x.lock')
    try {
      assert.equal(tryLock(lock), true)
      assert.equal(tryLock(lock), false)
      unlock(lock)
      assert.equal(tryLock(lock), true)
      unlock(lock)
      fs.writeFileSync(lock, '')
      const old = Date.now() - 10 * 60_000
      fs.utimesSync(lock, old / 1000, old / 1000)
      assert.equal(tryLock(lock), true, '过期的锁要被清掉，不能让一个崩掉的会话把雷达永远堵死')
    } finally { cleanup(dir) }
  })

  test('锁一直被占 → 不无限等，明说没出结果（不是没有新东西）', async () => {
    const cache = tmp('nomi-radar-cache-')
    try {
      const env = { NOMI_INTAKE_CACHE: cache }
      assert.equal(tryLock(`${radarStateFile(env)}.lock`), true)
      const text = await runSession({ root: '/x', env, now: () => NOW, run: okRun(), sleep: async () => {}, lockWaitMs: 4000 })
      assert.match(text, /还没出结果；不是没有新东西/)
    } finally { cleanup(cache) }
  })
})

describe('技能在不在：不存在的技能不能叫人去跑；论文雷达不再每日提醒；模型雷达直接指向方案文档', () => {
  const run = async () => ({ status: 0, stdout: '新增 2' })
  const FORBIDDEN = [/nomi-research-radar/, /nomi-model-radar/, /静默跑/]

  test('任何情形下，输出里都不出现「nomi-research-radar」「nomi-model-radar」「静默跑」', async () => {
    for (const hasSkill of [allSkills, noSkills]) {
      const { text } = await runDailyRadar({ root: '/x', now: NOW, run, hasSkill })
      for (const pattern of FORBIDDEN) assert.doesNotMatch(text, pattern, String(pattern))
    }
    const failed = await runDailyRadar({ root: '/x', now: NOW, run: failRun(), hasSkill: allSkills })
    for (const pattern of FORBIDDEN) assert.doesNotMatch(failed.text, pattern, String(pattern))
  })

  test('论文雷达那一行整个没有（按需，不再每日提醒）', async () => {
    const { text } = await runDailyRadar({ root: '/x', now: NOW, run, hasSkill: allSkills })
    assert.doesNotMatch(text, /论文雷达/)
    assert.doesNotMatch(text, /docs\/research\/.*-radar\.md/)
  })

  test('模型雷达：不按技能在不在分支，永远指向方案文档，分诊只由协调会话做', async () => {
    const present = await runDailyRadar({ root: '/x', now: NOW, run, hasSkill: allSkills })
    const missing = await runDailyRadar({ root: '/x', now: NOW, run, hasSkill: noSkills })
    for (const { text } of [present, missing]) {
      assert.match(text, /docs\/plan\/2026-08-27-vendor-model-radar\.md 的分诊规则由协调会话处理/)
    }
    const modelsLine = (text) => text.split('\n').find((line) => line.startsWith('→') && line.includes('vendor-model-radar'))
    assert.equal(modelsLine(present.text), modelsLine(missing.text), '有没有技能，模型雷达这句都一样')
  })

  test('用户反馈雷达、三日竞品雷达：技能在 → 照旧；不在 → 明说「在这台机器上没有」', async () => {
    const present = await runDailyRadar({ root: '/x', now: NOW, run, hasSkill: allSkills })
    assert.match(present.text, /起 nomi-intake-radar 技能分诊/)
    assert.match(present.text, /【三日竞品雷达】只由协调会话做：/)
    assert.match(present.text, /分诊只由协调会话做/)
    const missing = await runDailyRadar({ root: '/x', now: NOW, run, hasSkill: noSkills })
    assert.match(missing.text, /技能 nomi-intake-radar 在这台机器上没有/)
    assert.match(missing.text, /技能 nomi-competitive-radar 在这台机器上没有，今天没查成/)
  })

  test('skillExists 认三处：仓库 agent-skills、项目 .claude/skills、用户目录 ~/.claude/skills', () => {
    const root = path.join(os.tmpdir(), 'nomi-skill-root')
    const home = path.join(os.tmpdir(), 'nomi-skill-home')
    const at = (...parts) => path.join(...parts, 'SKILL.md')
    assert.equal(skillExists('x', { root, home, exists: () => false }), false)
    for (const found of [at(root, 'agent-skills', 'x'), at(root, '.claude', 'skills', 'x'), at(home, '.claude', 'skills', 'x')]) {
      assert.equal(skillExists('x', { root, home, exists: (file) => file === found }), true, found)
    }
    assert.equal(skillExists('x', { root, home, exists: (file) => file === at(root, 'agent-skills', 'other') }), false)
  })

  test('真实仓库里：hook 还会查的两个技能确实存在', () => {
    const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
    const home = makeTempDir('nomi-empty-home-')
    try {
      assert.equal(skillExists('nomi-intake-radar', { root: repo, home }), true)
      assert.equal(skillExists('nomi-competitive-radar', { root: repo, home }), true)
    } finally { cleanup(home) }
  })
})
