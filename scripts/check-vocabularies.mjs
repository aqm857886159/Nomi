#!/usr/bin/env node
// 语义词表门岗（R17 棘轮）—— 治「同一件事，系统里有好几套说法」这一族病。
//
// 为什么要它（2026-08-27 一天之内撞了 8 次）：
//   · 对外 22 个 nomi_* 工具 vs 内嵌 17 个，6 处同事两名
//   · 技能可见范围三套口径、加载机制两套、标识符两套
//   · 状态词表 33 套，其中 9 套讲的是同一件事（连拼写都不统一：success vs succeeded）
//   · 阶段词表：本来有 2 套，写设计文档时**又编了第 4 套**
//
// 根因不是「不知道不该造第二套」——P1/R20/§1.5 早就写着，当天全部没触发。
// 根因是**写新东西那一刻，「已经有第一套」这个事实不在手边**：这是检索失败，不是纪律失败。
// 所以这个门岗的作用不是骂人，是**在你新起一个词表的那一刻，把已有的摆到你眼前**。
//
// 判定：扫「含 ≥2 个生命周期词的字面量联合类型」。每套都必须在 baseline 里登记：
//   registered = 有意的独立词表，reason 说清「为什么它不能复用已有的」
//   debt       = 已知待收敛，reason 指向计划文档；**条数只减不增**（棘轮）
// 写不出 reason = 就是漏了。这条是全部重点——baseline 会自己长成一份「系统里有哪些
// 共享语义」的登记表，而且是从代码 derive 的，不会像手写文档那样腐烂。
//
// 抓不到什么（诚实边界）：格式契约、字段取值来源、名字完全不同的同义工具面。
// 那几类今天是靠真机走查和人横着量一遍抓出来的，没有银弹。
import fs from 'node:fs'
import path from 'node:path'

const ROOTS = ['src', 'electron']
const SKIP = /node_modules|dist|\.test\.|\.spec\./
const BASELINE_PATH = 'scripts/vocabularies-baseline.json'

/** 生命周期词：一个联合里出现 ≥2 个，基本可判定它是「某件事进行到哪一步」的词表。 */
const LIFECYCLE = new Set([
  'idle', 'pending', 'queued', 'waiting', 'running', 'active', 'streaming', 'drafting',
  'done', 'success', 'succeeded', 'complete', 'completed', 'finished', 'ready',
  'error', 'failed', 'failure', 'cancelled', 'canceled', 'stopped', 'aborted',
  'recoverable', 'retrying', 'timeout', 'skipped', 'denied', 'rejected', 'approved',
])

const UNION = /'([a-z][a-z0-9-]{1,24})'(?:\s*\|\s*'([a-z][a-z0-9-]{1,24})')+/gi

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (SKIP.test(full)) continue
    if (entry.isDirectory()) walk(full, out)
    else if (/\.tsx?$/.test(entry.name)) out.push(full)
  }
  return out
}

/** 词表的稳定 key = 成员排序后拼接（跟行号无关，改代码不会误报）。 */
function scan() {
  const vocabs = new Map()
  for (const root of ROOTS) {
    if (!fs.existsSync(root)) continue
    for (const file of walk(root)) {
      const lines = fs.readFileSync(file, 'utf8').split('\n')
      lines.forEach((text, index) => {
        for (const match of text.matchAll(UNION)) {
          const members = [...match[0].matchAll(/'([^']+)'/g)].map((m) => m[1])
          if (members.filter((m) => LIFECYCLE.has(m)).length < 2) continue
          const key = [...new Set(members)].sort().join('|')
          if (!vocabs.has(key)) vocabs.set(key, { key, members: [...new Set(members)], sites: [] })
          vocabs.get(key).sites.push(`${file}:${index + 1}`)
        }
      })
    }
  }
  return vocabs
}

const jaccard = (a, b) => {
  const A = new Set(a), B = new Set(b)
  const inter = [...A].filter((x) => B.has(x)).length
  return inter / (A.size + B.size - inter)
}

function loadBaseline() {
  if (!fs.existsSync(BASELINE_PATH)) return { registered: {}, debt: {} }
  return JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8'))
}

const vocabs = scan()
const baseline = loadBaseline()
const known = new Set([...Object.keys(baseline.registered || {}), ...Object.keys(baseline.debt || {})])

// --- 更新模式：把当前现状写回 baseline（新条目 reason 留待人填） ---
if (process.argv.includes('--update-baseline')) {
  const next = { registered: { ...(baseline.registered || {}) }, debt: { ...(baseline.debt || {}) } }
  let added = 0
  for (const [key, v] of vocabs) {
    if (known.has(key)) continue
    next.debt[key] = { members: v.members, reason: 'TODO: 说清为什么它不能复用已有词表，或指向收敛计划' }
    added += 1
  }
  // 清掉已消失的条目（棘轮：只减不增）
  for (const bucket of ['registered', 'debt']) {
    for (const key of Object.keys(next[bucket])) if (!vocabs.has(key)) delete next[bucket][key]
  }
  fs.writeFileSync(BASELINE_PATH, `${JSON.stringify(next, null, 2)}\n`)
  console.log(`已更新 ${BASELINE_PATH}：新增 ${added} 条待填 reason。`)
  process.exit(0)
}

const failures = []

// ① 未登记的新词表
for (const [key, v] of vocabs) {
  if (known.has(key)) continue
  const near = [...vocabs.values()]
    .filter((o) => o.key !== key && known.has(o.key))
    .map((o) => ({ o, sim: jaccard(v.members, o.members) }))
    .filter((x) => x.sim >= 0.4)
    .sort((a, b) => b.sim - a.sim)[0]
  failures.push({
    kind: 'unregistered',
    key,
    members: v.members,
    sites: v.sites,
    near: near ? { members: near.o.members, sim: near.sim, sites: near.o.sites } : null,
  })
}

// ② reason 没填（TODO 占位不算登记）
for (const bucket of ['registered', 'debt']) {
  for (const [key, entry] of Object.entries(baseline[bucket] || {})) {
    if (!vocabs.has(key)) continue
    const reason = String(entry?.reason || '')
    if (!reason || reason.startsWith('TODO')) {
      failures.push({ kind: 'no-reason', key, bucket, members: entry?.members || key.split('|') })
    }
  }
}

// ③ debt 棘轮：只减不增
const debtNow = Object.keys(baseline.debt || {}).filter((k) => vocabs.has(k)).length
const debtCap = Number(baseline.debtCap ?? debtNow)
if (debtNow > debtCap) {
  failures.push({ kind: 'debt-grew', debtNow, debtCap })
}

if (!failures.length) {
  console.log(
    `✓ 语义词表门岗通过：${vocabs.size} 套状态词表全部已登记（有意 ${Object.keys(baseline.registered || {}).length} · 待收敛 ${debtNow}/${debtCap}，只减不增）。`,
  )
  process.exit(0)
}

console.error('\n✖ 语义词表门岗未通过。\n')
console.error('  这个门岗治的是「同一件事，系统里有好几套说法」——2026-08-27 一天撞了 8 次，')
console.error('  包括写「同一语义只能有一份定义」那份文档时又编了第 4 套阶段词表。\n')

for (const f of failures) {
  if (f.kind === 'unregistered') {
    console.error(`  新词表未登记：[${f.members.join(' | ')}]`)
    console.error(`    出现在：${f.sites.slice(0, 3).join('  ')}${f.sites.length > 3 ? ' …' : ''}`)
    if (f.near) {
      const onlyNew = f.members.filter((m) => !f.near.members.includes(m))
      const onlyOld = f.near.members.filter((m) => !f.members.includes(m))
      console.error(`    ⚠️ 系统里已有 ${(f.near.sim * 100).toFixed(0)}% 相同的一套：[${f.near.members.join(' | ')}]`)
      console.error(`       ${f.near.sites[0]}`)
      if (onlyNew.length) console.error(`       只有你这套有：${onlyNew.join(', ')}`)
      if (onlyOld.length) console.error(`       只有那套有：${onlyOld.join(', ')}  ← 你的分支会静默漏掉这些`)
      console.error('    → 先问：能不能直接复用那一套？')
    }
    console.error('    → 确实必须独立：`node scripts/check-vocabularies.mjs --update-baseline` 后把 reason 填清楚。')
    console.error('       填不出理由 = 就是漏了。\n')
  } else if (f.kind === 'no-reason') {
    console.error(`  已登记但 reason 没填（${f.bucket}）：[${f.members.join(' | ')}]`)
    console.error(`    → 在 ${BASELINE_PATH} 里补上「为什么它不能复用已有词表」。\n`)
  } else if (f.kind === 'debt-grew') {
    console.error(`  待收敛词表变多了：${f.debtNow} > 上限 ${f.debtCap}（棘轮只减不增）`)
    console.error('    → 要么复用已有词表，要么把它登记进 registered 并说清理由。\n')
  }
}
process.exit(1)
