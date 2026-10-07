#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'

function arg(name, fallback) {
  const i = process.argv.indexOf(name)
  return i >= 0 ? process.argv[i + 1] : fallback
}
function rank(values) {
  const sorted = values.map((value, index) => ({ value, index })).sort((a, b) => a.value - b.value)
  const ranks = Array(values.length)
  for (let i = 0; i < sorted.length; ) {
    let j = i + 1
    while (j < sorted.length && sorted[j].value === sorted[i].value) j += 1
    const r = (i + 1 + j) / 2
    for (let k = i; k < j; k += 1) ranks[sorted[k].index] = r
    i = j
  }
  return ranks
}
function spearman(a, b) {
  if (a.length < 2) return null
  const ar = rank(a),
    br = rank(b)
  const am = ar.reduce((s, x) => s + x, 0) / ar.length
  const bm = br.reduce((s, x) => s + x, 0) / br.length
  const numerator = ar.reduce((s, x, i) => s + (x - am) * (br[i] - bm), 0)
  const da = Math.sqrt(ar.reduce((s, x) => s + (x - am) ** 2, 0))
  const db = Math.sqrt(br.reduce((s, x) => s + (x - bm) ** 2, 0))
  return da && db ? numerator / (da * db) : 0
}
const humanPath = arg('--human')
const judgePath = arg('--judge')
const manifestPath = arg('--manifest')
const outPath = arg('--out', 'director-calibration-alignment.json')
if (!humanPath || !judgePath || !manifestPath)
  throw new Error('usage: --human scores.json --judge results.json --manifest manifest.json [--out output.json]')
const human = JSON.parse(fs.readFileSync(humanPath, 'utf8'))
const judge = JSON.parse(fs.readFileSync(judgePath, 'utf8'))
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
const judgeByCardScheme = new Map()
for (const record of judge.records ?? []) {
  if (record.bait || typeof record.score !== 'number') continue
  const key = `${record.cardId}:${record.scheme}`
  const values = judgeByCardScheme.get(key) ?? []
  values.push(record.score)
  judgeByCardScheme.set(key, values)
}
const rows = []
for (const score of human.scores ?? []) {
  if (typeof score.score !== 'number') continue
  const item = (manifest.items ?? []).find((candidate) => candidate.id === score.id || candidate.video === score.video)
  if (!item) continue
  const base = path.basename(item.video).replace(/\.mp4$/, '')
  const match = base.match(/_(oracle|s1|s0-pr960-raw)$/)
  const scheme = match?.[1]
  if (!scheme) continue
  const values = judgeByCardScheme.get(`${item.cardId}:${scheme}`) ?? []
  if (!values.length) continue
  rows.push({
    id: item.id,
    cardId: item.cardId,
    scheme,
    human: score.score,
    judgeMean: values.reduce((s, x) => s + x, 0) / values.length,
  })
}
const humanValues = rows.map((row) => row.human)
const judgeValues = rows.map((row) => row.judgeMean)
const sameBin = rows.filter((row) => Math.round(row.judgeMean) === row.human).length
const result = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  n: rows.length,
  spearman: spearman(humanValues, judgeValues),
  sameBin: rows.length ? sameBin / rows.length : null,
  sameBinCount: sameBin,
  rows,
}
fs.writeFileSync(outPath, JSON.stringify(result, null, 2) + '\n')
console.log(JSON.stringify(result, null, 2))
