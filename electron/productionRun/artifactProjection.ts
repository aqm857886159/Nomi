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
  /**
   * 项目内相对路径——**校验后**才外发（见 safeProjectRelativePath）。本机 agent 拿它 + 项目目录就能验产物
   * （ffprobe 时长/编码之类），不必再走签名预览链。缩略图那条（thumbnailRelativePath）仍不外发：它是渲染
   * 中间物，外部没有用它的理由。
   */
  projectRelativePath?: string
  nomiUri: string
  preview?: ArtifactPreview
  /** For video artifacts this is the same signed, thumbnail-first preview under an explicit poster name. */
  poster?: ArtifactPreview
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

// k = token 类型判别位：'ra'（缺省）= production run-artifact（带 r/a），'asset' = 画布素材（只 p+path，无 run/artifact）。
// 两类共用同一 HMAC 签名 / 同一 /production-preview 端点，但校验分道——asset token 永远进不了 run 产物解析路，反之亦然。
type PreviewTokenKind = 'ra' | 'asset'
type PreviewClaims = {
  v: number
  k?: PreviewTokenKind
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

/**
 * 外发前把产物路径过一遍 normalizeRelativePath：绝对路径 / 盘符 / provider URL / `..` 穿越 / 坏编码一律省略。
 * 字段名写着 relative 但历史写入方并不保证（合同 evidence 里就见过 `/Users/...` 绝对路径），所以这里按**值**
 * 判定、不按字段名信任——校验通过才算「项目内相对路径」，否则当没有。与预览链共用同一把尺子，不另立第二套。
 */
export function safeProjectRelativePath(value: string | undefined): string | undefined {
  if (!value) return undefined
  try {
    return normalizeRelativePath(value)
  } catch {
    return undefined
  }
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
  const kind: PreviewTokenKind = claims.k === 'asset' ? 'asset' : 'ra'
  claims.k = kind
  claims.path = normalizeRelativePath(claims.path)
  claims.p = identifier(claims.p, 'project')
  // asset token 无 run/artifact 身份——不校验 r/a（校验会因空串抛）；run-artifact token 照旧强校验。
  if (kind === 'ra') {
    claims.r = identifier(claims.r, 'run')
    claims.a = identifier(claims.a, 'artifact')
  }
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
  // 预览用的是「缩略图优先」那条；外发的产物路径必须是产物**自己**那条，且各自独立校验。
  const artifactPath = safeProjectRelativePath(args.artifact.projectRelativePath)
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
    ...(args.artifact.version !== undefined ? { version: args.artifact.version } : {}),
    ...(args.artifact.source ? { source: args.artifact.source } : {}),
    ...(args.artifact.parentArtifactId ? { parentArtifactId: args.artifact.parentArtifactId } : {}),
    ...(args.artifact.retryCount !== undefined ? { retryCount: args.artifact.retryCount } : {}),
    ...(args.artifact.retryReason ? { retryReason: args.artifact.retryReason } : {}),
    ...(args.artifact.contentHash ? { contentHash: args.artifact.contentHash } : {}),
    ...(args.artifact.sourceArtifactId ? { sourceArtifactId: args.artifact.sourceArtifactId } : {}),
    ...(args.artifact.sourceVersion !== undefined ? { sourceVersion: args.artifact.sourceVersion } : {}),
    ...(args.artifact.sourceContentHash ? { sourceContentHash: args.artifact.sourceContentHash } : {}),
    ...(args.artifact.sourceHash ? { sourceHash: args.artifact.sourceHash } : {}),
    ...(args.artifact.sourceScriptArtifactId ? { sourceScriptArtifactId: args.artifact.sourceScriptArtifactId } : {}),
    ...(args.artifact.sourceScriptVersion !== undefined ? { sourceScriptVersion: args.artifact.sourceScriptVersion } : {}),
    ...(args.artifact.sourceScriptHash ? { sourceScriptHash: args.artifact.sourceScriptHash } : {}),
    ...(args.artifact.reviewStatus ? { reviewStatus: args.artifact.reviewStatus } : {}),
    ...(args.artifact.skillEvidence ? { skillEvidence: args.artifact.skillEvidence } : {}),
    createdAt: args.artifact.createdAt,
    ...(args.artifact.adoptedAt ? { adoptedAt: args.artifact.adoptedAt } : {}),
    ...(artifactPath ? { projectRelativePath: artifactPath } : {}),
    nomiUri: `nomi://project/${encodeURIComponent(projectId)}/run/${encodeURIComponent(runId)}/artifact/${encodeURIComponent(artifactId)}`,
    ...(preview ? { preview, ...(args.artifact.kind === 'video' && args.artifact.thumbnailRelativePath ? { poster: preview } : {}) } : {}),
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
  // 硬隔离：production run-artifact 校验器只认 'ra' token——asset token 打进来直接拒，绝不穿到 run 产物解析。
  if (claims.k === 'asset') throw new Error('Preview token kind mismatch')
  const nowMs = Number.isFinite(args.nowMs) ? Number(args.nowMs) : Date.now()
  if (claims.exp <= nowMs) throw new Error('Artifact preview token expired')
  const expected = args.expected || {}
  if ((expected.projectId && claims.p !== expected.projectId) || (expected.runId && claims.r !== expected.runId) || (expected.artifactId && claims.a !== expected.artifactId)) {
    throw new Error('Artifact preview token scope mismatch')
  }
  if (expected.relativePath && claims.path !== normalizeRelativePath(expected.relativePath)) throw new Error('Artifact preview token path mismatch')
  return { projectId: claims.p, runId: claims.r, artifactId: claims.a, relativePath: claims.path, expiresAt: new Date(claims.exp).toISOString() }
}

// ── 交付④ · canvas-asset 签名预览（生成结果缩略图给非 Electron 宿主用；复用同一 secret / server / HMAC）────

/**
 * 为一张画布素材（项目相对路径，无 run/artifact）铸一个短 TTL 签名 URL，指向已在跑的 /production-preview 端点。
 * HTTP server 未起（无 origin）→ 返回 null，调用方回退 nomi-local://。路径越界/供应商 URL 在此即拒（不放宽）。
 */
export function mintAssetPreviewUrl(args: {
  projectId: string
  relativePath: string
  secret: string
  nowMs?: number
  ttlMs?: number
}): { url: string; token: string; expiresAt: string } | null {
  if (!previewHttpOrigin) return null
  const projectId = identifier(args.projectId, 'project')
  const safePath = normalizeRelativePath(args.relativePath) // 越界/供应商 URL 在此抛
  const nowMs = Number.isFinite(args.nowMs) ? Number(args.nowMs) : Date.now()
  const ttlMs = Math.min(MAX_TTL_MS, Math.max(1_000, Math.floor(args.ttlMs ?? DEFAULT_TTL_MS)))
  const exp = nowMs + ttlMs
  // asset token：k='asset'，r/a 置空（parseToken 对 asset kind 不校验它们）。
  const token = tokenFor({ v: TOKEN_VERSION, k: 'asset', p: projectId, r: '', a: '', path: safePath, exp }, args.secret)
  return {
    token,
    expiresAt: new Date(exp).toISOString(),
    url: `${previewHttpOrigin}/production-preview?preview=${encodeURIComponent(token)}`,
  }
}

/** 校验 canvas-asset 预览 token（只认 'asset' kind——run-artifact token 打进来拒）。回项目 id + 相对路径。 */
export function verifyAssetPreviewToken(args: {
  token: string
  secret: string
  nowMs?: number
}): { projectId: string; relativePath: string; expiresAt: string } {
  const claims = parseToken(args.token, args.secret)
  if (claims.k !== 'asset') throw new Error('Preview token kind mismatch')
  const nowMs = Number.isFinite(args.nowMs) ? Number(args.nowMs) : Date.now()
  if (claims.exp <= nowMs) throw new Error('Asset preview token expired')
  return { projectId: claims.p, relativePath: claims.path, expiresAt: new Date(claims.exp).toISOString() }
}

/**
 * 校验 asset token 并落到磁盘绝对路径（HTTP server 用）。projectRoot 由注入的 resolver 给（真实是
 * resolveProjectRelativePath 背后的项目目录）。仍走 resolveOwnedArtifactFile 拒越界/符号链接（与 production 同严）。
 */
export function resolveAssetPreviewFile(args: {
  token: string
  secret: string
  projectRootFor: (projectId: string) => string | null
  nowMs?: number
}): { filePath: string; expiresAt: string } {
  const claims = verifyAssetPreviewToken({ token: args.token, secret: args.secret, nowMs: args.nowMs })
  const root = args.projectRootFor(claims.projectId)
  if (!root) throw new Error('Asset preview project root unavailable')
  return { filePath: resolveOwnedArtifactFile(root, claims.relativePath), expiresAt: claims.expiresAt }
}
