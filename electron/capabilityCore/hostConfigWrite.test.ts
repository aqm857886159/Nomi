// 宿主配置唯一写盘门（hostConfigWrite.atomicWrite）的必红测试：#1142 复审阻断 1（锁租约过期两个 Nomi 同写）
// 与阻断 2（比对到换名之间宿主插写、备份复制中宿主写入）。全部在临时目录里，不碰任何真实宿主配置。
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getPath: () => os.tmpdir() } }))

import { HostConfigChangedError, HostConfigLockLostError, atomicWrite } from './hostConfigWrite'

const require = createRequire(import.meta.url)
const tsxCli = require.resolve('tsx/cli')
const hostConfigWriteSource = path.join(process.cwd(), 'electron', 'capabilityCore', 'hostConfigWrite.ts')
const PREMIGRATE = { suffix: '.nomi-backup-premigrate', overwrite: false } as const

let dir = ''
let target = ''
const ORIGINAL = '{"mcpServers":{"nomi":{"command":"old"}},"keep":1}'
const OURS = '{"mcpServers":{"nomi":{"url":"new"}},"keep":1}'
const HOST = '{"mcpServers":{"nomi":{"command":"old"}},"keep":1,"hostWrote":true}'

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-hostwrite-'))
  target = path.join(dir, 'config.json')
  fs.writeFileSync(target, ORIGINAL)
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  fs.rmSync(dir, { recursive: true, force: true })
})

/** 目录里 Nomi 的临时件（成功或失败后都不该留下）。 */
function leftovers(): string[] {
  return fs.readdirSync(dir).filter((name) => /\.nomi-(?:tmp|prev|lock)|\.part\./.test(name))
}

/** 宿主「原地写」：同一个文件对象（我们的硬链接看得见它）。 */
function hostWritesInPlace(content: string): void {
  const fd = fs.openSync(target, 'r+')
  try {
    fs.ftruncateSync(fd, 0)
    fs.writeSync(fd, content, 0, 'utf8')
  } finally {
    fs.closeSync(fd)
  }
}

describe('阻断 2：比对之后、换名之前宿主写入，不会被 Nomi 的旧临时文件盖掉', () => {
  it('宿主在最后一次比对之后、换名之前原地写：Nomi 把它放回去、如实报失败，宿主的字节一个不丢', () => {
    const realRename = fs.renameSync
    vi.spyOn(fs, 'renameSync').mockImplementation(((from: fs.PathLike, to: fs.PathLike) => {
      if (String(to) === target && String(from).includes('.nomi-tmp') && fs.readFileSync(target, 'utf8') === ORIGINAL) hostWritesInPlace(HOST)
      return realRename(from, to)
    }) as typeof fs.renameSync)
    expect(() => atomicWrite(target, () => OURS, { backup: PREMIGRATE })).toThrow(HostConfigChangedError)
    expect(fs.readFileSync(target, 'utf8')).toBe(HOST)
    // 失败不留（也不锁定）一份首份备份：下一次迁移才会备份到宿主改过之后的那一版。
    expect(fs.existsSync(`${target}${PREMIGRATE.suffix}`)).toBe(false)
    expect(fs.readdirSync(dir).filter((n) => n.includes('.nomi-conflict'))).toEqual([])
    expect(leftovers()).toEqual([])
  })

  it('宿主在比对之后用「写临时文件再换名」的方式整份替换（挂链接之前）：同样被发现并放回', () => {
    const realLink = fs.linkSync
    let replaced = false
    vi.spyOn(fs, 'linkSync').mockImplementation(((from: fs.PathLike, to: fs.PathLike) => {
      if (!replaced && String(from) === target && String(to).includes('.nomi-prev')) {
        replaced = true
        const hostTmp = path.join(dir, 'host-tmp.json')
        fs.writeFileSync(hostTmp, HOST)
        fs.renameSync(hostTmp, target)
      }
      return realLink(from, to)
    }) as typeof fs.linkSync)
    expect(() => atomicWrite(target, () => OURS)).toThrow(HostConfigChangedError)
    expect(fs.readFileSync(target, 'utf8')).toBe(HOST)
    expect(leftovers()).toEqual([])
  })

  it('换名之后宿主立刻又写：不动宿主的新内容，如实报失败；Nomi 的内容确实落过盘，首份备份保留', () => {
    const realRename = fs.renameSync
    vi.spyOn(fs, 'renameSync').mockImplementation(((from: fs.PathLike, to: fs.PathLike) => {
      realRename(from, to)
      if (String(to) === target && String(from).includes('.nomi-tmp')) fs.writeFileSync(target, HOST)
    }) as typeof fs.renameSync)
    let error: unknown = null
    try { atomicWrite(target, () => OURS, { backup: PREMIGRATE }) } catch (e) { error = e }
    expect(error).toBeInstanceOf(HostConfigChangedError)
    expect((error as HostConfigChangedError).committed).toBe(true)
    expect(fs.readFileSync(target, 'utf8')).toBe(HOST)
    expect(fs.readFileSync(`${target}${PREMIGRATE.suffix}`, 'utf8')).toBe(ORIGINAL)
  })

  it('原来没有这个文件，宿主恰好同时建了它：排他创建失败，宿主建的那份原样保留', () => {
    fs.rmSync(target)
    const realLink = fs.linkSync
    vi.spyOn(fs, 'linkSync').mockImplementation(((from: fs.PathLike, to: fs.PathLike) => {
      if (String(to) === target) fs.writeFileSync(target, HOST)
      return realLink(from, to)
    }) as typeof fs.linkSync)
    expect(() => atomicWrite(target, () => OURS)).toThrow(HostConfigChangedError)
    expect(fs.readFileSync(target, 'utf8')).toBe(HOST)
    expect(leftovers()).toEqual([])
  })
})

describe('阻断 2 次生：备份从内存里那份原文写出，宿主在「备份中」写入不会留下错的首份备份', () => {
  it('宿主在备份写出的同时改了配置：备份内容就是 Nomi 据以修改的那一版；这次没写成，首份备份撤掉、不锁定', () => {
    const realWrite = fs.writeFileSync
    const backupBytes: string[] = []
    vi.spyOn(fs, 'writeFileSync').mockImplementation(((file: fs.PathOrFileDescriptor, data: string | NodeJS.ArrayBufferView, options?: fs.WriteFileOptions) => {
      realWrite(file, data, options)
      if (String(file).includes(`${PREMIGRATE.suffix}.part`)) {
        backupBytes.push(String(data))
        realWrite(target, HOST) // 宿主此刻写了它自己的改动
      }
    }) as typeof fs.writeFileSync)
    expect(() => atomicWrite(target, () => OURS, { backup: PREMIGRATE })).toThrow(HostConfigChangedError)
    expect(backupBytes).toEqual([ORIGINAL])
    expect(fs.readFileSync(target, 'utf8')).toBe(HOST)
    expect(fs.existsSync(`${target}${PREMIGRATE.suffix}`)).toBe(false)
    vi.restoreAllMocks()
    // 重试：这次首份备份是宿主改过之后、迁移之前的那一版（恢复会回到它，而不是更早的那份）。
    atomicWrite(target, () => OURS, { backup: PREMIGRATE })
    expect(fs.readFileSync(`${target}${PREMIGRATE.suffix}`, 'utf8')).toBe(HOST)
    expect(fs.readFileSync(target, 'utf8')).toBe(OURS)
  })

  it('首份备份已存在（之前真迁移过）：失败时不撤掉别人的那份', () => {
    fs.writeFileSync(`${target}${PREMIGRATE.suffix}`, 'EARLIER')
    vi.spyOn(fs, 'renameSync').mockImplementation(() => { throw Object.assign(new Error('io'), { code: 'EIO' }) })
    expect(() => atomicWrite(target, () => OURS, { backup: PREMIGRATE })).toThrow()
    expect(fs.readFileSync(`${target}${PREMIGRATE.suffix}`, 'utf8')).toBe('EARLIER')
    expect(fs.readFileSync(target, 'utf8')).toBe(ORIGINAL)
  })
})

describe('崩溃残渣', () => {
  it('写它的进程已经死了的临时文件 / 链接 / 备份半成品在下次写时清掉；活进程的、以及 .nomi-conflict 不动', () => {
    const dead = 2_147_483_000
    const deadNames = [`config.json.nomi-tmp.${dead}.0a1b2c3d`, `config.json.nomi-prev.${dead}.0a1b2c3d`, `config.json.nomi-backup-premigrate.part.${dead}.0a1b2c3d`]
    const kept = [`config.json.nomi-tmp.${process.pid}.0a1b2c3d`, `config.json.nomi-conflict.${dead}.0a1b2c3d`]
    for (const name of [...deadNames, ...kept]) fs.writeFileSync(path.join(dir, name), 'x')
    atomicWrite(target, () => OURS)
    for (const name of deadNames) expect(fs.existsSync(path.join(dir, name)), name).toBe(false)
    for (const name of kept) expect(fs.existsSync(path.join(dir, name)), name).toBe(true)
  })
})

/**
 * 两个独立进程跨越租约时长：A 拿锁、读完、写好临时文件后停住（卡在提交之前，模拟杀毒 / 云盘把一步拖过租约）；
 * B 等 A 的租约过期后回收锁、写入并提交；A 醒来时锁已不是自己的 → 必须在换名之前失败，B 的结果原样保留。
 */
const CHILD = `
const fs = require('node:fs')
const path = require('node:path')
const [role, source, target, flags] = process.argv.slice(2)
const { atomicWrite } = require(source)
const flag = (name) => path.join(flags, name)
const pause = new Int32Array(new SharedArrayBuffer(4))
function blockUntil(name) { while (!fs.existsSync(flag(name))) Atomics.wait(pause, 0, 0, 20) }
let result
try {
  if (role === 'A') {
    let paused = false
    atomicWrite(target, () => 'written-by-A', { beforeCommit: () => {
      if (paused) return
      paused = true
      fs.writeFileSync(flag('a-paused'), '1')
      blockUntil('b-done')
    } })
  } else {
    blockUntil('a-paused')
    atomicWrite(target, () => 'written-by-B')
    fs.writeFileSync(flag('b-done'), '1')
  }
  result = 'ok'
} catch (error) {
  result = error && error.constructor ? error.constructor.name : String(error)
}
process.stdout.write(JSON.stringify({ role, result }))
`

function runChild(role: 'A' | 'B', script: string, flags: string): Promise<{ role: string; result: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [tsxCli, script, role, hostConfigWriteSource, target, flags], {
      env: { ...process.env, NOMI_E2E: '', NOMI_SETTINGS_DIR: '', NOMI_HOST_LOCK_LEASE_MS: '1500', NOMI_HOST_LOCK_WAIT_MS: '20000' },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let out = ''
    let err = ''
    child.stdout.on('data', (chunk) => { out += String(chunk) })
    child.stderr.on('data', (chunk) => { err += String(chunk) })
    child.on('error', reject)
    child.on('exit', (code) => {
      try { resolve(JSON.parse(out)) } catch { reject(new Error(`child ${role} exited ${code}: ${out}\n${err}`)) }
    })
  })
}

describe('阻断 1：锁租约过期后，两个独立 Nomi 进程不会同时写同一个宿主文件', () => {
  it('A 卡在提交前超过租约、B 回收锁并写入：A 在换名之前因「锁丢了」失败，文件是 B 的', async () => {
    const flags = path.join(dir, 'flags')
    fs.mkdirSync(flags)
    const script = path.join(dir, 'child.cjs')
    fs.writeFileSync(script, CHILD)
    const [a, b] = await Promise.all([runChild('A', script, flags), runChild('B', script, flags)])
    expect(b).toEqual({ role: 'B', result: 'ok' })
    expect(a).toEqual({ role: 'A', result: HostConfigLockLostError.name })
    expect(fs.readFileSync(target, 'utf8')).toBe('written-by-B')
    expect(fs.readdirSync(dir).filter((n) => /\.nomi-(?:tmp|prev|conflict)/.test(n))).toEqual([])
  }, 60_000)
})

/**
 * 复盘 docs/plan/2026-10-10-mcp-migration-consent-and-leftovers-direction-check.md 的特征测试（V-1142b 发现）：
 * 真 App（Electron 43）里 Cursor 的 mcp.json 设成只读后迁移，换名 EPERM；挂上的 .nomi-prev 硬链接与目标共用只读属性，
 * Electron 里删不掉（D:/v1142b-tmp 下实测留了 6 个 = 1 次 + 5 次共享冲突重试）。系统 Node 22 的 unlink 会无视只读，
 * 所以这里用「换名 EPERM + 删 .nomi-prev 失败」复刻 Electron 里的那两步。
 * it.fails = 「现在确实是坏的」：修好后这条会变红，届时把 it.fails 改回 it。
 */
describe('特征（待修）：失败路径不在宿主目录里留下 .nomi-prev 残留', () => {
  it.fails('换名一直失败、且挂上的链接删不掉时，目录里没有 .nomi-prev.* 残留', () => {
    const eperm = () => Object.assign(new Error('operation not permitted'), { code: 'EPERM' })
    const realRename = fs.renameSync
    const realRm = fs.rmSync
    vi.spyOn(fs, 'renameSync').mockImplementation(((from: fs.PathLike, to: fs.PathLike) => {
      if (String(to) === target && String(from).includes('.nomi-tmp')) throw eperm()
      return realRename(from, to)
    }) as typeof fs.renameSync)
    vi.spyOn(fs, 'rmSync').mockImplementation(((file: fs.PathLike, options?: fs.RmOptions) => {
      if (String(file).includes('.nomi-prev')) throw eperm()
      return realRm(file, options)
    }) as typeof fs.rmSync)
    expect(() => atomicWrite(target, () => OURS)).toThrow()
    vi.restoreAllMocks()
    expect(fs.readFileSync(target, 'utf8')).toBe(ORIGINAL)
    expect(fs.readdirSync(dir).filter((n) => n.includes('.nomi-prev'))).toEqual([])
  })
})
