// Intake Radar —— 仓库外缓存层：原始数据、增量状态、报告全部落在这里，一行都不进仓库。
//
// 目录形状故意和 `D:\tmp\intake-pull.mjs` 已经下载好的那份一模一样（`<cacheDir>/<feedback|
// events|trajectories>/<date>/<uuid>.json`），这样把 NOMI_INTAKE_CACHE 指到那份临时下载
// 上，脚本能直接认出「这些键已经在本地」，不用重下——增量的单一判据仍然是 state.json
// 里的 seenKeys（见下），文件是否已经在磁盘只影响「要不要再打一次网络请求」。

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const STATE_FILE = 'state.json'
const REPORTS_DIR = 'reports'

/** 缓存目录：NOMI_INTAKE_CACHE 优先；没设就按平台给一个合理默认值。
 *  Windows 默认 `%LOCALAPPDATA%\nomi-intake`（任务书钉死的那个）；macOS/Linux 按各自的
 *  标准缓存位置给——主仓库在 macOS 上跑，这条雷达不能只在 Windows 能用。 */
export function resolveCacheDir(env = process.env, platform = process.platform, home = os.homedir()) {
  const override = String(env.NOMI_INTAKE_CACHE || '').trim()
  if (override) return override
  if (platform === 'win32') return path.join(env.LOCALAPPDATA || path.join(home, 'AppData', 'Local'), 'nomi-intake')
  if (platform === 'darwin') return path.join(home, 'Library', 'Caches', 'nomi-intake')
  return path.join(home, '.cache', 'nomi-intake')
}

function statePath(cacheDir) {
  return path.join(cacheDir, STATE_FILE)
}

export function reportsDir(cacheDir) {
  return path.join(cacheDir, REPORTS_DIR)
}

const EMPTY_STATE = () => ({ schemaVersion: 1, seenKeys: {}, lastRunAt: null, lastRunOk: null })

/** 状态文件坏了不该让整条雷达瘫——退回空状态（最多把已经见过的键当新的重报一次，
 *  不会丢数据，只会多看一眼），与 feedback-radar.mjs 的 readState 同一个容错哲学。 */
export function readState(cacheDir) {
  const file = statePath(cacheDir)
  if (!fs.existsSync(file)) return EMPTY_STATE()
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'))
    if (!raw || typeof raw !== 'object' || typeof raw.seenKeys !== 'object') return EMPTY_STATE()
    return { schemaVersion: 1, seenKeys: raw.seenKeys ?? {}, lastRunAt: raw.lastRunAt ?? null, lastRunOk: raw.lastRunOk ?? null }
  } catch {
    return EMPTY_STATE()
  }
}

export function writeState(cacheDir, state) {
  fs.mkdirSync(cacheDir, { recursive: true })
  fs.writeFileSync(statePath(cacheDir), JSON.stringify(state, null, 2) + '\n')
}

/** R2 key（`feedback/2026-09-27/uuid.json`）→ 缓存目录里的本地路径。key 本身就是
 *  用 `/` 分隔的相对路径，split 再 join 是为了在 Windows 上落成 `\` 分隔的真实路径。 */
export function rawFilePath(cacheDir, key) {
  return path.join(cacheDir, ...key.split('/'))
}

export function rawFileExists(cacheDir, key) {
  return fs.existsSync(rawFilePath(cacheDir, key))
}

export function writeRawFile(cacheDir, key, buffer) {
  const file = rawFilePath(cacheDir, key)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, buffer)
}

/** 递归列出某个前缀目录下的全部 .json 文件的 R2 key（不是本地路径）。
 *  自己写而不是用 `fs.readdirSync(dir, {recursive:true})`：后者要求较新的 Node 版本，
 *  这份脚本会被人手动 `node ./scripts/intake-radar.mjs` 跑，不值得为了省几行去赌版本。 */
function walkJsonFiles(dir, baseDir, out) {
  let entries
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return out // 前缀目录还不存在（这种数据这次还一条没有）——不是错误
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      walkJsonFiles(full, baseDir, out)
    } else if (entry.isFile() && entry.name.endsWith('.json')) {
      const key = path.relative(baseDir, full).split(path.sep).join('/')
      out.push(key)
    }
  }
  return out
}

/**
 * 读某个前缀（`feedback/` | `events/` | `trajectories/`）下缓存里现有的全部原始记录。
 * 单个文件解析失败不中断整批——收进 `corrupt`，让调用方决定怎么在报告里说清楚
 * 「这几条本地读不出来」，而不是让一份坏文件拖垮整份报告。
 */
export function listRawRecords(cacheDir, prefix) {
  const dir = path.join(cacheDir, prefix)
  const keys = walkJsonFiles(dir, cacheDir, []).sort()
  const records = []
  const corrupt = []
  for (const key of keys) {
    try {
      const record = JSON.parse(fs.readFileSync(rawFilePath(cacheDir, key), 'utf8'))
      records.push({ key, record })
    } catch (err) {
      corrupt.push({ key, error: err instanceof Error ? err.message : String(err) })
    }
  }
  return { records, corrupt }
}

/**
 * 每轮一份报告，文件名到秒。按天命名时，同一天第二轮会盖掉第一轮：第一轮列出的新反馈，
 * 第二轮已经不算新了，于是报告里写着「新增 0」，那条反馈从此没有人看得到（线上发生过两次）。
 * 同一秒再跑一次就加序号。不用冒号：Windows 文件名不收。
 */
export function writeReport(cacheDir, generatedAt, { markdown, json }) {
  const dir = reportsDir(cacheDir)
  fs.mkdirSync(dir, { recursive: true })
  const stamp = String(generatedAt).replace(/\.\d+Z$/, 'Z').replace(/:/g, '')
  let name = stamp
  for (let copy = 2; fs.existsSync(path.join(dir, `${name}.md`)); copy += 1) name = `${stamp}-${copy}`
  const mdPath = path.join(dir, `${name}.md`)
  const jsonPath = path.join(dir, `${name}.json`)
  fs.writeFileSync(mdPath, markdown)
  fs.writeFileSync(jsonPath, JSON.stringify(json, null, 2) + '\n')
  return { mdPath, jsonPath }
}
