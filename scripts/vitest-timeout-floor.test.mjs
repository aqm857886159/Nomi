// 「用例 / 钩子不许设比 vitest 全局更短的超时」这条 ESLint 规则的两条保险：
// ① eslint.config.mjs 里的下限与 vitest.config.ts 的 testTimeout / hookTimeout 同值（改一边忘了另一边就红）；
// ② 规则真的接在测试文件上：更短的超时报错，等于全局 / 不传不报。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { ESLint } from 'eslint'
import { describe, expect, it } from 'vitest'

import { VITEST_TIMEOUT_FLOOR_MS } from '../eslint.config.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

describe('vitest timeout floor', () => {
  it('ESLint 下限与 vitest.config.ts 的全局超时同值', () => {
    const config = fs.readFileSync(path.join(root, 'vitest.config.ts'), 'utf8')
    const read = (key) => Number(config.match(new RegExp(`\\b${key}:\\s*([\\d_]+)`))?.[1]?.replaceAll('_', ''))
    expect(read('testTimeout')).toBe(VITEST_TIMEOUT_FLOOR_MS)
    expect(read('hookTimeout')).toBe(VITEST_TIMEOUT_FLOOR_MS)
  })

  it('测试文件里更短的超时被拦，等于全局或不传不拦', async () => {
    const eslint = new ESLint({ cwd: root })
    const source = [
      "import { beforeAll, it, test } from 'vitest'",
      "it('short', async () => {}, 15_000)",
      "test.each([1])('short each %s', async () => {}, 5000)",
      "it('short option', async () => {}, { timeout: 10_000 })",
      "beforeAll(async () => {}, 20_000)",
      "it('floor', async () => {}, 30_000)",
      "it('default', async () => {})",
      '',
    ].join('\n')
    const [result] = await eslint.lintText(source, { filePath: path.join(root, 'electron', 'timeoutFloorProbe.test.ts') })
    const lines = result.messages.filter((m) => m.ruleId === 'no-restricted-syntax').map((m) => m.line)
    expect(lines).toEqual([2, 3, 4, 5])
  }, 60_000)
})
