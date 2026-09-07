import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { splitNulPaths } from './lib/gitPaths.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

export function changedFiles({
  cwd = root,
  base = process.env.NOMI_CHANGED_BASE || 'origin/main',
  head = process.env.NOMI_CHANGED_HEAD || 'HEAD',
} = {}) {
  const result = spawnSync('git', ['diff', '-z', '--name-only', base, head], { cwd, encoding: 'utf8' })
  if (result.status !== 0) throw new Error(result.stderr || `cannot inspect ${base}..${head}`)
  // `-z`：默认 quotePath 会把非 ASCII 路径转义成 `"src/\344..."`，选测的后缀/前缀判断全落空。
  return splitNulPaths(result.stdout).map((file) => file.replaceAll('\\', '/'))
}

export function isVitestFile(file) {
  return /\.(?:test|spec)\.(?:ts|tsx|mts|cts|js|jsx|mjs|cjs)$/.test(file)
}

export function isNodeTestFile(file) {
  return /\.node-test\.(?:mjs|cjs)$/.test(file)
}

function isSourceFile(file) {
  return /\.(?:ts|tsx|mts|cts|js|jsx|mjs|cjs)$/.test(file)
}

function siblingTests(file, projectRoot = root) {
  const ext = path.extname(file)
  const stem = file.slice(0, -ext.length)
  const candidates = [
    `${stem}.test${ext}`,
    `${stem}.spec${ext}`,
    `${stem}.integration.test${ext}`,
    `${stem}.e2e.test${ext}`,
    `${stem}.node-test.mjs`,
    `${stem}.node-test.cjs`,
  ]
  return candidates.filter((candidate) => fs.existsSync(path.join(projectRoot, candidate)))
}

export function selectFocusedTargets(files, projectRoot = root) {
  const normalized = files.map((file) => file.replaceAll('\\', '/'))
  const directVitest = new Set(normalized.filter(isVitestFile).filter((file) => !isNodeTestFile(file)))
  const directNode = new Set(normalized.filter(isNodeTestFile))
  const related = new Set()
  const sourceFiles = normalized.filter((file) => isSourceFile(file) && !isVitestFile(file) && !isNodeTestFile(file))

  for (const file of sourceFiles) {
    const siblings = siblingTests(file, projectRoot)
    for (const sibling of siblings) {
      if (isNodeTestFile(sibling)) directNode.add(sibling)
      else directVitest.add(sibling)
    }
    if (siblings.length === 0 && fs.existsSync(path.join(projectRoot, file))) related.add(file)
  }

  return {
    vitest: [...directVitest],
    related: [...related],
    node: [...directNode],
  }
}

export function buildFocusedCommands(targets, platform = process.platform) {
  const pnpm = platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
  const commands = []
  if (targets.vitest.length > 0) {
    commands.push({ label: 'focused Vitest', command: pnpm, args: ['exec', 'vitest', 'run', ...targets.vitest] })
  }
  if (targets.related.length > 0) {
    commands.push({
      label: 'focused related Vitest',
      command: pnpm,
      args: ['exec', 'vitest', 'related', '--run', '--passWithNoTests', ...targets.related],
    })
  }
  if (targets.node.length > 0) {
    commands.push({ label: 'focused Node tests', command: process.execPath, args: ['--test', ...targets.node] })
  }
  return commands
}

function run(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    stdio: 'inherit',
    shell: process.platform === 'win32' && command.endsWith('.cmd'),
  })
  if (result.status !== 0) {
    const error = new Error(`${command} ${args.join(' ')} failed`)
    error.exitCode = result.status ?? 1
    throw error
  }
}

export function runFocusedValidation(projectRoot = root, files = changedFiles({ cwd: projectRoot })) {
  const targets = selectFocusedTargets(files, projectRoot)
  const commands = buildFocusedCommands(targets)
  if (commands.length === 0) {
    console.log('focused tests: no executable test target for this change; contracts gate remains required')
    return
  }
  for (const invocation of commands) {
    console.log(`${invocation.label}: ${invocation.args.join(' ')}`)
    run(invocation.command, invocation.args, projectRoot)
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  try {
    runFocusedValidation(root)
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(error && typeof error === 'object' && 'exitCode' in error ? error.exitCode : 1)
  }
}
