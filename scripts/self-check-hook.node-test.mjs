#!/usr/bin/env node
import { makeTempDir } from './_test-temp.mjs'
// 每轮注入（self-check.sh）的行为测试：常驻要小、关键词块命中才出现、注入里指向的文件都真实存在。
//
// 为什么要测：规则体系瘦身把 CLAUDE.md 里「只在特定场景才用」的段落搬走，保证它们「用到时一定加载」的唯一机制就是
// 这些关键词块。关键词块静默失效（比如 hook 读不到用户消息）时，一切照常退出 0、只是什么也没注入——和旧版
// 只读未文档化的 CLAUDE_USER_PROMPT 环境变量的情形一模一样。所以这里真起 hook、喂官方形状的 stdin JSON。
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, test } from 'node:test'

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const HOOK = path.join(repo, 'scripts', 'claude-hooks', 'self-check.sh')
const emptyProject = makeTempDir('nomi-selfcheck-')

const inject = (prompt) => spawnSync('bash', [HOOK], {
  input: Buffer.from(JSON.stringify({ hook_event_name: 'UserPromptSubmit', prompt }), 'utf8'),
  env: { ...process.env, CLAUDE_PROJECT_DIR: emptyProject, CLAUDE_USER_PROMPT: '' },
  encoding: 'utf8',
}).stdout

const NEUTRAL = '你好，今天天气怎么样'

describe('常驻部分', () => {
  test('没命中任何关键词时只有那一小段（≤1000 字节，瘦身前是 2824）', () => {
    const out = inject(NEUTRAL)
    assert.match(out, /【动手前 · 到这三刻必停/)
    assert.ok(Buffer.byteLength(out, 'utf8') <= 1000, `常驻 ${Buffer.byteLength(out, 'utf8')} 字节`)
    for (const block of ['【设计卡】', '【设计流程】', '【画新面', '【先查别人', '【报完成前', '【修根因', '【交付', '【命令全表】']) assert.doesNotMatch(out, new RegExp(block))
  })

  test('常驻段保留三刻和贯穿原则的锚点', () => {
    const out = inject(NEUTRAL)
    for (const anchor of ['P0', 'grill', 'P5', 'design-card', 'P3', 'R13', 'R11/R22', 'P2', 'P1', 'RW']) assert.ok(out.includes(anchor), anchor)
  })
})

describe('关键词块：命中才注入', () => {
  const cases = [
    ['这个生成要先付费确认再批量生成', '【设计卡】'],
    ['我要画一个新页面', '【设计卡】'],
    ['想引入一个新框架 SDK', '【先查别人 · R5】'],
    ['这个功能做完了，给你看', '【报完成前 · R13】'],
    ['有个 bug 要修', '【修根因 · P2】'],
    ['准备合并这个 PR，先跑 delivery:preflight', '【交付 · R11/R22】'],
    ['pnpm run gates 红了', '【命令全表】'],
    ['check:filesize 红了', '不许抬基线或预算挤 PR(R17)'],
    ['这个又坏了，再修一轮', '【方向检查 · RW】'],
    ['已经是第五轮了还是不对', '【方向检查 · RW】'],
    ['派工给子 agent 做', '【派工 · 省 token】'],
  ]
  for (const [prompt, expected] of cases) {
    test(`「${prompt}」→ ${expected}`, () => {
      const out = inject(prompt)
      assert.ok(out.includes(expected), out)
      assert.ok(out.includes('【动手前 · 到这三刻必停'), '常驻段不能被挤掉')
    })
  }

  test('新合并规矩在交付块里（只由协调会话做；CI 绿 + 扫描干净就合，最多 3 个在等收据，红了立刻停）', () => {
    const out = inject('合并')
    assert.match(out, /只由协调会话做/)
    assert.match(out, /最多 3 个在等收据/)
    assert.match(out, /收据红了立刻停/)
    assert.doesNotMatch(out, /上一个合入没有收据，就不合下一个/)
  })
})

describe('方向检查块：只在反复修信号出现时注入，普通 bug 与第 1-2 轮不触发', () => {
  test('普通修 bug 只有修根因块，没有方向检查块', () => {
    const out = inject('有个 bug 要修')
    assert.doesNotMatch(out, /【方向检查 · RW】/)
    assert.ok(out.includes("方向检查(RW)"))
  })
  test('第 2 轮不触发，第 3 轮触发', () => {
    assert.doesNotMatch(inject('这是第 2 轮'), /【方向检查 · RW】/)
    assert.match(inject('这是第 3 轮'), /【方向检查 · RW】/)
  })
})

describe('指针完整：注入里点名的文件都真实存在', () => {
  test('所有关键词块里的 docs/ 与 .agents/ 路径都在仓库里', () => {
    const out = [NEUTRAL, '设计 新页面 框架 做完 bug 合并 gates'].map(inject).join('\n')
    const paths = [...new Set([...out.matchAll(/((?:docs|\.agents)\/[\w./-]+\.(?:md|json))/g)].map((m) => m[1]))]
    assert.ok(paths.length >= 4, `只找到 ${paths.length} 个路径`)
    for (const rel of paths) assert.ok(fs.existsSync(path.join(repo, rel)), `${rel} 不存在`)
    const skill = '.agents/skills/root-cause-remediation'
    assert.ok(fs.existsSync(path.join(repo, skill, 'SKILL.md')), skill)
  })
})

describe('读不到用户消息 → 退化为只有常驻段，不崩', () => {
  test('空 stdin / 坏 JSON', () => {
    for (const input of ['', '{not json']) {
      const result = spawnSync('bash', [HOOK], { input: Buffer.from(input), env: { ...process.env, CLAUDE_PROJECT_DIR: emptyProject, CLAUDE_USER_PROMPT: '' }, encoding: 'utf8' })
      assert.equal(result.status, 0)
      assert.match(result.stdout, /【动手前 · 到这三刻必停/)
    }
  })
})

describe('设计卡块：两块合成一块、词表收窄、命中次数记到本机统计文件', () => {
  test('原来的【设计流程】【画新面】不再单独出现；泛词（界面 / 设计 / 重做）不再触发', () => {
    const out = inject('我要画一个新页面，带付费确认')
    assert.equal((out.match(/【设计卡】/g) ?? []).length, 1)
    assert.doesNotMatch(out, /【设计流程】|【画新面/)
    for (const prompt of ['帮我改下这个界面的颜色', '这个设计重做一下', '导入导出格式规范怎么写']) {
      const quiet = inject(prompt)
      assert.doesNotMatch(quiet, /【设计卡】|【先查别人/, prompt)
    }
  })

  test('命中一次就在 .claude/self-check-hits.log 记一行（块名），没命中不记', () => {
    const project = makeTempDir('nomi-selfcheck-hits-')
    const run = (prompt) => spawnSync('bash', [HOOK], {
      input: Buffer.from(JSON.stringify({ prompt }), 'utf8'),
      env: { ...process.env, CLAUDE_PROJECT_DIR: project, CLAUDE_USER_PROMPT: '' },
      encoding: 'utf8',
    })
    run(NEUTRAL)
    const log = path.join(project, '.claude', 'self-check-hits.log')
    assert.equal(fs.existsSync(log), false, '没命中不该记')
    run('新界面要走付费确认')
    run('想引入一个新框架 SDK')
    const lines = fs.readFileSync(log, 'utf8').trim().split(String.fromCharCode(10))
    assert.deepEqual(lines.map((line) => line.split('|')[1]), ['design-card', 'prior-art'])
    fs.rmSync(project, { recursive: true, force: true })
  })
})
