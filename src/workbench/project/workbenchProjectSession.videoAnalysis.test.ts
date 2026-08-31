import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  clearActiveWorkbenchProjectSaveTarget,
  persistActiveWorkbenchProjectNow,
  rememberActiveWorkbenchProjectId,
  setActiveWorkbenchProjectSaveTarget,
} from './workbenchProjectSession'

describe('active project persistence identity', () => {
  afterEach(() => clearActiveWorkbenchProjectSaveTarget())

  it('refuses to persist an old extraction into the newly active project', async () => {
    const saveProject = vi.fn()
    setActiveWorkbenchProjectSaveTarget({
      projectId: 'project-b',
      projectName: 'B',
      canPersist: () => true,
      saveProject,
      onSaved: vi.fn(),
    })

    await expect(persistActiveWorkbenchProjectNow('project-a')).resolves.toBeNull()
    expect(saveProject).not.toHaveBeenCalled()
  })

  it('publishes project identity before the asynchronous save binding exists', async () => {
    rememberActiveWorkbenchProjectId('project-a')
    await expect(persistActiveWorkbenchProjectNow('project-b')).resolves.toBeNull()
  })
})
