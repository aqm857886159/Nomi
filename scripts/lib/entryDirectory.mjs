// 「一条一个文件」的账本目录的读写（2026-10-07）。逃逸账本与概念登记共用这一份，不各写一份。
//
// 为什么拆成一条一个文件：两本账本原来都是一个大 JSON 数组，几乎每个修复 PR 都往数组末尾追加一条，
// 两个 PR 同时在途时先合的那个必然让另一个在 GitHub 上变成 CONFLICTING（追加永远落在同一处）。
// 记录的身份（id / subject）落到文件名上以后，新增 = 新文件，git 不会冲突；改同一条才冲突，那是真冲突。
//
// 目录形状：`<dir>/_meta.json` 放账本顶层字段（schema、分类表……），其余每个 `*.json` 是一条记录。
// 本模块只管「读出来 / 写一条」；文件名 ↔ 身份的规则、排序、字段判据都在各自账本的库里
// （scripts/escape-ledger-lib.mjs、scripts/concept-registry-lib.mjs）。
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

import { gitPaths } from './gitPaths.mjs'

export const META_FILE = '_meta.json'

/** 一条记录的落盘写法：两格缩进 + 结尾换行。账本写入只走这一处，免得两种写法互相改来改去。 */
export function formatEntryJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`
}

/** 工作树里还留着拆分前的大文件 → 抛错（两本账本共用这一条）。 */
export function refuseRetiredFile(repoRoot, rel) {
  if (fs.existsSync(path.join(repoRoot, rel))) {
    throw new Error(`${rel} 已拆成一条一个文件的目录，这个旧大文件不该还在——多半是合 main 时留下了它，里面新加的条目不会进账；按拆分 PR 正文里「在途 PR 怎么跟」的补搬命令搬进目录后删掉它`)
  }
}

function parse(label, text) {
  try {
    return JSON.parse(text)
  } catch (error) {
    throw new Error(`${label} 不是合法 JSON：${error instanceof Error ? error.message : String(error)}`)
  }
}

function assemble(label, names, readText) {
  if (!names.includes(META_FILE)) throw new Error(`${label}/${META_FILE} 不存在（账本顶层字段住在这里）`)
  const meta = parse(`${label}/${META_FILE}`, readText(META_FILE))
  const entries = names
    .filter((name) => name !== META_FILE && name.endsWith('.json'))
    .sort()
    .map((name) => ({ name, value: parse(`${label}/${name}`, readText(name)) }))
  return { meta, entries }
}

/**
 * 工作树里的账本目录 → `{ meta, entries: [{ name, value }] }`；目录不存在 → null。
 * 任一文件不是合法 JSON → 抛错并点名文件（门岗读到坏账本必须红，不能当空账本放行）。
 */
export function readEntryDirectory(absDir) {
  if (!fs.existsSync(absDir)) return null
  const names = fs.readdirSync(absDir, { withFileTypes: true }).filter((entry) => entry.isFile()).map((entry) => entry.name)
  return assemble(absDir, names, (name) => fs.readFileSync(path.join(absDir, name), 'utf8'))
}

/** 解析 `git cat-file --batch` 的输出：`<sha> <type> <size>\n<内容>\n`，缺失的是 `<spec> missing\n`。 */
export function parseCatFileBatch(buffer, specs) {
  const out = new Map()
  let offset = 0
  for (const spec of specs) {
    const newline = buffer.indexOf(0x0a, offset)
    if (newline === -1) break
    const header = buffer.subarray(offset, newline).toString('utf8')
    offset = newline + 1
    if (header.endsWith(' missing')) {
      out.set(spec, null)
      continue
    }
    const size = Number(header.split(' ')[2])
    out.set(spec, buffer.subarray(offset, offset + size).toString('utf8'))
    offset += size + 1
  }
  return out
}

/**
 * 某个提交上的账本目录（relDir 相对仓库根，正斜杠）→ 同上形状；该提交上没有这个目录 → null。
 * 路径表一次 `ls-tree`，内容一次 `cat-file --batch`（一个进程读完整个目录）。
 */
export function readEntryDirectoryAtRef(repoRoot, ref, relDir) {
  const dir = relDir.replace(/\/+$/, '')
  const verify = spawnSync('git', ['rev-parse', '--verify', `${ref}^{commit}`], { cwd: repoRoot, encoding: 'utf8' })
  if (verify.status !== 0) throw new Error(`读不到提交 ${ref}：${String(verify.stderr).trim()}`)
  const commit = verify.stdout.trim()
  const paths = gitPaths(['ls-tree', '--name-only', commit, '--', `${dir}/`], { cwd: repoRoot })
  if (paths.length === 0) return null
  const names = paths.map((file) => file.slice(dir.length + 1)).filter((name) => name && !name.includes('/'))
  const specs = names.map((name) => `${commit}:${dir}/${name}`)
  const result = spawnSync('git', ['cat-file', '--batch'], { cwd: repoRoot, input: `${specs.join('\n')}\n`, maxBuffer: 256 * 1024 * 1024 })
  if (result.status !== 0) throw new Error(`git cat-file 失败：${String(result.stderr)}`)
  const texts = parseCatFileBatch(result.stdout, specs)
  return assemble(`${ref}:${dir}`, names, (name) => texts.get(`${commit}:${dir}/${name}`) ?? '')
}
