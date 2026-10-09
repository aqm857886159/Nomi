// E2E Walkthroughs (Linux) 的分片计划（唯一 owner）。
//
// 背景：这一个 job 把十条走查 + 90 多格弹层几何普查串在一台机器上，实测 38.9 分钟，是每个 PR 每次推送的
// 关键路径（Unit 16、Perf 12 都比它短一半多）。现在 workflow 把它开成 N 片矩阵并行，**每片跑哪些走查由这里算**，
// workflow 里不写死分配——新增一条走查 / 一个普查格会自动进某一片，不可能漏跑（assertPartition 与结构测试守这一条）。
//
// 分配：按历史耗时做 LPT 装箱（最长的先放，每次放进当前最轻的一片），不按文件名平分。
// 耗时来源：近 4 次 main/PR 成功运行的逐步耗时均值（2026-10-09，job 步骤 started_at/completed_at）与普查逐格时间戳；
// 数字只用来均衡，不是预算——差一点只会让某片稍长，不会漏跑任何走查。
//
// 为什么每片各自 build，而不是上游 job 出 artifact 共享：build 实测 ~65 秒；共享要多一个串行上游 job
// （checkout + install + build ≈ 2 分钟）再加每片下载 dist / dist-electron，墙钟比各片并行各 build 长。
// Canvas Acceptance 现成的矩阵也是各片自己 build，沿用同一写法。
import { listMeasurableTargets } from '../../tests/ux/design-lab/popupGeometryTargets.mjs'

/**
 * 整块走查（一个 workflow 步骤 = 一个单元）。id 与 quality-gate.yml 里该步骤的 `id:` 一字不差，
 * 结构测试逐个核对 yml 步骤的 `contains(steps.plan.outputs.units, …)` 条件。
 * seconds：该单元历史耗时（秒）。
 */
export const E2E_UNITS = Object.freeze([
  Object.freeze({ id: 'feel', seconds: 14 }), // 浏览器手感机制（node --test 三个文件）
  Object.freeze({ id: 'smoke', seconds: 45 }), // Electron 冒烟
  Object.freeze({ id: 'journeys', seconds: 75 }), // CI-safe 用户旅程
  Object.freeze({ id: 'mcp-journey', seconds: 170 }), // MCP L1 握手
  Object.freeze({ id: 'mcp-elicitation', seconds: 25 }), // MCP elicitation-first
  Object.freeze({ id: 'real-user-journeys', seconds: 300 }), // 真实用户 loopback 旅程
  Object.freeze({ id: 'golden', seconds: 47 }), // 金路径
  Object.freeze({ id: 'spend-walks', seconds: 270 }), // 花钱路径走查（阻断子集，由路由表给清单）
  Object.freeze({ id: 'canvas-critical', seconds: 300 }), // 关键画布验收（仅 canvas==critical 时跑）
])

/** 弹层几何普查逐格耗时（秒/格），按屏；没登记的屏用默认值。导演台是 WebGL 软渲染，慢一个量级。 */
export const CENSUS_SECONDS_BY_SCREEN = Object.freeze({
  'director-refine': 32,
  'director-3dbox': 11,
  'catalog-liveness': 6,
})
export const CENSUS_DEFAULT_SECONDS = 4

const cellSeconds = (cell) => CENSUS_SECONDS_BY_SCREEN[cell.split('/')[0]] ?? CENSUS_DEFAULT_SECONDS

/** 所有要分配的东西：[{ kind: 'unit'|'census', id, seconds }]。 */
export function listShardItems() {
  const units = E2E_UNITS.map((unit) => ({ kind: 'unit', id: unit.id, seconds: unit.seconds }))
  const cells = listMeasurableTargets().map(({ screen, state }) => {
    const id = `${screen}/${state.id}`
    return { kind: 'census', id, seconds: cellSeconds(id) }
  })
  return [...units, ...cells]
}

/** LPT 装箱：返回 total 片，每片 { units: [id], census: [screen/state], seconds }。确定性：同输入同输出。 */
export function planShards(total, items = listShardItems()) {
  if (!Number.isInteger(total) || total < 1) throw new Error(`分片数必须是正整数，收到 ${total}`)
  const bins = Array.from({ length: total }, () => ({ units: [], census: [], seconds: 0 }))
  const ordered = [...items].sort((a, b) => b.seconds - a.seconds || (a.kind + a.id < b.kind + b.id ? -1 : 1))
  for (const item of ordered) {
    const bin = bins.reduce((lightest, candidate) => (candidate.seconds < lightest.seconds ? candidate : lightest))
    bin[item.kind === 'unit' ? 'units' : 'census'].push(item.id)
    bin.seconds += item.seconds
  }
  return bins
}

/** 每个单元 / 普查格恰好落在一片，否则抛错（运行期也会调：计划自己坏了不许静默漏跑）。 */
export function assertPartition(total, items = listShardItems()) {
  const bins = planShards(total, items)
  const seen = new Map()
  bins.forEach((bin, index) => {
    for (const key of [...bin.units.map((id) => `unit:${id}`), ...bin.census.map((id) => `census:${id}`)]) {
      seen.set(key, [...(seen.get(key) ?? []), index + 1])
    }
  })
  const expected = items.map((item) => `${item.kind}:${item.id}`)
  const missing = expected.filter((key) => !seen.has(key))
  const duplicated = [...seen].filter(([, shards]) => shards.length > 1).map(([key]) => key)
  const phantom = [...seen.keys()].filter((key) => !expected.includes(key))
  if (missing.length || duplicated.length || phantom.length) {
    throw new Error(`E2E 分片计划不是一个划分：漏分 ${JSON.stringify(missing)}，重分 ${JSON.stringify(duplicated)}，幽灵 ${JSON.stringify(phantom)}`)
  }
  return bins
}

export function parseShardArg(text) {
  const match = /^(\d+)\/(\d+)$/.exec(String(text ?? '').trim())
  if (!match) throw new Error(`--shard 要写成 i/n（如 2/4），收到 ${JSON.stringify(text)}`)
  const index = Number(match[1])
  const total = Number(match[2])
  if (total < 1 || index < 1 || index > total) throw new Error(`--shard ${text} 越界`)
  return { index, total }
}

export const unitsForShard = (index, total) => assertPartition(total)[index - 1].units
export const censusCellsForShard = (index, total) => assertPartition(total)[index - 1].census
