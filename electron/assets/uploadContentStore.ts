import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { isJsonRecord, type JsonRecord } from '../jsonUtils'
import { projectDirById } from '../projects/repository'
import { localAssetUrl, stableAssetId } from './assetPaths'
import { broadcastAssetsUpdated } from './assetEvents'
import { captureAssetWriteContext, type AssetWriteContext } from './assetWriteContext'
import { copyFileWithProgress, type AssetCopyProgress } from './assetImportProgress'
import { retryOnSharingViolation } from '../jsonFile'
import { reapAbandonedUploadStaging, removeScratchAfterUse, UPLOAD_STAGING_PREFIX } from './scratchCleanup'

export function isContentAddressedUpload(meta: unknown): boolean {
  return isJsonRecord(meta) && ['upload', 'imported', 'local'].includes(String(meta.kind || '').toLowerCase())
}

export async function contentHashForFile(filePath: string): Promise<string> {
  const hash = crypto.createHash('sha256')
  for await (const chunk of fs.createReadStream(filePath)) hash.update(chunk as Buffer)
  return hash.digest('hex')
}

export function storedAssetRecord(projectId: string, absolutePath: string, fileName: string, contentType: string, meta: JsonRecord, contentHash: string, context?: AssetWriteContext) {
  // DTO construction is after commit; authorization belongs before publication/reuse.
  const projectDir = context?.root ?? projectDirById(projectId)
  if (!projectDir) throw new Error('Project not found')
  const relativePath = path.relative(projectDir, absolutePath).replace(/\\/g, '/')
  const stat = fs.statSync(absolutePath)
  return {
    id: stableAssetId(projectId, relativePath), name: fileName, userId: 'local' as const, projectId,
    createdAt: new Date(stat.birthtimeMs || stat.mtimeMs).toISOString(), updatedAt: new Date(stat.mtimeMs).toISOString(),
    data: { ...meta, url: localAssetUrl(projectId, relativePath), relativePath, absolutePath, contentType, size: stat.size, contentHash },
  }
}

// Publication is synchronous after native copying/hashing finishes. Byte and native callers
// therefore cannot observe an incomplete file or choose separate identities in the main process.
function publish(context: AssetWriteContext, fileName: string, contentType: string, meta: JsonRecord, hash: string, write: (target: string) => void) {
  context.assertCurrent()
  const { projectId, root: projectDir } = context
  const directory = path.join(projectDir, 'assets', 'imported', 'sha256', hash)
  fs.mkdirSync(directory, { recursive: true })
  const parsed = path.parse(path.basename(fileName))
  let target = path.join(directory, path.basename(fileName))
  for (let index = 2; fs.existsSync(target) || fs.existsSync(`${target}.meta`); index += 1) {
    target = path.join(directory, `${parsed.name}-${index}${parsed.ext}`)
  }
  const storedMeta = { ...meta, contentHash: hash, contentType }
  fs.writeFileSync(`${target}.meta`, JSON.stringify(storedMeta), { flag: 'wx' })
  try {
    write(target)
  } catch (error) {
    fs.rmSync(`${target}.meta`, { force: true })
    throw error
  }
  broadcastAssetsUpdated(projectId)
  return storedAssetRecord(projectId, target, path.basename(target), contentType, storedMeta, hash, context)

}

async function findStoredUpload(context: AssetWriteContext, size: number, hash: string) {
  const projectDir = context.root
  const walk = async (directory: string): Promise<string | null> => {
    let entries: fs.Dirent[]
    try { entries = await fs.promises.readdir(directory, { withFileTypes: true }) }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error }
    for (const entry of entries) {
      if (entry.name.endsWith('.meta')) continue
      const absolutePath = path.join(directory, entry.name)
      if (entry.isDirectory()) { const found = await walk(absolutePath); if (found) return found; continue }
      if (!entry.isFile()) continue
      const stat = await fs.promises.stat(absolutePath)
      if (stat.size !== size) continue
      let meta: unknown
      try { meta = JSON.parse(await fs.promises.readFile(`${absolutePath}.meta`, 'utf8')) }
      catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT' || error instanceof SyntaxError) continue; throw error }
      if (!isJsonRecord(meta) || !isContentAddressedUpload(meta)) continue
      const cached = meta.contentHashSize === stat.size && meta.contentHashMtime === stat.mtimeMs && meta.contentHashCtime === stat.ctimeMs && typeof meta.contentHash === 'string'
      const candidateHash = cached ? String(meta.contentHash) : await contentHashForFile(absolutePath)
      const afterHash = await fs.promises.stat(absolutePath)
      if (afterHash.size !== stat.size || afterHash.mtimeMs !== stat.mtimeMs || afterHash.ctimeMs !== stat.ctimeMs) continue
      if (!cached) {
        context.assertCurrent()
        const temporaryMeta = `${absolutePath}.${crypto.randomUUID()}.meta`
        try {
          fs.writeFileSync(temporaryMeta, JSON.stringify({ ...meta, contentHash: candidateHash, contentHashSize: stat.size, contentHashMtime: stat.mtimeMs, contentHashCtime: stat.ctimeMs }))
          fs.renameSync(temporaryMeta, `${absolutePath}.meta`)
        } catch {
          // A hash cache is optional; a read-only/low-space sidecar must not
          // reject valid media. Identity/cancellation checks stay outside.
        } finally { try { fs.rmSync(temporaryMeta, { force: true }) } catch { /* optional cache cleanup */ } }
      }
      if (candidateHash === hash) return absolutePath
    }
    return null
  }
  return walk(path.join(projectDir, 'assets', 'imported'))
}

async function reuseStoredUpload(context: AssetWriteContext, size: number, hash: string, contentType: string) {
  const found = await findStoredUpload(context, size, hash)
  if (!found) return null
  const meta: unknown = JSON.parse(await fs.promises.readFile(`${found}.meta`, 'utf8'))
  if (!isJsonRecord(meta) || !isContentAddressedUpload(meta)) return null
  context.assertCurrent()
  return storedAssetRecord(context.projectId, found, path.basename(found), contentType, meta, hash, context)
}

type StoredAsset = ReturnType<typeof storedAssetRecord>
const pendingUploads = new Map<string, Promise<StoredAsset>>()
function withUploadIdentity(context: AssetWriteContext, hash: string, persist: () => Promise<StoredAsset>): Promise<StoredAsset> {
  const key = `${context.root}:${context.binding.immutableProjectUuid}:${context.binding.projectGeneration}:${hash}`
  const pending = pendingUploads.get(key)
  // Serialize publication, never share a previous caller's authorization/result.
  const result = (pending ? pending.catch(() => undefined) : Promise.resolve()).then(() => {
    context.assertCurrent()
    return persist()
  }).finally(() => { if (pendingUploads.get(key) === result) pendingUploads.delete(key) })
  pendingUploads.set(key, result)
  return result
}

export async function persistUploadBytes(projectId: string, bytes: Buffer, fileName: string, contentType: string, meta: JsonRecord, captured?: AssetWriteContext) {
  const context = captured ?? await captureAssetWriteContext(projectId)
  context.assertCurrent()
  const hash = crypto.createHash('sha256').update(bytes).digest('hex')
  return withUploadIdentity(context, hash, async () => {
    const legacy = await reuseStoredUpload(context, bytes.byteLength, hash, contentType)
    return legacy ?? publish(context, fileName, contentType, meta, hash, target => fs.writeFileSync(target, bytes, { flag: 'wx' }))
  })
}

export async function persistUploadFile(
  projectId: string,
  source: string,
  fileName: string,
  contentType: string,
  meta: JsonRecord,
  captured?: AssetWriteContext,
  onCopyProgress?: AssetCopyProgress,
) {
  const context = captured ?? await captureAssetWriteContext(projectId)
  context.assertCurrent()
  reapAbandonedUploadStaging(context.root)
  const staging = fs.mkdtempSync(path.join(context.root, UPLOAD_STAGING_PREFIX))
  const snapshot = path.join(staging, 'content')
  try {
    await copyFileWithProgress(source, snapshot, onCopyProgress)
    const hash = await contentHashForFile(snapshot)
    const stat = await fs.promises.stat(snapshot)
    return await withUploadIdentity(context, hash, async () => {
      const legacy = await reuseStoredUpload(context, stat.size, hash, contentType)
      return legacy ?? publish(context, fileName, contentType, meta, hash, target => {
        retryOnSharingViolation(() => fs.linkSync(snapshot, target))
        // 立刻摘掉暂存里那个名字（链接数变化会改 ctime，拖到后面删会让并发的同内容导入认不出这份）。
        // 摘不掉不抛：正式文件已经链接好了，抛出去只会让 publish 撤掉 .meta、留下一份没人认领的素材；
        // 暂存目录在 finally 里还会再删一次。
        try { fs.unlinkSync(snapshot) } catch { /* 交给暂存目录清理 */ }
      })
    })
  } finally {
    await removeScratchAfterUse(staging)
  }
}
