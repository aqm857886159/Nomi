import crypto from 'node:crypto'
import { performance } from 'node:perf_hooks'

import {
  CAPTURED_CANVAS_READ_SNAPSHOT_VERSION,
  type CapturedCanvasReadSnapshotHandleWire,
} from '../shared/surfacePortBinding'
import {
  canvasReadResultSchema,
  type CanvasReadResult,
} from '../shared/agentCapabilities/canvasRead'
import {
  SurfacePortError,
  type CommittedSurfaceProjectSelection,
  type SurfaceOwnerAuthorityRuntime,
  type SurfaceOwnerDescriptor,
  type SurfaceOwnerEvidence,
  type SurfacePortBinding,
} from './canvasReadSurfaceRegistry'

export const CAPTURED_CANVAS_READ_DEFAULT_TTL_MS = 60_000
export const CAPTURED_CANVAS_READ_MAX_ENTRIES_PER_OWNER = 8
export const CAPTURED_CANVAS_READ_MAX_ENTRIES_GLOBAL = 32
export const CAPTURED_CANVAS_READ_MAX_SNAPSHOT_BYTES = 1_048_576

const issuedCapturedCanvasReadSnapshotRegistries = new WeakSet<object>()

declare const capturedCanvasReadSnapshotPortBrand: unique symbol
export type CapturedCanvasReadSnapshotPort = Readonly<{
  readonly [capturedCanvasReadSnapshotPortBrand]: never
}>

export type CapturedCanvasReadSnapshotDispatch = Readonly<{
  binding: SurfacePortBinding
  canonicalRootDigest: string
  snapshotHash: string
  authorityRef: string
  result: CanvasReadResult
}>

type PendingState = Readonly<{
  owner: SurfaceOwnerEvidence
  ownerDescriptor: SurfaceOwnerDescriptor
  binding: SurfacePortBinding
  canonicalRootDigest: string
  snapshotHash: string
  authorityRef: string
  result: CanvasReadResult
  handle: CapturedCanvasReadSnapshotHandleWire
  expiresAt: number
  timer: ReturnType<typeof setTimeout>
}>

type CapturedState = Readonly<{
  owner: SurfaceOwnerEvidence
  ownerDescriptor: SurfaceOwnerDescriptor
  dispatch: CapturedCanvasReadSnapshotDispatch
}>

export type CapturedCanvasReadSnapshotRegistry = Readonly<{
  seal(input: Readonly<{
    owner: SurfaceOwnerEvidence
    binding: SurfacePortBinding
    selection: CommittedSurfaceProjectSelection
    snapshot: unknown
  }>): CapturedCanvasReadSnapshotHandleWire
  consume(input: Readonly<{
    owner: SurfaceOwnerEvidence
    handle: unknown
    projectId: string
  }>): CapturedCanvasReadSnapshotPort
  resolve(captured: CapturedCanvasReadSnapshotPort): CapturedCanvasReadSnapshotDispatch
  release(captured: CapturedCanvasReadSnapshotPort): void
  revokePendingForOwner(owner: SurfaceOwnerEvidence): void
  invalidateOwner(owner: SurfaceOwnerEvidence): void
}>

export function assertCapturedCanvasReadSnapshotRegistry(
  value: unknown,
): asserts value is CapturedCanvasReadSnapshotRegistry {
  if (!value || typeof value !== 'object' || !issuedCapturedCanvasReadSnapshotRegistries.has(value)) {
    throw new SurfacePortError('surface_owner_mismatch')
  }
}

function positiveLimit(value: number | undefined, fallback: number): number {
  return Number.isSafeInteger(value) && Number(value) > 0 ? Number(value) : fallback
}

function requiredString(value: unknown, code: 'surface_port_stale' | 'capability_input_invalid'): string {
  const normalized = typeof value === 'string' ? value.trim() : ''
  if (!normalized) throw new SurfacePortError(code)
  return normalized
}

function sameOwner(left: SurfaceOwnerDescriptor, right: SurfaceOwnerDescriptor): boolean {
  return left.contents === right.contents
    && left.frame === right.frame
    && left.webContentsId === right.webContentsId
    && left.processId === right.processId
    && left.frameRoutingId === right.frameRoutingId
    && left.origin === right.origin
}

function bindingMatchesOwner(binding: SurfacePortBinding, owner: SurfaceOwnerDescriptor): boolean {
  return binding.webContentsId === owner.webContentsId
    && binding.processId === owner.processId
    && binding.frameRoutingId === owner.frameRoutingId
    && binding.origin === owner.origin
}

function bindingMatchesSelection(
  binding: SurfacePortBinding,
  selection: CommittedSurfaceProjectSelection,
): boolean {
  return binding.binding.projectId === selection.projectId
    && binding.binding.immutableProjectUuid === selection.immutableProjectUuid
    && binding.binding.projectGeneration === selection.projectGeneration
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child)
  }
  return value
}

function canonicalSnapshot(value: unknown, maxBytes: number): Readonly<{
  result: CanvasReadResult
  bytes: string
}> {
  let rawBytes: string | undefined
  try {
    rawBytes = JSON.stringify(value)
  } catch {
    throw new SurfacePortError('capability_input_invalid')
  }
  if (rawBytes === undefined || Buffer.byteLength(rawBytes, 'utf8') > maxBytes) {
    throw new SurfacePortError('capability_input_invalid')
  }
  let result: CanvasReadResult
  try {
    result = canvasReadResultSchema.parse(value)
  } catch {
    throw new SurfacePortError('capability_input_invalid')
  }
  const bytes = JSON.stringify(result)
  if (Buffer.byteLength(bytes, 'utf8') > maxBytes) {
    throw new SurfacePortError('capability_input_invalid')
  }
  return Object.freeze({ result: deepFreeze(result), bytes })
}

function exactHandle(value: unknown): Readonly<{
  version: number
  handleId: string
  nonce: string
}> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new SurfacePortError('surface_port_stale')
  }
  const record = value as Record<string, unknown>
  if (Object.keys(record).sort().join(',') !== 'handleId,nonce,version') {
    throw new SurfacePortError('surface_port_stale')
  }
  return Object.freeze({
    version: Number(record.version),
    handleId: requiredString(record.handleId, 'surface_port_stale'),
    nonce: requiredString(record.nonce, 'surface_port_stale'),
  })
}

export function createCapturedCanvasReadSnapshotRegistry(input: Readonly<{
  ownerAuthority: SurfaceOwnerAuthorityRuntime
  randomId?: () => string
  ttlMs?: number
  maxEntriesPerOwner?: number
  maxEntriesGlobal?: number
  maxSnapshotBytes?: number
  now?: () => number
}>): CapturedCanvasReadSnapshotRegistry {
  const randomId = input.randomId ?? (() => crypto.randomUUID())
  const now = input.now ?? (() => performance.now())
  const ttlMs = positiveLimit(input.ttlMs, CAPTURED_CANVAS_READ_DEFAULT_TTL_MS)
  const maxEntriesPerOwner = positiveLimit(
    input.maxEntriesPerOwner,
    CAPTURED_CANVAS_READ_MAX_ENTRIES_PER_OWNER,
  )
  const maxEntriesGlobal = positiveLimit(
    input.maxEntriesGlobal,
    CAPTURED_CANVAS_READ_MAX_ENTRIES_GLOBAL,
  )
  const maxSnapshotBytes = positiveLimit(
    input.maxSnapshotBytes,
    CAPTURED_CANVAS_READ_MAX_SNAPSHOT_BYTES,
  )
  const pendingById = new Map<string, PendingState>()
  const pendingByOwner = new Map<SurfaceOwnerEvidence, Set<string>>()
  const captures = new WeakMap<object, CapturedState>()
  const capturesByOwner = new Map<SurfaceOwnerEvidence, Set<CapturedCanvasReadSnapshotPort>>()

  const currentTimeMs = (): number => {
    const value = now()
    if (!Number.isFinite(value) || value < 0) {
      throw new SurfacePortError('surface_port_unavailable')
    }
    return value
  }

  const capturedEntryCount = (): number => {
    let count = 0
    for (const owned of capturesByOwner.values()) count += owned.size
    return count
  }

  const assertCapacity = (owner: SurfaceOwnerEvidence): void => {
    const ownerCount = (pendingByOwner.get(owner)?.size ?? 0)
      + (capturesByOwner.get(owner)?.size ?? 0)
    const globalCount = pendingById.size + capturedEntryCount()
    if (ownerCount >= maxEntriesPerOwner || globalCount >= maxEntriesGlobal) {
      throw new SurfacePortError('surface_port_unavailable')
    }
  }

  const resolveLiveOwner = (owner: SurfaceOwnerEvidence): SurfaceOwnerDescriptor => {
    const descriptor = input.ownerAuthority.resolve(owner)
    if (!descriptor.isLive()) throw new SurfacePortError('surface_port_unavailable')
    return descriptor
  }

  const removePending = (state: PendingState): void => {
    if (pendingById.get(state.handle.handleId) !== state) return
    pendingById.delete(state.handle.handleId)
    clearTimeout(state.timer)
    const owned = pendingByOwner.get(state.owner)
    owned?.delete(state.handle.handleId)
    if (!owned?.size) pendingByOwner.delete(state.owner)
  }

  const revokeCapturedForOwner = (owner: SurfaceOwnerEvidence): void => {
    const owned = capturesByOwner.get(owner)
    if (!owned) return
    for (const captured of owned) captures.delete(captured)
    capturesByOwner.delete(owner)
  }

  const newId = (): string => {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const candidate = requiredString(randomId(), 'surface_port_stale')
      if (!pendingById.has(candidate)) return candidate
    }
    throw new SurfacePortError('surface_port_unavailable')
  }

  const registry: CapturedCanvasReadSnapshotRegistry = Object.freeze({
    seal({ owner, binding, selection, snapshot }) {
      const ownerDescriptor = resolveLiveOwner(owner)
      if (!bindingMatchesOwner(binding, ownerDescriptor)) {
        throw new SurfacePortError('surface_owner_mismatch')
      }
      if (!bindingMatchesSelection(binding, selection)) {
        throw new SurfacePortError('project_binding_stale')
      }
      const rootDigest = requiredString(selection.canonicalRootDigest, 'surface_port_stale')
      assertCapacity(owner)
      const owned = pendingByOwner.get(owner)
      const canonical = canonicalSnapshot(snapshot, maxSnapshotBytes)
      const expiresAt = currentTimeMs() + ttlMs
      if (!Number.isFinite(expiresAt)) throw new SurfacePortError('surface_port_unavailable')

      const handle = Object.freeze({
        version: CAPTURED_CANVAS_READ_SNAPSHOT_VERSION,
        handleId: newId(),
        nonce: requiredString(randomId(), 'surface_port_stale'),
      })
      const timer = setTimeout(() => {
        const pending = pendingById.get(handle.handleId)
        if (pending) removePending(pending)
      }, ttlMs)
      ;(timer as unknown as { unref?: () => void }).unref?.()
      const state: PendingState = Object.freeze({
        owner,
        ownerDescriptor,
        binding,
        canonicalRootDigest: rootDigest,
        snapshotHash: crypto.createHash('sha256').update(canonical.bytes).digest('hex'),
        authorityRef: `captured-canvas-read-v1:${requiredString(randomId(), 'surface_port_stale')}`,
        result: canonical.result,
        handle,
        expiresAt,
        timer,
      })
      pendingById.set(handle.handleId, state)
      const nextOwned = owned ?? new Set<string>()
      nextOwned.add(handle.handleId)
      if (!owned) pendingByOwner.set(owner, nextOwned)
      return handle
    },

    consume({ owner, handle: handleValue, projectId: projectValue }) {
      const handle = exactHandle(handleValue)
      const state = pendingById.get(handle.handleId)
      if (!state
        || handle.version !== CAPTURED_CANVAS_READ_SNAPSHOT_VERSION
        || handle.nonce !== state.handle.nonce) {
        throw new SurfacePortError('surface_port_stale')
      }
      const descriptor = resolveLiveOwner(owner)
      if (owner !== state.owner || !sameOwner(descriptor, state.ownerDescriptor)) {
        throw new SurfacePortError('surface_owner_mismatch')
      }
      if (requiredString(projectValue, 'surface_port_stale') !== state.binding.binding.projectId) {
        throw new SurfacePortError('surface_port_stale')
      }
      if (currentTimeMs() >= state.expiresAt) {
        removePending(state)
        throw new SurfacePortError('surface_port_stale')
      }

      removePending(state)
      const captured = Object.freeze({}) as CapturedCanvasReadSnapshotPort
      const dispatch = Object.freeze({
        binding: state.binding,
        canonicalRootDigest: state.canonicalRootDigest,
        snapshotHash: state.snapshotHash,
        authorityRef: state.authorityRef,
        result: state.result,
      })
      captures.set(captured, Object.freeze({ owner, ownerDescriptor: descriptor, dispatch }))
      const owned = capturesByOwner.get(owner) ?? new Set<CapturedCanvasReadSnapshotPort>()
      owned.add(captured)
      capturesByOwner.set(owner, owned)
      return captured
    },

    resolve(captured) {
      if (!captured || typeof captured !== 'object') throw new SurfacePortError('surface_port_stale')
      const state = captures.get(captured)
      if (!state) throw new SurfacePortError('surface_port_stale')
      const descriptor = resolveLiveOwner(state.owner)
      if (!sameOwner(descriptor, state.ownerDescriptor)) {
        throw new SurfacePortError('surface_owner_mismatch')
      }
      return state.dispatch
    },

    release(captured) {
      if (!captured || typeof captured !== 'object') return
      const state = captures.get(captured)
      if (!state) return
      captures.delete(captured)
      const owned = capturesByOwner.get(state.owner)
      owned?.delete(captured)
      if (!owned?.size) capturesByOwner.delete(state.owner)
    },

    revokePendingForOwner(owner) {
      const owned = pendingByOwner.get(owner)
      if (!owned) return
      for (const handleId of [...owned]) {
        const state = pendingById.get(handleId)
        if (state) removePending(state)
      }
    },

    invalidateOwner(owner) {
      registry.revokePendingForOwner(owner)
      revokeCapturedForOwner(owner)
    },
  })

  issuedCapturedCanvasReadSnapshotRegistries.add(registry)
  return registry
}
