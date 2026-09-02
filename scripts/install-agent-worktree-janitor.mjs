#!/usr/bin/env node
/* global console, process */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

export function buildStopHookCommand() {
  return 'if [ -f "$CLAUDE_PROJECT_DIR/scripts/agent-worktree-janitor.mjs" ]; then node "$CLAUDE_PROJECT_DIR/scripts/agent-worktree-janitor.mjs" stop "$CLAUDE_PROJECT_DIR" --apply; fi'
}

function hasJanitorCommand(command) {
  return typeof command === 'string' && command.includes('agent-worktree-janitor.mjs') && command.includes(' stop ')
}

export function mergeStopHook(settings) {
  const next = JSON.parse(JSON.stringify(settings || {}))
  if (!next.hooks || typeof next.hooks !== 'object') next.hooks = {}
  const stopEntries = Array.isArray(next.hooks.Stop) ? next.hooks.Stop : []
  let replaced = false
  for (const entry of stopEntries) {
    if (!Array.isArray(entry?.hooks)) continue
    for (const hook of entry.hooks) {
      if (!hasJanitorCommand(hook?.command)) continue
      hook.type = 'command'
      hook.command = buildStopHookCommand()
      replaced = true
    }
  }
  if (!replaced) {
    stopEntries.push({ hooks: [{ type: 'command', command: buildStopHookCommand() }] })
  }
  next.hooks.Stop = stopEntries
  return next
}

export function installStopHook({ settingsPath = join(homedir(), '.claude', 'settings.json'), dryRun = false } = {}) {
  const path = resolve(settingsPath)
  let settings = {}
  if (existsSync(path)) settings = JSON.parse(readFileSync(path, 'utf8'))
  const next = mergeStopHook(settings)
  const serialized = `${JSON.stringify(next, null, 2)}\n`
  if (!dryRun) {
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, serialized)
  }
  return { path, command: buildStopHookCommand(), changed: serialized !== `${JSON.stringify(settings, null, 2)}\n` }
}

function main(argv) {
  const dryRun = argv.includes('--dry-run')
  const pathArgIndex = argv.indexOf('--settings')
  const settingsPath = pathArgIndex >= 0 ? argv[pathArgIndex + 1] : undefined
  if (pathArgIndex >= 0 && !settingsPath) {
    console.error('--settings requires a path')
    return 2
  }
  const result = installStopHook({ settingsPath, dryRun })
  console.log(`${dryRun ? 'would install' : 'installed'} Nomi worktree Stop hook in ${result.path}`)
  return 0
}

if (import.meta.url === `file://${process.argv[1]}`) process.exitCode = main(process.argv.slice(2))
