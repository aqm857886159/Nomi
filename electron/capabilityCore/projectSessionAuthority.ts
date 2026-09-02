import { CANVAS_READ_CAPABILITY } from '../shared/agentCapabilities/canvasRead'
import { CANVAS_WRITE_CAPABILITY } from '../shared/agentCapabilities/canvasWrite'
import { DOCUMENT_READ_CAPABILITY } from '../shared/agentCapabilities/documentRead'
import { DOCUMENT_WRITE_CAPABILITY } from '../shared/agentCapabilities/documentWrite'
import type { McpConnectionContext } from './mcpConnectionContext'
import type { McpGenerationCapability, McpGenerationPolicy } from './mcpGenerationPolicy'
import type {
  ProjectLeaseAuthority,
  ProjectLeaseExpectation,
  ProjectLeaseV2,
  ProjectSelectionInput,
} from './projectLease'

export type ProjectSelectionSource = 'current_project' | 'created_project' | 'server_allowlist'

export type ProjectSelectionResolution = Readonly<Omit<ProjectSelectionInput, 'scopeSet' | 'ttlMs'>>

export type ProjectSelectionRequest = Readonly<{
  source: ProjectSelectionSource
  connection: McpConnectionContext
  projectHint: string | undefined
}>

export type ProjectSelectionResolver = (
  request: ProjectSelectionRequest,
) => Promise<ProjectSelectionResolution>

export type ProjectSessionOpenResult = Readonly<{
  protocolVersion: 2
  sessionId: string
  leaseHandle: string
  immutableProjectUuid: string
  projectGeneration: number
  projectId: string
  expiresAt: string
  audience: ProjectLeaseV2['audience']
  effectiveScope: readonly string[]
}>

export type ProjectSessionAuthorityDeps = Readonly<{
  leaseAuthority: ProjectLeaseAuthority
  resolveProjectSelection: ProjectSelectionResolver
  generationPolicy: McpGenerationPolicy
}>

export class ProjectSessionRequestError extends Error {
  readonly code = 'lease_required'
  readonly httpStatus = 400

  constructor(message: string) {
    super(message)
    this.name = 'ProjectSessionRequestError'
  }
}

export function scopeForGenerationCapability(capability: McpGenerationCapability): string {
  switch (capability) {
    case 'context': return 'context:read'
    case 'read': return 'generation:read'
    case 'events': return 'generation:events'
    case 'create': return 'generation:create'
    case 'plan': return 'generation:plan'
    case 'preview': return 'generation:preview'
    case 'gate_request':
    case 'gate_decide': return 'generation:gate'
    case 'start': return 'generation:submit'
    case 'cancel':
    case 'steer': return 'generation:control'
    case 'reconcile': return 'generation:reconcile'
  }
}

/** The session bootstrap can only grant server-owned, non-submit scopes. */
export function deriveProjectSessionScopes(policy: McpGenerationPolicy): readonly string[] {
  // The same project session also authorizes the registered read-only editing
  // ports and the current document/canvas session capabilities. Generation
  // submit remains excluded; timeline/export writes still use their own
  // approval paths.
  const scopes = new Set<string>([
    CANVAS_READ_CAPABILITY.requiredScope,
    CANVAS_WRITE_CAPABILITY.requiredScope,
    DOCUMENT_READ_CAPABILITY.requiredScope,
    DOCUMENT_WRITE_CAPABILITY.requiredScope,
    'timeline:read',
    'export:read',
    'asset:read',
  ])
  const snapshot = policy.snapshot()
  if (snapshot.flagEnabled) {
    for (const capability of snapshot.effectiveScope) {
      if (capability === 'start') continue
      scopes.add(scopeForGenerationCapability(capability))
    }
  }
  return Object.freeze([...scopes].sort())
}

function assertOnlyFields(value: Record<string, unknown>, allowed: ReadonlySet<string>, label: string): void {
  const unexpected = Object.keys(value).find((key) => !allowed.has(key))
  if (unexpected) throw new ProjectSessionRequestError(`${label} field is not allowed: ${unexpected}`)
}

function normalizedProjectHint(value: string): string {
  const projectHint = value.trim()
  if (!projectHint || projectHint.length > 200) throw new ProjectSessionRequestError('Project hint is invalid')
  return projectHint
}

export function createProjectSessionAuthority(deps: ProjectSessionAuthorityDeps) {
  const effectiveScope = deriveProjectSessionScopes(deps.generationPolicy)

  async function selectionFor(
    source: ProjectSelectionSource,
    projectHint: string | undefined,
    connection: McpConnectionContext,
  ) {
    const resolved = await deps.resolveProjectSelection({ source, connection, projectHint })
    if (projectHint !== undefined && resolved.projectId !== projectHint) {
      throw new ProjectSessionRequestError('Resolved project does not match the authorized project hint')
    }
    return deps.leaseAuthority.issueSelectionHandle({
      ...resolved,
      scopeSet: [...effectiveScope],
    }, connection)
  }

  async function issueProjectSelection(
    source: Exclude<ProjectSelectionSource, 'current_project'>,
    projectHintValue: string,
    connection: McpConnectionContext,
  ) {
    return selectionFor(source, normalizedProjectHint(projectHintValue), connection)
  }

  async function open(
    rawParams: Record<string, unknown>,
    connection: McpConnectionContext,
  ): Promise<ProjectSessionOpenResult> {
    assertOnlyFields(rawParams, new Set(['projectSelectionHandle', 'bootstrap']), 'Project session')
    const selectionToken = typeof rawParams.projectSelectionHandle === 'string'
      ? rawParams.projectSelectionHandle.trim()
      : ''
    const bootstrap = rawParams.bootstrap
    if (selectionToken && bootstrap !== undefined) {
      throw new ProjectSessionRequestError('Choose a selection handle or current-project bootstrap, not both')
    }

    let handleToken = selectionToken
    if (bootstrap !== undefined) {
      if (!bootstrap || typeof bootstrap !== 'object' || Array.isArray(bootstrap)) {
        throw new ProjectSessionRequestError('Current-project bootstrap is invalid')
      }
      const bootstrapRecord = bootstrap as Record<string, unknown>
      assertOnlyFields(bootstrapRecord, new Set(['mode']), 'Project session bootstrap')
      if (bootstrapRecord.mode !== 'current_project') {
        throw new ProjectSessionRequestError('Current-project bootstrap mode is invalid')
      }
      handleToken = (await selectionFor('current_project', undefined, connection)).token
    }
    if (!handleToken) {
      throw new ProjectSessionRequestError('A project selection handle or current-project bootstrap is required')
    }

    // Verify the connection-bound selection before any lease is issued. The
    // lease authority then performs the fresh workspace identity check.
    deps.leaseAuthority.verifySelectionHandle(handleToken, connection)
    const issued = await deps.leaseAuthority.issueLease(handleToken, connection, {
      scopeCeiling: effectiveScope,
    })
    return Object.freeze({
      protocolVersion: 2 as const,
      sessionId: issued.lease.sessionId,
      leaseHandle: issued.token,
      immutableProjectUuid: issued.lease.immutableProjectUuid,
      projectGeneration: issued.lease.projectGeneration,
      projectId: issued.lease.projectId,
      expiresAt: issued.lease.expiresAt,
      audience: issued.lease.audience,
      effectiveScope: Object.freeze([...issued.lease.scopeSet]),
    })
  }

  function verifyLease(token: string, expected: ProjectLeaseExpectation): Promise<ProjectLeaseV2> {
    return deps.leaseAuthority.verifyLease(token, expected)
  }

  async function authorizeGenerationSubmit(token: string, connection: McpConnectionContext) {
    const current = await deps.leaseAuthority.verifyLease(token, { connection, scope: 'generation:gate' })
    return deps.leaseAuthority.upgradeLeaseScope(
      token,
      [...current.scopeSet, 'generation:submit'],
      connection,
    )
  }

  return {
    open,
    issueProjectSelection,
    verifyLease,
    authorizeGenerationSubmit,
    revoke: deps.leaseAuthority.revoke,
  }
}

export type ProjectSessionAuthority = ReturnType<typeof createProjectSessionAuthority>
