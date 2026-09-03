#!/usr/bin/env node
// vitest 并发让路 —— 多个 gates 同时跑时，让每个 vitest 只拿机器的一份，而不是各自按满核开。
//
// 为什么要有它：vitest 按「本机核数」决定 worker 数，这个默认对**独占**是对的，对**并行**是灾难——
// 几个会话各跑各的 `pnpm run gates`，彼此看不见，每个都以为自己独占 10 核。
// 2026-09-03 实测：5 个 gates 并发 → 62 个 node 进程 / 4.7GB / load 105（10 核机器）；
// CPU 里 `sys` 占到 29–37%（正常 <10%），也就是 3+ 个核在做进程切换和换页，不在跑测试；
// 内存 23G 吃光、压缩器扛 8.7G、swapout 累计 1.8 亿次。
//
// 代价不是「慢」，是**测试结论不可信**：`projectAgentHost` 那条空闲时就要跑满 ~31s 的用例
// （预算 30s，本来就没余量）在超载下必然超时，于是连红三轮、每轮都在查一个跟改动无关的东西。
// 门岗一旦开始误报，人就会开始绕过它——这道闸就等于没有了。本脚本保的是「红灯=真有问题」这条信号。
//
// 机制：进入时把自己登记到一个**跨 worktree 共享**的注册表目录，再数还活着的同类，
// 按 `floor(核数 / 并发数)` 分配 `--maxWorkers`。先登记再数，两个同时启动的进程能互相看见
// （纯靠 ps 数进程做不到这点：两边都会读到 0）。
//
// 独占时（只有自己）**不传任何 flag**，vitest 完全走它自己的默认——CI 单跑和本地独占零行为变化。

import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/** 跨 worktree 共享：几个 worktree 的 gates 必须看得见彼此，所以**故意**用固定路径而不是进程私有目录。 */
export const REGISTRY_DIR = path.join(os.tmpdir(), 'nomi-vitest-runs')

/**
 * 分配策略（纯函数，好测）。
 * - 独占（peers=1）→ null，表示不传 flag、交给 vitest 自己的默认。
 * - 并发 → floor(核数/并发数)，下限 2：再低单跑会慢到没法用，宁可轻微超订。
 */
export function fairShare({ cores, peers }) {
  if (!Number.isInteger(cores) || cores < 1) throw new Error(`cores 必须是正整数，收到 ${cores}`)
  if (!Number.isInteger(peers) || peers < 1) throw new Error(`peers 必须是正整数（含自己），收到 ${peers}`)
  if (peers === 1) return null
  return Math.max(2, Math.floor(cores / peers))
}

/** 进程还活着吗。kill(pid,0) 不发信号、只做存在性与权限检查。 */
export function isAlive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    return err.code === 'EPERM' // 存在但不属于我们：仍算活着
  }
}

/**
 * 数注册表里还活着的登记（顺手清掉死掉的）。崩溃/被 kill 的进程留下的条目在这里自愈，
 * 所以不需要额外的过期时间或看门狗。
 */
export function countLivePeers(dir = REGISTRY_DIR, aliveFn = isAlive) {
  let entries = []
  try {
    entries = fs.readdirSync(dir)
  } catch {
    return 0
  }
  let live = 0
  for (const name of entries) {
    const pid = Number(name)
    if (!Number.isInteger(pid) || pid <= 0) continue
    if (aliveFn(pid)) live += 1
    else fs.rmSync(path.join(dir, name), { force: true })
  }
  return live
}

function register(pid = process.pid) {
  fs.mkdirSync(REGISTRY_DIR, { recursive: true })
  const file = path.join(REGISTRY_DIR, String(pid))
  fs.writeFileSync(file, `${new Date().toISOString()} ${root}\n`)
  return file
}

function resolveVitestBin() {
  const local = path.join(root, 'node_modules', '.bin', 'vitest')
  return fs.existsSync(local) ? local : 'vitest'
}

/**
 * 登记完到开数之间的沉淀窗口。
 *
 * 只有「先登记再数」还不够：实测两个同时启动的进程里，先手会在后手登记**之前**就数完，
 * 于是先手仍按独占开满（10 核上 9+5=14 个 worker）。几百毫秒的窗口足以让同批启动的彼此看见，
 * 相对一趟三四分钟的测试可以忽略。
 *
 * 注意这不是「拿 sleep 当完成信号」——它不等待任何事件完成，只是给并发登记一个对齐点；
 * 窗口没赶上也不会错，最坏退化成「后来者让路、先到者保持原速」，见文件头注的残留说明。
 */
const SETTLE_MS = 400

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function main() {
  const passthrough = process.argv.slice(2)
  // 先登记、再数 —— 顺序反了的话，两个同时启动的进程会互相看不见，各自按独占开满。
  const file = register()
  const cleanup = () => fs.rmSync(file, { force: true })
  process.on('exit', cleanup)
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
    process.on(sig, () => {
      cleanup()
      process.exit(130)
    })
  }

  await sleep(SETTLE_MS)

  const cores = os.availableParallelism?.() ?? os.cpus().length
  const peers = Math.max(1, countLivePeers())
  const share = fairShare({ cores, peers })

  const args = ['run', ...passthrough]
  if (share === null) {
    console.log(`[vitest] 独占本机（${cores} 核），worker 数交给 vitest 默认。`)
  } else {
    args.splice(1, 0, `--maxWorkers=${share}`)
    console.log(
      `[vitest] 检测到 ${peers} 个 vitest 并发（${cores} 核）→ 本次限 ${share} 个 worker。` +
        `\n         并发时不让路会把机器压进 swap，测试因超载而超时、红灯失去意义（见脚本头注）。`,
    )
  }

  const child = spawn(resolveVitestBin(), args, { stdio: 'inherit', env: process.env })
  child.on('error', (err) => {
    console.error(`[vitest] 启动失败：${err.message}`)
    cleanup()
    process.exit(1)
  })
  child.on('close', (code, signal) => {
    cleanup()
    // 信号退出要还原成常规退出码，否则 CI 只看到 null。
    process.exit(signal ? 128 : (code ?? 1))
  })
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((err) => {
    console.error(`[vitest] 让路逻辑异常：${err?.stack ?? err}`)
    process.exit(1)
  })
}
