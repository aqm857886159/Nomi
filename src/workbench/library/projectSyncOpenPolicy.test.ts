import { describe, expect, it } from 'vitest'
import type { WorkspaceSyncStatus } from '../../../electron/shared/workspaceSyncContracts'
import { canOpenProjectWithSyncStatus } from './projectSyncOpenPolicy'

describe('project sync open policy', () => {
  it('allows a project with missing assets to open for partial recovery', () => {
    expect(canOpenProjectWithSyncStatus('missing-assets')).toBe(true)
  })

  it('allows ready and unknown inspection states', () => {
    expect(canOpenProjectWithSyncStatus('ready')).toBe(true)
    expect(canOpenProjectWithSyncStatus(undefined)).toBe(true)
  })

  it('keeps unreadable or externally changed manifests blocked', () => {
    const blocked: WorkspaceSyncStatus[] = ['external-change', 'conflict', 'corrupt-manifest']
    for (const status of blocked) expect(canOpenProjectWithSyncStatus(status)).toBe(false)
  })
})
