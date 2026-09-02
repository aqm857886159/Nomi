import { synchronousSha256 } from '../../../electron/shared/synchronousSha256'

export const SCRIPT_DRAFT_SNAPSHOT_SCHEMA_VERSION = 1 as const

export type ScriptDraftSource = 'user' | 'nomi-agent' | 'external-mcp'

export type ScriptDraftSnapshot = {
  schemaVersion: typeof SCRIPT_DRAFT_SNAPSHOT_SCHEMA_VERSION
  kind: 'script'
  projectId?: string
  runId?: string
  artifactId?: string
  version: number
  source: ScriptDraftSource
  content: string
  contentHash: string
  createdAt: string
}

function contentOf(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error('Script draft content is required')
  return value
}

export function scriptDraftContentHash(content: string): string {
  return synchronousSha256(content)
}

export function snapshotScriptDraft(input: {
  content: string
  projectId?: string
  runId?: string
  artifactId?: string
  version?: number
  source?: ScriptDraftSource
  createdAt?: string
}): ScriptDraftSnapshot {
  const content = contentOf(input.content)
  const version = Number.isInteger(input.version) && (input.version as number) > 0 ? input.version as number : 1
  const source = input.source || 'user'
  if (source !== 'user' && source !== 'nomi-agent' && source !== 'external-mcp') throw new Error('Invalid script draft source')
  const createdAt = input.createdAt || new Date().toISOString()
  return {
    schemaVersion: SCRIPT_DRAFT_SNAPSHOT_SCHEMA_VERSION,
    kind: 'script',
    ...(input.projectId ? { projectId: input.projectId } : {}),
    ...(input.runId ? { runId: input.runId } : {}),
    ...(input.artifactId ? { artifactId: input.artifactId } : {}),
    version,
    source,
    content,
    contentHash: scriptDraftContentHash(content),
    createdAt,
  }
}

export function readScriptDraftSnapshot(value: unknown): ScriptDraftSnapshot | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const raw = value as Record<string, unknown>
  if (raw.schemaVersion !== SCRIPT_DRAFT_SNAPSHOT_SCHEMA_VERSION || raw.kind !== 'script') return null
  if (typeof raw.content !== 'string' || !raw.content.trim() || typeof raw.contentHash !== 'string') return null
  if (raw.contentHash !== scriptDraftContentHash(raw.content)) return null
  if (!Number.isInteger(raw.version) || Number(raw.version) <= 0) return null
  if (!['user', 'nomi-agent', 'external-mcp'].includes(String(raw.source))) return null
  if (typeof raw.createdAt !== 'string' || !raw.createdAt.trim()) return null
  return raw as unknown as ScriptDraftSnapshot
}
