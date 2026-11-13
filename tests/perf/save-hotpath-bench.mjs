#!/usr/bin/env node
// 保存热路径量具（设计卡 docs/plan/2026-11-13-save-hotpath-safe-subset.md ★1）：真函数 saveWorkspaceProject，临时项目目录，
// 只在量具进程里按 --fault 往项目目录内的 fs 调用注入故障（生产代码里没有任何故障开关）：
//   none              不注入：一次普通保存；
//   ebusy:<毫秒>      从第一次改名起，项目目录里的 rename 持续这么久抛 EBUSY（杀毒 / 同步盘占着文件）；
//   slowfsync:<毫秒>  项目目录里每次 fsync 同步慢这么久（慢盘）。
// 指标：saveWallMs（这次保存从发起到完成）、saveMainStallMaxMs（保存期间事件循环最大延迟，主进程上别的请求被挡多久）、
//       saveSyncSleepMs（这次保存里 Atomics.wait 原地睡了多久）、saveReads（同步读盘次数：readFileSync）、
//       saveWrites（同步写盘次数：writeFileSync + renameSync + copyFileSync）。
// 用途：给下一刀（把保存搬出主进程）留修前基线；不登记性能场景、不写基线。
// 零花费、零外网、不碰真实资料。接口同 tests/perf/node-json-bench.mjs：--runs N --out 文件。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { require as tsxRequire } from 'tsx/cjs/api'
import { cleanupTestTemp, makeTempDir } from '../../scripts/_test-temp.mjs'

const arg = (name, fallback) => { const i = process.argv.indexOf(name); return i < 0 ? fallback : process.argv[i + 1] }
const runs = Number(arg('--runs', 5))
const output = arg('--out', '')
const fault = String(arg('--fault', process.env.NOMI_PERF_FAULT ?? 'none'))
if (!output || !Number.isInteger(runs) || runs < 1) throw new Error('Use --out <result.json> and a positive --runs')
const [faultKind, faultMsText] = fault.split(':')
const faultMs = faultKind === 'none' ? 0 : Number(faultMsText)
if (!['none', 'ebusy', 'slowfsync'].includes(faultKind) || !Number.isFinite(faultMs)) throw new Error('Use --fault none, ebusy:<ms> or slowfsync:<ms>')

const root = makeTempDir('nomi-save-hotpath-bench-')
process.env.NOMI_SETTINGS_DIR = path.join(root, 'settings')
process.env.NOMI_ELECTRON_USER_DATA_DIR = path.join(root, 'user-data')
const settingsRoot = path.join(root, 'settings')
const projectsRoot = path.join(root, 'projects')
fs.mkdirSync(settingsRoot, { recursive: true })

const { createWorkspaceProject, saveWorkspaceProject } = tsxRequire('../../electron/workspace/workspaceRepository.ts', import.meta.url)
const deps = { settingsRoot, defaultProjectsRoot: projectsRoot }

const metrics = { saveWallMs: [], saveMainStallMaxMs: [], saveSyncSleepMs: [], saveReads: [], saveWrites: [] }
let failure
let sleptMs = 0
let reads = 0
let writes = 0
let counting = false
const original = { wait: Atomics.wait, rename: fs.renameSync, fsync: fs.fsyncSync, read: fs.readFileSync, write: fs.writeFileSync, copy: fs.copyFileSync }
Atomics.wait = (...args) => { const at = performance.now(); try { return original.wait(...args) } finally { sleptMs += performance.now() - at } }
fs.readFileSync = (...args) => { if (counting) reads += 1; return original.read(...args) }
fs.writeFileSync = (...args) => { if (counting) writes += 1; return original.write(...args) }
fs.copyFileSync = (...args) => { if (counting) writes += 1; return original.copy(...args) }
let firstRenameAt = null
let projectRoot = ''
let armed = false
const inProject = (p) => armed && String(p).startsWith(projectRoot)
fs.renameSync = (from, to) => {
  if (counting) writes += 1
  if (faultKind === 'ebusy' && inProject(to)) {
    firstRenameAt ??= Date.now()
    if (Date.now() - firstRenameAt < faultMs) throw Object.assign(new Error('injected EBUSY'), { code: 'EBUSY', errno: -4082, syscall: 'rename', path: String(to) })
  }
  return original.rename(from, to)
}
if (faultKind === 'slowfsync') {
  fs.fsyncSync = (fd) => { if (!armed) return original.fsync(fd); const end = performance.now() + faultMs; while (performance.now() < end) { /* 慢盘：同步慢 */ } return original.fsync(fd) }
}
try {
  projectRoot = path.join(projectsRoot, 'bench')
  const created = createWorkspaceProject({ rootPath: projectRoot, record: { name: 'Bench', payload: { text: 'seed' } } }, deps)
  armed = true
  for (let run = 0; run < runs; run += 1) {
    firstRenameAt = null
    sleptMs = 0
    reads = 0
    writes = 0
    // 事件循环心跳：每 5ms 一拍，量相邻两拍的最大间隔（同步干活 / 原地睡时一拍都过不去，间隔就是被挡的时间）。
    let last = performance.now()
    let maxGapMs = 0
    const ticker = setInterval(() => { const now = performance.now(); maxGapMs = Math.max(maxGapMs, now - last - 5); last = now }, 5)
    await new Promise((resolve) => setTimeout(resolve, 30))
    last = performance.now()
    maxGapMs = 0
    counting = true
    const startedAt = performance.now()
    const saved = await saveWorkspaceProject(created.id, { payload: { text: `run-${run}` } }, deps)
    const wall = performance.now() - startedAt
    counting = false
    await new Promise((resolve) => setTimeout(resolve, 30))
    clearInterval(ticker)
    if (saved.payload?.text !== `run-${run}`) throw new Error('The save did not land the new content')
    metrics.saveWallMs.push(wall)
    metrics.saveMainStallMaxMs.push(Math.max(0, maxGapMs))
    metrics.saveSyncSleepMs.push(sleptMs)
    metrics.saveReads.push(reads)
    metrics.saveWrites.push(writes)
  }
} catch (error) {
  failure = error
} finally {
  Atomics.wait = original.wait
  fs.renameSync = original.rename
  fs.fsyncSync = original.fsync
  fs.readFileSync = original.read
  fs.writeFileSync = original.write
  fs.copyFileSync = original.copy
  cleanupTestTemp(root)
}
const noisy = os.loadavg()[1] >= 10
const median = (values) => { const sorted = [...values].sort((a, b) => a - b); return sorted.length ? sorted[Math.floor(sorted.length / 2)] : null }
const report = {
  scope: `real saveWorkspaceProject on a temp project, fault ${fault}`,
  date: new Date().toISOString(),
  machine: `${process.platform} ${process.arch} ${os.cpus()[0]?.model}`,
  node: process.version,
  loadavg5: os.loadavg()[1],
  noisy,
  runs,
  metrics,
  ...(failure ? { failure: failure.message } : {}),
}
fs.mkdirSync(path.dirname(path.resolve(output)), { recursive: true })
fs.writeFileSync(output, JSON.stringify(report, null, 2))
console.log(JSON.stringify({ medians: Object.fromEntries(Object.entries(metrics).map(([key, values]) => [key, median(values)])), noisy, loadavg5: report.loadavg5 }))
if (failure) { console.error(failure.message); process.exit(1) }
