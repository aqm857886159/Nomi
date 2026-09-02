import type { TFunction } from 'i18next'

import { confirmDialog } from '../../design'
import { getDesktopBridge } from '../../desktop/bridge'
import { toast } from '../../ui/toast'
import type { ProjectHydrationGuard } from './projectCanvasReadSurface'
import type { WorkbenchProjectPersistenceService } from './projectPersistenceService'

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
}>): Promise<Awaited<ReturnType<WorkbenchProjectPersistenceService['hydrateProject']>>> {
  const { projectId, service, guard, t } = input
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
      if (hydrated) toast(t('studio.projectRecoveryComplete'), 'success')
    }
  } else if (diagnostic?.status === 'missing-folder') {
    toast(t('studio.projectFolderMissing'), 'error')
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
    toast(t('studio.projectNotFound'), 'error')
  }
  if (!hydrated && hydrateError) console.error('project hydrate failed', hydrateError)
  return hydrated
}
