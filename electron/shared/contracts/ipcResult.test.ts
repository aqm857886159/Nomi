import { describe, expect, it } from 'vitest'
import { unwrapIpcResult } from './ipcResult'
import { projectSaveFailure } from './projectSaveFailure'

describe('single IPC envelope owner', () => {
  it('returns successful receipts intact', () => {
    const value = { id: 'project', revision: 3 }
    expect(unwrapIpcResult({ ok: true, value }, 'save')).toBe(value)
  })
  it('keeps existing synchronous error messages and Error identity', () => {
    try { unwrapIpcResult({ ok: false, error: 'original failure' }, 'sync') } catch (error) {
      expect(error).toBeInstanceOf(Error)
      expect(error).toMatchObject({ name: 'Error', message: 'original failure' })
      return
    }
    throw new Error('expected rejection')
  })
  it.each(['EBUSY', 'EPERM', 'ENOSPC'])('ordinary data preserves %s before renderer unwrapping', code => {
    const reason = projectSaveFailure({ code, errno: -1, syscall: 'rename', path: '/private/path' }, 'save-project')
    const envelope = JSON.parse(JSON.stringify({ ok: false, error: 'project-save-failed', reason }))
    try { unwrapIpcResult(envelope, 'nomi:projects:save-async') } catch (error) {
      expect(error).toMatchObject({ reason })
      expect(JSON.stringify(error)).not.toContain('/private/path')
      return
    }
    throw new Error('expected rejection')
  })
})
