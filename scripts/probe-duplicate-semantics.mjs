// 一次性探针（不进 gates）：找「同一语义两份词表」这一族病。
//
// 第一版做「所有字面量联合两两算相似度」→ 2616 对，信号被噪音淹（'text'|'image'|'video' 这种
// 模态词表到处都是且合理）。收窄到**状态词表**这一族：只看含生命周期词的联合，
// 按「概念面」分组，报出每个面有几套互不相同的说法。
import fs from 'node:fs'
import path from 'node:path'

const ROOTS = ['src', 'electron']
const SKIP = /node_modules|dist|\.test\.|\.spec\./

// 生命周期词汇：一个联合里出现 ≥2 个，就基本可以判定它是「某件事进行到哪一步」的词表
const LIFECYCLE = new Set([
  'idle', 'pending', 'queued', 'waiting', 'running', 'active', 'streaming', 'drafting',
  'done', 'success', 'succeeded', 'complete', 'completed', 'finished', 'ready',
  'error', 'failed', 'failure', 'cancelled', 'canceled', 'stopped', 'aborted',
  'recoverable', 'retrying', 'timeout', 'skipped', 'denied', 'rejected', 'approved',
])

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (SKIP.test(p)) continue
    if (e.isDirectory()) walk(p, out)
    else if (/\.tsx?$/.test(e.name)) out.push(p)
  }
  return out
}

const UNION = /'([a-z][a-z0-9-]{1,24})'(?:\s*\|\s*'([a-z][a-z0-9-]{1,24})')+/gi
const vocabs = new Map() // 排序后的成员串 → { members, sites:[] }

for (const root of ROOTS) {
  if (!fs.existsSync(root)) continue
  for (const file of walk(root)) {
    const lines = fs.readFileSync(file, 'utf8').split('\n')
    lines.forEach((text, i) => {
      for (const m of text.matchAll(UNION)) {
        const members = [...m[0].matchAll(/'([^']+)'/g)].map((x) => x[1])
        const hits = members.filter((x) => LIFECYCLE.has(x)).length
        if (hits < 2) continue
        const key = [...members].sort().join('|')
        if (!vocabs.has(key)) vocabs.set(key, { members, sites: [] })
        vocabs.get(key).sites.push(`${file}:${i + 1}`)
      }
    })
  }
}

const all = [...vocabs.values()].sort((a, b) => b.sites.length - a.sites.length)
console.log(`状态词表（含 ≥2 个生命周期词的字面量联合）：${all.length} 套互不相同的说法\n`)

for (const v of all) {
  console.log(`  [${v.members.join(' | ')}]`)
  console.log(`     ${v.sites.length} 处：${v.sites.slice(0, 3).join('  ')}${v.sites.length > 3 ? ' …' : ''}`)
}

// 交叉：哪些词只在一套里出现 —— 这些是最容易漏处理的分支
const count = new Map()
for (const v of all) for (const m of new Set(v.members)) count.set(m, (count.get(m) || 0) + 1)
const lonely = [...count.entries()].filter(([m, c]) => c === 1 && LIFECYCLE.has(m)).map(([m]) => m)
console.log(`\n只在某一套词表里出现的生命周期词（渲染分支最容易漏的）：\n  ${lonely.join(', ') || '（无）'}`)
