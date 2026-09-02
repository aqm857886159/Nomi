import type { ProjectAgentReference } from '../../workbenchStore'

type Translate = (key: string, options?: Record<string, unknown>) => string

/**
 * Context chips are deliberately compact, but their scope must not be
 * inferred from an undifferentiated @ icon.  Keep this mapping presentation
 * only; the Host snapshot remains the source of reference identity/revision.
 */
export function residentReferenceRole(t: Translate, kind: ProjectAgentReference['kind']): string {
  const key = {
    document: 'referenceRoleDocument',
    canvas: 'referenceRoleCanvas',
    preview: 'referenceRolePreview',
    timeline: 'referenceRoleTimeline',
    browser: 'referenceRoleBrowser',
  }[kind]
  return t(`agentResident.${key}`)
}

export type ResidentReferencePresentation = Readonly<{
  role: string
  /** Optional until the Host supplies a frozen revision/state projection. */
  state?: string
  accessibleLabel: string
}>

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
