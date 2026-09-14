import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { isJsonRecord, type JsonRecord } from '../jsonUtils'
import { projectDirById } from '../projects/repository'
import { localAssetUrl, stableAssetId } from './assetPaths'
import { broadcastAssetsUpdated } from './assetEvents'
import { copyFileWithProgress, type AssetCopyProgress } from './assetImportProgress'

export function isContentAddressedUpload(meta: unknown): boolean {
  return isJsonRecord(meta) && ['upload', 'imported', 'local'].includes(String(meta.kind || '').toLowerCase())
}

export async function contentHashForFile(filePath: string): Promise<string> {
  const hash = crypto.createHash('sha256')
  for await (const chunk of fs.createReadStream(filePath)) hash.update(chunk as Buffer)
  return hash.digest('hex')
}

export function storedAssetRecord(projectId: string, absolutePath: string, fileName: string, contentType: string, meta: JsonRecord, contentHash: string) {
  const projectDir = projectDirById(projectId)
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
function publish(projectId: string, fileName: string, contentType: string, meta: JsonRecord, hash: string, write: (target: string) => void) {
  const projectDir = projectDirById(projectId)
  if (!projectDir) throw new Error('Project not found')
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
  return storedAssetRecord(projectId, target, path.basename(target), contentType, storedMeta, hash)

}

async function findStoredUpload(projectId: string, size: number, hash: string) {
  const projectDir = projectDirById(projectId)
  if (!projectDir) throw new Error('Project not found')
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
        const temporaryMeta = `${absolutePath}.${crypto.randomUUID()}.meta`
        try {
          await fs.promises.writeFile(temporaryMeta, JSON.stringify({ ...meta, contentHash: candidateHash, contentHashSize: stat.size, contentHashMtime: stat.mtimeMs, contentHashCtime: stat.ctimeMs }))
          await fs.promises.rename(temporaryMeta, `${absolutePath}.meta`)
        } finally { await fs.promises.rm(temporaryMeta, { force: true }) }
      }
      if (candidateHash === hash) return absolutePath
    }
    return null
  }
  return walk(path.join(projectDir, 'assets', 'imported'))
}

async function reuseStoredUpload(projectId: string, size: number, hash: string, contentType: string) {
  const found = await findStoredUpload(projectId, size, hash)
  if (!found) return null
  const meta: unknown = JSON.parse(await fs.promises.readFile(`${found}.meta`, 'utf8'))
  if (!isJsonRecord(meta) || !isContentAddressedUpload(meta)) return null
  return storedAssetRecord(projectId, found, path.basename(found), contentType, meta, hash)
}

type StoredAsset = ReturnType<typeof storedAssetRecord>
const pendingUploads = new Map<string, Promise<StoredAsset>>()
function withUploadIdentity(projectId: string, hash: string, persist: () => Promise<StoredAsset>): Promise<StoredAsset> {
  const key = `${projectDirById(projectId)}:${hash}`
  const pending = pendingUploads.get(key)
  if (pending) return pending
  const result = persist().finally(() => { pendingUploads.delete(key) })
  pendingUploads.set(key, result)
  return result
}

export async function persistUploadBytes(projectId: string, bytes: Buffer, fileName: string, contentType: string, meta: JsonRecord) {
  const hash = crypto.createHash('sha256').update(bytes).digest('hex')
  return withUploadIdentity(projectId, hash, async () => {
    const legacy = await reuseStoredUpload(projectId, bytes.byteLength, hash, contentType)
    return legacy ?? publish(projectId, fileName, contentType, meta, hash, target => fs.writeFileSync(target, bytes, { flag: 'wx' }))
  })
}

export async function persistUploadFile(projectId: string, source: string, fileName: string, contentType: string, meta: JsonRecord, onCopyProgress?: AssetCopyProgress) {
  const projectDir = projectDirById(projectId)
  if (!projectDir) throw new Error('Project not found')
  await fs.promises.mkdir(projectDir, { recursive: true })
  const staging = await fs.promises.mkdtemp(path.join(projectDir, '.nomi-upload-'))
  const snapshot = path.join(staging, 'content')
  try {
    await copyFileWithProgress(source, snapshot, onCopyProgress)
    const hash = await contentHashForFile(snapshot)
    const stat = await fs.promises.stat(snapshot)
    return await withUploadIdentity(projectId, hash, async () => {
      const legacy = await reuseStoredUpload(projectId, stat.size, hash, contentType)
      return legacy ?? publish(projectId, fileName, contentType, meta, hash, target => { fs.linkSync(snapshot, target); fs.unlinkSync(snapshot) })
    })
  } finally {
    await fs.promises.rm(staging, { recursive: true, force: true })
  }
}
