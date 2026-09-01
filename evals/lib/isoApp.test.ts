// 种子期版本闸的回归。
//
// 隔离走查的 catalog 种子拷自用户**真实档案**，而真实档案总被这台机器上最新的构建升级
// （这里常年 20+ worktree 各在不同 schema 版本）。种子比被测构建新时，主进程 writeCatalog
// 会 fail-closed 拒绝一切写回（行为正确），于是走查播种的 vendor/key/model 全写不进去、
// 模型选择器空着、「切换模型」点了不生效且不报错 —— 假绿。
//
// 启动期已有一道运行时闸（tests/ux/_launchApp.mjs assertCatalogWritable）。这道更早：
// 在 copyFileSync 那一刻就拦，省掉起 app 的几十秒，且报错点离病因更近。
//
// 注意：文件名必须是 .test.ts —— vitest.config 的 include 里 evals/** 只收 .ts，
// 写成 .mjs 会静静躺着不跑（比没写更糟）。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { assertSeedUnderstoodByBuild } from './isoApp.mjs'

const made: string[] = []
function seedFile(value: unknown): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-seed-gate-'))
  made.push(dir)
  const file = path.join(dir, 'model-catalog.json')
  fs.writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value))
  return file
}

afterEach(() => {
  for (const dir of made.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

describe('prepareIsolation 的种子期版本闸', () => {
  it('种子比被测构建新 → 抛错，并带出两个版本号与三条出路', () => {
    const file = seedFile({ version: 14, vendors: [], models: [], mappings: [], apiKeysByVendor: {} })
    expect(() => assertSeedUnderstoodByBuild(file, 12)).toThrow(/只读/)

    let message = ''
    try { assertSeedUnderstoodByBuild(file, 12) } catch (error) { message = (error as Error).message }
    expect(message).toContain('v14')
    expect(message).toContain('v12')
    // 报错必须解释「为什么这是假绿」，否则下一个人会去改断言绕过它。
    expect(message).toContain('假绿')
    expect(message).toContain('requireCatalog: false')
    expect(message).toContain('allowReadOnlyCatalog: true')
  })

  it('同版本与更旧的种子照常放行（旧种子由 app 自己前向迁移，不归这道闸管）', () => {
    const same = seedFile({ version: 12, vendors: [], models: [], mappings: [], apiKeysByVendor: {} })
    const older = seedFile({ version: 3, vendors: [], models: [], mappings: [], apiKeysByVendor: {} })
    expect(assertSeedUnderstoodByBuild(same, 12)).toBe(12)
    expect(assertSeedUnderstoodByBuild(older, 12)).toBe(3)
  })

  it('读不到被测构建版本时不判断——绝不臆断一个版本号来拦人', () => {
    const file = seedFile({ version: 99, vendors: [], models: [], mappings: [], apiKeysByVendor: {} })
    expect(assertSeedUnderstoodByBuild(file, null as unknown as number)).toBe(null)
  })

  it('种子损坏/无版本号不归这道闸管（别把无关故障报成版本偏移）', () => {
    expect(assertSeedUnderstoodByBuild(seedFile('{ not json'), 12)).toBe(null)
    expect(assertSeedUnderstoodByBuild(seedFile({ vendors: [] }), 12)).toBe(null)
    expect(assertSeedUnderstoodByBuild(path.join(os.tmpdir(), 'nomi-absent-seed.json'), 12)).toBe(null)
  })

  it('绝不代劳降级种子版本——那正是 writeCatalog 拼命防的静默降级', () => {
    const file = seedFile({ version: 14, vendors: [], models: [], mappings: [], apiKeysByVendor: {} })
    try { assertSeedUnderstoodByBuild(file, 12) } catch { /* 预期抛错 */ }
    expect(JSON.parse(fs.readFileSync(file, 'utf8')).version).toBe(14)
  })
})
