import { execSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'

// L1 回归：禁止非 token 的半 px 字号（text-[N.5px]），R8 token-only。
// 字号 token 只有 11/12/13/14/16/20/24（text-micro/caption/body-sm/body/title…）。
// 已知文档化例外（spec §4.3 派生角标 / 时间轴 snap-tag）列白名单，棘轮只减不增。
const ALLOWLIST = new Set([
  'src/workbench/generationCanvas/nodes/BaseGenerationNode.tsx:611', // §4.3 独立副本派生角标，spec'd 10.5
  'src/workbench/timeline/TimelinePanel.tsx:297', // 时间轴 snap-tag，9.5 低于 token 下限
])

describe('字号 token 合规（R8）', () => {
  it('src 内无非白名单的半 px 字号 text-[N.5px]', () => {
    let raw = ''
    try {
      // grep 命中返回 0，无命中返回 1（抛错）→ 无命中即视为通过
      raw = execSync(String.raw`grep -rn "text-\[[0-9]*\.5px\]" src/`, { encoding: 'utf8' })
    } catch {
      raw = ''
    }
    const offenders = raw
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const [file, lineNo] = line.split(':')
        return `${file}:${lineNo}`
      })
      .filter((loc) => !ALLOWLIST.has(loc))
    expect(offenders, `发现非 token 半 px 字号（应换 text-micro/caption/body-sm 等 token）：\n${offenders.join('\n')}`).toEqual([])
  })
})
