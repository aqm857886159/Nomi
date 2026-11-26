import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { isDeepStrictEqual } from 'node:util'
import { REPO_ROOT } from './board-extract.mjs'
import { differencesOf, validRevision } from './board-diff-report.mjs'

const launchBase = '77ffa8221da42031d8ecf711a93f7f6cbfb445b7'
const relative = (root, file) => path.relative(root, file).split(path.sep).join('/')
function git(args, input) {
  return execFileSync('git', args, { cwd: REPO_ROOT, input, maxBuffer: 128 * 1024 * 1024 })
}

// Read only board manifests and walk receipts in two Git snapshots. No hand-maintained counts.
// The introduction snapshot bounds eligibility; the integration base retires paid-down IDs.
function snapshot(ref) {
  const files = git(['ls-tree', '-r', ref, '--', 'docs/design/boards']).toString().trim().split('\n')
    .map(row => row.match(/^\d+ blob (\w+)\t(.+)$/)).filter(m => m && (m[2].endsWith('.board.json') || m[2].endsWith('.candidates.json') || /\/walk\/[^/]+\/[^/]+\.diff\.json$/.test(m[2])))
  const data = git(['cat-file', '--batch'], files.map(m => m[1]).join('\n') + '\n')
  let offset = 0
  const debt = new Map()
  const receipts = []
  const censuses = new Map()
  for (const [, , file] of files) {
    const end = data.indexOf(10, offset)
    const size = Number(data.toString('ascii', offset, end).split(' ')[2])
    const doc = JSON.parse(data.toString('utf8', end + 1, end + 1 + size))
    offset = end + size + 2
    if (file.endsWith('.board.json')) {
      debt.set(file, new Map(doc.elements.filter(e => e.status === 'implemented').map(e => [e.id, new Set(e.candidates?.length ? e.candidates : [null])])))
    } else if (file.endsWith('.candidates.json')) {
      censuses.set(file.replace(/\.candidates\.json$/, '.board.json'), candidateRecords(doc))
    } else receipts.push([file, doc])
  }
  for (const [file, report] of receipts) {
    const owner = path.posix.dirname(file)
    const key = path.posix.join(path.posix.dirname(path.posix.dirname(owner)), path.posix.basename(owner) + '.board.json')
    for (const s of report.samples ?? []) debt.get(key)?.get(s.element)?.delete(s.candidate)
  }
  for (const [file, elements] of debt) {
    const records = censuses.get(file) ?? new Map()
    for (const [element, ids] of elements) {
      const eligible = new Map()
      for (const id of ids) {
        if (id === null || records.has(id)) eligible.set(id, records.get(id) ?? null)
      }
      elements.set(element, eligible)
    }
  }
  return debt
}

function candidateRecords(census) {
  return new Map((census?.candidates ?? []).map(c => [c.id, c]))
}

export function remainingLegacy(initial, previous) {
  const kept = new Map()
  for (const [id, candidates] of initial ?? []) {
    const old = previous?.get(id)
    if (old) kept.set(id, new Map([...candidates].filter(([key, record]) => old.has(key) && isDeepStrictEqual(record, old.get(key)))))
  }
  return kept
}
export function loadDiffBaseline() {
  const head = git(['rev-parse', 'HEAD']).toString().trim()
  const fork = git(['merge-base', 'HEAD', 'origin/main']).toString().trim()
  const base = fork === head && head !== launchBase ? git(['rev-parse', 'HEAD^1']).toString().trim() : fork
  const initial = snapshot(launchBase)
  const previous = base === launchBase ? initial : snapshot(base)
  const current = base === fork ? previous : snapshot(fork)
  return new Map([...initial].map(([file, elements]) => {
    const atBase = remainingLegacy(elements, previous.get(file))
    return [file, remainingLegacy(atBase, current.get(file))]
  }))
}

export function boardEvidence(dir, board, baseline = loadDiffBaseline()) {
  const directory = path.join(dir, 'walk', board)
  const reports = fs.existsSync(directory) ? fs.readdirSync(directory).filter(f => f.endsWith('.diff.json')).sort()
    .map(f => JSON.parse(fs.readFileSync(path.join(directory, f), 'utf8'))) : []
  const name = relative(REPO_ROOT, path.join(dir, board + '.board.json'))
  const census = path.join(dir, board + '.candidates.json')
  const doc = fs.existsSync(census) ? JSON.parse(fs.readFileSync(census, 'utf8')) : null
  const records = candidateRecords(doc)
  records.set(null, null) // historically implemented manifest-only element without a census
  const eligible = baseline.get(name) ?? new Map()
  const working = new Map([...eligible.keys()].map(id => [id, records]))
  return { reports, legacy: remainingLegacy(eligible, working), sourceSha256: doc?.sourceSha256 }
}

export function checkMeasuredCandidates({ board, manifest, evidence = {}, onDebt }) {
  const errors = []
  const issue = text => errors.push(`[${board}] R4 ${text}`)
  const covered = new Map()
  const implemented = new Map(manifest.elements?.filter(el => el.status === 'implemented').map(el => [el.id, el]) ?? [])
  const decisions = Array.isArray(manifest.decisions) ? manifest.decisions : []
  for (const r of evidence.reports ?? []) {
    if (!validRevision(r?.screenRevision)) { issue('差异清单缺有效真屏提交 screenRevision'); continue }
    if (r.version !== 2 || r.board !== board || typeof r.locale !== 'string' || !r.locale.trim() || !['dark', 'light'].includes(r.theme)
        || !/^[0-9a-f]{64}$/.test(r.sourceSha256) || r.sourceSha256 !== evidence.sourceSha256
        || !Array.isArray(r.samples) || !r.samples.length) {
      issue('差异清单缺测量信息、板身份或板源哈希不符')
      continue
    }
    let diffs
    try { diffs = differencesOf(r.samples) } catch (error) { issue(error.message); continue }
    if (!isDeepStrictEqual(diffs, r.differences)) issue('差异清单与原始读数不符，请重新采集')
    const seen = new Set()
    for (const { element, candidate } of r.samples) {
      if (seen.has(candidate)) issue(`差异清单候选重复 ${candidate}`)
      seen.add(candidate)
      if (!implemented.has(element)) continue
      if (!implemented.get(element).candidates?.includes(candidate)) { issue(`差异清单 ${element} 没认领 ${candidate}`); continue }
      if (!covered.has(candidate)) covered.set(candidate, new Set())
      const tracks = covered.get(candidate)
      tracks.add('locale:' + r.locale)
      tracks.add('theme:' + r.theme)
    }
    for (const d of diffs) {
      if (!implemented.has(d.element)) continue
      if (d.reason === 'unmatched') issue(`${r.locale}/${r.theme} ${d.candidate}${d.part ? '/' + d.part : ''} 配对失败`)
      else if (!decisions.some(x => x?.candidate === d.candidate && x.property === d.property && x.part === d.part &&
          Object.hasOwn(x, 'board') && Object.hasOwn(x, 'screen') && x.board === d.board && x.screen === d.screen &&
          (x.locale === undefined || x.locale === r.locale) && (x.theme === undefined || x.theme === r.theme) &&
          typeof x.reason === 'string' && x.reason.trim() && typeof x.approvedBy === 'string' && x.approvedBy.trim())) {
        issue(`${r.locale}/${r.theme} ${d.candidate}${d.part ? '/' + d.part : ''} ${d.property} ${JSON.stringify(d.board)} → ${JSON.stringify(d.screen)}（${d.reason}，未登记）`)
      }
    }
  }
  let count = 0
  for (const el of implemented.values()) {
    const legacy = evidence.legacy?.get(el.id)
    const ids = el.candidates ?? []
    let owes = false
    if (!ids.length) {
      if (legacy?.has(null)) owes = true
      else issue(`元素 ${el.id} 缺可核对的候选与差异清单`)
    }
    const required = []
    if (el.states?.includes('zh-en')) required.push('locale:zh-CN', 'locale:en')
    if (el.states?.includes('dark')) required.push('theme:dark')
    for (const id of ids) {
      const tracks = covered.get(id)
      if (tracks) {
        for (const track of required) if (!tracks.has(track)) issue(`元素 ${el.id} 候选 ${id} 缺 ${track} 轨差异清单`)
        continue
      }
      if (legacy?.has(id)) owes = true
      else issue(`元素 ${el.id} 候选 ${id} 缺差异清单`)
    }
    if (owes) count++
  }
  if (count) onDebt?.(board, count)
  return errors
}
