#!/usr/bin/env node
// 唯一的发布比例写入边界。公开变更必须显式 --yes；默认只读计划。
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { parseArgs } from 'node:util'
import { fileURLToPath } from 'node:url'
import yaml from 'js-yaml'
import { makeTempDir } from './_test-temp.mjs'
import { execGhReadSync, execGhWriteSync, retryTransientSync } from './lib/transientRetry.mjs'

export const METADATA = ['latest.yml', 'latest-mac.yml']
export function percentage(value) {
  if (!/^(?:[1-9]\d?|100)$/.test(String(value ?? ''))) throw new Error('首批比例必须显式提供 1–100 的整数')
  return Number(value)
}
function document(text, version) {
  const doc = yaml.load(text)
  if (!doc || typeof doc !== 'object' || Array.isArray(doc) || doc.version !== version || !Array.isArray(doc.files) || !doc.files.length) throw new Error('更新元数据必须是目标版本的 mapping，且含 files')
  return doc
}
export function rewriteMetadata(text, value, version) {
  const doc = document(text, version)
  doc.stagingPercentage = percentage(value)
  return yaml.dump(doc, { lineWidth: -1, noRefs: true })
}
const sha256 = text => crypto.createHash('sha256').update(text).digest('hex')
export function planMetadata(files, value, version) {
  const next = {}
  const changes = []
  for (const name of METADATA) {
    if (typeof files[name] !== 'string') throw new Error(`缺少 ${name}`)
    const old = document(files[name], version)
    next[name] = rewriteMetadata(files[name], value, version)
    changes.push({ name, before: old.stagingPercentage ?? '未设置', after: percentage(value) })
  }
  if (typeof files['SHA256SUMS.txt'] !== 'string') throw new Error('缺少 SHA256SUMS.txt')
  // 只替换元数据两行；安装包哈希原样保留，并先核对下载的旧元数据。
  let sums = files['SHA256SUMS.txt']
  for (const name of METADATA) {
    const lines = sums.split('\n').filter(line => line.endsWith(`  ${name}`))
    if (lines.length !== 1 || lines[0] !== `${sha256(files[name])}  ${name}`) throw new Error(`${name} 原校验和不匹配`)
    sums = sums.replace(lines[0], `${sha256(next[name])}  ${name}`)
  }
  next['SHA256SUMS.txt'] = sums
  return { files: next, changes: [...changes, { name: 'SHA256SUMS.txt', before: sha256(files['SHA256SUMS.txt']), after: sha256(sums) }] }
}
function readFiles(dir) {
  return Object.fromEntries([...METADATA, 'SHA256SUMS.txt'].map(name => [name, fs.readFileSync(path.join(dir, name), 'utf8')]))
}
export function planPause(release, previous, files) {
  if (release.draft || release.prerelease) throw new Error('暂停只接受公开稳定发布')
  const ver = tag => tag.match(/^v(\d+)\.(\d+)\.(\d+)$/)?.slice(1).map(Number)
  const a = ver(release.tag_name), b = ver(previous?.tag_name ?? '')
  const lower = a && b && a.some((n, i) => n > b[i] && a.slice(0, i).every((v, j) => v === b[j]))
  if (!previous || previous.draft || previous.prerelease || !lower) throw new Error('暂停前必须有更低版本的公开稳定发布')
  for (const name of METADATA) document(files[name], release.tag_name.slice(1))
  return { prerelease: true, previous: previous.tag_name, files, changes: [{ name: release.tag_name, before: 'stable', after: 'prerelease（官网 latest 也回到上一稳定版）' }] }
}

function ghCommand(args) {
  const options = { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 30000 }
  if (args[0] === 'api') return execGhReadSync(args, options)
  if (args[0] === 'release' && args[1] === 'download') return retryTransientSync(() => execFileSync('gh', args, options), { retryTimeouts: true, timeoutMs: options.timeout })
  return execGhWriteSync(args, options) // 公开写入只能试一次，不能自动重试
}
export function runRollout(argv, { gh = ghCommand, log = console.log } = {}) {
  const { values, positionals } = parseArgs({ args: argv, allowPositionals: true, options: {
    dir: { type: 'string' }, percentage: { type: 'string' }, tag: { type: 'string' },
    repo: { type: 'string', default: 'aqm857886159/Nomi' }, yes: { type: 'boolean', default: false },
  } })
  const action = positionals[0]
  if (positionals.length !== 1 || !['prepare', 'full', 'pause'].includes(action)) throw new Error('用法：prepare --dir DIR --percentage N [--yes] | full/pause --tag vX.Y.Z [--yes]')
  const { repo, tag } = values
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new Error('非法 repo')
  if (action === 'prepare') {
    percentage(values.percentage)
    if (!values.dir || !/^v\d+\.\d+\.\d+$/.test(tag ?? '')) throw new Error('prepare 需要 --dir 和 --tag')
    const plan = planMetadata(readFiles(values.dir), values.percentage, tag.slice(1))
    log(JSON.stringify({ action, dir: values.dir, changes: plan.changes, apply: values.yes }, null, 2))
    if (values.yes) for (const [name, text] of Object.entries(plan.files)) fs.writeFileSync(path.join(values.dir, name), text)
    return plan
  }
  if (values.dir || values.percentage || !/^v\d+\.\d+\.\d+$/.test(tag ?? '')) throw new Error('full/pause 只接受 --tag、--repo、--yes')
  const api = (suffix, filter) => JSON.parse(gh(['api', `repos/${repo}/${suffix}`, ...(filter ? ['--jq', filter] : [])]))
  const release = api(`releases/tags/${tag}`)
  if (release.tag_name !== tag || release.draft || release.prerelease) throw new Error('目标必须是公开稳定发布')
  if (api('releases/latest').id !== release.id) throw new Error('只能操作当前 latest 稳定发布')
  if (action === 'full' && (release.immutable !== false || api('immutable-releases').enabled !== false)) throw new Error('资产不可变或状态未知：停止，交协调选择新版本/独立 feed')
  const temp = makeTempDir('nomi-release-rollout-')
  try {
    const names = action === 'full' ? [...METADATA, 'SHA256SUMS.txt'] : METADATA
    const download = ['release', 'download', tag, '--repo', repo, '--dir', temp, '--clobber']
    for (const name of names) download.push('--pattern', name)
    gh(download)
    const files = Object.fromEntries(names.map(name => [name, fs.readFileSync(path.join(temp, name), 'utf8')]))
    const releases = action === 'pause' ? api('releases?per_page=100', '[.[] | {id,tag_name,draft,prerelease}]') : []
    const previous = releases.find(r => r.id !== release.id && !r.draft && !r.prerelease)
    const plan = action === 'pause' ? planPause(release, previous, files) : planMetadata(files, 100, tag.slice(1))
    log(JSON.stringify({ action, repo, tag, changes: plan.changes, previous: plan.previous, apply: values.yes }, null, 2))
    if (!values.yes) return plan
    // 防止计划与写入之间已有其他人暂停或发布；资产逐个替换不是事务，失败必须红退。
    const current = api(`releases/tags/${tag}`)
    if (current.updated_at !== release.updated_at || current.prerelease || current.immutable !== release.immutable || api('releases/latest').id !== release.id) throw new Error('Release 状态已变化，请重新计划')
    if (action === 'pause') {
      gh(['release', 'edit', tag, '--repo', repo, '--prerelease', '--latest=false'])
      if (api(`releases/tags/${tag}`).prerelease !== true || api('releases/latest').id === release.id) throw new Error('暂停读回失败')
    } else {
      for (const [name, text] of Object.entries(plan.files)) fs.writeFileSync(path.join(temp, name), text)
      gh(['release', 'upload', tag, ...Object.keys(plan.files).map(name => path.join(temp, name)), '--repo', repo, '--clobber'])
      const verify = path.join(temp, 'verify')
      fs.mkdirSync(verify)
      const args = ['release', 'download', tag, '--repo', repo, '--dir', verify, '--clobber']
      for (const name of names) args.push('--pattern', name)
      gh(args)
      for (const name of names) if (fs.readFileSync(path.join(verify, name), 'utf8') !== plan.files[name]) throw new Error(`${name} 上传读回不符：停止放量，交协调处理`)
    }
    return plan
  } finally {
    fs.rmSync(temp, { recursive: true, force: true })
  }
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try { runRollout(process.argv.slice(2)) } catch (error) { console.error(error.message); process.exitCode = 1 }
}
