import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

import type { ProductionArtifact, ProductionRun } from './productionRunTypes'

const DEFAULT_TTL_MS = 5 * 60_000
const MAX_TTL_MS = 24 * 60 * 60_000
const TOKEN_VERSION = 1
let processPreviewSecret = ''
let previewHttpOrigin = ''

export type ArtifactPreview = {
  url: string
  nomiUrl: string
  token: string
  expiresAt: string
}

export type ArtifactProjection = Omit<ProductionArtifact, 'projectRelativePath' | 'thumbnailRelativePath'> & {
  projectId: string
  runId: string
  nomiUri: string
  preview?: ArtifactPreview
  openInNomi: string
}

/** The desktop process shares this secret with the nomi-local protocol handler. */
export function getArtifactPreviewSecret(): string {
  const configured = String(process.env.NOMI_ARTIFACT_PREVIEW_SECRET || '').trim()
  if (configured) return configured
  processPreviewSecret ||= crypto.randomBytes(32).toString('hex')
  return processPreviewSecret
}

/** Persist a random profile-scoped secret. The file is never exposed on the MCP wire. */
export function loadOrCreateArtifactPreviewSecret(filePath: string): string {
  const target = path.resolve(filePath)
  fs.mkdirSync(path.dirname(target), { recursive: true })
  try {
    const existing = fs.readFileSync(target, 'utf8').trim()
    if (/^[a-f0-9]{64}$/i.test(existing)) return existing
  } catch {
    // First use creates the file below.
  }
  const secret = crypto.randomBytes(32).toString('hex')
  const temporary = `${target}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`
  fs.writeFileSync(temporary, `${secret}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' })
  try {
    fs.renameSync(temporary, target)
    try { fs.chmodSync(target, 0o600) } catch { /* POSIX mode is best effort on Windows. */ }
    return secret
  } catch (error) {
    try { fs.unlinkSync(temporary) } catch { /* Another process may have won the create race. */ }
    const existing = fs.readFileSync(target, 'utf8').trim()
    if (/^[a-f0-9]{64}$/i.test(existing)) return existing
    throw error
  }
}

export function setArtifactPreviewHttpOrigin(origin: string | null): void {
  if (!origin) {
    previewHttpOrigin = ''
    return
  }
  const parsed = new URL(origin)
  if (parsed.protocol !== 'http:' || parsed.hostname !== '127.0.0.1' || parsed.username || parsed.password || parsed.search || parsed.hash || (parsed.pathname && parsed.pathname !== '/')) {
    throw new Error('Artifact preview origin must be a loopback HTTP origin')
  }
  previewHttpOrigin = parsed.origin
}

type PreviewClaims = {
  v: number
  p: string
  r: string
  a: string
  path: string
  exp: number
}

function base64Url(value: string | Buffer): string {
  return Buffer.from(value).toString('base64url')
}

function decodeBase64Url(value: string): Buffer {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('Invalid preview token encoding')
  return Buffer.from(value, 'base64url')
}

function identifier(value: string, label: string): string {
  const normalized = String(value || '').trim()
  if (!/^[A-Za-z0-9._-]{1,160}$/.test(normalized) || normalized === '.' || normalized === '..') throw new Error(`Invalid ${label} id`)
  return normalized
}

function normalizeRelativePath(value: string): string {
  const raw = String(value || '').trim()
  if (!raw || raw.includes('\0') || raw.startsWith('/') || raw.startsWith('\\') || /^[A-Za-z]:[\\/]/.test(raw)) {
    throw new Error('Artifact path must be project-relative')
  }
  if (/^[A-Za-z][A-Za-z0-9+.-]*:/i.test(raw) || raw.includes('\\')) throw new Error('Artifact path cannot be a provider URL')
  let decoded = raw
  for (let i = 0; i < 3; i += 1) {
    try {
      const next = decodeURIComponent(decoded)
      if (next === decoded) break
      decoded = next
    } catch {
      throw new Error('Artifact path has invalid encoding')
    }
  }
  const segments = decoded.split('/')
  if (segments.some((segment) => !segment || segment === '.' || segment === '..')) {
    throw new Error('Artifact path traversal is not allowed')
  }
  return segments.join('/')
}

export function resolveOwnedArtifactFile(projectRoot: string, relativePath: string): string {
  const root = path.resolve(projectRoot)
  const target = path.resolve(root, relativePath)
  if (target !== root && !target.startsWith(`${root}${path.sep}`)) throw new Error('Artifact path leaves project root')
  let current = root
  for (const segment of relativePath.split('/')) {
    current = path.join(current, segment)
    const stat = fs.lstatSync(current)
    if (stat.isSymbolicLink()) throw new Error('Artifact preview rejects symlink paths')
  }
  const stat = fs.statSync(target)
  if (!stat.isFile()) throw new Error('Artifact preview requires a regular file')
  const realRoot = fs.realpathSync(root)
  const realTarget = fs.realpathSync(target)
  if (realTarget !== realRoot && !realTarget.startsWith(`${realRoot}${path.sep}`)) {
    throw new Error('Artifact path resolves outside project root')
  }
  return realTarget
}

function sign(value: string, secret: string): string {
  return base64Url(crypto.createHmac('sha256', secret).update(value).digest())
}

function tokenFor(claims: PreviewClaims, secret: string): string {
  const body = base64Url(JSON.stringify(claims))
  return `${body}.${sign(body, secret)}`
}

function parseToken(token: string, secret: string): PreviewClaims {
  const [body, signature, extra] = String(token || '').split('.')
  if (!body || !signature || extra) throw new Error('Invalid preview token')
  const expected = sign(body, secret)
  const actualBytes = Buffer.from(signature)
  const expectedBytes = Buffer.from(expected)
  if (actualBytes.length !== expectedBytes.length || !crypto.timingSafeEqual(actualBytes, expectedBytes)) {
    throw new Error('Invalid preview token signature')
  }
  let claims: PreviewClaims
  try {
    claims = JSON.parse(decodeBase64Url(body).toString('utf8')) as PreviewClaims
  } catch {
    throw new Error('Invalid preview token claims')
  }
  if (claims.v !== TOKEN_VERSION || !Number.isInteger(claims.exp) || typeof claims.path !== 'string') {
    throw new Error('Invalid preview token claims')
  }
  claims.path = normalizeRelativePath(claims.path)
  claims.p = identifier(claims.p, 'project')
  claims.r = identifier(claims.r, 'run')
  claims.a = identifier(claims.a, 'artifact')
  return claims
}

export function createArtifactProjection(args: {
  projectRoot: string
  run: Pick<ProductionRun, 'projectId' | 'runId'>
  artifact: ProductionArtifact
  secret: string
  nowMs?: number
  ttlMs?: number
}): ArtifactProjection {
  const projectId = identifier(args.run.projectId, 'project')
  const runId = identifier(args.run.runId, 'run')
  const artifactId = identifier(args.artifact.artifactId, 'artifact')
  const sourcePath = args.artifact.thumbnailRelativePath || args.artifact.projectRelativePath
  const safePath = sourcePath ? normalizeRelativePath(sourcePath) : undefined
  if (safePath) resolveOwnedArtifactFile(args.projectRoot, safePath)
  const nowMs = Number.isFinite(args.nowMs) ? Number(args.nowMs) : Date.now()
  const ttlMs = Math.min(MAX_TTL_MS, Math.max(1_000, Math.floor(args.ttlMs ?? DEFAULT_TTL_MS)))
  const exp = nowMs + ttlMs
  const preview = safePath
    ? (() => {
        const token = tokenFor({ v: TOKEN_VERSION, p: projectId, r: runId, a: artifactId, path: safePath, exp }, args.secret)
        const encodedPath = safePath.split('/').map(encodeURIComponent).join('/')
        const nomiUrl = `nomi-local://production-preview/${encodeURIComponent(projectId)}/${encodeURIComponent(runId)}/${encodeURIComponent(artifactId)}/${encodedPath}?preview=${encodeURIComponent(token)}`
        return {
          token,
          expiresAt: new Date(exp).toISOString(),
          nomiUrl,
          url: previewHttpOrigin
            ? `${previewHttpOrigin}/production-preview?preview=${encodeURIComponent(token)}`
            : nomiUrl,
        }
      })()
    : undefined
  return {
    artifactId,
    runId,
    projectId,
    stageId: args.artifact.stageId,
    ...(args.artifact.jobId ? { jobId: args.artifact.jobId } : {}),
    kind: args.artifact.kind,
    status: args.artifact.status,
    createdAt: args.artifact.createdAt,
    ...(args.artifact.adoptedAt ? { adoptedAt: args.artifact.adoptedAt } : {}),
    nomiUri: `nomi://project/${encodeURIComponent(projectId)}/run/${encodeURIComponent(runId)}/artifact/${encodeURIComponent(artifactId)}`,
    ...(preview ? { preview } : {}),
    openInNomi: `nomi://project/${encodeURIComponent(projectId)}/run/${encodeURIComponent(runId)}?artifact=${encodeURIComponent(artifactId)}`,
  }
}

export function verifyArtifactPreviewHandle(args: {
  token: string
  secret: string
  nowMs?: number
  expected?: { projectId?: string; runId?: string; artifactId?: string; relativePath?: string }
}): { projectId: string; runId: string; artifactId: string; relativePath: string; expiresAt: string } {
  const claims = parseToken(args.token, args.secret)
  const nowMs = Number.isFinite(args.nowMs) ? Number(args.nowMs) : Date.now()
  if (claims.exp <= nowMs) throw new Error('Artifact preview token expired')
  const expected = args.expected || {}
  if ((expected.projectId && claims.p !== expected.projectId) || (expected.runId && claims.r !== expected.runId) || (expected.artifactId && claims.a !== expected.artifactId)) {
    throw new Error('Artifact preview token scope mismatch')
  }
  if (expected.relativePath && claims.path !== normalizeRelativePath(expected.relativePath)) throw new Error('Artifact preview token path mismatch')
  return { projectId: claims.p, runId: claims.r, artifactId: claims.a, relativePath: claims.path, expiresAt: new Date(claims.exp).toISOString() }
}
