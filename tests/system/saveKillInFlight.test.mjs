// 设计卡 D-main-thread-unblock ★9 A4：保存在飞时 kill -9，盘上要么是上一份完整版，要么是新版完整版，二者之一。
// 逐项隔离只改「写什么」，不改「怎么落盘」（仍是主进程的整文件原子写：写临时文件 → 改名）；这条测试证明这一点没被改坏。
// 杀的时刻由 tests/fixtures/save-kill-inflight.mjs 在保存代码里卡准（大块写的中途 / 改名之前），不靠计时碰运气。
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { afterAll, describe, expect, it } from 'vitest'
import { makeTempDir } from '../../scripts/_test-temp.mjs'

const FIXTURE = path.resolve(import.meta.dirname, '../fixtures/save-kill-inflight.mjs')
const REPEAT = 200_000 // 8 字符 × 200k = 1.6MB 一版
const roots = []
afterAll(() => { for (const root of roots) fs.rmSync(root, { recursive: true, force: true }) })

function runKilledAt(killAt) {
  const root = fs.realpathSync(makeTempDir('nomi-kill-inflight-'))
  roots.push(root)
  const killSave = 3
  const child = spawnSync(process.execPath, ['--import', 'tsx', FIXTURE, JSON.stringify({ root, repeat: REPEAT, killSave, killAt })], {
    encoding: 'utf8', timeout: 60_000, env: { ...process.env, VITEST: undefined, VITEST_WORKER_ID: undefined },
  })
  fs.readFileSync(path.join(root, 'id.json'), 'utf8')
  const manifest = path.join(root, 'projects', 'project', '.nomi', 'project.json')
  const record = JSON.parse(fs.readFileSync(manifest, 'utf8')) // 半截文件在这里就抛
  const saved = child.stdout.split('\n').filter(line => line.startsWith('saved ')).map(line => Number(line.slice(6)))
  return { text: record.payload.text, lastSaved: Math.max(0, ...saved), signal: child.signal }
}

describe('a process killed with SIGKILL while a save is in flight', () => {
  it.each(['write:1', 'write:2', 'write:3', 'write:4', 'rename'])('leaves the old complete version or the new complete version on disk (killed at %s)', (killAt) => {
    const { text, lastSaved } = runKilledAt(killAt)
    // 完整 = 8 位版本号重复满 REPEAT 次；版本只可能是「已报完成的最后一版」或「正在飞的下一版」。
    const version = Number(text.slice(0, 8))
    expect(text).toBe(String(version).padStart(8, '0').repeat(REPEAT))
    expect([lastSaved, lastSaved + 1]).toContain(version)
  }, 60_000)

  it('the kill points that exist in the real save do kill the process in flight', () => {
    // 防空转：写项目文件与它的备份、以及改名之前，必须真的在保存中途把进程杀掉，否则上面那条什么都没证明。
    expect(runKilledAt('write:1').signal).toBe('SIGKILL')
    expect(runKilledAt('write:2').signal).toBe('SIGKILL')
    expect(runKilledAt('rename').signal).toBe('SIGKILL')
  }, 60_000)
})
