#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { collectGithubGrowth, upsertSnapshot } from './lib/growth/github-growth.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const HISTORY_PATH = path.join(ROOT, 'docs', 'stats', 'growth-history.json')
const DOWNLOAD_HISTORY_PATH = path.join(ROOT, 'docs', 'stats', 'downloads-history.json')
const TIME_ZONE = 'Asia/Shanghai'

function dateInTimeZone(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now)
}

function resolveRepo() {
  if (process.env.GITHUB_REPOSITORY) return process.env.GITHUB_REPOSITORY
  const remote = execFileSync('git', ['remote', 'get-url', 'origin'], { cwd: ROOT, encoding: 'utf8' }).trim()
  const match = remote.match(/github\.com[/:]([^/]+)\/(.+?)(?:\.git)?$/)
  if (!match) throw new Error(`Cannot infer GitHub repository from origin: ${remote}`)
  return `${match[1]}/${match[2]}`
}

function readJson(file, fallback) {
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : fallback
}

function latestDownloadSnapshot() {
  const history = readJson(DOWNLOAD_HISTORY_PATH, { snapshots: [] })
  const latest = history.snapshots.at(-1)
  if (!latest) return { status: 'unavailable', reason: 'no_download_snapshot' }
  return {
    status: 'ok',
    snapshotDate: latest.date,
    total: latest.total,
    byPlatform: latest.byPlatform,
  }
}

export async function buildGrowthSnapshot({
  repo = resolveRepo(),
  fetchImpl = globalThis.fetch,
  token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN,
  observedAt = new Date().toISOString(),
  date = dateInTimeZone(new Date(observedAt)),
} = {}) {
  const github = await collectGithubGrowth({ repo, fetchImpl, token, observedAt })
  return {
    date,
    observedAt,
    repo,
    ...github,
    downloads: latestDownloadSnapshot(),
  }
}

async function main() {
  const snapshot = await buildGrowthSnapshot()
  const trafficSummary = snapshot.traffic.status === 'ok'
    ? `${snapshot.traffic.views.uniques} unique views / ${snapshot.traffic.clones.uniques} unique clones`
    : `traffic ${snapshot.traffic.reason}`

  console.log(`Nomi growth · ${snapshot.date}`)
  console.log(`${snapshot.repository.stars} stars · ${snapshot.repository.forks} forks · ${trafficSummary}`)
  console.log(snapshot.downloads.status === 'ok' ? `${snapshot.downloads.total} installer downloads` : 'downloads unavailable')

  if (!process.argv.includes('--snapshot')) return
  const history = readJson(HISTORY_PATH, { schemaVersion: 1, snapshots: [] })
  const next = upsertSnapshot(history, snapshot)
  fs.mkdirSync(path.dirname(HISTORY_PATH), { recursive: true })
  fs.writeFileSync(HISTORY_PATH, `${JSON.stringify(next, null, 2)}\n`)
  console.log(`Saved ${path.relative(ROOT, HISTORY_PATH)}`)
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  main().catch((error) => {
    console.error(`Growth observatory failed: ${error.message}`)
    process.exit(1)
  })
}
