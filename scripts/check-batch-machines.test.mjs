// 批量机器门岗的规则单测（P4 S7）。
//
// 为什么存在（dead-selector 教训）：一个失效的门岗比没门岗更坏——它给人「有人在守」的假安全感，
// 却悄悄放行。这份测试把每条规则的两头同时钉死：① 违规签名**必被抓**；② 合法/相似写法**不许误报**
// （误报=噪音=整条规则被无视，heavy-path 教训）。规则是 check-batch-machines.mjs 里的纯函数 scan，
// 直接 import 单测（不重写一遍规则，测的是真规则）。
import { describe, expect, it } from 'vitest'
import { RULES, stripComments, REQUIRED_LEGACY_ROUTES } from './check-batch-machines.mjs'

const ruleById = (id) => {
  const rule = RULES.find((r) => r.id === id)
  if (!rule) throw new Error(`规则不存在：${id}（改名了？测试要同步）`)
  return rule
}

/** 用某文件路径跑某规则（先抹注释，与真扫描器同款）。返回命中数。 */
const scanAs = (id, file, source) => ruleById(id).scan(stripComments(source), file).length

describe('check:batch-machines · rogue-renderer-batch（禁白名单外调 runGenerationNode）', () => {
  const OUTSIDE = 'src/workbench/generationCanvas/__new_machine.ts'
  const HOME = 'src/workbench/generationCanvas/runner/generationRunController.ts'

  it('抓：白名单外新起 runGenerationNode 循环', () => {
    expect(scanAs('rogue-renderer-batch', OUTSIDE, 'for (const id of ids) await runGenerationNode(id)')).toBeGreaterThan(0)
  })
  it('不误报：白名单家里调 runGenerationNode（现役唯一 GUI 批量家）', () => {
    expect(scanAs('rogue-renderer-batch', HOME, 'const result = await runGenerationNode(nodeId, opts)')).toBe(0)
  })
  it('不误报：定义/re-export runGenerationNode（不是调用）', () => {
    expect(scanAs('rogue-renderer-batch', OUTSIDE, 'export async function runGenerationNode(id) {}')).toBe(0)
    expect(scanAs('rogue-renderer-batch', OUTSIDE, "export { runGenerationNode } from './controller'")).toBe(0)
  })
  it('不误报：名字里含 runGenerationNode 的别的标识符（属性访问）', () => {
    expect(scanAs('rogue-renderer-batch', OUTSIDE, 'controller.runGenerationNode(id)')).toBe(0)
  })
})

describe("check:batch-machines · rogue-durable-submit（禁白名单外请求 production.generate-node）", () => {
  const OUTSIDE = 'electron/productionRun/__new_driver.ts'
  const FIXTURE_HOME = 'electron/productionRun/productionRunE2eFixture.ts'

  it('抓：白名单外新起 production.generate-node 请求点', () => {
    expect(scanAs('rogue-durable-submit', OUTSIDE, "return req('production.generate-node', payload)")).toBeGreaterThan(0)
  })
  it('不误报：只读 E2E fixture 可以模拟旧桥输入', () => {
    expect(scanAs('rogue-durable-submit', FIXTURE_HOME, "case 'production.generate-node': {")).toBe(0)
  })
  it('抓：旧请求方或应答方重新出现', () => {
    expect(scanAs('rogue-durable-submit', 'electron/productionRun/productionRunDriverOps.ts', "await requestRenderer('production.generate-node', {})")).toBeGreaterThan(0)
    expect(scanAs('rogue-durable-submit', 'src/workbench/capability/capabilityApplyHandler.ts', "case 'production.generate-node': {")).toBeGreaterThan(0)
  })
})

describe('check:batch-machines · legacy-routes-shrunk（LEGACY_GENERATION_ROUTES 六条不许少）', () => {
  const FILE = 'electron/capabilityCore/mcpGenerationPolicy.ts'
  const fullSet = `const LEGACY_GENERATION_ROUTES = new Set([\n${REQUIRED_LEGACY_ROUTES.map((r) => `  '${r}',`).join('\n')}\n])`

  it('不误报：六条 legacy 路齐全', () => {
    expect(scanAs('legacy-routes-shrunk', FILE, fullSet)).toBe(0)
  })
  it('抓：少了 production.control', () => {
    const shrunk = fullSet.replace("  'production.control',\n", '')
    expect(scanAs('legacy-routes-shrunk', FILE, shrunk)).toBeGreaterThan(0)
  })
  it('抓：少了 nomi_generate（换一条也一样抓）', () => {
    const shrunk = fullSet.replace("  'nomi_generate',\n", '')
    expect(scanAs('legacy-routes-shrunk', FILE, shrunk)).toBeGreaterThan(0)
  })
  it('只在该文件生效（别处出现这些字面量不算）', () => {
    expect(scanAs('legacy-routes-shrunk', 'electron/other.ts', fullSet)).toBe(0)
  })
})

describe('check:batch-machines · third-frozen-judgment（禁第三份 frozen.at>0 判据）', () => {
  const OUTSIDE = 'src/workbench/generationCanvas/__third_frozen.ts'
  const AUTHORITY = 'electron/capabilityCore/anchorBible.ts'
  const MIRROR = 'src/workbench/generationCanvas/model/anchorBibleKeys.ts'

  it('抓：第三处手写 isAnchorFrozen 判据（frozen 的 at>0 数值门）', () => {
    const src = [
      'const mark = meta.frozen',
      "if (typeof mark.at === 'number' && mark.at > 0) return true",
    ].join('\n')
    expect(scanAs('third-frozen-judgment', OUTSIDE, src)).toBeGreaterThan(0)
  })
  it('不误报：权威与镜像两处（合法的两源镜像）', () => {
    const src = "const at = mark.at\nreturn typeof at === 'number' && Number.isFinite(at) && at > 0 // frozen"
    expect(scanAs('third-frozen-judgment', AUTHORITY, src)).toBe(0)
    expect(scanAs('third-frozen-judgment', MIRROR, src)).toBe(0)
  })
  it('不误报：referenceSheet === true（到处在用的合法标记，不是冻结判据）', () => {
    // 关键防噪音断言：分镜编号/画布工具/nodeKindDomain 都读 referenceSheet===true，认它=噪音爆炸。
    expect(scanAs('third-frozen-judgment', OUTSIDE, 'if (meta.referenceSheet === true) return false')).toBe(0)
  })
  it('不误报：单纯读 meta.frozen 值（渲染/序列化，不是又写一份判据）', () => {
    expect(scanAs('third-frozen-judgment', OUTSIDE, 'const frozen = node.meta?.frozen')).toBe(0)
  })
})
