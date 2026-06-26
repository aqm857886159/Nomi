import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

// L1 回归：禁止非 token 的半 px 字号（text-[N.5px]），R8 token-only。
// 字号 token 只有 11/12/13/14/16/20/24（text-micro/caption/body-sm/body/title…）。
// 两处文档化例外（spec §4.3 派生角标 10.5 / 时间轴 snap-tag 9.5）按「文件 → 允许条数」
// 列白名单——按文件计数而非行号，避免无关编辑挪行就误报。棘轮只减不增。
const ALLOWED_PER_FILE: Record<string, number> = {
  'src/workbench/generationCanvas/nodes/BaseGenerationNode.tsx': 1, // §4.3 独立副本派生角标 10.5
  'src/workbench/timeline/TimelinePanel.tsx': 1, // 时间轴 snap-tag 9.5，低于 token 下限
}

describe('字号 token 合规（R8）', () => {
  it('src 内无超出白名单的半 px 字号 text-[N.5px]', () => {
    const countByFile = new Map<string, number>()
    const pattern = /text-\[[0-9]*\.5px\]/g

    function walk(dir: string): void {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const absolutePath = path.join(dir, entry.name)
        if (entry.isDirectory()) {
          walk(absolutePath)
          continue
        }
        if (!/\.(ts|tsx)$/.test(entry.name)) continue
        const content = fs.readFileSync(absolutePath, 'utf8')
        const matches = content.match(pattern)
        if (!matches?.length) continue
        const relativePath = absolutePath.replace(/\\/g, '/')
        countByFile.set(relativePath, matches.length)
      }
    }

    walk('src')
    const offenders = [...countByFile.entries()]
      .filter(([file, count]) => count > (ALLOWED_PER_FILE[file] ?? 0))
      .map(([file, count]) => `${file}: ${count} 处（白名单允许 ${ALLOWED_PER_FILE[file] ?? 0}）`)
    expect(offenders, `发现超白名单的非 token 半 px 字号（应换 text-micro/caption/body-sm 等 token）：\n${offenders.join('\n')}`).toEqual([])
  })
})
