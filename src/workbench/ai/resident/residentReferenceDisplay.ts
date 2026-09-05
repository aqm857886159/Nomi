import type { TranslationKey } from '../../../i18n/translationKey'
import type { ProjectAgentReference } from '../../workbenchStore'

type Translate = (key: string, options?: Record<string, unknown>) => string

/**
 * Context chips are deliberately compact, but their scope must not be
 * inferred from an undifferentiated @ icon.  Keep this mapping presentation
 * only; the Host snapshot remains the source of reference identity/revision.
 */
export function residentReferenceRole(t: Translate, kind: ProjectAgentReference['kind']): string {
  // 整键，不拼命名空间（拼接会让死键门岗对整棵 agentResident 失明）。
  const key = {
    document: 'agentResident.referenceRoleDocument',
    canvas: 'agentResident.referenceRoleCanvas',
    preview: 'agentResident.referenceRolePreview',
    timeline: 'agentResident.referenceRoleTimeline',
    browser: 'agentResident.referenceRoleBrowser',
    asset: 'agentResident.referenceRoleAsset',
  } as const satisfies Record<ProjectAgentReference['kind'], TranslationKey>
  return t(key[kind])
}

export type ResidentReferencePresentation = Readonly<{
  role: string
  /** Optional until the Host supplies a frozen revision/state projection. */
  state?: string
  accessibleLabel: string
}>

export function isResidentReferenceStale(state: string | undefined): boolean {
  const normalized = state?.trim().toLowerCase() ?? ''
  return normalized === 'stale' || normalized.endsWith('.referencechanged')
}

/**
 * Build the visible/accessible copy without inventing a revision.  A future
 * ContextSnapshot may pass `state` through the reference DTO; when absent we
 * keep the status line out of the chip and expose only scope + label.
 */
export function presentResidentReference(
  t: Translate,
  reference: ProjectAgentReference & Readonly<{ intentRole?: string; state?: string }>,
): ResidentReferencePresentation {
  const role = reference.intentRole?.trim() || residentReferenceRole(t, reference.kind)
  const state = reference.state?.trim() || undefined
  const accessibleLabel = [role, reference.label, state].filter(Boolean).join(' · ')
  return Object.freeze({ role, ...(state ? { state } : {}), accessibleLabel })
}
