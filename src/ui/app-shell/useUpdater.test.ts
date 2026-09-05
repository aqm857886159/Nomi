import { describe, expect, it } from 'vitest'
import { reduceUpdaterState, shouldShowUpdaterDialog, UPDATER_INITIAL_STATE } from './useUpdater'

describe('reduceUpdaterState', () => {
  it('checking 重置为干净检查态', () => {
    const dirty = { ...UPDATER_INITIAL_STATE, phase: 'error' as const, errorMessage: '旧错误', percent: 40 }
    expect(reduceUpdaterState(dirty, { type: 'checking' })).toEqual({ ...UPDATER_INITIAL_STATE, phase: 'checking' })
  })

  it('available 带出版本号与更新说明', () => {
    const next = reduceUpdaterState(UPDATER_INITIAL_STATE, { type: 'available', version: '0.11.0', notes: '修复音频' })
    expect(next.phase).toBe('available')
    expect(next.latestVersion).toBe('0.11.0')
    expect(next.notes).toBe('修复音频')
  })

  it('up-to-date 不残留上一次的版本号', () => {
    const had = reduceUpdaterState(UPDATER_INITIAL_STATE, { type: 'available', version: '0.11.0', notes: '' })
    const next = reduceUpdaterState(had, { type: 'up-to-date' })
    expect(next).toEqual({ ...UPDATER_INITIAL_STATE, phase: 'up-to-date' })
  })

  it('progress 累进到 downloading 且百分比被带上', () => {
    const a = reduceUpdaterState(UPDATER_INITIAL_STATE, { type: 'progress', percent: 12 })
    expect(a.phase).toBe('downloading')
    expect(a.percent).toBe(12)
    const b = reduceUpdaterState(a, { type: 'progress', percent: 87 })
    expect(b.percent).toBe(87)
  })

  it('downloaded 在 progress 之后保留下载完成态', () => {
    const downloading = reduceUpdaterState(UPDATER_INITIAL_STATE, { type: 'progress', percent: 99 })
    const done = reduceUpdaterState(downloading, { type: 'downloaded', version: '0.11.0' })
    expect(done.phase).toBe('downloaded')
    expect(done.latestVersion).toBe('0.11.0')
  })

  it('error 透传上游 message', () => {
    const next = reduceUpdaterState(UPDATER_INITIAL_STATE, { type: 'error', message: '网络不可达' })
    expect(next.phase).toBe('error')
    expect(next.errorMessage).toBe('网络不可达')
  })
})

describe('shouldShowUpdaterDialog', () => {
  it('keeps the update quiet while a task is running', () => {
    expect(shouldShowUpdaterDialog({ phase: 'available', hasRunningTask: true })).toBe(false)
    expect(shouldShowUpdaterDialog({ phase: 'error', hasRunningTask: true })).toBe(false)
  })

  it('shows pending update states once the workspace is idle', () => {
    expect(shouldShowUpdaterDialog({ phase: 'available', hasRunningTask: false })).toBe(true)
    expect(shouldShowUpdaterDialog({ phase: 'downloaded', hasRunningTask: false })).toBe(true)
    expect(shouldShowUpdaterDialog({ phase: 'idle', hasRunningTask: false })).toBe(false)
  })
})
