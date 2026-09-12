import fs from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { copyToClipboard } from './clipboard'

const repoRoot = process.cwd()

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) { if (entry.name !== 'node_modules') walk(full, out); continue }
    if (/\.(ts|tsx|mts)$/.test(entry.name)) out.push(full)
  }
  return out
}

describe('剪贴板只有一个写口', () => {
  /**
   * 2026-09-11 用户反馈：助手输出上那枚复制 icon「点了没反应」。字进去了，只是没人说一声。
   *
   * 这条不是查那一处，是查**结构**：只要还有第二个地方能直接调 `clipboard.writeText`，
   * 「复制成功要不要说」就又变成每个调用点自己的判断，漏掉的那几处早晚回来。
   * 收成一处之后这条门岗替人数数（R28：能让门岗拦的别留给人）。
   */
  it('全仓除 design/clipboard.ts 外，没有第二处直接调 navigator.clipboard.writeText', () => {
    const offenders: string[] = []
    for (const file of [...walk(path.join(repoRoot, 'src')), ...walk(path.join(repoRoot, 'electron'))]) {
      const relative = path.relative(repoRoot, file)
      // 本文件自己会写出这个串（mock 与正则），它是门岗不是调用点。
      if (relative === path.join('src', 'design', 'clipboard.ts')) continue
      if (relative === path.join('src', 'design', 'clipboard.test.ts')) continue
      const source = fs.readFileSync(file, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '')
        .replace(/^\s*\*.*$/gm, '')
      if (/clipboard\s*\??\.\s*writeText/.test(source)) offenders.push(relative)
    }
    expect(offenders).toEqual([])
  })
})

describe('copyToClipboard 不抛、不吞', () => {
  const writeText = vi.fn()
  beforeEach(() => {
    writeText.mockReset()
    Object.defineProperty(globalThis, 'navigator', { value: { clipboard: { writeText } }, configurable: true, writable: true })
  })
  afterEach(() => { vi.restoreAllMocks() })

  it('写成了回 true', async () => {
    writeText.mockResolvedValue(undefined)
    await expect(copyToClipboard('hello')).resolves.toBe(true)
    expect(writeText).toHaveBeenCalledWith('hello')
  })

  /** 失败必须**可分辨**——原来各调用点的 `.catch(() => undefined)` 把失败洗成了和成功一样。 */
  it('写失败（无权限 / 非安全上下文）回 false，不抛出去', async () => {
    writeText.mockRejectedValue(new Error('NotAllowedError'))
    await expect(copyToClipboard('hello')).resolves.toBe(false)
  })

  it('没有 navigator.clipboard 时回 false', async () => {
    Object.defineProperty(globalThis, 'navigator', { value: {}, configurable: true, writable: true })
    await expect(copyToClipboard('hello')).resolves.toBe(false)
  })

  /** 空内容说「已复制」就是骗人：没东西可复制时不写、也不亮回执。 */
  it('空串不写，回 false', async () => {
    await expect(copyToClipboard('')).resolves.toBe(false)
    expect(writeText).not.toHaveBeenCalled()
  })
})
