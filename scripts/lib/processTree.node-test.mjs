import assert from 'node:assert/strict'
import { execFileSync, spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { makeTempDir } from '../_test-temp.mjs'
import { killProcessTree, processTreeSpawnOptions } from './processTree.mjs'

const waitFor = async (predicate, timeoutMs = 3000) => {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  assert.fail('等待进程树收尾超时')
}

const isAlive = (pid) => {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    if (error.code === 'ESRCH') return false
    throw error
  }
}

test('POSIX 子进程组选项与整组终止覆盖后代进程', async (t) => {
  if (process.platform === 'win32') return t.skip('Windows 使用 taskkill /T')
  const dir = makeTempDir('nomi-process-tree-')
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const childPidFile = path.join(dir, 'child.pid')
  const parent = spawn(process.execPath, ['-e', [
    "const { spawn } = require('node:child_process')",
    `spawn(process.execPath, ['-e', ${JSON.stringify("require('node:fs').writeFileSync(process.argv[1], String(process.pid)); setInterval(() => {}, 1000)")}, ${JSON.stringify(childPidFile)}], { stdio: 'ignore' })`,
    'setInterval(() => {}, 1000)',
  ].join(';')], { ...processTreeSpawnOptions(), stdio: 'ignore' })
  t.after(() => { if (parent.exitCode === null) killProcessTree(parent, 'SIGKILL') })
  await waitFor(() => fs.existsSync(childPidFile))
  const childPid = Number(fs.readFileSync(childPidFile, 'utf8'))
  assert.ok(childPid > 0)
  killProcessTree(parent, 'SIGKILL')
  await new Promise((resolve) => parent.once('close', resolve))
  await waitFor(() => !isAlive(childPid))
})

test('没有独立进程组的活子进程误用 killProcessTree 时必须点名 processTreeSpawnOptions', async (t) => {
  if (process.platform === 'win32') return t.skip('Windows 使用 taskkill /T')
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' })
  t.after(() => { if (child.exitCode === null && child.signalCode === null) process.kill(child.pid, 'SIGKILL') })
  assert.throws(
    () => killProcessTree(child, 'SIGKILL'),
    /processTreeSpawnOptions\(\)/,
  )
  process.kill(child.pid, 'SIGKILL')
  await new Promise((resolve) => child.once('close', resolve))
})

test('启动器前台进程组收到 SIGHUP 时子进程和孙进程一起消失', async (t) => {
  if (process.platform === 'win32') return t.skip('Windows 不使用 POSIX 前台进程组')
  const dir = makeTempDir('nomi-launcher-sighup-')
  const childPidFile = path.join(dir, 'child.pid')
  const grandchildPidFile = path.join(dir, 'grandchild.pid')
  const lifecycleModule = pathToFileURL(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../child-process-lifecycle.mjs')).href
  const launcherSource = [
    "import { spawn } from 'node:child_process'",
    "import fs from 'node:fs'",
    `import { installChildProcessLifecycle } from ${JSON.stringify(lifecycleModule)}`,
    'const lifecycle = installChildProcessLifecycle()',
    `const child = lifecycle.track(spawn(process.execPath, ['-e', ${JSON.stringify([
      "const { spawn } = require('node:child_process')",
      `const grandchild = spawn(process.execPath, ['-e', ${JSON.stringify("process.on('SIGHUP', () => process.exit(129)); setInterval(() => {}, 1000)")}], { stdio: 'ignore' })`,
      `require('node:fs').writeFileSync(${JSON.stringify(grandchildPidFile)}, String(grandchild.pid))`,
      "process.on('SIGHUP', () => process.exit(129)); setInterval(() => {}, 1000)",
    ].join(';'))}], { stdio: 'ignore' }))`,
    `fs.writeFileSync(${JSON.stringify(childPidFile)}, String(child.pid))`,
    'setInterval(() => {}, 1000)',
  ].join('\n')
  const launcherPath = path.join(dir, 'launcher.mjs')
  fs.writeFileSync(launcherPath, launcherSource)
  const launcher = spawn(process.execPath, [launcherPath], { detached: true, stdio: 'ignore' })
  t.after(() => {
    if (launcher.exitCode === null && launcher.signalCode === null) {
      try { process.kill(launcher.pid, 'SIGKILL') } catch { void 0 }
    }
    for (const pidFile of [childPidFile, grandchildPidFile]) {
      if (!fs.existsSync(pidFile)) continue
      const pid = Number(fs.readFileSync(pidFile, 'utf8'))
      try { process.kill(pid, 'SIGKILL') } catch { void 0 }
      try { process.kill(-pid, 'SIGKILL') } catch { void 0 }
    }
  })
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  await waitFor(() => fs.existsSync(childPidFile) && fs.existsSync(grandchildPidFile))
  const childPid = Number(fs.readFileSync(childPidFile, 'utf8'))
  const grandchildPid = Number(fs.readFileSync(grandchildPidFile, 'utf8'))
  const processGroupId = Number(execFileSync('ps', ['-o', 'pgid=', '-p', String(launcher.pid)], { encoding: 'utf8' }).trim())
  assert.ok(processGroupId > 0)
  spawnSync('kill', ['-HUP', `-${processGroupId}`], { stdio: 'ignore' })
  await waitFor(() => !isAlive(childPid) && !isAlive(grandchildPid))
})

test('Windows unavailable tree terminator cannot report cleanup success', (t) => {
  if (process.platform !== 'win32') return t.skip('native Windows taskkill lookup');
  const moduleUrl=pathToFileURL(path.resolve('scripts/lib/processTree.mjs')).href;
  const run=spawnSync(process.execPath,['--input-type=module','-e',
    'import assert from "node:assert/strict";import {killProcessTree} from '+JSON.stringify(moduleUrl)+';process.env.PATH="";assert.throws(()=>killProcessTree({pid:process.pid,exitCode:null,signalCode:null}),/process_cleanup_failed/);assert.equal(killProcessTree({pid:process.pid,exitCode:0,signalCode:null}),false);'
  ],{encoding:'utf8',windowsHide:true});
  assert.equal(run.status,0,run.stderr);
});
