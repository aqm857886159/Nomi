#!/usr/bin/env node
// git commit-msg 调用：fix 提交碰了「反复修的热点」（见 scripts/fix-churn.mjs）时，必须带
// `Direction-Check: <复盘文档路径>`，且那份文档真实存在、不是空壳。Claude、Codex、人都会经过 git，所以执行点放这里。
// 按内容判，不看任何环境变量（没有「设个变量就跳过」的口子）。
// 放行：非 fix 提交（merge / revert 的标题本来就不是 fix，回滚不该被拦）；碰的不是 src/ electron/ 的源码；没命中热点。
// 判不了（git 报错）一律放行——这道门拦的是方向，不是 git 故障。
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { gitPaths } from './lib/gitPaths.mjs'
import { directionMessage, findHotspots, isFixSubject, parseDirectionTrailer, stagedNamespaces, TRAILER_KEY } from './fix-churn.mjs'

const MIN_DOC_BYTES = 400

export function subjectOf(message) {
  return String(message || '').split(/\r?\n/).find((l) => l.trim() && !l.startsWith('#'))?.trim() || ''
}

/** 纯决策：{ ok, reason? }。deps.stagedFiles / deps.hotspots / deps.docOk 可注入，便于测试。 */
export function decideDirectionTrailer(message, deps) {
  const subject = subjectOf(message)
  if (!isFixSubject(subject)) return { ok: true, skipped: 'not-fix' }
  const hits = deps.hotspots(deps.stagedFiles())
  if (!hits.length) return { ok: true, skipped: 'not-hot' }
  const trailer = parseDirectionTrailer(message)
  if (!trailer) return { ok: false, hits, reason: `缺 ${TRAILER_KEY} trailer` }
  if (!deps.docOk(trailer)) return { ok: false, hits, reason: `${TRAILER_KEY} 指向的文档不存在、不在 docs/ 下、或内容不足 ${MIN_DOC_BYTES} 字节：${trailer}` }
  // 自写通用能力连修第 2 次：复盘里必须点名那条登记（id），不能拿一份无关的复盘文档糊弄
  const ids = hits.filter((h) => h.unit?.kind === 'self-written').map((h) => h.unit.id)
  const missing = deps.docMentions ? ids.filter((id) => !deps.docMentions(trailer, id)) : []
  if (missing.length) return { ok: false, hits, reason: `${TRAILER_KEY} 指向的复盘文档没有写到这些自写登记条目（id）：${missing.join('、')}——要写清为什么现在换不了现成方案、哪天换` }
  return { ok: true, trailer }
}

export function docMentions(root, rel, id) {
  try { return fs.readFileSync(path.join(root, String(rel).split('\\').join('/')), 'utf8').includes(id) } catch { return false }
}

export function docLooksReal(root, rel) {
  const r = String(rel).split('\\').join('/')
  if (path.isAbsolute(r) || r.split('/').includes('..') || !r.startsWith('docs/') || !r.endsWith('.md')) return false
  try { return fs.statSync(path.join(root, r)).size >= MIN_DOC_BYTES } catch { return false }
}

function main() {
  const msgFile = process.argv[2]
  if (!msgFile || !fs.existsSync(msgFile)) return 0
  const message = fs.readFileSync(msgFile, 'utf8')
  let root
  try { root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim() } catch { return 0 }
  const result = decideDirectionTrailer(message, {
    stagedFiles: () => {
      try { return gitPaths(['diff', '--cached', '--name-only', '--no-renames'], { cwd: root }) } catch { return [] }
    },
    hotspots: (files) => findHotspots(root, files, { touched: stagedNamespaces(root, files) }),
    docOk: (rel) => docLooksReal(root, rel),
    docMentions: (rel, id) => docMentions(root, rel, id),
  })
  if (result.ok) return 0
  console.error(`\n${directionMessage(result.hits)}\n\n拦下原因：${result.reason}\n`)
  return 1
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.exit(main()) } catch { process.exit(0) }
}
