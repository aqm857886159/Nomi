// app.started.lastExit 的唯一来源：上一次留下的标记 → 本次启动读出；本次会话出了什么事就改标记。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { EventEmitter } from 'node:events'
import { afterEach, describe, expect, it, vi } from 'vitest'
const quitDrains = vi.hoisted(() => [] as Array<{ name: string; drain: () => void; options: { critical?: boolean } }>)
vi.mock('../quitTeardown', () => ({ registerQuitDrain: (name: string, drain: () => void, options: { critical?: boolean } = {}) => { quitDrains.push({ name, drain, options }); return () => undefined } }))
import { lastExitOfRendererGone, startAppSessionExitTracking, startSessionExitTracking } from './sessionExit'
import { LAST_EXIT_VALUES } from '../shared/contracts/telemetry'

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }) })

function session(markerPath: string, enabled = true, existingWindows: EventEmitter[] = []) {
  const app = new EventEmitter()
  const proc = new EventEmitter()
  // 退出流程登记的 finish（生产里是 quitTeardown 的 drain）；quit() = 正常退出走到了这一步。
  const finishers: Array<() => void> = []
  const lastExit = startSessionExitTracking({ enabled, markerPath, app, process: proc, existingWindows, onQuit: (finish) => { finishers.push(finish) } })
  const marker = () => (fs.existsSync(markerPath) ? JSON.parse(fs.readFileSync(markerPath, 'utf8')) : null)
  const quit = () => { for (const finish of finishers) finish() }
  return { app, proc, lastExit, marker, quit, finishers }
}
function markerFile(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-session-exit-'))
  roots.push(root)
  return path.join(root, 'telemetry-session-state.json')
}

describe('上一次是怎么结束的', () => {
  it('第一次启动 = unknown；正常退出 → 下次 clean', () => {
    const file = markerFile()
    const first = session(file)
    expect(first.lastExit).toBe('unknown')
    expect(first.marker()).toEqual({ schemaVersion: 1, state: 'running' })
    first.quit()
    expect(session(file).lastExit).toBe('clean')
  })

  it('进程被强退 / 断电（没走到退出流程）→ 下次 abnormal', () => {
    const file = markerFile()
    session(file)
    expect(session(file).lastExit).toBe('abnormal')
  })

  it('渲染层崩溃后又正常退出：记出过的那件事，不被 clean 盖掉', () => {
    const file = markerFile()
    const s = session(file)
    s.app.emit('render-process-gone', {}, {}, { reason: 'oom', exitCode: 9 })
    s.quit()
    expect(session(file).lastExit).toBe('renderer-oom')
  })

  it('第一件事定格：主进程异常之后再有渲染层崩溃，仍记主进程异常', () => {
    const file = markerFile()
    const s = session(file)
    s.proc.emit('uncaughtExceptionMonitor', new Error('boom /Users/me/secret'), 'uncaughtException')
    s.app.emit('render-process-gone', {}, {}, { reason: 'crashed' })
    expect(s.marker()).toEqual({ schemaVersion: 1, state: 'main-exception' })
    expect(JSON.stringify(s.marker())).not.toContain('secret')
  })

  it('窗口无响应时被强退 → unresponsive-killed；恢复响应后正常退出 → clean', () => {
    const file = markerFile()
    const early = new EventEmitter()
    const s = session(file, true, [early])
    early.emit('unresponsive')
    expect(session(file).lastExit).toBe('unresponsive-killed')

    const file2 = markerFile()
    const s2 = session(file2)
    const win = new EventEmitter()
    s2.app.emit('browser-window-created', {}, win)
    win.emit('unresponsive')
    win.emit('responsive')
    s2.quit()
    expect(session(file2).lastExit).toBe('clean')
    void s
  })

  it('无响应中途正常退出（用户等它缓过来后点了退出）→ clean', () => {
    const file = markerFile()
    const s = session(file)
    const win = new EventEmitter()
    s.app.emit('browser-window-created', {}, win)
    win.emit('unresponsive')
    s.quit()
    expect(session(file).lastExit).toBe('clean')
  })

  it('渲染层 clean-exit 不算事；认不出的 reason 归 renderer-other；每个映射值都在闭合表里', () => {
    expect(lastExitOfRendererGone('clean-exit')).toBeNull()
    expect(lastExitOfRendererGone('brand-new-reason')).toBe('renderer-other')
    expect(lastExitOfRendererGone(undefined)).toBe('renderer-other')
    for (const reason of ['crashed', 'oom', 'killed', 'abnormal-exit', 'launch-failed', 'integrity-failure', 'memory-eviction']) {
      expect(LAST_EXIT_VALUES as readonly string[]).toContain(lastExitOfRendererGone(reason))
    }
  })

  it('标记坏了 / 被改成认不出的值 → unknown，不抛', () => {
    const file = markerFile()
    fs.writeFileSync(file, '{ not json')
    expect(session(file).lastExit).toBe('unknown')
    fs.writeFileSync(file, JSON.stringify({ schemaVersion: 1, state: '/Users/me/evil' }))
    expect(session(file).lastExit).toBe('unknown')
  })

  it('遥测关着：删掉旧标记、不挂监听、返回 unknown', () => {
    const file = markerFile()
    session(file).app.emit('render-process-gone', {}, {}, { reason: 'crashed' })
    const off = session(file, false)
    expect(off.lastExit).toBe('unknown')
    expect(fs.existsSync(file)).toBe(false)
    expect(off.finishers).toHaveLength(0)
    expect(off.proc.listenerCount('uncaughtExceptionMonitor')).toBe(0)
  })

  it('生产接线：正常退出与系统关机（critical）两条都经退出流程登记，跑哪条都记 clean', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-session-exit-'))
    roots.push(root)
    vi.stubEnv('NOMI_SETTINGS_DIR', root)
    vi.stubEnv('NOMI_MCP_STDIO', '')
    try {
      expect(startAppSessionExitTracking({ enabled: true, app: new EventEmitter() })).toBe('unknown')
      expect(quitDrains.map((d) => [d.name, Boolean(d.options.critical)])).toEqual([['telemetry-session-exit', false], ['telemetry-session-exit-critical', true]])
      quitDrains[1].drain()
      expect(JSON.parse(fs.readFileSync(path.join(root, 'telemetry-session-state.json'), 'utf8'))).toEqual({ schemaVersion: 1, state: 'clean' })
    } finally {
      vi.unstubAllEnvs()
    }
  })
})
