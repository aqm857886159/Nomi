// 脚本与测试侧的唯一原子写入口：先在同目录写满暂存件，再原子改名公布。
//
// 为什么在 atomically@2.1.1 外面再包一层：
//   · 异步路径传 Readable 给 atomically.writeFile，走 Node WriteStream 的 writeAll 循环保证整包写满，
//     并复用它的同目录暂存、重试改名与失败清理；
//   · atomically@2.1.1 的同步 writeFileSync 只调一次 fs.writeSync 且丢弃返回字节数，磁盘满 / 配额短写时会把半包改名公布。
//     这里同步路径自己循环 writeSync 写满全部字节并核对 fstatSync 字节数，短写立刻抛 ESHORTWRITE 并同步清理暂存件，绝不改名。
import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { Readable } from 'node:stream'
import { writeFile as atomicallyWriteFile } from 'atomically'

const WINDOWS_RETRYABLE_RENAME_CODES = new Set(['EBUSY', 'EPERM', 'EACCES'])
const WINDOWS_RENAME_RETRY_MS = 500

function toBuffer(content, encoding = 'utf8') {
  if (Buffer.isBuffer(content)) return content
  if (ArrayBuffer.isView(content)) return Buffer.from(content.buffer, content.byteOffset, content.byteLength)
  if (typeof content === 'string') return Buffer.from(content, encoding)
  throw new TypeError('writeFileAtomic expects a string, Buffer, or Uint8Array')
}

function normalizeOptions(options) {
  if (typeof options === 'string') return { encoding: options }
  return options ?? {}
}

export function defaultAtomicTempPath(file) {
  return path.join(path.dirname(file), `.${path.basename(file)}.p${process.pid}-${randomUUID()}.tmp`)
}

function createShortWriteError(tempPath, written, expected) {
  const error = new Error(`Short write to ${tempPath}: wrote ${written} of ${expected} bytes`)
  error.code = 'ESHORTWRITE'
  error.bytesWritten = written
  error.expectedBytes = expected
  return error
}

function writeAllSync(fd, bytes, tempPath) {
  let offset = 0
  while (offset < bytes.length) {
    const written = fs.writeSync(fd, bytes, offset, bytes.length - offset)
    if (!Number.isInteger(written) || written <= 0 || written > bytes.length - offset) {
      throw createShortWriteError(tempPath, offset, bytes.length)
    }
    offset += written
  }
  const stat = fs.fstatSync(fd)
  if (stat.size !== bytes.length) {
    throw createShortWriteError(tempPath, stat.size, bytes.length)
  }
}

function renameSyncAtomic(source, target) {
  const deadline = process.platform === 'win32' ? Date.now() + WINDOWS_RENAME_RETRY_MS : 0
  for (;;) {
    try {
      fs.renameSync(source, target)
      return
    } catch (error) {
      if (process.platform === 'win32' && WINDOWS_RETRYABLE_RENAME_CODES.has(error?.code) && Date.now() < deadline) {
        continue
      }
      throw error
    }
  }
}

/**
 * 同步原子写：确保全部字节完整写入同目录暂存件（可选 fsync）后再 rename 公布。
 * 短写或任意失败都立刻抛错并同步删除暂存件，绝不公布截断文件。
 */
export function writeFileAtomicSync(target, content, options = {}) {
  const { encoding = 'utf8', mode, fsync = true, tmpCreate = defaultAtomicTempPath } = normalizeOptions(options)
  const bytes = toBuffer(content, encoding)
  let resolved = target
  let existingMode
  try {
    resolved = fs.realpathSync(target)
    if (mode === undefined) existingMode = fs.statSync(resolved).mode & 0o777
  } catch {
    /* target does not exist yet */
  }
  fs.mkdirSync(path.dirname(resolved), { recursive: true })
  let tempPath = tmpCreate(resolved)
  let fd = null
  try {
    const targetMode = mode ?? existingMode
    fd = fs.openSync(tempPath, 'wx', targetMode ?? 0o666)
    writeAllSync(fd, bytes, tempPath)
    if (fsync !== false) fs.fsyncSync(fd)
    fs.closeSync(fd)
    fd = null
    if (targetMode !== undefined) {
      try {
        fs.chmodSync(tempPath, targetMode)
      } catch {
        /* best-effort permission preservation */
      }
    }
    renameSyncAtomic(tempPath, resolved)
    tempPath = null
  } finally {
    if (fd !== null) {
      try {
        fs.closeSync(fd)
      } catch {
        /* ignore close errors while unwinding */
      }
    }
    if (tempPath !== null) {
      try {
        fs.unlinkSync(tempPath)
      } catch {
        /* ignore cleanup errors while unwinding */
      }
    }
  }
}

/**
 * 异步原子写：把缓冲区包装为 Readable 交给 atomically.writeFile，
 * 利用 Node WriteStream.writeAll 写满全部字节后再原子改名。
 */
export async function writeFileAtomic(target, content, options = {}) {
  const { encoding = 'utf8', mode, fsync = true, tmpCreate = defaultAtomicTempPath, timeout } = normalizeOptions(options)
  const bytes = toBuffer(content, encoding)
  const stream = bytes.length > 0 ? Readable.from([bytes]) : Readable.from([])
  await atomicallyWriteFile(target, stream, {
    ...(mode !== undefined ? { mode } : {}),
    ...(timeout !== undefined ? { timeout } : {}),
    fsync,
    tmpCreate,
  })
}
