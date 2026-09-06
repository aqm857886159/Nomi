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
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { LAB_SCREENS, LAB_SCREEN_IDS, parseLabStateFile, readLabStates } from './labStates.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))

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

  // 真注册表上的活性证据：**两种方法数出同一个数**。
  //
  // 一边用最笨的 grep 数每个注册表文件里有几条 `id: '…',` 紧跟 `name:`，一边用解析器
  // 数它解出几条。两边都在数同一件事，但方法完全不同，所以「解析器悄悄漏了一条」
  // 会让两个数分家——而这正是本族 bug 唯一的外在表现（漏项在下游长成「本来就没有这个状态」）。
  //
  // 不写死 id 清单：清单会在 main 增删一格时红在「清单过期」上（#542 删掉 v4-wired-empty
  // 时就红过一次），那种红既不指向 bug 又逼人改测试，久了就会被改成松断言。
  // 也不假设某个文件用的是标识符写法：#542 已经把 04-wired.tsx 的 `SOURCE` 内联成字面量了，
  // 「哪个文件用哪种写法」是会漂的，能不能解析得动才是这里要钉的。
  it('每个屏：解析器数出的条数 = 最笨的 grep 数出的条数', () => {
    for (const screen of LAB_SCREEN_IDS) {
      const dir = LAB_SCREENS[screen].registryDir
      const naive = fs.readdirSync(dir).filter((n) => n.endsWith('.tsx')).reduce((sum, name) => {
        const text = fs.readFileSync(path.join(dir, name), 'utf8')
        return sum + (text.match(/\bid:\s*'[a-z0-9-]+',\s*\n\s*name:\s*'/g) ?? []).length
      }, 0)
      expect(naive, `${screen} 的注册表一条都没数到，判据本身失效了`).toBeGreaterThan(0)
      expect(readLabStates(screen), `${screen} 解析漏项`).toHaveLength(naive)
    }
  })

  // 标识符写法今天在仓里没有实例（#542 内联掉了），但解析器仍然必须认得它——
  // 否则谁再写一次 `const SOURCE`，就又是一次静默漏项。合成夹具那几条就是它的证据，
  // 这里只再确认一遍「解出来的是那句话，不是 'SOURCE' 六个字母」。
  it('标识符 source 解出的是常量的值，不是标识符本身', () => {
    const [first] = parseLabStateFile(IDENTIFIER_SOURCE, 'demo/01.tsx')
    expect(first.source).not.toBe('SOURCE')
    expect(first.source).toContain('一整组共用这一句')
  })})
