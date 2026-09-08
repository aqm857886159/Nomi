#!/usr/bin/env node
/**
 * IPC sender-binding ratchet.
 *
 * This is deliberately a small source scanner rather than a TypeScript AST
 * dependency: it runs before the app build and must also work in a fresh
 * checkout. Every ipcMain.handle/on registration is scanned; a registration
 * is considered bound only when its callback expression calls a trust guard
 * (`assertTrustedSender` for main-window-only channels, `assertTrustedUiSender`
 * for channels the in-app browser chrome/overlay also drives).
 *
 * A second rule rides along: every `new BrowserWindow(` under electron/ must be
 * accompanied by a trust-role registration (`registerAppWindow` / `setMainWindow`)
 * in the same file. Trust is declared at window creation and read from
 * electron/appWindowRegistry.ts by the guards; a window nobody registered gets
 * zero guarded channels — fail-closed, but silently broken for the user (the
 * 2026-09-08 asset-box overlay bug: imports failed and the asset grid was
 * permanently empty). This rule moves that from "someone notices in production"
 * to "the gate is red before it ships".
 *
 * The baseline is a **list of stable identities** (`file` + `kind` + `channel`),
 * not a bare count. A count cannot say *which* registration is new, so a failing
 * gate used to point at an arbitrary bystander file and the tempting "fix" was
 * to bump the number — silently reopening the hole the ratchet exists to hold
 * shut. Line numbers are deliberately excluded from the identity because they
 * churn on every unrelated edit above the registration.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const electronRoot = path.join(repoRoot, 'electron')
const baselinePath = path.join(repoRoot, 'scripts', 'ipc-sender-binding-baseline.json')

const GUARD_PATTERN = /\b(?:assertTrustedSender|assertTrustedUiSender)\s*\(/

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
      file: path.relative(repoRoot, file).split(path.sep).join('/'),
      line,
      channel,
      kind: match[1],
      guarded: GUARD_PATTERN.test(call),
    })
  }
  return registrations
}

/** Stable identity: survives edits that move the registration within its file. */
function identityOf(entry) {
  return `${entry.file}|${entry.kind}|${entry.channel}`
}

/** Rule 2:每处建窗都必须在同文件声明信任角色。 */
function scanWindowRegistrations(files) {
  const offenders = []
  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8')
    const creations = [...source.matchAll(/new\s+BrowserWindow\s*\(/g)]
    if (!creations.length) continue
    if (/\b(?:registerAppWindow|setMainWindow)\s*\(/.test(source)) continue
    offenders.push({
      file: path.relative(repoRoot, file).split(path.sep).join('/'),
      line: source.slice(0, creations[0].index).split('\n').length,
      count: creations.length,
    })
  }
  return offenders
}

const sourceFiles = listSourceFiles(electronRoot)
const unregisteredWindows = scanWindowRegistrations(sourceFiles)
if (unregisteredWindows.length) {
  console.error(`✗ 有 ${unregisteredWindows.length} 个文件建了 BrowserWindow 却没登记信任角色`)
  for (const entry of unregisteredWindows) {
    console.error(`  ${entry.file}:${entry.line} (${entry.count} 处 new BrowserWindow)`)
  }
  console.error('  → 在建窗处调 registerAppWindow(win, role, entryUrl)；')
  console.error('    role 只有三种：main / app-surface / untrusted（装第三方网页、不给 IPC 的显式声明）')
  process.exit(1)
}

const registrations = sourceFiles.flatMap(scanFile)
const unguarded = registrations.filter((entry) => !entry.guarded)

if (!fs.existsSync(baselinePath)) {
  console.error(`✗ 缺少 ${path.relative(repoRoot, baselinePath)}；先核对实扫结果后写入存量基线`)
  process.exit(1)
}

const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'))
const allowedList = baseline.unguardedRegistrations
if (!Array.isArray(allowedList) || allowedList.some((value) => typeof value !== 'string')) {
  console.error(
    `✗ ${path.relative(repoRoot, baselinePath)} 的 unguardedRegistrations 必须是身份字符串数组（file|kind|channel）`,
  )
  process.exit(1)
}
const duplicates = allowedList.filter((value, index) => allowedList.indexOf(value) !== index)
if (duplicates.length) {
  console.error(`✗ 基线里有重复身份：${[...new Set(duplicates)].join(', ')}`)
  process.exit(1)
}

const allowed = new Set(allowedList)
// A single file may register the same channel more than once; identity is
// per-channel, so count occurrences to keep duplicates from hiding each other.
const counts = new Map()
for (const entry of unguarded) {
  const id = identityOf(entry)
  counts.set(id, (counts.get(id) ?? 0) + 1)
}

const added = unguarded.filter((entry) => !allowed.has(identityOf(entry)))
const removed = allowedList.filter((id) => !counts.has(id))

console.log(
  `IPC sender binding: ${registrations.length} registrations; ${registrations.length - unguarded.length} guarded; ${unguarded.length} unguarded (baseline ${allowedList.length})`,
)

if (added.length) {
  console.error(`✗ IPC sender binding 回归：${added.length} 处新增未加固注册`)
  for (const entry of added) console.error(`  ${entry.file}:${entry.line} ${entry.kind} ${entry.channel}`)
  console.error('  → 给这些注册加 assertTrustedSender / assertTrustedUiSender，而不是把它们写进基线')
  process.exit(1)
}

if (removed.length) {
  console.log(`↓ 存量减少 ${removed.length} 处；从基线里删掉这些身份锁定战果：`)
  for (const id of removed) console.log(`  ${id}`)
}

console.log(`✓ 建窗信任登记：${sourceFiles.length} 个源文件全过`)
console.log('✓ IPC sender binding 棘轮通过（只减不增）')
