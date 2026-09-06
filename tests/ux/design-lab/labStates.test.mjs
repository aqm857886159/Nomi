// 注册表解析器的回归测试（2026-09-06）。
//
// 立项根因：这把解析器的失败模式是**静默漏项**，而不是报错。漏掉的状态在所有下游都
// 长成「本来就没有这个状态」——少截一张图、少比一条基线，`check:design-lab` 照旧打印
// 「一一对应」。它至今咬过两次（`inspector-04-music` 夹了注释、`v4-wired-*` 用标识符写
// source），两次都只有走查的「活页面 vs 解析结果」事后抓到，静态门岗一次都没看见。
//
// 所以这里钉的是两件事，缺一不可：
//   ① 合法但不同写法的注册项**都数得进来**（标识符 source、中间夹注释）；
//   ② 真读不懂的时候**当场抛**，不是安静地少一条。
// 与它同 dir 的 labFailureTriage.test.mjs 一样走 vitest（vitest.config 的 `tests/**/*.test.mjs`
// 已经收了这片），不另起一套跑法。
import { describe, expect, it } from 'vitest'
import { parseLabStateFile, readLabStates } from './labStates.mjs'

const IDENTIFIER_SOURCE = `
import type { LabState } from '../../labScreen'
const SOURCE = '2026-09-06-some-doc.md · 一整组共用这一句'
export const SOME_STATES: readonly LabState[] = [
  {
    id: 'demo-01-first',
    name: '第一格',
    source: SOURCE,
    coverage: 'shell',
    span: 2,
    render: () => <FirstCell />,
  },
  {
    id: 'demo-02-second',
    name: '第二格',
    source: SOURCE,
    coverage: 'shell',
    capture: 'viewport',
    render: () => <SecondCell />,
  },
]
`

describe('注册表解析器', () => {
  it('用标识符写 source 也被数进去，且解出常量的值', () => {
    const states = parseLabStateFile(IDENTIFIER_SOURCE, 'demo/01.tsx')
    expect(states.map((state) => state.id)).toEqual(['demo-01-first', 'demo-02-second'])
    expect(states[0].source).toBe('2026-09-06-some-doc.md · 一整组共用这一句')
    expect(states[1].capture).toBe('viewport')
  })

  it('注册项中间夹一段注释仍然数得进来（旧正则要求四行严格相邻）', () => {
    const withComment = IDENTIFIER_SOURCE.replace(
      "    source: SOURCE,\n    coverage: 'shell',\n    span: 2,",
      "    source: SOURCE,\n    // 这一格拍板时要看的是……\n    coverage: 'shell',\n    span: 2,",
    )
    expect(parseLabStateFile(withComment, 'demo/01.tsx').map((state) => state.id))
      .toEqual(['demo-01-first', 'demo-02-second'])
  })

  it('夹具数据里的 id 不会被当成状态（它后面没有紧跟 name）', () => {
    const withFixture = IDENTIFIER_SOURCE.replace(
      '<FirstCell />',
      "<RowStage sourceSegment={{ id: 'F_SEG_B', edited: false }} />",
    )
    expect(parseLabStateFile(withFixture, 'demo/01.tsx')).toHaveLength(2)
  })

  it('source 引用了不存在的常量时当场抛，指名道姓说是哪一条', () => {
    const dangling = IDENTIFIER_SOURCE.replace("const SOURCE = ", "const OTHER_NAME = ")
    expect(() => parseLabStateFile(dangling, 'demo/01.tsx')).toThrow(/demo-01-first[\s\S]*SOURCE/)
  })

  it('认出注册项却读不全元数据时当场抛，而不是安静地少一条', () => {
    const noCoverage = IDENTIFIER_SOURCE.replace("    coverage: 'shell',\n    span: 2,\n", '')
    expect(() => parseLabStateFile(noCoverage, 'demo/01.tsx')).toThrow(/demo-01-first[\s\S]*coverage/)
  })

  it('真注册表里 v4 的 6 张接线格都在（它们正是用标识符写 source 的那一组）', () => {
    const wired = readLabStates('agent-panel-v4').filter((state) => state.id.startsWith('v4-wired-'))
    expect(wired.map((state) => state.id)).toEqual([
      'v4-wired-creation', 'v4-wired-generation', 'v4-wired-preview',
      'v4-wired-empty', 'v4-wired-running', 'v4-wired-failure',
    ])
    for (const state of wired) expect(state.source).toMatch(/接线证据/)
  })
})
