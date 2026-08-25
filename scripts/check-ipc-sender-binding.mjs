#!/usr/bin/env node
/**
 * IPC sender-binding ratchet.
 *
 * This is deliberately a small source scanner rather than a TypeScript AST
 * dependency: it runs before the app build and must also work in a fresh
 * checkout. Every ipcMain.handle/on registration is counted; a registration
 * is considered bound only when its callback expression calls the shared
 * assertTrustedSender guard. Existing unbound registrations are debt recorded
 * in the baseline; adding another one is an immediate failure.
 */
import fs from 'node:fs'
import path from 'node:path'

const repoRoot = path.resolve(new URL('.', import.meta.url).pathname, '..')
const electronRoot = path.join(repoRoot, 'electron')
const baselinePath = path.join(repoRoot, 'scripts', 'ipc-sender-binding-baseline.json')

function listSourceFiles(dir) {
  const files = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name)
    if (entry.isDirectory()) files.push(...listSourceFiles(file))
    else if (/\.(?:ts|tsx)$/.test(entry.name) && !/\.test\.(?:ts|tsx)$/.test(entry.name)) files.push(file)
  }
  return files
}

function scanFile(file) {
  const source = fs.readFileSync(file, 'utf8')
  const registrations = []
  const pattern = /ipcMain\.(handle|on)\s*\(/g
  const matches = [...source.matchAll(pattern)]
  for (const [index, match] of matches.entries()) {
    const start = match.index
    // Delimit by the next registration rather than balancing JavaScript
    // parentheses; regex literals and template expressions make a full parser
    // surprisingly error-prone for this pre-build ratchet.
    const end = matches[index + 1]?.index ?? source.length
    const call = source.slice(start, end)
    const channel = call.match(/ipcMain\.(?:handle|on)\s*\(\s*["'`]([^"'`]+)["'`]/)?.[1] || '<dynamic>'
    const line = source.slice(0, start).split('\n').length
    registrations.push({
      file: path.relative(repoRoot, file),
      line,
      channel,
      kind: match[1],
      guarded: /\bassertTrustedSender\s*\(/.test(call),
    })
  }
  return registrations
}

const registrations = listSourceFiles(electronRoot).flatMap(scanFile)
const unguarded = registrations.filter((entry) => !entry.guarded)
if (!fs.existsSync(baselinePath)) {
  console.error(`✗ 缺少 ${path.relative(repoRoot, baselinePath)}；先核对实扫结果后写入存量基线`)
  process.exit(1)
}
const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'))
const allowed = Number(baseline.unguardedRegistrations)
if (!Number.isInteger(allowed) || allowed < 0) {
  console.error(`✗ ${path.relative(repoRoot, baselinePath)} 的 unguardedRegistrations 不是非负整数`)
  process.exit(1)
}

console.log(
  `IPC sender binding: ${registrations.length} registrations; ${registrations.length - unguarded.length} guarded; ${unguarded.length} unguarded (baseline ${allowed})`,
)
if (unguarded.length > allowed) {
  console.error(`✗ IPC sender binding 回归：${unguarded.length} > 基线 ${allowed}`)
  for (const entry of unguarded.slice(allowed))
    console.error(`  ${entry.file}:${entry.line} ${entry.kind} ${entry.channel}`)
  process.exit(1)
}
if (unguarded.length < allowed) {
  console.log(`↓ 存量减少 ${allowed - unguarded.length} 处；更新 baseline 锁定战果`)
}
console.log('✓ IPC sender binding 棘轮通过（只减不增）')
