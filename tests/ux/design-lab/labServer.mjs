// 设计实验室**预览服务器归属**这一件事的唯一 owner（2026-09-06）。
//
// 立项根因：实验室的三个 dev server 端口（视觉基线 5197、两条走查 5198/5200）是**整台机器
// 的全局单例**，而这台机器上常年挂着 20+ 个 worktree。两个后果都实测到了：
//
//   1. **假证据**：`playwright.config.mjs` 的 `reuseExistingServer: !CI` 只探「这个 URL 有没有
//      人应答」。2026-09-06 05:22 实测，5197 上应答的是
//      `/Users/aoqimin/Desktop/Nomi-storyboard-v6-lab` 那棵树的 vite——在本树跑门岗，比的会是
//      **另一条分支的 UI**。红了查不出原因，绿了更糟（那是彻头彻尾的假绿）。
//   2. **假红**：那棵树的 vite 一退出，本树跑到一半的用例全体 `ERR_CONNECTION_REFUSED`，
//      而门岗当时把它报成「视觉基线不符」（见 failureTriage.mjs 的立项背景）。
//
// 修法分两层，缺一不可：
//   · **端口按 worktree 派生**（下面的 labPortFor）——把「全局单例」变成「每棵树自己的一段」，
//     两棵树同时跑实验室不再互相踩。这是消除争用。
//   · **应答者归属断言**（assertLabPortOwnership）——派生仍可能撞上机器上别的东西（哈希碰撞、
//     别人占了这一段），所以在信任任何像素之前必须证明「答话的这个进程的 cwd 就是本树」。
//     这是 fail-closed 的那道，不是提示。
//
// 为什么不是「跑之前先 kill 掉占端口的进程」：那会打断别人正在跑的门岗，而且把「我以为它是我的」
// 这个错误假设保留着。归属靠证明，不靠抢。
import crypto from 'node:crypto'
import fs from 'node:fs'
import { spawnSync } from 'node:child_process'
import { REPO_ROOT } from './labStates.mjs'

/**
 * 实验室要占端口的角色。**加角色就在这里加**——端口段的宽度随它走，
 * 不许在别处再写一个裸端口号（那就又造出一个全局单例）。
 */
export const LAB_ROLES = ['visual', 'walk-agent-panel-v4', 'walk-editing', 'walk-storyboard', 'walk-host-config', 'walk-vendor-order', 'walk-canvas-add-menu', 'walk-settings']

// 每棵 worktree 分到一段连续端口，段内按角色的下标取一口。
// 起点 5300：避开 vite 默认的 5173、以及本仓历史上写死过的 5197/5198/5200。
// 上界随角色数走（`5300 + 64 × LAB_ROLES.length`），所以**加角色只改上面那个数组**，
// 这里不再抄一个会过期的具体数字。
const PORT_BLOCK_BASE = 5300
const PORT_BLOCK_COUNT = 64
const PORT_BLOCK_SIZE = LAB_ROLES.length

/** 路径归一：/tmp 与 /private/tmp、软链 worktree 都会让字符串比较得出错误结论。 */
function canonicalPath(target) {
  try {
    return fs.realpathSync(target)
  } catch {
    return target
  }
}

/**
 * 本 worktree 上某个角色的端口。同一棵树同一角色恒定（哈希决定，不随时间/进程变），
 * 所以「上一次跑起来的服务器」还能被本树自己复用；不同树几乎必然落在不同段。
 */
export function labPortFor(role, repoRoot = REPO_ROOT) {
  const index = LAB_ROLES.indexOf(role)
  if (index < 0) throw new Error(`未知的实验室角色：${role}（已登记：${LAB_ROLES.join(', ')}）`)
  const digest = crypto.createHash('sha256').update(canonicalPath(repoRoot)).digest()
  const block = digest.readUInt16BE(0) % PORT_BLOCK_COUNT
  return PORT_BLOCK_BASE + block * PORT_BLOCK_SIZE + index
}

export function labOriginFor(role, repoRoot = REPO_ROOT) {
  return `http://127.0.0.1:${labPortFor(role, repoRoot)}`
}

/**
 * 谁在监听这个端口。拿不到就是拿不到（返回 unknown），**不猜**。
 * 返回 null = 确实没人监听；{ unknown: true } = 这台机器上问不出来（没有 lsof 等）。
 */
export function portHolder(port) {
  const listeners = spawnSync('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t'], { encoding: 'utf8' })
  // spawnSync 的 error 才是「没有 lsof」；lsof 查无结果时正常退出但 status 非 0。
  if (listeners.error) return { unknown: true, reason: `无法执行 lsof：${listeners.error.message}` }
  const pid = Number((listeners.stdout || '').trim().split('\n')[0])
  if (!Number.isInteger(pid) || pid <= 0) return null
  const cwdOut = spawnSync('lsof', ['-a', '-p', String(pid), '-d', 'cwd', '-Fn'], { encoding: 'utf8' })
  const cwdLine = (cwdOut.stdout || '').split('\n').find((line) => line.startsWith('n'))
  const command = (spawnSync('ps', ['-o', 'command=', '-p', String(pid)], { encoding: 'utf8' }).stdout || '').trim()
  return { pid, cwd: cwdLine ? canonicalPath(cwdLine.slice(1)) : null, command }
}

/**
 * 端口归属判定。四种结果，调用方**必须**区分对待：
 *   free    没人监听——等着自己把服务器拉起来。
 *   ours    监听者的 cwd 就是本树——复用它是安全的。
 *   foreign 监听者是别的 worktree/别的程序——**在这上面比像素就是拿别人的 UI 当自己的**，必须红。
 *   unknown 问不出来（没 lsof / 进程已退出）——不假装安全，也不假装出事，由调用方决定嗓门。
 */
export function classifyPortHolder(holder, repoRoot = REPO_ROOT) {
  if (holder === null) return 'free'
  if (holder.unknown) return 'unknown'
  // cwd 问不出来 = 证不出是自己的。证不出就不算自己的（fail-closed）。
  if (holder.cwd && holder.cwd === canonicalPath(repoRoot)) return 'ours'
  return 'foreign'
}

export function inspectLabPort(role, repoRoot = REPO_ROOT) {
  const port = labPortFor(role, repoRoot)
  const holder = portHolder(port)
  const status = classifyPortHolder(holder, repoRoot)
  return { status, port, role, holder, reason: holder?.reason }
}

/** foreign 时给人看的那段话。单独抽出来是为了让门岗和走查报的是同一句。 */
export function formatForeignHolder({ port, holder }) {
  const where = holder?.cwd ?? '（问不出 cwd）'
  return [
    `🚧 端口 ${port} 上应答的**不是本 worktree 的预览服务器**——在它上面截图/比像素等于拿别人分支的 UI 当自己的。`,
    `   占用者：pid ${holder?.pid ?? '?'} · cwd ${where}`,
    `   命令：${holder?.command ?? '（问不出）'}`,
    `   处理：等那棵树跑完，或让它自己收掉服务器；不要 kill 别人的进程来抢端口。`,
  ].join('\n')
}

/**
 * fail-closed 的归属断言：foreign 直接抛。unknown 只回一条警告字符串——
 * 「问不出来」不是「出事了」，把它也报红会在没有 lsof 的机器上制造纯噪音。
 */
export function assertLabPortOwnership(role, repoRoot = REPO_ROOT) {
  const verdict = inspectLabPort(role, repoRoot)
  if (verdict.status === 'foreign') {
    const error = new Error(formatForeignHolder(verdict))
    error.name = 'LabServerOwnershipError'
    throw error
  }
  return verdict
}
