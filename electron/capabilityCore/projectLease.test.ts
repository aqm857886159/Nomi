import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import type { McpConnectionContext } from './mcpConnectionContext'
import {
  PROJECT_LEASE_VERSION,
  ProjectBindingStaleError,
  ProjectLeaseExpiredError,
  ProjectLeaseScopeError,
  createProjectLeaseAuthority,
  type FreshProjectIdentity,
} from './projectLease'
import { createProjectLeaseStore } from './projectLeaseStore'

const tempDirs: string[] = []

const connection: McpConnectionContext = Object.freeze({
  authenticatedClient: 'codex',
  principal: 'mcp:codex',
  sessionId: 'mcp-session:session-1',
  connectionNonce: 'connection-1',
})

const foreignConnection: McpConnectionContext = Object.freeze({
  authenticatedClient: 'codex',
  principal: 'mcp:codex',
  sessionId: 'mcp-session:session-2',
  connectionNonce: 'connection-2',
})

const selection = {
  projectId: 'project-1',
  immutableProjectUuid: 'uuid-1',
  projectGeneration: 3,
  canonicalRootDigest: 'root-digest-1',
  manifestDigest: 'manifest-digest-at-selection',
  scopeSet: ['canvas:read', 'generation:plan'],
}

function makeAuthority() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-project-lease-'))
  tempDirs.push(dir)
  let tick = 0
  const now = () => `2026-08-23T00:00:${String(tick).padStart(2, '0')}.000Z`
  const advance = (seconds: number) => { tick += seconds }
  let currentIdentity: FreshProjectIdentity = {
    projectId: selection.projectId,
    immutableProjectUuid: selection.immutableProjectUuid,
    projectGeneration: selection.projectGeneration,
    canonicalRootDigest: selection.canonicalRootDigest,
  }
  const verifyProjectIdentity = vi.fn(async () => ({ ...currentIdentity }))
  const store = createProjectLeaseStore({ filePath: path.join(dir, 'leases.json'), macKey: 'store-key', now })
  const deps = {
    macKey: 'authority-key',
    keyId: 'authority-v2',
    store,
    now,
    verifyProjectIdentity,
    randomId: (() => {
      let index = 0
      return () => `id-${++index}`
    })(),
  }
  const authority = createProjectLeaseAuthority(deps)
  return {
    authority,
    store,
    advance,
    now,
    verifyProjectIdentity,
    replaceIdentity: (patch: Partial<FreshProjectIdentity>) => {
      currentIdentity = { ...currentIdentity, ...patch }
    },
    restart: () => createProjectLeaseAuthority({ ...deps, store, now }),
  }
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

describe('ProjectLeaseAuthority v2', () => {
  it('binds selection and lease to project, verified principal, session, and connection across restart', async () => {
    const { authority, restart } = makeAuthority()
    const handle = authority.issueSelectionHandle(selection, connection)
    const lease = await authority.issueLease(handle.token, connection)

    expect(PROJECT_LEASE_VERSION).toBe(2)
    expect(handle.handle).toMatchObject({
      version: 2,
      projectId: 'project-1',
      leasePrincipal: 'mcp:codex',
      sessionId: 'mcp-session:session-1',
      connectionNonce: 'connection-1',
    })
    expect(lease.lease).toMatchObject({
      version: 2,
      projectId: 'project-1',
      leasePrincipal: 'mcp:codex',
      sessionId: 'mcp-session:session-1',
      connectionNonce: 'connection-1',
      projectGeneration: 3,
      audience: 'nomi-mcp',
    })

    await expect(restart().verifyLease(lease.token, {
      connection,
      projectHint: 'project-1',
      scope: 'canvas:read',
    })).resolves.toEqual(lease.lease)
  })

  it('rejects a selection or lease replayed by another transport connection', async () => {
    const { authority } = makeAuthority()
    const handle = authority.issueSelectionHandle(selection, connection)

    expect(() => authority.verifySelectionHandle(handle.token, foreignConnection))
      .toThrow(ProjectLeaseScopeError)
    await expect(authority.issueLease(handle.token, foreignConnection))
      .rejects.toThrow(ProjectLeaseScopeError)

    const lease = await authority.issueLease(handle.token, connection)
    await expect(authority.verifyLease(lease.token, { connection: foreignConnection, scope: 'canvas:read' }))
      .rejects.toThrow(ProjectLeaseScopeError)
  })

  it('freshly revalidates UUID, generation, and canonical real-root identity without comparing revisions', async () => {
    const { authority, replaceIdentity, verifyProjectIdentity } = makeAuthority()
    const handle = authority.issueSelectionHandle(selection, connection)
    const lease = await authority.issueLease(handle.token, connection)

    await expect(authority.verifyLease(lease.token, { connection, scope: 'canvas:read' }))
      .resolves.toMatchObject({ projectId: 'project-1' })
    await expect(authority.verifyLease(lease.token, { connection, scope: 'canvas:read' }))
      .resolves.toMatchObject({ manifestDigest: 'manifest-digest-at-selection' })
    expect(verifyProjectIdentity).toHaveBeenCalledTimes(3)

    replaceIdentity({ immutableProjectUuid: 'uuid-replaced' })
    await expect(authority.verifyLease(lease.token, { connection, scope: 'canvas:read' }))
      .rejects.toEqual(expect.objectContaining({ code: 'project_binding_stale', name: 'ProjectBindingStaleError' }))
    replaceIdentity({ immutableProjectUuid: 'uuid-1', projectGeneration: 4 })
    await expect(authority.verifyLease(lease.token, { connection, scope: 'canvas:read' }))
      .rejects.toBeInstanceOf(ProjectBindingStaleError)
    replaceIdentity({ projectGeneration: 3, canonicalRootDigest: 'moved-root' })
    await expect(authority.verifyLease(lease.token, { connection, scope: 'canvas:read' }))
      .rejects.toBeInstanceOf(ProjectBindingStaleError)
  })

  it('rejects expiry, tampering, foreign scope, project-hint mismatch, and revoked leases', async () => {
    const { authority, advance } = makeAuthority()
    const handle = authority.issueSelectionHandle({ ...selection, ttlMs: 5_000 }, connection)
    const lease = await authority.issueLease(handle.token, connection, { ttlMs: 5_000 })

    await expect(authority.verifyLease(lease.token, { connection, projectHint: 'project-2' }))
      .rejects.toThrow(ProjectLeaseScopeError)
    await expect(authority.verifyLease(lease.token, { connection, scope: 'generation:submit' }))
      .rejects.toThrow(ProjectLeaseScopeError)
    await expect(authority.verifyLease(`${lease.token.slice(0, -1)}x`, { connection }))
      .rejects.toThrow(ProjectLeaseScopeError)
    advance(6)
    await expect(authority.verifyLease(lease.token, { connection }))
      .rejects.toThrow(ProjectLeaseExpiredError)

    const freshHandle = authority.issueSelectionHandle(selection, connection)
    const freshLease = await authority.issueLease(freshHandle.token, connection)
    authority.revoke(freshLease.token)
    await expect(authority.verifyLease(freshLease.token, { connection }))
      .rejects.toThrow(/revoked/)
  })

  it('intersects a selection handle with a server-owned scope ceiling when issuing a lease', async () => {
    const { authority } = makeAuthority()
    const handle = authority.issueSelectionHandle({
      ...selection,
      scopeSet: ['canvas:read', 'generation:plan', 'generation:submit'],
    }, connection)

    const lease = await authority.issueLease(handle.token, connection, {
      scopeCeiling: ['canvas:read', 'generation:plan'],
    })

    expect(lease.lease.scopeSet).toEqual(['canvas:read', 'generation:plan'])
    await expect(authority.verifyLease(lease.token, { connection, scope: 'generation:submit' }))
      .rejects.toThrow(/scope/i)
  })

  it('upgrades only the current connection lease scope and preserves every binding', async () => {
    const { authority } = makeAuthority()
    const handle = authority.issueSelectionHandle({ ...selection, scopeSet: ['canvas:read'] }, connection)
    const lease = await authority.issueLease(handle.token, connection, { ttlMs: 60_000 })

    const upgraded = await authority.upgradeLeaseScope(
      lease.token,
      ['canvas:read', 'generation:gate'],
      connection,
    )
    expect(upgraded.lease).toMatchObject({
      projectId: 'project-1',
      immutableProjectUuid: 'uuid-1',
      projectGeneration: 3,
      leasePrincipal: 'mcp:codex',
      sessionId: 'mcp-session:session-1',
      connectionNonce: 'connection-1',
      scopeSet: ['canvas:read', 'generation:gate'],
    })
    expect(Date.parse(upgraded.lease.expiresAt)).toBeLessThanOrEqual(Date.parse(lease.lease.expiresAt))
    await expect(authority.verifyLease(upgraded.token, { connection, scope: 'generation:gate' }))
      .resolves.toMatchObject({ projectId: 'project-1' })
    await expect(authority.upgradeLeaseScope(lease.token, ['generation:submit'], connection))
      .rejects.toThrow(ProjectLeaseScopeError)
    await expect(authority.upgradeLeaseScope(lease.token, ['canvas:read', 'generation:gate'], foreignConnection))
      .rejects.toThrow(ProjectLeaseScopeError)
  })
})
