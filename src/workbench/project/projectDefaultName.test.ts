import { describe, expect, it } from 'vitest'
import { formatDefaultProjectName } from './projectRepository'
import type { WorkbenchProjectSummary } from './projectRecordSchema'

// 2026-09-17 走查 W-10 的回归：连续新建两个空白项目，项目库里两张卡的名字、缩略图、状态行
// **完全相同**，用户没有任何办法分辨哪个是哪个。缩略图（同一张灰色占位）与状态行（都是「刚刚」）
// 本来就该一样——它们没有身份可言；名字是卡片上唯一能承载身份的那一格。
const summary = (name: string): WorkbenchProjectSummary =>
  ({ id: `p-${name}`, name, createdAt: 0, updatedAt: 0, revision: 0 } as WorkbenchProjectSummary)

describe('新建项目的默认名', () => {
  it('没撞名就还是那个干净的名字（代价只落在真撞了的那次上）', () => {
    const first = formatDefaultProjectName([])
    expect(first).toBeTruthy()
    expect(first).not.toMatch(/\(\d+\)$/)
  })

  it('同一分钟内建第二个：名字必须和第一个不同', () => {
    const first = formatDefaultProjectName([])
    const second = formatDefaultProjectName([summary(first)])
    expect(second).not.toBe(first)
    const third = formatDefaultProjectName([summary(first), summary(second)])
    expect(new Set([first, second, third]).size).toBe(3)
  })
})
