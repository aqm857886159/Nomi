import type { TFunction } from 'i18next'

import { confirmDialog } from '../../design'
import { getDesktopBridge } from '../../desktop/bridge'
import type { ProjectHydrationGuard } from './projectCanvasReadSurface'
import type { WorkbenchProjectPersistenceService } from './projectPersistenceService'
import { logRendererError } from '../../desktop/rendererLog'

/**
 * Hydrates one guarded project and owns the existing repair UX. Every async
 * boundary is followed by the same Surface epoch check, so an overlapping
 * project switch cannot diagnose, recover, reveal, or publish into its heir.
 */
export async function hydrateWorkbenchProjectWithRecovery(input: Readonly<{
  projectId: string
  service: WorkbenchProjectPersistenceService
  guard: ProjectHydrationGuard
  t: TFunction
  present: (message: string) => void
}>): Promise<Awaited<ReturnType<WorkbenchProjectPersistenceService['hydrateProject']>>> {
  const { projectId, service, guard, t, present } = input
  let hydrateError: unknown = null
  let hydrated = await service.hydrateProject(projectId, guard).catch((error: unknown) => {
    guard.assertCurrent()
    hydrateError = error
    return null
  })
  guard.assertCurrent()
  if (hydrated) return hydrated

  const projectBridge = getDesktopBridge()?.projects
  const diagnostic = projectBridge?.diagnose
    ? await projectBridge.diagnose(projectId).catch(() => null)
    : null
  guard.assertCurrent()
  if (diagnostic?.recoverable && projectBridge?.recover) {
    const confirmed = await confirmDialog({
      title: t('studio.projectRecoveryTitle'),
      message: t('studio.projectRecoveryMessage'),
      confirmLabel: t('studio.projectRecoveryConfirm'),
      cancelLabel: t('common.cancel'),
      tone: 'info',
    })
    guard.assertCurrent()
    if (confirmed) {
      await projectBridge.recover(projectId)
      guard.assertCurrent()
      hydrated = await service.hydrateProject(projectId, guard)
      guard.assertCurrent()
    }
  } else if (diagnostic?.status === 'missing-folder') {
    present(t('studio.projectFolderMissing'))
  } else if (diagnostic?.rootPath) {
    const reveal = await confirmDialog({
      title: t('studio.projectRepairTitle'),
      message: t('studio.projectRepairMessage', { path: diagnostic.rootPath }),
      confirmLabel: t('studio.openProjectFolder'),
      cancelLabel: t('common.cancel'),
      tone: 'info',
    })
    guard.assertCurrent()
    if (reveal) {
      await getDesktopBridge()?.workspace?.revealProjectFolder({ projectId })
      guard.assertCurrent()
    }
  } else {
    present(t('studio.projectNotFound'))
  }
  if (!hydrated && hydrateError) logRendererError('project-hydrate-failed', hydrateError)
  return hydrated
}
