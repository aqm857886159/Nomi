#!/usr/bin/env node
// 手动测量：宿主配置写盘门提交时「挂链接 → 换名」那段测不到的窗口有多长（#1142 复审 3）。
//
// 只在手动时跑，不进任何门岗。直接调用**生产**的 electron/capabilityCore/hostConfigWrite.ts 的 atomicWrite，
// 计时取自它的测量缝 onCommitWindow（「挂链接」调用开始 → 「换名」调用返回，纳秒），不复刻任何一步。
// 全部在一个新建的临时目录里写一个临时文件，跑完删掉；不碰任何真实宿主配置。
//
// 用法：
//   node scripts/measure-host-config-commit-window.mjs [--n 300] [--size-kb 80] [--host-interval-s 5] [--out <收据.json>]
// 输出（stdout 或 --out 指定的文件）：原始样本、p50 / p95 / p99 / 最大值、平台、Node 版本、文件系统类型（取得到就取）、
// 按写明的宿主写入频率假设算出的撞击概率与公式。收据里不写本机绝对路径、主机名、用户名。
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { cleanupTestTemp, makeTempDir } from './_test-temp.mjs'

const require = createRequire(import.meta.url)
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

export function parseArgs(argv) {
  const options = { n: 300, sizeKb: 80, hostIntervalS: 5, out: null }
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i]
    const value = argv[i + 1]
    if (flag === '--n') options.n = Number(value)
    else if (flag === '--size-kb') options.sizeKb = Number(value)
    else if (flag === '--host-interval-s') options.hostIntervalS = Number(value)
    else if (flag === '--out') options.out = value
    else throw new Error(`unknown argument: ${flag}`)
    i += 1
  }
  if (!Number.isInteger(options.n) || options.n < 1) throw new Error('--n must be a positive integer')
  if (!(options.sizeKb > 0)) throw new Error('--size-kb must be positive')
  if (!(options.hostIntervalS > 0)) throw new Error('--host-interval-s must be positive')
  return options
}

/** 最近秩百分位（不插值）：p 取 0–100。 */
export function percentile(sorted, p) {
  if (sorted.length === 0) return null
  const rank = Math.max(1, Math.ceil((p / 100) * sorted.length))
  return sorted[rank - 1]
}

/** 宿主写入按平均间隔 T 秒的泊松过程到达：窗口 w 秒内至少落进一次的概率 P = 1 − e^(−w/T)。 */
export function collisionProbability(windowMs, hostIntervalS) {
  return 1 - Math.exp(-(windowMs / 1000) / hostIntervalS)
}

/** 临时目录所在卷的文件系统类型；取不到写 unknown（不报路径）。 */
function filesystemType(dir) {
  try {
    if (process.platform === 'win32') {
      const drive = path.parse(dir).root.replace(/[\\/:]/g, '')
      const out = execFileSync('powershell.exe', ['-NoProfile', '-Command', `(Get-Volume -DriveLetter ${drive}).FileSystemType`], { encoding: 'utf8', timeout: 20_000 })
      return out.trim() || 'unknown'
    }
    if (process.platform === 'linux') return execFileSync('stat', ['-f', '-c', '%T', dir], { encoding: 'utf8', timeout: 10_000 }).trim() || 'unknown'
    if (process.platform === 'darwin') {
      const real = fs.realpathSync(dir)
      let best = { point: '', type: 'unknown' }
      for (const line of execFileSync('/sbin/mount', [], { encoding: 'utf8', timeout: 10_000 }).split('\n')) {
        const match = line.match(/ on (.+) \(([^,)]+)/)
        if (match && real.startsWith(match[1]) && match[1].length > best.point.length) best = { point: match[1], type: match[2] }
      }
      return best.type
    }
  } catch {
    /* 取不到就写 unknown */
  }
  return 'unknown'
}

function loadProductionWriteDoor() {
  // 写盘门在「隔离实例」标记下会拒绝写真实主目录里的路径（Windows 的临时目录就在主目录下）；测量进程不是隔离实例。
  delete process.env.NOMI_E2E
  delete process.env.NOMI_SETTINGS_DIR
  require('tsx/cjs/api').register()
  return require(path.join(repoRoot, 'electron', 'capabilityCore', 'hostConfigWrite.ts'))
}

export function measure(options) {
  const { atomicWrite } = loadProductionWriteDoor()
  const dir = makeTempDir('nomi-commit-window-')
  const target = path.join(dir, 'config.json')
  const bytes = Math.round(options.sizeKb * 1024)
  const samplesNs = []
  try {
    fs.writeFileSync(target, 'a'.repeat(bytes))
    for (let i = 0; i < options.n; i += 1) {
      const content = (i % 2 === 0 ? 'b' : 'a').repeat(bytes)
      let sample = null
      atomicWrite(target, () => content, { onCommitWindow: (ns) => { sample = ns } })
      if (sample === null) throw new Error(`iteration ${i}: production commit did not report a window`)
      samplesNs.push(sample)
    }
    const fsType = filesystemType(dir)
    const samplesMs = samplesNs.map((ns) => Number(ns) / 1e6)
    const sorted = [...samplesMs].sort((a, b) => a - b)
    const stats = {
      p50Ms: percentile(sorted, 50),
      p95Ms: percentile(sorted, 95),
      p99Ms: percentile(sorted, 99),
      maxMs: sorted[sorted.length - 1],
    }
    const round = (value) => Number(value.toPrecision(4))
    return {
      schemaVersion: 1,
      measuredAt: new Date().toISOString(),
      command: `node scripts/measure-host-config-commit-window.mjs --n ${options.n} --size-kb ${options.sizeKb} --host-interval-s ${options.hostIntervalS}`,
      measures: 'production hostConfigWrite.atomicWrite commit: start of link(target → prev) call to return of rename(tmp → target), via the onCommitWindow seam',
      environment: {
        platform: process.platform,
        osRelease: os.release(),
        arch: process.arch,
        node: process.version,
        cpuModel: os.cpus()[0]?.model?.trim() ?? 'unknown',
        filesystem: fsType,
      },
      parameters: { n: options.n, fileBytes: bytes, hostIntervalS: options.hostIntervalS },
      stats,
      collision: {
        assumption: `the host rewrites this config as a Poisson process with mean interval ${options.hostIntervalS} s (an actively running host); a collision = one host whole-file replace (write temp + rename) landing inside the window`,
        formula: 'P = 1 - exp(-(windowMs / 1000) / hostIntervalS)',
        perMigrationAtP50: round(collisionProbability(stats.p50Ms, options.hostIntervalS)),
        perMigrationAtP95: round(collisionProbability(stats.p95Ms, options.hostIntervalS)),
        perMigrationAtP99: round(collisionProbability(stats.p99Ms, options.hostIntervalS)),
        perMigrationAtMax: round(collisionProbability(stats.maxMs, options.hostIntervalS)),
      },
      samplesMs: samplesMs.map((ms) => Number(ms.toFixed(4))),
    }
  } finally {
    cleanupTestTemp(dir)
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const options = parseArgs(process.argv.slice(2))
  const receipt = measure(options)
  const text = `${JSON.stringify(receipt, null, 2)}\n`
  if (options.out) {
    fs.mkdirSync(path.dirname(path.resolve(options.out)), { recursive: true })
    fs.writeFileSync(options.out, text)
    console.log(`p50 ${receipt.stats.p50Ms.toFixed(3)} ms · p95 ${receipt.stats.p95Ms.toFixed(3)} ms · p99 ${receipt.stats.p99Ms.toFixed(3)} ms · max ${receipt.stats.maxMs.toFixed(3)} ms → ${options.out}`)
  } else {
    process.stdout.write(text)
  }
}
