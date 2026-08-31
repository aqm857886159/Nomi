import type { ProductionRunRepository } from './productionRunRepository'

function identifier(value: string, label: string): string {
  const normalized = String(value || '').trim()
  if (!/^[A-Za-z0-9._-]{1,160}$/.test(normalized) || normalized === '.' || normalized === '..') throw new Error(`Invalid ${label} id in production link`)
  return normalized
}

export type ProductionDeepLinkTarget = { projectId: string; runId: string; artifactId?: string }

export function buildProductionDeepLink(projectId: string, runId: string, artifactId?: string): string {
  const project = identifier(projectId, 'project')
  const run = identifier(runId, 'run')
  const artifact = artifactId === undefined ? undefined : identifier(artifactId, 'artifact')
  const base = `nomi://project/${encodeURIComponent(project)}/run/${encodeURIComponent(run)}`
  return artifact ? `${base}?artifact=${encodeURIComponent(artifact)}` : base
}

export function resolveProductionDeepLink(rawUrl: string, repository: Pick<ProductionRunRepository, 'read'>): ProductionDeepLinkTarget {
  let url: URL
  try { url = new URL(rawUrl) } catch { throw new Error('Invalid production deep link') }
  if (url.protocol !== 'nomi:' || url.hostname !== 'project' || url.port || url.username || url.password || url.hash) {
    throw new Error('Unsupported production deep link')
  }
  const parts = url.pathname.split('/').filter(Boolean)
  if (parts.length !== 3 || parts[1] !== 'run') throw new Error('Invalid production deep link path')
  let projectId: string
  let runId: string
  try { projectId = identifier(decodeURIComponent(parts[0]), 'project'); runId = identifier(decodeURIComponent(parts[2]), 'run') } catch { throw new Error('Invalid production deep link path') }
  const keys = [...url.searchParams.keys()]
  if (keys.some((key) => key !== 'artifact') || keys.filter((key) => key === 'artifact').length > 1) throw new Error('Invalid production deep link query')
  const artifactId = url.searchParams.has('artifact') ? identifier(url.searchParams.get('artifact') || '', 'artifact') : undefined
  const run = repository.read(projectId, runId)
  if (!run) throw new Error(`Production run not found: ${runId}`)
  if (run.projectId !== projectId) throw new Error('Production run project mismatch')
  if (artifactId && !run.artifacts.some((artifact) => artifact.artifactId === artifactId)) throw new Error(`Production artifact not found: ${artifactId}`)
  return { projectId, runId, ...(artifactId ? { artifactId } : {}) }
}
