#!/usr/bin/env node
// 运行时下载的第三方二进制 / 权重的**版本钉门岗**（R5⑤ 外部契约 + R17 登记要有防线）。
//
// 为什么需要它：这些东西不进安装包、不进 lockfile，`pnpm audit` / dependabot 一个都看不见。
// 它们唯一的记录是代码里那串 URL 与 sha256——而 sha256 只保证「下到的是我们钉的那个」，
// **不保证「我们钉的那个还是该钉的那个」**。上游 whisper.cpp 每天出构建、升一版就可能
// 静默改变转写输出；没有一个会响的东西提醒我们回来看，登记就只是备忘录。
//
// 三条判据：
//  1. 登记的版本号必须**真的出现在它声明的源文件里**——有人改了代码里的 pin 却没动登记 = 红。
//     （反过来也成立：登记写了一个代码里没有的版本，同样红。）
//  2. 复查日期过了 = 红。`maxReviewDays` 限制「一次最多能把自己放行多久」。
//  3. 声明了运行时下载资产的源文件（凭「downloadUrl + sha256 同时出现」认定）必须在登记表里
//     有对应条目——新接一家却忘了登记，在这里红，而不是等到上游某天悄悄换了东西。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
export const REGISTRY_FILE = 'docs/engineering/supply-chain-pins.json'
/** 扫这些目录里「声明了运行时下载资产」的源文件。清单在共享层，不在各自域里散着。 */
export const SCAN_DIRS = ['electron/shared']

/** 一个源文件算不算「声明了运行时下载资产」：同时出现 downloadUrl 与 sha256 才算。 */
export function declaresDownloadedAssets(source) {
  return /downloadUrl\s*:/.test(source) && /sha256\s*:/.test(source)
}

export function evaluate({ registry, sources, today }) {
  const errors = []
  const notes = []
  const maxDays = Number(registry.maxReviewDays) || 120
  const pins = Array.isArray(registry.pins) ? registry.pins : []
  if (pins.length === 0) errors.push('登记表里一条 pin 都没有——扫描到的源文件却声明了运行时下载资产')

  const registered = new Set()
  for (const pin of pins) {
    const where = `pin "${pin.id ?? '(无 id)'}"`
    for (const field of ['id', 'what', 'sourceFile', 'pinnedVersion', 'whyNotLatest', 'pinnedAt', 'reviewBy', 'upstreamReleasesUrl']) {
      if (typeof pin[field] !== 'string' || pin[field].trim() === '') errors.push(`${where}：缺 ${field}`)
    }
    if (typeof pin.whyNotLatest === 'string' && pin.whyNotLatest.trim().length < 40) {
      // 「为什么不跟 latest」是这份登记表存在的理由。一句「稳定性」等于没写。
      errors.push(`${where}：whyNotLatest 太短，要说清升版会带来什么后果、怎么才算验过`)
    }
    if (typeof pin.sourceFile !== 'string') continue
    registered.add(pin.sourceFile)
    const abs = path.join(repoRoot, pin.sourceFile)
    const source = sources.get(pin.sourceFile) ?? (fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : null)
    if (source === null) {
      errors.push(`${where}：sourceFile ${pin.sourceFile} 不存在`)
      continue
    }
    if (typeof pin.pinnedVersion === 'string' && !source.includes(pin.pinnedVersion)) {
      errors.push(`${where}：登记的版本 ${pin.pinnedVersion} 在 ${pin.sourceFile} 里找不到——代码改了钉，登记没跟上（或反过来）`)
    }
    const reviewBy = Date.parse(`${pin.reviewBy}T00:00:00Z`)
    const pinnedAt = Date.parse(`${pin.pinnedAt}T00:00:00Z`)
    if (Number.isNaN(reviewBy) || Number.isNaN(pinnedAt)) {
      errors.push(`${where}：pinnedAt / reviewBy 要是 YYYY-MM-DD`)
      continue
    }
    const days = Math.round((reviewBy - pinnedAt) / 86_400_000)
    if (days > maxDays) errors.push(`${where}：复查期 ${days} 天 > 上限 ${maxDays} 天`)
    if (reviewBy < today) errors.push(`${where}：复查日期 ${pin.reviewBy} 已过——回去看一眼上游，再重新钉一次（不是顺手把日期往后挪）`)
    else notes.push(`· ${pin.id}（${pin.pinnedVersion}）复查日 ${pin.reviewBy}`)
  }

  for (const [relative, source] of sources) {
    if (!declaresDownloadedAssets(source)) continue
    if (!registered.has(relative)) errors.push(`${relative} 声明了运行时下载的资产，却不在 ${REGISTRY_FILE} 里——新接一家要连带登记版本钉与「为什么不跟 latest」`)
  }
  return { errors, notes }
}

/**
 * 键用登记表 `sourceFile` 的同一种写法（正斜杠）。用 path.join 拼键，Windows 上会得到反斜杠，
 * 与登记表永远对不上 → 每个已登记的文件都被报成「没登记」（2026-09-24 实跑才暴露：入口判断坏了，这段从没在 Windows 上跑过）。
 */
export function collectSources(root = repoRoot) {
  const sources = new Map()
  const walk = (dir) => {
    const abs = path.join(root, dir)
    if (!fs.existsSync(abs)) return
    for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
      const relative = path.posix.join(dir, entry.name)
      if (entry.isDirectory()) walk(relative)
      else if (entry.name.endsWith('.ts') && !entry.name.includes('.test.')) sources.set(relative, fs.readFileSync(path.join(root, relative), 'utf8'))
    }
  }
  for (const dir of SCAN_DIRS) walk(dir)
  return sources
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const registry = JSON.parse(fs.readFileSync(path.join(repoRoot, REGISTRY_FILE), 'utf8'))
  const { errors, notes } = evaluate({ registry, sources: collectSources(), today: Date.now() })
  for (const note of notes) console.log(note)
  if (errors.length > 0) {
    console.error(`\n✖ check:supply-chain-pins 红了（${errors.length} 条）：`)
    for (const error of errors) console.error(`  - ${error}`)
    console.error(`\n登记表：${REGISTRY_FILE}。升版不是改个常量——要按方案里那张表用同一批真素材重测。`)
    process.exit(1)
  }
  console.log(`✔ check:supply-chain-pins：${registry.pins.length} 条版本钉在册，复查日期未过，代码与登记一致`)
}
