#!/usr/bin/env node
// LLM 流式调用单一 owner 门岗（2026-10-09）。
//
// 起因：ai@4 的 streamText 在请求发不出去（网闸拦 / DNS / 断网，fetch 本身抛）时既不抛也不关——
// textStream 静默结束、finishReason 永不 settle，错误只走 onError。哪个调用点没接 onError，就是一个会让界面
// 永远停在「提交中」的洞（真模型走查 2026-10-09 实测）。接对一次（electron/ai/streamTextTask.ts 的 onError），
// 就不该再有第二个直接调用的地方：任何要跑文本流的代码一律走 streamTextTask。
//
// 规则：`streamText` / `generateText` / `streamObject` 只许在 electron/ai/streamTextTask.ts 里从 "ai" 直接引入。
// 零基线：今天仓库里就只有它一处，新增即红；不留豁免名单（要例外就改 OWNER 并写清理由）。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const OWNER = 'electron/ai/streamTextTask.ts'
export const BANNED = ['streamText', 'generateText', 'streamObject']

const IMPORT_FROM_AI = /import\s+(?!type\b)[^;]*?\bfrom\s*['"]ai['"]/gs
const REQUIRE_AI = /require\(\s*['"]ai['"]\s*\)/

/** 一个文件的源码里直接引入了哪些被禁的名字（抹掉注释后判）。 */
export function bannedImports(source) {
  const code = source.replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, '')).replace(/^[^\S\n]*\/\/.*$/gm, '')
  const found = new Set()
  for (const match of code.matchAll(IMPORT_FROM_AI)) {
    for (const name of BANNED) if (new RegExp(`(?<![A-Za-z0-9_$])${name}(?![A-Za-z0-9_$])`).test(match[0])) found.add(name)
  }
  if (REQUIRE_AI.test(code)) found.add('require("ai")')
  return [...found]
}

export function scan(root) {
  const hits = []
  const walk = (dir) => {
    if (!fs.existsSync(dir)) return
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (['node_modules', 'dist', 'dist-electron', '.git', '.tmp'].includes(entry.name)) continue
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) { walk(full); continue }
      if (!/\.(tsx?|mts|cts|mjs|cjs)$/.test(entry.name) || /\.(test|node-test)\.[cm]?[jt]sx?$/.test(entry.name)) continue
      const rel = path.relative(root, full).split(path.sep).join('/')
      if (rel === OWNER) continue
      const names = bannedImports(fs.readFileSync(full, 'utf8'))
      if (names.length) hits.push({ file: rel, names })
    }
  }
  for (const dir of ['src', 'electron', 'workers']) walk(path.join(root, dir))
  return hits
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
  const hits = scan(root)
  if (hits.length) {
    console.error(`✖ ${hits.length} 个文件直接引入了 ai 的流式调用（只许 ${OWNER}）：`)
    for (const hit of hits) console.error(`  ${hit.file}  ${hit.names.join(', ')}`)
    console.error(`  → 改走 streamTextTask（它接了 onError；裸 streamText 在请求发不出去时会让调用永远挂住）`)
    process.exit(1)
  }
  console.log(`✅ LLM 流式调用单一 owner：只有 ${OWNER} 直接引入 streamText / generateText / streamObject`)
}
