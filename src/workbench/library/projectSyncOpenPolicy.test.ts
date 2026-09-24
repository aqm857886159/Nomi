import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import type { WorkspaceSyncStatus } from '../../../electron/shared/workspaceSyncContracts'
import { canOpenProjectWithSyncStatus } from './projectSyncOpenPolicy'

const read = (relative: string): string => fs.readFileSync(path.join(process.cwd(), relative), 'utf8')

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

  it('keeps the library card action on the shared policy boundary', () => {
    const page = read('src/workbench/library/ProjectLibraryPage.tsx')
    expect(page).toContain('if (!canOpenProjectWithSyncStatus(status))')
  })
})
