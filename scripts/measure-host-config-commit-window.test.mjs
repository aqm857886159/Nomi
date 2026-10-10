// 防烂测试：手动测量脚本用很小的 N 真跑一遍（走生产写盘门的测量缝），收据形状、统计和隐私约束都还成立。
import { execFileSync } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { collisionProbability, parseArgs, percentile } from './measure-host-config-commit-window.mjs'

const script = path.join(path.dirname(fileURLToPath(import.meta.url)), 'measure-host-config-commit-window.mjs')

describe('measure-host-config-commit-window', () => {
  it('小 N 真跑：每次提交都从生产写盘门拿到一个窗口样本，统计有序，收据里没有本机路径 / 主机名 / 用户名', () => {
    const out = execFileSync(process.execPath, [script, '--n', '3', '--size-kb', '1', '--host-interval-s', '5'], { encoding: 'utf8', timeout: 120_000 })
    const receipt = JSON.parse(out)
    expect(receipt.schemaVersion).toBe(1)
    expect(receipt.parameters).toEqual({ n: 3, fileBytes: 1024, hostIntervalS: 5 })
    expect(receipt.samplesMs).toHaveLength(3)
    for (const sample of receipt.samplesMs) expect(sample).toBeGreaterThan(0)
    const { p50Ms, p95Ms, p99Ms, maxMs } = receipt.stats
    expect(p50Ms).toBeLessThanOrEqual(p95Ms)
    expect(p95Ms).toBeLessThanOrEqual(p99Ms)
    expect(p99Ms).toBeLessThanOrEqual(maxMs)
    expect(receipt.collision.formula).toBe('P = 1 - exp(-(windowMs / 1000) / hostIntervalS)')
    expect(receipt.environment.node).toBe(process.version)
    for (const secret of [os.hostname(), os.userInfo().username, os.homedir(), os.tmpdir()]) {
      expect(out.toLowerCase(), 'receipt leaks a machine identifier').not.toContain(secret.toLowerCase())
    }
  }, 150_000)

  it('百分位用最近秩、撞击概率按泊松公式、参数校验', () => {
    expect(percentile([1, 2, 3, 4], 50)).toBe(2)
    expect(percentile([1, 2, 3, 4], 95)).toBe(4)
    expect(collisionProbability(1000, 5)).toBeCloseTo(1 - Math.exp(-0.2), 12)
    expect(parseArgs([])).toEqual({ n: 300, sizeKb: 80, hostIntervalS: 5, out: null })
    expect(() => parseArgs(['--n', '0'])).toThrow()
    expect(() => parseArgs(['--bogus', '1'])).toThrow()
  })
})
