import React from 'react'

/**
 * Shared, domain-agnostic discovery helpers for Nomi's libraries.
 *
 * The libraries remain separate sources of truth. This module only standardises
 * how the renderer searches, sorts and remembers the last successful use of an
 * item; it never stores the item body or changes a domain write boundary.
 */

export type LibraryKind = 'project' | 'prompt' | 'skill' | 'asset'

export type LibrarySearchDocument = {
  title: string
  description?: string | null
  tags?: readonly string[] | null
  keywords?: readonly string[] | null
}

export type LibraryUsage = {
  lastUsedAt?: number
}

type UsageIndex = Partial<Record<LibraryKind, Record<string, LibraryUsage>>>

const STORAGE_KEY = 'nomi:library-discovery:v1'
const USAGE_EVENT = 'nomi-library-usage-changed'
const LIBRARY_KINDS = ['project', 'prompt', 'skill', 'asset'] as const
const MAX_USAGE_ENTRIES_PER_KIND = 200

let usageVersion = 0

export function normalizeLibraryQuery(value: string | null | undefined): string {
  return String(value ?? '').trim().toLocaleLowerCase()
}

/** Match all query terms against the user-visible/searchable fields. */
export function matchesLibraryQuery(item: LibrarySearchDocument, query: string): boolean {
  const normalized = normalizeLibraryQuery(query)
  if (!normalized) return true
  const haystack = [
    item.title,
    item.description ?? '',
    ...(item.tags ?? []),
    ...(item.keywords ?? []),
  ]
    .join(' ')
    .toLocaleLowerCase()
  return normalized.split(/\s+/).every((term) => haystack.includes(term))
}

function readUsageIndex(): UsageIndex {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const clean: UsageIndex = {}
    for (const kind of LIBRARY_KINDS) {
      const bucket = (parsed as Record<string, unknown>)[kind]
      if (!bucket || typeof bucket !== 'object' || Array.isArray(bucket)) continue
      const cleanBucket: Record<string, LibraryUsage> = {}
      for (const [id, value] of Object.entries(bucket as Record<string, unknown>)) {
        if (!id || !value || typeof value !== 'object' || Array.isArray(value)) continue
        const at = (value as { lastUsedAt?: unknown }).lastUsedAt
        if (typeof at === 'number' && Number.isFinite(at) && at >= 0) cleanBucket[id] = { lastUsedAt: at }
      }
      if (Object.keys(cleanBucket).length > 0) clean[kind] = trimUsageBucket(cleanBucket)
    }
    return clean
  } catch {
    // Private browsing and Electron contexts can deny localStorage. Discovery
    // must still work; recency is an enhancement, not a data dependency.
    return {}
  }
}

function writeUsageIndex(index: UsageIndex): void {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(index))
  } catch {
    // Ignore storage quota/security failures; domain data is unaffected.
  }
}

function trimUsageBucket(bucket: Record<string, LibraryUsage>): Record<string, LibraryUsage> {
  const entries = Object.entries(bucket)
  if (entries.length <= MAX_USAGE_ENTRIES_PER_KIND) return bucket
  entries.sort(([leftId, left], [rightId, right]) => {
    const leftTime = Number.isFinite(left.lastUsedAt) && (left.lastUsedAt ?? 0) >= 0 ? left.lastUsedAt ?? 0 : 0
    const rightTime = Number.isFinite(right.lastUsedAt) && (right.lastUsedAt ?? 0) >= 0 ? right.lastUsedAt ?? 0 : 0
    return rightTime - leftTime || leftId.localeCompare(rightId)
  })
  return Object.fromEntries(entries.slice(0, MAX_USAGE_ENTRIES_PER_KIND))
}

export function getLibraryUsage(kind: LibraryKind, id: string): LibraryUsage {
  return readUsageIndex()[kind]?.[id] ?? {}
}

/** Subscribe to same-window usage updates so a just-used item moves immediately. */
export function subscribeLibraryUsage(listener: () => void): () => void {
  const target = globalThis as typeof globalThis & {
    addEventListener?: (type: string, handler: EventListener) => void
    removeEventListener?: (type: string, handler: EventListener) => void
  }
  if (!target.addEventListener) return () => undefined
  const handler: EventListener = () => listener()
  target.addEventListener(USAGE_EVENT, handler)
  return () => target.removeEventListener?.(USAGE_EVENT, handler)
}

export function getLibraryUsageVersion(): number {
  return usageVersion
}

/** React bridge for the tiny renderer-only usage index (resource bodies stay in domain stores). */
export function useLibraryUsageVersion(): number {
  return React.useSyncExternalStore(subscribeLibraryUsage, getLibraryUsageVersion, () => 0)
}

function notifyLibraryUsageChanged(): void {
  usageVersion += 1
  const target = globalThis as typeof globalThis & { dispatchEvent?: (event: Event) => boolean }
  if (target.dispatchEvent && typeof CustomEvent !== 'undefined') {
    target.dispatchEvent(new CustomEvent(USAGE_EVENT))
  }
}

export function markLibraryUsed(kind: LibraryKind, id: string, at = Date.now()): void {
  if (!LIBRARY_KINDS.includes(kind) || !String(id ?? '').trim()) return
  const normalizedId = String(id).trim()
  const index = readUsageIndex()
  const bucket = index[kind] ?? {}
  bucket[normalizedId] = { ...bucket[normalizedId], lastUsedAt: Number.isFinite(at) && at >= 0 ? at : Date.now() }
  index[kind] = trimUsageBucket(bucket)
  writeUsageIndex(index)
  notifyLibraryUsageChanged()
}

/** Most recently used first; preserve source order when usage timestamps tie. */
export function sortByLibraryUsage<T>(
  items: readonly T[],
  kind: LibraryKind,
  getId: (item: T) => string,
  getFallbackTime?: (item: T) => number | undefined,
): T[] {
  const usage = readUsageIndex()[kind] ?? {}
  const safeTime = (value: number | undefined): number => Number.isFinite(value) && (value ?? 0) >= 0 ? value ?? 0 : 0
  return items
    .map((item, index) => ({ item, index }))
    .sort((leftEntry, rightEntry) => {
      const left = leftEntry.item
      const right = rightEntry.item
      const leftUsage = usage[getId(left)]
      const rightUsage = usage[getId(right)]
      const leftTime = leftUsage ? safeTime(leftUsage.lastUsedAt) : safeTime(getFallbackTime?.(left))
      const rightTime = rightUsage ? safeTime(rightUsage.lastUsedAt) : safeTime(getFallbackTime?.(right))
      if (rightTime !== leftTime) return rightTime - leftTime
      return leftEntry.index - rightEntry.index
    })
    .map(({ item }) => item)
}
