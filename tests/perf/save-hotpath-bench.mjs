#!/usr/bin/env node
// 保存热路径量具（设计卡 docs/plan/2026-11-13-main-unblock-pr2.md ★7）：真函数 saveWithSharingRetry(saveWorkspaceProject)，
// 临时项目目录，只在量具进程里按 --fault 往项目目录内的 fs 调用注入故障（生产代码里没有任何故障开关）：
//   ebusy:<毫秒>      从第一次改名起，项目目录里的 rename 持续这么久抛 EBUSY（杀毒 / 同步盘占着文件）；
//   slowfsync:<毫秒>  项目目录里每次 fsync 同步慢这么久（慢盘）。
// 指标：saveMainStallMaxMs（一次保存期间事件循环最大延迟，主进程上别的请求被挡多久）、
//       saveSyncSleepMs（这次保存里 Atomics.wait 原地睡了多久，应为 0）、saveWallMs（这次保存从发起到完成）。
// 零花费、零外网、不碰真实资料。接口同 tests/perf/node-json-bench.mjs：--runs N --out 文件。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { require as tsxRequire } from 'tsx/cjs/api'
import { cleanupTestTemp, makeTempDir } from '../../scripts/_test-temp.mjs'

const arg = (name, fallback) => { const i = process.argv.indexOf(name); return i < 0 ? fallback : process.argv[i + 1] }
const runs = Number(arg('--runs', 5))
const output = arg('--out', '')
const fault = String(arg('--fault', process.env.NOMI_PERF_FAULT ?? ''))
if (!output || !Number.isInteger(runs) || runs < 1) throw new Error('Use --out <result.json> and a positive --runs')
const [faultKind, faultMsText] = fault.split(':')
const faultMs = Number(faultMsText)
if (!['ebusy', 'slowfsync'].includes(faultKind) || !Number.isFinite(faultMs)) throw new Error('Use --fault ebusy:<ms> or slowfsync:<ms>')

const root = makeTempDir('nomi-save-hotpath-bench-')
process.env.NOMI_SETTINGS_DIR = path.join(root, 'settings')
process.env.NOMI_ELECTRON_USER_DATA_DIR = path.join(root, 'user-data')
const settingsRoot = path.join(root, 'settings')
const projectsRoot = path.join(root, 'projects')
fs.mkdirSync(settingsRoot, { recursive: true })

const { createWorkspaceProject, saveWorkspaceProject } = tsxRequire('../../electron/workspace/workspaceRepository.ts', import.meta.url)
const { saveWithSharingRetry } = tsxRequire('../../electron/projects/saveRetry.ts', import.meta.url)
const deps = { settingsRoot, defaultProjectsRoot: projectsRoot }

const metrics = { saveMainStallMaxMs: [], saveSyncSleepMs: [], saveWallMs: [] }
let failure
let sleptMs = 0
const originalWait = Atomics.wait
Atomics.wait = (...args) => { const at = performance.now(); try { return originalWait(...args) } finally { sleptMs += performance.now() - at } }
const originalRename = fs.renameSync
const originalFsync = fs.fsyncSync
let firstRenameAt = null
let projectRoot = ''
let armed = false
const inProject = (p) => armed && String(p).startsWith(projectRoot)
if (faultKind === 'ebusy') {
  fs.renameSync = (from, to) => {
    if (inProject(to)) {
      firstRenameAt ??= Date.now()
      if (Date.now() - firstRenameAt < faultMs) throw Object.assign(new Error('injected EBUSY'), { code: 'EBUSY', errno: -4082, syscall: 'rename', path: String(to) })
    }
    return originalRename(from, to)
  }
} else {
  fs.fsyncSync = (fd) => { if (!armed) return originalFsync(fd); const end = performance.now() + faultMs; while (performance.now() < end) { /* 慢盘：同步慢 */ } return originalFsync(fd) }
}
try {
  projectRoot = path.join(projectsRoot, 'bench')
  const created = createWorkspaceProject({ rootPath: projectRoot, record: { name: 'Bench', payload: { text: 'seed' } } }, deps)
  armed = true
  for (let run = 0; run < runs; run += 1) {
    firstRenameAt = null
    sleptMs = 0
    // 事件循环心跳：每 5ms 一拍，量相邻两拍的最大间隔（同步干活 / 原地睡时一拍都过不去，间隔就是被挡的时间）。
    let last = performance.now()
    let maxGapMs = 0
    const ticker = setInterval(() => { const now = performance.now(); maxGapMs = Math.max(maxGapMs, now - last - 5); last = now }, 5)
    await new Promise((resolve) => setTimeout(resolve, 30))
    last = performance.now()
    maxGapMs = 0
    const startedAt = performance.now()
    const saved = await saveWithSharingRetry(async () => saveWorkspaceProject(created.id, { payload: { text: `run-${run}` } }, deps))
    const wall = performance.now() - startedAt
    await new Promise((resolve) => setTimeout(resolve, 30))
    clearInterval(ticker)
    if (saved.payload?.text !== `run-${run}`) throw new Error('The save did not land the new content')
    metrics.saveMainStallMaxMs.push(Math.max(0, maxGapMs))
    metrics.saveSyncSleepMs.push(sleptMs)
    metrics.saveWallMs.push(wall)
  }
} catch (error) {
  failure = error
} finally {
  Atomics.wait = originalWait
  fs.renameSync = originalRename
  fs.fsyncSync = originalFsync
  cleanupTestTemp(root)
}
const noisy = os.loadavg()[1] >= 10
const report = {
  scope: `real saveWithSharingRetry(saveWorkspaceProject) on a temp project, fault ${fault}`,
  date: new Date().toISOString(),
  machine: `${process.platform} ${process.arch} ${os.cpus()[0]?.model}`,
  node: process.version,
  noisy,
  runs,
  metrics,
  ...(failure ? { failure: failure.message } : {}),
}
fs.mkdirSync(path.dirname(path.resolve(output)), { recursive: true })
fs.writeFileSync(output, JSON.stringify(report, null, 2))
console.log(JSON.stringify({ ...metrics, noisy }))
if (failure) { console.error(failure.message); process.exit(1) }
