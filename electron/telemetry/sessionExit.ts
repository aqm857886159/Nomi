import fs from 'node:fs'
import path from 'node:path'
import { readJsonFile, writeJsonFileAtomic } from '../jsonFile'
import { getSettingsRoot } from '../settings/settingsRoot'
import { registerQuitDrain } from '../quitTeardown'
import { LAST_EXIT_VALUES, type LastExit } from '../shared/contracts/telemetry'

// 「上一次是怎么结束的」——`app.started.lastExit` 的唯一来源（2026-11-13）。
//
// 一次会话的结局只有下一次启动才知道：本次启动先读上一次留下的标记，再把自己记成 running；
// 会话里出了事就把标记改成出了什么事；正常退出（退出流程 `quitTeardown` 跑到这一步）且没出过事才改成 clean。
// 进程被强退 / 断电 / 主进程直接崩掉 → 标记停在 running → 下次读到的就是 abnormal。
// 一次会话里出过崩溃又正常退出的，记出过的那件事（问的是「这次会话有没有出事」，不是「最后一下怎么关的」）。
//
// 只在遥测开着时记：关着就删掉标记、什么监听都不挂。标记里只有一个闭合值，没有时间、路径或任何内容。
// 主进程的崩溃日志（`crashLog.ts`）是另一件事：它写本机诊断，这里只为上传事件留一个闭合值，两边各自独立。

const FILE = 'telemetry-session-state.json'
const LAST_EXIT_SET: ReadonlySet<string> = new Set(LAST_EXIT_VALUES)
/** 会话进行中；下次启动读到它 = 没走到正常退出。 */
const RUNNING = 'running'
/** 窗口无响应期间先记成这个；恢复响应改回 running；无响应时被强退，下次就读到它。 */
const PENDING_UNRESPONSIVE: LastExit = 'unresponsive-killed'

type Listenable = { on(event: string, listener: (...args: unknown[]) => void): unknown }
type WindowLike = Listenable

export type SessionExitDeps = {
  enabled: boolean
  markerPath: string
  app: Listenable
  process: Listenable
  /** 挂监听这一刻已经开着的窗口（启动事件是异步记的，主窗口可能先建好）。 */
  existingWindows?: readonly WindowLike[]
  /** 正常退出时调一次 finish。生产里经退出流程唯一的主人 `quitTeardown` 登记（不自己订 will-quit）。 */
  onQuit: (finish: () => void) => void
}

const RENDERER_REASON: Record<string, LastExit> = {
  crashed: 'renderer-crashed',
  oom: 'renderer-oom',
  killed: 'renderer-killed',
  'abnormal-exit': 'renderer-abnormal-exit',
  'launch-failed': 'renderer-launch-failed',
  'integrity-failure': 'renderer-integrity-failure',
  'memory-eviction': 'renderer-memory-eviction',
}

/** Electron `render-process-gone` 的 reason → 闭合值；正常退出不算事，认不出的归 renderer-other。 */
export function lastExitOfRendererGone(reason: unknown): LastExit | null {
  if (reason === 'clean-exit') return null
  return (typeof reason === 'string' && RENDERER_REASON[reason]) || 'renderer-other'
}

function readMarker(markerPath: string): LastExit {
  try {
    const raw = readJsonFile(markerPath) as { state?: unknown } | null
    const state = raw && typeof raw === 'object' ? raw.state : undefined
    if (state === RUNNING) return 'abnormal'
    return typeof state === 'string' && LAST_EXIT_SET.has(state) ? state as LastExit : 'unknown'
  } catch {
    return 'unknown'
  }
}

/**
 * 读出上一次的结局、挂上本次的监听，返回上一次的结局。遥测关着 = 删标记、不挂监听、返回 unknown。
 * 一个进程只挂一次（重复调用直接返回第一次读到的值）。
 */
export function startSessionExitTracking(deps: SessionExitDeps): LastExit {
  if (!deps.enabled) {
    try { fs.rmSync(deps.markerPath, { force: true }) } catch { /* 删不掉就留着，下次开着时照常读 */ }
    return 'unknown'
  }
  const previous = readMarker(deps.markerPath)
  /** 本次会话目前的状态：running / 待定的无响应 / 出过的那件事。出过事之后不再被覆盖。 */
  let state: string = RUNNING
  const write = (next: string) => {
    state = next
    try { writeJsonFileAtomic(deps.markerPath, { schemaVersion: 1, state: next }) } catch { /* 标记写不了只影响下一次的这一格（会读成 unknown / abnormal） */ }
  }
  const settled = () => state !== RUNNING && state !== PENDING_UNRESPONSIVE
  const recordIncident = (incident: LastExit) => { if (!settled()) write(incident) }

  write(RUNNING)
  deps.app.on('render-process-gone', (_event, _contents, details) => {
    const incident = lastExitOfRendererGone((details as { reason?: unknown } | undefined)?.reason)
    if (incident) recordIncident(incident)
  })
  deps.process.on('uncaughtExceptionMonitor', () => recordIncident('main-exception'))
  const watchWindow = (win: WindowLike) => {
    win.on('unresponsive', () => { if (!settled()) write(PENDING_UNRESPONSIVE) })
    win.on('responsive', () => { if (state === PENDING_UNRESPONSIVE) write(RUNNING) })
  }
  for (const win of deps.existingWindows ?? []) watchWindow(win)
  deps.app.on('browser-window-created', (_event, window) => watchWindow(window as WindowLike))
  deps.onQuit(() => { if (!settled()) write('clean') })
  return previous
}

let started: LastExit | null = null

/** 生产入口：遥测开关以启动这一刻为准；MCP stdio 模式（别的工具拉起的无窗进程）不记。 */
export function startAppSessionExitTracking(input: { enabled: boolean; app: Listenable; existingWindows?: readonly WindowLike[] }): LastExit {
  if (started !== null) return started
  if (process.env.NOMI_MCP_STDIO === '1') return (started = 'unknown')
  started = startSessionExitTracking({
    enabled: input.enabled, markerPath: path.join(getSettingsRoot(), FILE), app: input.app, process, existingWindows: input.existingWindows,
    // 正常退出一条；系统关机 / 注销（Windows session-end、Linux shutdown）只跑 critical 那一条，也记成正常退出。
    // 写一个几十字节的同步文件，不拖退出；写不了只影响下一次的这一格。
    onQuit: (finish) => {
      registerQuitDrain('telemetry-session-exit', finish, { required: false })
      registerQuitDrain('telemetry-session-exit-critical', finish, { required: false, critical: true })
    },
  })
  return started
}
