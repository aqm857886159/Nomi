#!/usr/bin/env node
/**
 * 把 canvas-scale-bench 的若干份结果 JSON 合成文档里的三张表。
 *
 * 分成多份是实测出来的需要：一次跑满 3 档 × 8 场景要一个多小时，中途机器上别的工作树
 * 一忙就得中断重跑。所以按（规模 × 场景）分批跑、各出一份 JSON，这里按
 * (scenario, scale) 去重合并——**采样次数多的那份胜出**，不是后写的那份胜出。
 *
 * 用法：node tests/perf/summarize-scale-results.mjs [file.json ...]
 * 不给参数就吃 tests/perf/results/canvas-scale-*.json 全部。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const resultsDir = path.join(repoRoot, 'tests/perf/results')
const files = process.argv.slice(2).length
  ? process.argv.slice(2)
  : fs.readdirSync(resultsDir).filter((name) => name.startsWith('canvas-scale-') && name.endsWith('.json'))
    .map((name) => path.join(resultsDir, name))

const SCENARIO_ORDER = [
  'drag-nodes-1', 'drag-nodes-20', 'drag-nodes-60', 'drag-nodes-all',
  'drag-group-frame-60', 'marquee-select-all', 'wheel-zoom', 'pan', 'zoom-slider-drag',
]
const SCALE_ORDER = ['I60', 'I150', 'I300', 'S', 'M', 'L', 'XL']

const rows = []
const profiles = []
let machine = null
for (const file of files) {
  const payload = JSON.parse(fs.readFileSync(file, 'utf8'))
  machine = machine || payload.machine
  for (const row of payload.results) {
    if (row.skipped) continue
    if (Array.isArray(row.profileTop) && row.profileTop.length) {
      // profile 腿跑的是 runs=1，会在下面的「采样多者胜」里被挤掉；profileTop 是它独有的
      // 产物（别的腿没有），所以单独留一份，不跟着去重走。
      profiles.push(row)
    }
    const index = rows.findIndex((candidate) => candidate.scenario === row.scenario && candidate.scale === row.scale)
    if (index < 0) rows.push(row)
    else if ((row.runs || 0) > (rows[index].runs || 0)) rows[index] = row
  }
}
rows.sort((a, b) => (SCENARIO_ORDER.indexOf(a.scenario) - SCENARIO_ORDER.indexOf(b.scenario))
  || (SCALE_ORDER.indexOf(a.scale) - SCALE_ORDER.indexOf(b.scale)))

// 代表样本取「帧时间中位数那一次」，不是第一次也不是最好的一次。
const representative = (row) => {
  const sorted = [...row.samples].sort((a, b) => a.frameP50Ms - b.frameP50Ms)
  return sorted[Math.floor(sorted.length / 2)]
}
// 计算出来的数一律一位小数（18 → 18.0）：表要能和文档逐字符对上，不能靠人眼补零。
// 原样记录的数（fps / p50 / p95 / 最长帧 / heap / load）不动，它们本来就是采样值。
const fmt1 = (value) => (Number.isFinite(value) ? (Math.round(value * 10) / 10).toFixed(1) : '—')
const perSecond = (value, elapsedMs) => fmt1((value || 0) / (elapsedMs / 1000))

console.log(`机器：${machine?.cpuModel} · ${machine?.cpus} 核 · ${machine?.memoryGb} GB · ${machine?.platform} · ${machine?.build}\n`)

console.log('| 场景 | 规模 | 节点 | 选中 | zoom | 挂载 | fps | p50 ms | p95 ms | 最长帧 ms | 长任务 次/最长ms | load |')
console.log(`|${'---|'.repeat(12)}`)
for (const row of rows) {
  console.log(`| \`${row.scenario}\` | ${row.scale} | ${row.nodes} | ${row.selected ?? '—'} | ${row.viewport?.zoom ?? '—'} | ${row.viewport?.mountedNodes ?? '—'} | ${row.fps} | ${row.frameP50Ms} | ${row.frameP95Ms} | ${row.frameMaxMs} | ${row.longTasks}/${row.longTaskMaxMs} | ${row.loadAvg1} |`)
}

console.log('\n| 场景 | 规模 | 窗口 s | 主线程忙 % | script ms/s | style ms/s | layout ms/s | 布局次/s | 每次 flush 触碰节点 | 每次 flush DOM 变更 | heap MB |')
console.log(`|${'---|'.repeat(11)}`)
for (const row of rows) {
  const sample = representative(row)
  const elapsed = sample.elapsedMs
  const flushes = Math.max(1, sample.domFlushes)
  console.log(`| \`${row.scenario}\` | ${row.scale} | ${fmt1(elapsed / 1000)} | ${fmt1((sample.cdpTaskMs || 0) / elapsed * 100)}% | ${perSecond(sample.cdpScriptMs, elapsed)} | ${perSecond(sample.cdpStyleMs, elapsed)} | ${perSecond(sample.cdpLayoutMs, elapsed)} | ${perSecond(sample.cdpLayoutCount, elapsed)} | ${fmt1(sample.nodeStyleWrites / flushes)} | ${fmt1(sample.subtreeMutations / flushes)} | ${sample.jsHeapMb} |`)
}

const control = new Map()
for (const row of rows) {
  if (row.scenario !== 'drag-nodes-1') continue
  const sample = representative(row)
  control.set(row.scale, [
    row.frameP50Ms,
    perSecond(sample.cdpScriptMs, sample.elapsedMs),
    perSecond(sample.cdpStyleMs, sample.elapsedMs),
    perSecond(sample.cdpLayoutCount, sample.elapsedMs),
  ])
}
console.log('\n| 场景 | 规模 | p50 ×对照 | script/s ×对照 | style/s ×对照 | 布局次/s ×对照 |')
console.log(`|${'---|'.repeat(6)}`)
for (const row of rows) {
  const base = control.get(row.scale)
  if (!base) continue
  const sample = representative(row)
  const values = [
    row.frameP50Ms,
    perSecond(sample.cdpScriptMs, sample.elapsedMs),
    perSecond(sample.cdpStyleMs, sample.elapsedMs),
    perSecond(sample.cdpLayoutCount, sample.elapsedMs),
  ]
  console.log(`| \`${row.scenario}\` | ${row.scale} | ${values.map((value, index) => Number(base[index]) ? `${fmt1(Number(value) / Number(base[index]))}×` : '—').join(' | ')} |`)
}

// ── 表 4：一帧的账本 ───────────────────────────────────────────────────────────
// 「最坏的那一帧里，时间花在谁身上」——把 CDP 的分层耗时除以实际帧数，得到每帧毫秒。
// 「其它忙」= TaskDuration − script − style − layout：绘制、合成、事件派发、图片解码派发
// 与浏览器内部工作都落在这一格，CDP 不再往下分，所以它**不能**被读成某一项的耗时。
// 「空闲」= 帧预算(1000/fps) − 每帧忙：它是留给下一次输入的余量，塌到 0 就是手感上的「拖不动」。
console.log('\n| 场景 | 规模 | fps | 帧预算 ms | script ms/帧 | style ms/帧 | layout ms/帧 | 其它忙 ms/帧 | 空闲 ms/帧 | DOM 刷新/帧 | 重渲染实例/刷 | DOM 变更/帧 | style 写/帧 |')
console.log(`|${'---|'.repeat(13)}`)
for (const row of rows) {
  const sample = representative(row)
  const frames = Math.max(1, sample.frames)
  const busy = (sample.cdpTaskMs || 0) / frames
  const script = (sample.cdpScriptMs || 0) / frames
  const style = (sample.cdpStyleMs || 0) / frames
  const layout = (sample.cdpLayoutMs || 0) / frames
  const budget = 1000 / row.fps
  console.log(`| \`${row.scenario}\` | ${row.scale} | ${row.fps} | ${fmt1(budget)} | ${fmt1(script)} | ${fmt1(style)} | ${fmt1(layout)} | ${fmt1(Math.max(0, busy - script - style - layout))} | ${fmt1(Math.max(0, budget - busy))} | ${fmt1(sample.domFlushes / frames)} | ${fmt1(sample.medianTouchedPerFlush)} | ${fmt1(sample.subtreeMutations / frames)} | ${fmt1(sample.nodeStyleWrites / frames)} |`)
}

// ── 表 5：script 那一格里是谁（只有带 --profile 的采样有） ─────────────────────
// CDP 采样分析器的自时间，按**产物块**归并。prod bundle 的函数名被压掉了，所以归并的判据
// 是块名不是函数名：react-vendor = React 调和/提交，state-vendor = Zustand/immer 的 store 写，
// index 主块 = 应用代码 + i18next，canvasViewportScale / GenerationCanvas* = 画布自己的块。
// ⚠️ 只取了自时间前 25 名，尾巴没算进来，所以「点名合计」是**下界**不是全部。
const BUCKETS = [
  ['(idle)', (frame) => frame.includes('(idle)')],
  ['(program)', (frame) => frame.includes('(program)')],
  ['react-vendor', (frame) => frame.includes('react-vendor')],
  ['state-vendor', (frame) => frame.includes('state-vendor')],
  ['index 主块', (frame) => /index-[A-Za-z0-9_-]+\.js/.test(frame)],
  ['画布块', (frame) => frame.includes('canvasViewportScale') || frame.includes('GenerationCanvas')],
  ['GC', (frame) => frame.includes('garbage collector')],
]
const profiled = profiles.sort((a, b) => (SCENARIO_ORDER.indexOf(a.scenario) - SCENARIO_ORDER.indexOf(b.scenario))
  || (SCALE_ORDER.indexOf(a.scale) - SCALE_ORDER.indexOf(b.scale)))
if (profiled.length) {
  console.log('\n| 场景 | 规模 | (idle) | (program) | react-vendor | state-vendor | index 主块 | 画布块 | GC | DOM API/其它 | 点名合计（下界） |')
  console.log(`|${'---|'.repeat(11)}`)
  for (const row of profiled) {
    const totals = new Map(BUCKETS.map(([name]) => [name, 0]))
    let other = 0
    for (const entry of row.profileTop) {
      const bucket = BUCKETS.find(([, test]) => test(entry.frame))
      if (bucket) totals.set(bucket[0], totals.get(bucket[0]) + entry.share)
      else other += entry.share
    }
    const named = BUCKETS.filter(([name]) => name !== '(idle)' && name !== '(program)')
      .reduce((sum, [name]) => sum + totals.get(name), 0) + other
    console.log(`| \`${row.scenario}\` | ${row.scale} | ${BUCKETS.map(([name]) => `${fmt1(totals.get(name))}%`).join(' | ')} | ${fmt1(other)}% | ${fmt1(named)}% |`)
  }
}
