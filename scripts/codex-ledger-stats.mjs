#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
export const KINDS = ['research', 'implementation', 'acceptance', 'review', 'design', 'gate-fix', 'release']
export const OUTCOMES = ['accepted-first-pass', 'returned-by-coordinator', 'ci-red-after-push']
const REQUIRED = ['date', 'line', 'kind', 'pr', 'outcome', 'defects', 'note']

export function parseLedger(text, categories) {
  const errors = []
  const rows = []
  const allowedDefects = new Set(Object.keys(categories))
  for (const [index, raw] of text.split(/\r?\n/).entries()) {
    if (!raw.trim()) continue
    let row
    try { row = JSON.parse(raw) } catch (error) {
      errors.push(`line ${index + 1}: invalid JSON (${error.message})`)
      continue
    }
    const missing = REQUIRED.filter((field) => !Object.hasOwn(row, field))
    if (missing.length) errors.push(`line ${index + 1}: missing ${missing.join(', ')}`)
    if (typeof row.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(row.date ?? '')) errors.push(`line ${index + 1}: date must be YYYY-MM-DD`)
    if (typeof row.line !== 'string' || !row.line.trim()) errors.push(`line ${index + 1}: line must be non-empty`)
    if (!KINDS.includes(row.kind)) errors.push(`line ${index + 1}: unknown kind ${JSON.stringify(row.kind)}`)
    if (!(row.pr === null || Number.isInteger(row.pr))) errors.push(`line ${index + 1}: pr must be an integer or null`)
    if (!OUTCOMES.includes(row.outcome)) errors.push(`line ${index + 1}: unknown outcome ${JSON.stringify(row.outcome)}`)
    if (!Array.isArray(row.defects)) errors.push(`line ${index + 1}: defects must be an array`)
    else for (const defect of row.defects) if (!allowedDefects.has(defect)) errors.push(`line ${index + 1}: unknown defect ${JSON.stringify(defect)}`)
    if (typeof row.note !== 'string') errors.push(`line ${index + 1}: note must be a string`)
    rows.push(row)
  }
  if (errors.length) throw new Error(errors.join('\n'))
  return rows
}

export function calculateStats(rows, qualityProfile, categories) {
  const byKind = Object.fromEntries(KINDS.map((kind) => {
    const subset = rows.filter((row) => row.kind === kind)
    const firstPass = subset.filter((row) => row.outcome === 'accepted-first-pass').length
    return [kind, { total: subset.length, firstPass, rate: subset.length ? firstPass / subset.length : 0 }]
  }))
  const ciRed = rows.filter((row) => row.outcome === 'ci-red-after-push').length
  const defectCounts = new Map()
  for (const row of rows) for (const defect of row.defects) defectCounts.set(defect, (defectCounts.get(defect) ?? 0) + 1)
  const defectRanking = [...defectCounts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([id, count]) => ({ id, name: categories[id], count }))
  const unmentioned = defectRanking.filter(({ id, name, count }) => count >= 2 && !qualityProfile.includes(id) && !qualityProfile.includes(name))
  return { total: rows.length, firstPassByKind: byKind, ciRedAfterPush: { count: ciRed, rate: rows.length ? ciRed / rows.length : 0 }, defectRanking, unmentioned }
}

export function loadStats({ ledgerPath = path.join(ROOT, 'docs/engineering/codex/delivery-ledger.jsonl'), categoriesPath = path.join(ROOT, 'docs/engineering/codex/defect-categories.json'), qualityProfilePath = path.join(ROOT, 'docs/engineering/codex/quality-profile.md') } = {}) {
  const categories = JSON.parse(fs.readFileSync(categoriesPath, 'utf8'))
  const rows = parseLedger(fs.readFileSync(ledgerPath, 'utf8'), categories)
  const qualityProfile = fs.readFileSync(qualityProfilePath, 'utf8')
  return { rows, categories, stats: calculateStats(rows, qualityProfile, categories) }
}

function main() {
  try {
    const result = loadStats()
    if (process.argv.includes('--check')) {
      console.log(`codex ledger valid: ${result.rows.length} rows`)
      return
    }
    console.log(JSON.stringify(result.stats, null, 2))
  } catch (error) {
    console.error(`codex ledger invalid: ${error.message}`)
    process.exitCode = 1
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
