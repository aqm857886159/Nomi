import crypto from 'node:crypto'

import type { McpConnectionContext } from './mcpConnectionContext'
import type { ProjectLeaseStore } from './projectLeaseStore'

export const PROJECT_LEASE_VERSION = 2 as const
export const PROJECT_LEASE_ALGORITHM = 'HMAC-SHA256' as const
export const PROJECT_LEASE_AUDIENCE = 'nomi-mcp' as const

type ProjectIdentityClaims = {
  projectId: string
  immutableProjectUuid: string
  projectGeneration: number
  canonicalRootDigest: string
}

type ProjectTransportClaims = {
  leasePrincipal: McpConnectionContext['principal']
  sessionId: string
  connectionNonce: string
}

export type FreshProjectIdentity = Readonly<ProjectIdentityClaims>
export type FreshProjectIdentityVerifier = (projectId: string) => Promise<FreshProjectIdentity>

export type ProjectSelectionHandleV2 = ProjectIdentityClaims & ProjectTransportClaims & {
  version: typeof PROJECT_LEASE_VERSION
  keyId: string
  algorithm: typeof PROJECT_LEASE_ALGORITHM
  issuer: 'nomi-main'
  handleId: string
  /** Selection-time audit evidence only; normal project revision changes do not invalidate a lease. */
  manifestDigest: string
  audience: typeof PROJECT_LEASE_AUDIENCE
  issuedAt: string
  expiresAt: string
  revocationEpoch: number
  scopeSet: string[]
  mac: string
}

export type ProjectLeaseV2 = ProjectIdentityClaims & ProjectTransportClaims & {
  version: typeof PROJECT_LEASE_VERSION
  keyId: string
  algorithm: typeof PROJECT_LEASE_ALGORITHM
  issuer: 'nomi-main'
  /** Selection-time audit evidence only; it is intentionally absent from fresh identity checks. */
  manifestDigest: string
  audience: typeof PROJECT_LEASE_AUDIENCE
  issuedAt: string
  expiresAt: string
  nonce: string
  scopeSet: string[]
  scopeHash: string
  revocationEpoch: number
  mac: string
}

export type ProjectLeaseAuthorityDeps = {
  macKey: string | NodeJS.TypedArray
  keyId?: string
  store: ProjectLeaseStore
  verifyProjectIdentity: FreshProjectIdentityVerifier
  now?: () => string
  randomId?: () => string
  defaultTtlMs?: number
}

export type ProjectSelectionInput = ProjectIdentityClaims & {
  manifestDigest: string
  scopeSet: string[]
  revocationEpoch?: number
  ttlMs?: number
}

export type ProjectLeaseIssueOptions = {
  ttlMs?: number
  scopeCeiling?: readonly string[]
}

export type ProjectLeaseExpectation = {
  connection: McpConnectionContext
  projectHint?: string
  scope?: string
}

export class ProjectLeaseScopeError extends Error {
  readonly code = 'project_scope_changed'

  constructor(message = 'Project lease scope is invalid') {
    super(message)
    this.name = 'ProjectLeaseScopeError'
  }
}

/** A previously verified lease now points at a different UUID, generation, or canonical root. */
export class ProjectBindingStaleError extends Error {
  readonly code = 'project_binding_stale'

  constructor() {
    super('Project binding no longer matches the current workspace')
    this.name = 'ProjectBindingStaleError'
  }
}

export class ProjectLeaseExpiredError extends Error {
  readonly code = 'lease_expired'

  constructor() {
    super('Project lease has expired')
    this.name = 'ProjectLeaseExpiredError'
  }
}

export class ProjectLeaseRevokedError extends Error {
  readonly code = 'lease_revoked'

  constructor() {
    super('Project lease has been revoked')
    this.name = 'ProjectLeaseRevokedError'
  }
}

function stableJson(value: unknown): string {
  if (value === null) return 'null'
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value)
  if (typeof value === 'number') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(',')}}`
  }
  throw new Error('Project lease payload must be JSON serializable')
}

function keyBuffer(value: string | NodeJS.TypedArray): Buffer {
  return typeof value === 'string'
    ? Buffer.from(value, 'utf8')
    : Buffer.from(value.buffer, value.byteOffset, value.byteLength)
}

function digest(value: unknown): string {
  return crypto.createHash('sha256').update(stableJson(value)).digest('hex')
}

type SignedProjectAuthorityValue = ProjectSelectionHandleV2 | ProjectLeaseV2

function sign(value: Omit<ProjectSelectionHandleV2, 'mac'> | Omit<ProjectLeaseV2, 'mac'>, key: string | NodeJS.TypedArray): string {
  return crypto.createHmac('sha256', keyBuffer(key)).update(stableJson(value)).digest('base64url')
}

function equalSignature(actual: string, expected: string): boolean {
  const left = Buffer.from(actual, 'utf8')
  const right = Buffer.from(expected, 'utf8')
  return left.length === right.length && crypto.timingSafeEqual(left, right)
}

function encode(value: SignedProjectAuthorityValue): string {
  return Buffer.from(stableJson(value), 'utf8').toString('base64url')
}

function decode(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object')
    return parsed as Record<string, unknown>
  } catch {
    throw new ProjectLeaseScopeError('Project lease handle is malformed')
  }
}

function normalizeScope(scopeSet: string[]): string[] {
  const normalized = Array.from(new Set(scopeSet.map((scope) => String(scope).trim()).filter(Boolean))).sort()
  if (normalized.length === 0) throw new ProjectLeaseScopeError('Project lease scope is empty')
  return normalized
}

function verifyShape(value: Record<string, unknown>, kind: 'handle' | 'lease'): void {
  if (value.version !== PROJECT_LEASE_VERSION || value.algorithm !== PROJECT_LEASE_ALGORITHM
    || value.issuer !== 'nomi-main' || value.audience !== PROJECT_LEASE_AUDIENCE
    || typeof value.keyId !== 'string' || typeof value.mac !== 'string') {
    throw new ProjectLeaseScopeError(`Project ${kind} signature shape is invalid`)
  }
}

function checkExpiry(value: { expiresAt: string }, now: string): void {
  if (!Number.isFinite(Date.parse(value.expiresAt)) || Date.parse(now) >= Date.parse(value.expiresAt)) {
    throw new ProjectLeaseExpiredError()
  }
}

function validIdentity(value: ProjectIdentityClaims): boolean {
  return Boolean(value.projectId && value.immutableProjectUuid && value.canonicalRootDigest)
    && Number.isInteger(value.projectGeneration)
    && value.projectGeneration >= 1
}

function assertTransportBinding(value: ProjectTransportClaims, connection: McpConnectionContext): void {
  if (value.leasePrincipal !== connection.principal
    || value.sessionId !== connection.sessionId
    || value.connectionNonce !== connection.connectionNonce) {
    throw new ProjectLeaseScopeError('Project lease transport binding does not match the current connection')
  }
}

export function createProjectLeaseAuthority(deps: ProjectLeaseAuthorityDeps) {
  const keyId = deps.keyId ?? 'project-lease-v2'
  const now = deps.now ?? (() => new Date().toISOString())
  const randomId = deps.randomId ?? (() => crypto.randomUUID())
  const defaultTtlMs = deps.defaultTtlMs ?? 5 * 60_000

  function expiresAt(startedAt: string, ttlMs: number | undefined, cap?: string): string {
    if (ttlMs !== undefined && (!Number.isInteger(ttlMs) || ttlMs <= 0)) {
      throw new ProjectLeaseScopeError('Project lease TTL is invalid')
    }
    const candidate = new Date(Date.parse(startedAt) + (ttlMs ?? defaultTtlMs)).toISOString()
    return cap && Date.parse(cap) < Date.parse(candidate) ? cap : candidate
  }

  function verifySigned<T extends SignedProjectAuthorityValue>(token: string, kind: 'handle' | 'lease'): T {
    const value = decode(token)
    verifyShape(value, kind)
    const unsigned = { ...value, mac: undefined } as unknown as Omit<ProjectSelectionHandleV2, 'mac'> | Omit<ProjectLeaseV2, 'mac'>
    if (value.keyId !== keyId || !equalSignature(value.mac as string, sign(unsigned, deps.macKey))) {
      throw new ProjectLeaseScopeError(`Project ${kind} signature is invalid`)
    }
    return value as T
  }

  function verifySelectionHandle(token: string, connection: McpConnectionContext): ProjectSelectionHandleV2 {
    const handle = verifySigned<ProjectSelectionHandleV2>(token, 'handle')
    checkExpiry(handle, now())
    if (!validIdentity(handle) || typeof handle.handleId !== 'string' || !handle.handleId
      || typeof handle.manifestDigest !== 'string' || !handle.manifestDigest
      || typeof handle.leasePrincipal !== 'string' || typeof handle.sessionId !== 'string'
      || typeof handle.connectionNonce !== 'string' || !Array.isArray(handle.scopeSet)
      || !Number.isInteger(handle.revocationEpoch)) {
      throw new ProjectLeaseScopeError('Project selection handle fields are invalid')
    }
    assertTransportBinding(handle, connection)
    return { ...handle, scopeSet: normalizeScope(handle.scopeSet) }
  }

  function issueSelectionHandle(
    input: ProjectSelectionInput,
    connection: McpConnectionContext,
  ): { token: string; handle: ProjectSelectionHandleV2 } {
    const issuedAt = now()
    const scopeSet = normalizeScope(input.scopeSet)
    if (!validIdentity(input) || !input.manifestDigest) {
      throw new ProjectLeaseScopeError('Project selection identity is incomplete')
    }
    const handleWithoutMac: Omit<ProjectSelectionHandleV2, 'mac'> = {
      version: PROJECT_LEASE_VERSION,
      keyId,
      algorithm: PROJECT_LEASE_ALGORITHM,
      issuer: 'nomi-main',
      handleId: randomId(),
      projectId: input.projectId,
      immutableProjectUuid: input.immutableProjectUuid,
      projectGeneration: input.projectGeneration,
      canonicalRootDigest: input.canonicalRootDigest,
      manifestDigest: input.manifestDigest,
      audience: PROJECT_LEASE_AUDIENCE,
      leasePrincipal: connection.principal,
      sessionId: connection.sessionId,
      connectionNonce: connection.connectionNonce,
      issuedAt,
      expiresAt: expiresAt(issuedAt, input.ttlMs),
      revocationEpoch: input.revocationEpoch ?? 0,
      scopeSet,
    }
    const handle: ProjectSelectionHandleV2 = { ...handleWithoutMac, mac: sign(handleWithoutMac, deps.macKey) }
    return { token: encode(handle), handle }
  }

  async function assertFreshProjectIdentity(claims: ProjectIdentityClaims): Promise<void> {
    const fresh = await deps.verifyProjectIdentity(claims.projectId)
    if (!validIdentity(fresh)
      || fresh.projectId !== claims.projectId
      || fresh.immutableProjectUuid !== claims.immutableProjectUuid
      || fresh.projectGeneration !== claims.projectGeneration
      || fresh.canonicalRootDigest !== claims.canonicalRootDigest) {
      throw new ProjectBindingStaleError()
    }
  }

  async function issueLease(
    handleToken: string,
    connection: McpConnectionContext,
    options: ProjectLeaseIssueOptions = {},
  ): Promise<{ token: string; lease: ProjectLeaseV2 }> {
    const handle = verifySelectionHandle(handleToken, connection)
    await assertFreshProjectIdentity(handle)
    const issuedAt = now()
    const scopeSet = options.scopeCeiling === undefined
      ? [...handle.scopeSet]
      : normalizeScope(handle.scopeSet.filter((scope) => options.scopeCeiling?.includes(scope)))
    const withoutMac: Omit<ProjectLeaseV2, 'mac'> = {
      version: PROJECT_LEASE_VERSION,
      keyId,
      algorithm: PROJECT_LEASE_ALGORITHM,
      issuer: 'nomi-main',
      projectId: handle.projectId,
      immutableProjectUuid: handle.immutableProjectUuid,
      projectGeneration: handle.projectGeneration,
      canonicalRootDigest: handle.canonicalRootDigest,
      manifestDigest: handle.manifestDigest,
      audience: PROJECT_LEASE_AUDIENCE,
      leasePrincipal: handle.leasePrincipal,
      sessionId: handle.sessionId,
      connectionNonce: handle.connectionNonce,
      issuedAt,
      expiresAt: expiresAt(issuedAt, options.ttlMs, handle.expiresAt),
      nonce: randomId(),
      scopeSet,
      scopeHash: digest(scopeSet),
      revocationEpoch: handle.revocationEpoch,
    }
    const lease: ProjectLeaseV2 = { ...withoutMac, mac: sign(withoutMac, deps.macKey) }
    const token = encode(lease)
    deps.store.recordIssued({
      tokenHash: digest(token),
      projectId: lease.projectId,
      immutableProjectUuid: lease.immutableProjectUuid,
      projectGeneration: lease.projectGeneration,
      issuedAt: lease.issuedAt,
      expiresAt: lease.expiresAt,
    })
    return { token, lease }
  }

  async function verifyLease(token: string, expected: ProjectLeaseExpectation): Promise<ProjectLeaseV2> {
    const lease = verifySigned<ProjectLeaseV2>(token, 'lease')
    checkExpiry(lease, now())
    if (!validIdentity(lease) || !lease.manifestDigest || !lease.leasePrincipal || !lease.sessionId
      || !lease.connectionNonce || !Array.isArray(lease.scopeSet)
      || lease.scopeHash !== digest(normalizeScope(lease.scopeSet))) {
      throw new ProjectLeaseScopeError('Project lease fields are invalid')
    }
    assertTransportBinding(lease, expected.connection)
    const stored = deps.store.read(digest(token))
    if (!stored || stored.lease.projectId !== lease.projectId
      || stored.lease.immutableProjectUuid !== lease.immutableProjectUuid
      || stored.lease.projectGeneration !== lease.projectGeneration) {
      throw new ProjectLeaseScopeError('Project lease is not registered')
    }
    if (stored.revokedAt) throw new ProjectLeaseRevokedError()
    if (expected.projectHint !== undefined && expected.projectHint !== lease.projectId) {
      throw new ProjectLeaseScopeError('Project lease project hint does not match the current scope')
    }
    if (expected.scope !== undefined && !lease.scopeSet.includes(expected.scope)) {
      throw new ProjectLeaseScopeError('Project lease scope is insufficient')
    }
    await assertFreshProjectIdentity(lease)
    return { ...lease, scopeSet: normalizeScope(lease.scopeSet) }
  }

  async function upgradeLeaseScope(
    token: string,
    scopeSet: string[],
    connection: McpConnectionContext,
  ): Promise<{ token: string; lease: ProjectLeaseV2 }> {
    const current = await verifyLease(token, { connection })
    const normalized = normalizeScope(scopeSet)
    if (current.scopeSet.some((scope) => !normalized.includes(scope))) {
      throw new ProjectLeaseScopeError('Project lease scope cannot be reduced')
    }
    if (stableJson(current.scopeSet) === stableJson(normalized)) return { token, lease: current }
    const issuedAt = now()
    const withoutMac: Omit<ProjectLeaseV2, 'mac'> = {
      version: PROJECT_LEASE_VERSION,
      keyId,
      algorithm: PROJECT_LEASE_ALGORITHM,
      issuer: 'nomi-main',
      projectId: current.projectId,
      immutableProjectUuid: current.immutableProjectUuid,
      projectGeneration: current.projectGeneration,
      canonicalRootDigest: current.canonicalRootDigest,
      manifestDigest: current.manifestDigest,
      audience: PROJECT_LEASE_AUDIENCE,
      leasePrincipal: current.leasePrincipal,
      sessionId: current.sessionId,
      connectionNonce: current.connectionNonce,
      issuedAt,
      expiresAt: expiresAt(issuedAt, undefined, current.expiresAt),
      nonce: randomId(),
      scopeSet: normalized,
      scopeHash: digest(normalized),
      revocationEpoch: current.revocationEpoch,
    }
    const lease: ProjectLeaseV2 = { ...withoutMac, mac: sign(withoutMac, deps.macKey) }
    const upgradedToken = encode(lease)
    deps.store.recordIssued({
      tokenHash: digest(upgradedToken),
      projectId: lease.projectId,
      immutableProjectUuid: lease.immutableProjectUuid,
      projectGeneration: lease.projectGeneration,
      issuedAt: lease.issuedAt,
      expiresAt: lease.expiresAt,
    })
    return { token: upgradedToken, lease }
  }

  function revoke(token: string): void {
    verifySigned<ProjectLeaseV2>(token, 'lease')
    deps.store.revoke(digest(token), now())
  }

  return {
    issueSelectionHandle,
    verifySelectionHandle,
    issueLease,
    upgradeLeaseScope,
    verifyLease,
    revoke,
  }
}

export type ProjectLeaseAuthority = ReturnType<typeof createProjectLeaseAuthority>
