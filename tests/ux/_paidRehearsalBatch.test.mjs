// 批量演练的两个纯函数：挑哪些脚本、日志 → 一句原因。
import { describe, expect, it } from 'vitest'

import { reasonFromLog, rehearsalTargets } from './_paidRehearsalBatch.mjs'

describe('paid rehearsal batch', () => {
  it('targets every *.paid.mjs except the ones that do not open through openPaidWalk', () => {
    const files = ['b.paid.mjs', 'a.paid.mjs', 'x.walk.mjs', '_paidRun.mjs', 'skip.paid.mjs']
    expect(rehearsalTargets(files, [{ file: 'tests/ux/skip.paid.mjs' }])).toEqual(['a.paid.mjs', 'b.paid.mjs'])
  })
  it('reason = the last [rehearsal] line, else the last error-looking line (stack frames ignored)', () => {
    expect(reasonFromLog('[paid] x\n[rehearsal] 付费走查出网被挡\n[rehearsal] 不过：没走到收窄花钱面\n')).toBe('不过：没走到收窄花钱面')
    expect(reasonFromLog('start\nError: 会花真钱\n    at foo (x.mjs:1)\n')).toBe('Error: 会花真钱')
    expect(reasonFromLog('')).toBe('没有输出')
  })
})
