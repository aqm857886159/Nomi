import { makeTempDir } from './_test-temp.mjs'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const outputs = ['dist', 'dist-electron']
const stampName = 'build-stamp.json'
const hint = '构建产物缺失、过期或构建失败；先 `pnpm build`。'

export function sourceIdentity(root) {
  const scratch = makeTempDir('nomi-build-index-')
  const git = (args, env = process.env) => execFileSync('git', args, { cwd: root, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  try {
    const head = git(['rev-parse', 'HEAD'])
    const env = { ...process.env, GIT_INDEX_FILE: path.join(scratch, 'index') }
    git(['read-tree', 'HEAD'], env)
    git(['add', '-A', '--', '.'], env)
    const tree = git(['write-tree'], env)
    return { head, tree, dirty: tree !== git(['rev-parse', 'HEAD^{tree}']) }
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true })
  }
}

export function invalidateBuild(root) {
  for (const output of outputs) fs.rmSync(path.join(root, output, stampName), { force: true })
}

export function verifyBuild(root) {
  const current = sourceIdentity(root)
  for (const output of outputs) {
    let stamp
    try { stamp = JSON.parse(fs.readFileSync(path.join(root, output, stampName), 'utf8')) }
    catch { throw new Error(`${output}: ${hint}`) }
    if (stamp.version !== 1 || Object.keys(current).some(key => stamp[key] !== current[key])) {
      throw new Error(`${output}: ${hint}`)
    }
  }
  return current
}

export function stampedBuild(root, build) {
  invalidateBuild(root)
  const before = sourceIdentity(root)
  build()
  if (JSON.stringify(before) !== JSON.stringify(sourceIdentity(root))) throw new Error(`构建期间源码变化；${hint}`)
  // Never manufacture missing output directories after an incomplete build.
  for (const output of outputs) {
    if (!fs.statSync(path.join(root, output)).isDirectory()) throw new Error(hint)
  }
  try {
    for (const output of outputs) fs.writeFileSync(path.join(root, output, stampName), JSON.stringify({ version: 1, ...before }) + '\n')
  } catch (error) {
    invalidateBuild(root)
    throw error
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = process.cwd()
  try {
    const command = process.argv[2]
    if (command === 'verify') {
      console.log('PASS package build stamp', verifyBuild(root))
    } else if (command === 'invalidate') invalidateBuild(root)
    else if (command === 'build') stampedBuild(root, () => {
      for (const script of ['check:electron-install', 'build:renderer', 'build:electron']) {
        const result = spawnSync(process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm', ['run', script], { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' })
        if (result.error || result.status !== 0) throw new Error(`Build failed: ${script}; ${hint}`)
      }
    })
    else throw new Error('Usage: package-build-stamp.mjs build|verify|invalidate')
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
