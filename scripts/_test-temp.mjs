import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// 目录归属（2026-10-28）：本助手发放的每个目录，名字都是 nomi-<前缀>-p<创建者进程号>-<6 位随机>（前缀已以 nomi- 开头的不重复加）。
//
// 为什么：这些目录原来只靠创建者进程里的 process.once('exit') 清理。进程被 SIGKILL（门岗超时、手动杀、崩溃、断电）时它不会跑
// （Node 文档：'SIGKILL' cannot have a listener installed），目录既没人认领、也没人敢删——10-24 到 10-28 漏了 10 份、约 8.6G，
// 磁盘两天到 99%。把「谁建的」写进名字以后，「这个目录还有没有人要」就是个能确定回答的问题（创建者进程还活着吗），
// 不再依赖创建者活到最后。做法照 electron/assets/scratchCleanup.ts 的 `.nomi-upload-p<pid>-xxxxxx`；不共用那份实现的理由
// （TS 产品代码 vs 零依赖的纯 node 脚本，本文件被构建链和 electron-build.test.mjs 单文件拷贝）见 docs/engineering/self-written.json 的 test-temp-owner-reclaim。
//
// 回收和下面的退出钩子是同一件事的两半，不是两套：
//   · 创建者正常退出：退出钩子立刻删它自己登记在 owned 里的目录（即时清理，不等下一个进程）；
//   · 创建者没走到退出钩子（被杀）：由别人回收「创建者已死」的目录——下一个进程第一次分配时（见 makeTempDir），
//     或杀它的一方（scripts/pre-push-contracts.mjs 的 terminateAndReclaim）等整棵进程树没了之后。
// 两者作用在同一批带进程号的目录上；区别只在「谁来删、什么时候删」，没有第二份命名、登记或判据。
//
// 回收只认本仓库的名字——nomi- 开头、带 -p<进程号>-<6 位随机> 的尾巴（makeTempDir 给不以 nomi- 开头的前缀补上 nomi-，所以它发放的每个目录都认得出；
// 别的程序的目录哪怕形状碰巧一样，名字不以 nomi- 开头，不会被碰）——并且只动：创建者进程确实已死（kill(pid, 0) 报 ESRCH；
// EPERM 和一切未知错误都算活）、属主是当前用户、lstat 看是真目录（符号链接不动，也不跟进）的目录。
// 进程号被别的进程复用只会让回收变慢（把死进程当活），不会误删。
const REPO_PREFIX = 'nomi-'
const OWNER_NAME = /^nomi-(?:.*-)?p(\d{1,10})-[A-Za-z0-9]{6}$/

const owned = new Set()
// Windows 上 Electron 刚退出时，子进程还可能占着 user-data 里的文件（EBUSY / EPERM）；交给 Node 自带的重试，不手写等待。
const REMOVE_OPTIONS = Object.freeze({ recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
let installed = false
// 每个进程对每个临时根只回收一次：热循环里反复 makeTempDir 不会反复 readdir。
const swept = new Set()

function installExitCleanup() {
  if (installed) return
  installed = true
  process.once('exit', () => {
    for (const root of owned) fs.rmSync(root, REMOVE_OPTIONS)
    owned.clear()
  })
}

export function registerTestTemp(root) {
  owned.add(root)
  installExitCleanup()
  return root
}

function ownerOf(name) {
  const match = OWNER_NAME.exec(name)
  return match ? Number(match[1]) : null
}

/** 创建者确实不在了？只有 ESRCH 才算；EPERM（有这个进程、只是没权限）、非法进程号、一切未知错误都当「还在」，宁可不收。 */
function ownerIsGone(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return false
  } catch (error) {
    return error?.code === 'ESRCH'
  }
}

/**
 * 回收 base 下「创建者已死」的测试临时目录，返回删掉的目录名。读不了 base、删不掉某个目录（被占用 / 别的进程正在收同一个）都不抛：
 * 留给下一次。创建者就是本进程的不收（还在用，或者进程号被复用过——退出钩子 / 下一个进程会处理）。
 */
export function reclaimAbandonedTestTemp(base = os.tmpdir()) {
  let names
  try {
    names = fs.readdirSync(base)
  } catch {
    return []
  }
  const uid = typeof process.getuid === 'function' ? process.getuid() : null
  const reclaimed = []
  for (const name of names) {
    const owner = ownerOf(name)
    if (owner === null || owner === process.pid || !ownerIsGone(owner)) continue
    const dir = path.join(base, name)
    try {
      const stat = fs.lstatSync(dir)
      if (!stat.isDirectory() || (uid !== null && stat.uid !== uid)) continue
      // 创建者已死：被占用的目录不值得为它阻塞重试，下一次分配再收。
      fs.rmSync(dir, { recursive: true, force: true })
      reclaimed.push(name)
    } catch {
      // 下一次再收。
    }
  }
  return reclaimed
}

function sweepOnce(base) {
  if (swept.has(base)) return
  swept.add(base)
  reclaimAbandonedTestTemp(base)
}

/** nomi-<前缀>-p<进程号>-：前缀不以 nomi- 开头就补上，不以横线结尾也补一个，mkdtemp 再接 6 位随机。 */
function ownedPrefix(prefix) {
  const head = prefix.startsWith(REPO_PREFIX) ? prefix : `${REPO_PREFIX}${prefix}`
  return `${head}${head.endsWith('-') ? '' : '-'}p${process.pid}-`
}

// 返回解过符号链接的真路径：macOS 的 tmpdir 是 /var → /private/var 的链接，而 import.meta.url、
// git rev-parse --show-toplevel、子进程 cwd 拿到的都是真路径。返回链接路径时，拿它比路径的测试只在 Mac 上红，
// Linux CI 永远看不见（2026-10-08 迁到本助手时丢了四处各自的 realpath，三道门岗在 Mac 上红了十天）。
export function makeTempDir(prefix = 'nomi-test-') {
  const base = os.tmpdir()
  sweepOnce(base)
  return registerTestTemp(fs.realpathSync(fs.mkdtempSync(path.join(base, ownedPrefix(prefix)))))
}

export async function makeTempDirAsync(prefix = 'nomi-test-') {
  const base = os.tmpdir()
  sweepOnce(base)
  return registerTestTemp(await fs.promises.realpath(await fs.promises.mkdtemp(path.join(base, ownedPrefix(prefix)))))
}

export function cleanupTestTemp(root) {
  if (!root) return
  owned.delete(root)
  fs.rmSync(root, REMOVE_OPTIONS)
}
