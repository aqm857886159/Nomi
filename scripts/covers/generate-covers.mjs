#!/usr/bin/env node
import fs from 'node:fs'
import { taskCharge, CNY_PER_USD_CEILING } from './cover-budget.mjs'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const MODEL = 'gpt-image-2'
const CONTRACT_URL = 'https://docs.apimart.ai/en/api-reference/images/gpt-image-2/generation.md'
const PRICE_URL = 'https://apimart.ai/api/marketplace/models?keyword=gpt-image-2&page_size=10'
const MAX_CNY = 12
const SESSION = 'skill-ui-b-20260909'
const MAX_CALLS = 90
const args = process.argv.slice(2)
const value = (flag) => args.includes(flag) ? args[args.indexOf(flag) + 1] : undefined
const dryRun = args.includes('--dry-run')
const anchor = path.join(root, 'docs/design/covers/anchors/anchor-3.png')
const anchorHash = createHash('sha256').update(fs.readFileSync(anchor)).digest('hex')
const limit = Number(value('--limit') ?? 33)
const rework = args.includes('--rework')
const resume = args.includes('--resume')
const outputRoot = path.join(root, 'docs/design/covers')
const ledgerPath = path.join(outputRoot, 'generation-receipt.json')

function saveLedger(ledger) {
  fs.mkdirSync(outputRoot, { recursive: true })
  fs.writeFileSync(`${ledgerPath}.tmp`, `${JSON.stringify(ledger, null, 2)}\n`)
  fs.renameSync(`${ledgerPath}.tmp`, ledgerPath)
}
function getEntries() {
  const { parseSkillFrontmatter } = require(path.join(root, 'dist-electron/skills/skillFrontmatter.js'))
  const { readSkillCuration } = require(path.join(root, 'dist-electron/shared/skillCuration.js'))
  return fs.readdirSync(path.join(root, 'skills')).sort().flatMap((name) => {
    const filename = path.join(root, 'skills', name, 'SKILL.md')
    if (!fs.existsSync(filename)) return []
    const source = fs.readFileSync(filename, 'utf8')
    const front = parseSkillFrontmatter(source)
    if (front.error) throw new Error(`Invalid Skill: ${name}`)
    const entry = readSkillCuration(front.values)
    if (!entry || entry.preview) return []
    return [{ name, filename, entry, front }]
  })
}
function palette() {
  const css = fs.readFileSync(path.join(root, 'src/theme/nomi-tokens.css'), 'utf8')
  return ['paper', 'ink', 'accent'].map((name) => {
    const match = css.match(new RegExp(`--nomi-${name}:\\s*([^;]+);`))
    if (!match) throw new Error(`Missing design token: ${name}`)
    return `${name} ${match[1]}`
  }).join(', ')
}
function metaphors() {
  const rules = fs.readFileSync(path.join(root, 'docs/design/2026-09-08-cover-illustration-rules.md'), 'utf8')
  const rows = [...rules.matchAll(/^\| ([a-z0-9-]+) \| ([^|]+) \| ([^|]+) \|$/gm)]
  const result = new Map(rows.filter(row => /^(effect-|writer-|director-|workbench-|brand-promo$|creation-edit$|drama-short$|model-integration$|release-media-pack$|skill-author$)/.test(row[1])).map(row => [row[1], /^[12]$/.test(row[3].trim()) ? row[2].trim() : row[3].trim()]))
  if (result.size !== 73) throw new Error('Rules must define all 73 unique illustration metaphors')
  return result
}
function promptFor(metaphor) {
  return `参考图仅是画风色卡，不是构图草稿。请从空白纸重新设计一张16:9横向几何插画。` +
    `必须画的全部主体，仅为：${metaphor}。除此以外不要加任何形状。` +
    `不要复制参考图的三组套框、左右蓝条或穿框排列。主体严格按上句重画。` +
    `保留参考图的浅暖纸底与轻微纸纹、深墨色线条粗细和克制的平面剪纸感。` +
    `主体中的一个小形状填参考图同款蓝色，其余形状全部纸色填充配墨线；全图恰好一块蓝色，最多两块，禁止三块或更多。` +
    `Keep only the reference palette and line weight; do NOT copy its objects or layout. ` +
    `Design tokens: ${palette()}; match their appearance in the reference. ` +
    `大幅留白。无文字、标题、字母、数字、水印、人脸、五官、写实物体、渐变、3D、投影、装饰星星。标题由UI叠加，不在图内。`
}

async function main() {
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_CALLS) throw new Error('--limit must be 1–90')
  if (args.some((arg) => !['--dry-run', '--rework', '--resume', '--limit', value('--limit')].includes(arg))) throw new Error('Unknown argument')
  if (resume && rework) throw new Error('Resume only polls an existing task; do not combine with rework')
  const entries = getEntries()
  const concepts = metaphors()
  const recorded = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'))
  const sessionJobs = recorded.jobs.filter(job => job.session === SESSION)
  const jobs = entries.filter(item => {
    const prior = sessionJobs.filter(job => job.name === item.name)
    if (resume) return prior.some(job => job.state === 'submitted' && job.taskId)
    if (rework) return prior.length === 1 && prior[0].review?.status === 'rejected'
    return prior.length === 0 && !fs.existsSync(path.join(root, 'skills', item.name, 'assets/cover.png'))
  }).slice(0, limit).map((item) => {
    const metaphor = concepts.get(item.name)
    if (!metaphor) throw new Error(`Missing approved metaphor: ${item.name}`)
    const existing = resume ? sessionJobs.find(job => job.name === item.name && job.state === 'submitted') : undefined
    if (existing) return { name: item.name, item, output: path.join(root, existing.output), prompt: existing.prompt }
    const correction = rework ? sessionJobs.find(job => job.name === item.name)?.review?.rework : undefined
    if (rework && !correction) throw new Error(`Missing visual-review correction: ${item.name}`)
    return { name: item.name, item, output: path.join(outputRoot, SESSION, rework ? 'round-2' : 'round-1', `${item.name}.png`), prompt: promptFor(metaphor) + (correction ? ` 本次返工：${correction}` : '') }
  })
  if (jobs.some((job) => job.prompt.length > 1000)) throw new Error('Prompt exceeds the documented 1000-character limit')
  if (dryRun) {
    const evidence = JSON.parse(fs.readFileSync(ledgerPath, 'utf8')).round3.priceEvidence
    const estimatedUsd = evidence.pricing.starting_price * jobs.length
    console.log(JSON.stringify({ mode: SESSION, missingMedia: entries.length, model: MODEL, limit, budgetCny: MAX_CNY,
      estimatedUsd, estimatedCny: estimatedUsd * CNY_PER_USD_CEILING, priceEvidence: evidence,
      anchor: path.relative(root, anchor), anchorHash, jobs: jobs.map(({ item: _item, ...job }) => job) }, null, 2))
    return
  }
  if (!jobs.length) { console.log('No eligible ungenerated or rejected covers.'); return }
  if (!process.versions.electron) throw new Error('Paid run requires Electron: pnpm exec electron scripts/covers/generate-covers.mjs --limit 5')
  const { app, nativeImage } = require('electron')
  app.setName(JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).name)
  app.setPath('userData', path.join(app.getPath('appData'), app.getName()))
  await app.whenReady()
  const lock = path.join(outputRoot, '.generation.lock')
  fs.mkdirSync(outputRoot, { recursive: true })
  const lockFd = fs.openSync(lock, 'wx')
  try {
    const ledger = fs.existsSync(ledgerPath) ? JSON.parse(fs.readFileSync(ledgerPath, 'utf8')) : {
      model: MODEL, budgetCny: MAX_CNY, cnyPerUsdCeiling: CNY_PER_USD_CEILING, jobs: [],
    }
    if (ledger.skillUiB?.model !== MODEL || ledger.skillUiB?.authorization !== SESSION) throw new Error('Current task model confirmation missing')
    for (const job of jobs) {
      const attempts = ledger.jobs.filter((prior) => prior.session === SESSION && prior.name === job.name)
      if (!resume && attempts.length >= 2) throw new Error('Two attempts exhausted; no third round permitted')
    }
    const taskJobs = ledger.jobs.filter(job => job.session === SESSION)
    if (taskJobs.length + (resume ? 0 : jobs.length) > MAX_CALLS) throw new Error('90-call task ceiling exceeded')
    const pending = ledger.jobs.filter((job) => job.state === 'reserved' || job.state === 'submitted')
    if (pending.length && (!resume || pending.length !== jobs.length || pending.some(job => job.session !== SESSION || job.state !== 'submitted' || !job.taskId))) {
      throw new Error('Uncertain paid request; reconcile before any new submission')
    }
    if (!ledger.jobs.some((job) => job.state === 'completed' && path.resolve(root, job.output) === path.resolve(anchor))) {
      throw new Error('Approved anchor must be a completed candidate from this receipt')
    }

    const pricingResponse = await fetch(PRICE_URL, { signal: AbortSignal.timeout(30000) })
    const pricing = (await pricingResponse.json()).data?.models?.find((model) => model.model_name === MODEL)?.pricing
    if (!pricingResponse.ok || pricing?.billing_type !== 'per_generation' || !(pricing.starting_price > 0) || pricing.starting_price > 0.02) {
      throw new Error('Current official per-image price missing or above verified ceiling')
    }
    // Two times the published price is reserved before each submit, including failed attempts.
    const reserveCny = pricing.starting_price * 2 * CNY_PER_USD_CEILING
    const reserved = taskJobs.reduce((sum, job) => sum + (job.actualCnyCeiling ?? job.reservedCny), 0)
    if (reserved + reserveCny * (resume ? 0 : jobs.length) > MAX_CNY) throw new Error('Session budget exhausted')
    ledger.skillUiB.priceEvidence = { url: PRICE_URL, retrievedAt: new Date().toISOString(), pricing }
    const { readCatalog } = require(path.join(root, 'dist-electron/catalog/catalogStore.js'))
    const { decryptApiKeyRecord } = require(path.join(root, 'dist-electron/catalog/secrets.js'))
    const catalog = readCatalog()
    const vendor = catalog.vendors.find((candidate) => candidate.key === 'apimart')
    const key = vendor && decryptApiKeyRecord(catalog.apiKeysByVendor[vendor.key])
    if (!key) throw new Error('APIMart credential is unavailable in the application catalog')
    const apiJson = async (route, body) => {
      const response = await fetch(`https://api.apimart.ai/v1/${route}`, {
        method: body ? 'POST' : 'GET', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(60000),
      })
      // Never print upstream response bodies: a provider could echo request credentials.
      if (!response.ok) throw new Error(`APIMart HTTP ${response.status}`)
      return response.json().catch(() => { throw new Error('APIMart invalid JSON response') })
    }
    const usedBalance = async () => {
      const response = await apiJson('balance')
      const data = response.data ?? response
      if (!Number.isFinite(data.used_balance)) throw new Error('Balance evidence unavailable')
      return data.used_balance
    }
    const reference = `data:image/png;base64,${fs.readFileSync(anchor).toString('base64')}`
    for (const job of jobs) {
      const existing = resume ? pending.find(prior => prior.name === job.name) : undefined
      const before = existing ? existing.before : await usedBalance()
      const receipt = existing ?? { session: SESSION, round: rework ? 2 : 1, name: job.name, selected: false, review: { status: 'pending' }, promptVersion: 3, contractUrl: CONTRACT_URL, resolution: '1k', model: MODEL, anchor: path.relative(root, anchor), anchorHash, prompt: job.prompt, output: path.relative(root, job.output), reservedCny: reserveCny, state: 'reserved', before, startedAt: new Date().toISOString() }
      if (!existing) {
        receipt.priceEvidence = ledger.skillUiB.priceEvidence
        ledger.jobs.push(receipt)
        saveLedger(ledger)
        const submitted = await apiJson('images/generations', { model: MODEL, prompt: job.prompt, size: '16:9', resolution: '1k', n: 1, image_urls: [reference] })
        const submittedTaskId = submitted.data?.[0]?.task_id
        if (!submittedTaskId) throw new Error('Submission has no task id; reconcile receipt, do not resubmit')
        receipt.taskId = submittedTaskId
        receipt.state = 'submitted'
        saveLedger(ledger)
      }
      const taskId = receipt.taskId
      let url
      for (let attempt = 0; attempt < 90; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 4000))
        const result = (await apiJson(`tasks/${encodeURIComponent(taskId)}`)).data
        if (result?.status === 'failed') throw new Error(`Image task failed: ${job.name}; no automatic retry`)
        if (result?.status === 'completed') {
          receipt.providerCost = result.cost ?? null
          receipt.providerCreditsCost = result.credits_cost ?? null
          const urls = result.result?.images?.[0]?.url
          url = Array.isArray(urls) ? urls[0] : urls
          break
        }
      }
      if (!url || !url.startsWith('https://')) throw new Error('Image did not complete with an HTTPS artifact')
      const response = await fetch(url, { signal: AbortSignal.timeout(60000) })
      if (!response.ok || !response.headers.get('content-type')?.startsWith('image/')) throw new Error('Invalid image artifact')
      const bytes = Buffer.from(await response.arrayBuffer())
      if (bytes.length > 20 * 1024 * 1024) throw new Error('Image artifact exceeds 20 MiB')
      fs.mkdirSync(path.dirname(job.output), { recursive: true })
      const decoded = nativeImage.createFromBuffer(bytes)
      if (decoded.isEmpty()) throw new Error('Image artifact could not be decoded')
      fs.writeFileSync(job.output, decoded.toPNG())
      receipt.after = await usedBalance()
      Object.assign(receipt, taskCharge({ cost: receipt.providerCost, before, after: receipt.after, reserveCny }))
      receipt.state = 'completed'
      receipt.completedAt = new Date().toISOString()
      saveLedger(ledger)
      console.log(`${job.name}: ${receipt.output}; task cost ${receipt.actualUsd.toFixed(6)}; account delta ${receipt.balanceDelta.toFixed(6)}`)
    }
    console.log(`Completed ${jobs.length} covers; receipt saved.`)
  } finally {
    fs.closeSync(lockFd)
    fs.unlinkSync(lock)
    app.quit()
  }
}

main().catch((error) => {
  // Local error messages only; no credentials, request bodies or provider response content.
  console.error(error instanceof Error ? error.message : 'Cover generation failed')
  if (process.versions.electron) require('electron').app.exit(1)
  else process.exitCode = 1
})
