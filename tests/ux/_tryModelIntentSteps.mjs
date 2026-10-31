import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import { makeTempDir } from '../../scripts/_test-temp.mjs'
import { expect, expectAbsent, proveProbe } from './_assert.mjs'
import { stationTimeout } from './_station-budget.mjs'
import { parseToolResult } from './_mcpJourney.mjs'
import { ensureAgentPanelOpen } from './_shell.mjs'
import { uiText } from './full-walk/invariants.mjs'

export const TRIAL_MODEL = { vendorKey: 'apimart', modelKey: 'gemini-3.1-flash-image-preview' }
const args = { ...TRIAL_MODEL, prompt: 'A single red apple on a plain white table, soft daylight', taskKind: 'text_to_image', params: { size: '1:1', resolution: '1K' } }
const CREATE_PATH = '/images/generations'

/** The provider's answer to the first create waits in the network guard, so the first order really comes back
 * unknown on the paid run too, not only where a fixture can sit on it. */
export function holdFirstProviderAnswer() {
  const releaseFile = path.join(makeTempDir('nomi-trial-hold-'), 'release')
  return {
    env: { NOMI_WALK_HOLD_RESPONSE: JSON.stringify({ method: 'POST', pathSuffix: CREATE_PATH, releaseFile }) },
    release: () => fs.writeFileSync(releaseFile, ''),
  }
}

/** Wire evidence on the paid run: what the guard saw leave for the provider. */
export function providerCreatesOnTheWire(paid) {
  return paid.readAllowedRequests().filter((entry) =>
    entry.kind === 'allowed-request' && entry.method === 'POST' && new URL(entry.url).pathname.endsWith(CREATE_PATH)).length
}

/** Shared real/rehearsal journey: real GUI approval, two actual MCP host sessions, recovery and restart.
 * Every step and assertion runs on both; the caller only says how to count creates on its wire.
 * No Agent token spend is needed: the caller is the SDK host, with no private executor shortcut.
 */
export async function runTryModelIntentJourney(paid, { hold, providerCreates, afterJourney }) {
  const { walk } = paid
  let started = await walk.start({ first: true })
  let { win } = started
  await paid.lockToAuthorizedModels(win)
  const { projectId } = await walk.newProject()
  const clients = []
  async function host(name) {
    const endpointPath = path.join(started.capabilityDir, 'mcp-http.json')
    await expect.poll(() => fs.existsSync(endpointPath), { timeout: stationTimeout({ operations: 2 }) }).toBe(true)
    const { url } = JSON.parse(fs.readFileSync(endpointPath, 'utf8'))
    // Only the disposable instance's local MCP authentication; never a provider key or real profile.
    const token = fs.readFileSync(path.join(started.capabilityDir, 'token'), 'utf8').trim()
    const proof = crypto.createHmac('sha256', token).update(`nomi-mcp-client:v1:${name}`).digest('base64url')
    const client = new Client({ name: `trial-${name}`, version: '1' }, { capabilities: {} })
    await client.connect(new StreamableHTTPClientTransport(new URL(url), {
      requestInit: { headers: { 'x-nomi-mcp-client': name, 'x-nomi-mcp-client-proof': proof } },
    }))
    clients.push(client)
    return async (input = args) => {
      const result = parseToolResult(await client.callTool({ name: 'nomi_try_model', arguments: input }, undefined, { timeout: 60_000 }))
      const value = result.json ?? result.outcome
      if (!value?.submission) throw new Error(`Trial did not return a durable receipt: ${JSON.stringify(value)}`)
      return value
    }
  }
  async function closeHosts() {
    for (const client of clients.splice(0)) await client.close()
  }
  /** Relaunch in this language with the project open, ready to show a confirmation. */
  async function restartIn(locale) {
    await closeHosts()
    await win.evaluate((value) => localStorage.setItem('nomi:locale:v1', value), locale)
    await walk.stopApp()
    started = await walk.start()
    win = started.win
    // Restart opens the project library. Reopen the isolated project through its real card
    // before asking the renderer to display a new-order confirmation.
    const projectCard = win.locator(`[data-project-card="true"][data-project-id="${projectId}"]`)
    await expect(projectCard).toBeVisible({ timeout: stationTimeout({ operations: 2 }) })
    await projectCard.click()
    await ensureAgentPanelOpen(win, 'Reopen the trial confirmation surface', { timeout: stationTimeout({ operations: 2 }) })
    return host('codex')
  }
  try {
    let call = await host('codex')
    const firstCall = call()
    // Handle an early tool rejection without an unhandled rejection while awaiting the real card.
    firstCall.catch(() => {})
    const dialog = win.locator('[data-spend-confirm-dialog]')
    await expect(dialog).toBeVisible({ timeout: stationTimeout({ operations: 2 }) })
    await walk.snap('trial-confirm-zh')
    await dialog.locator('[data-spend-confirm-action="confirm"]').click()
    await expect.poll(providerCreates, { timeout: stationTimeout({ operations: 2 }) }).toBe(1)
    const first = await firstCall
    const identity = first.submission
    expect(first.code).toBe('submission_unknown')
    const secondHost = await host('claude')
    for (const repeated of [await call(), await secondHost({ ...args, prompt: 'A different apple', params: { size: '16:9', resolution: '1K' } })]) {
      expect(repeated.submission.intentId).toBe(identity.intentId)
      expect(repeated.submission.attemptId).toBe(identity.attemptId)
      expect(repeated.submission.allowedActions).not.toContain('retry')
    }
    expect(providerCreates()).toBe(1)
    hold.release()
    let completed
    await expect.poll(async () => { completed = await call(); return completed.ok }, { timeout: stationTimeout({ operations: 12 }) }).toBe(true)
    expect(completed.state.assets.length).toBeGreaterThan(0)
    // Use the product's existing asset import boundary; raw loopback HTTP is deliberately
    // not an allowed renderer image source. This is retrieval, never another generation.
    const imported = await win.evaluate(async ({ projectId, url }) => {
      const record = await window.nomiDesktop.projects.readAsync(projectId)
      return window.nomiDesktop.assets.importRemoteUrl({ projectId, url, kind: 'generated', expectedKind: 'image',
        projectBinding: { projectId, immutableProjectUuid: record.immutableProjectUuid, projectGeneration: record.projectGeneration } })
    }, { projectId, url: completed.state.assets[0].url })
    expect(imported.ok, JSON.stringify(imported)).toBe(true)
    const localUrl = imported.asset.data.url
    const imageWidth = await win.evaluate((url) => new Promise((resolve) => {
      const image = new Image()
      image.onload = () => resolve(image.naturalWidth)
      image.onerror = () => resolve(0)
      image.src = url
    }), localUrl)
    expect(imageWidth, 'the original order produced a decodable local image').toBeGreaterThan(0)
    call = await restartIn('en')
    const recovered = await call()
    expect(recovered.ok).toBe(true)
    expect(recovered.submission.attemptId).toBe(identity.attemptId)
    // Asking for a second order only opens confirmation; cancelling it never submits a second job.
    const requested = call({ ...args, newAttemptOf: identity.attemptId })
    requested.catch(() => {})
    const newOrder = win.locator('[data-spend-confirm-dialog]')
    await expect(newOrder).toBeVisible({ timeout: stationTimeout({ operations: 2 }) })
    await expect(newOrder.locator('[data-spend-confirm-action="confirm"]')).toHaveText(uiText('en', 'runtime.capability.confirmGenerate'))
    const cardProbe = await proveProbe(newOrder, 'a real new order shows the spend card to this selector')
    await walk.snap('trial-new-confirm-after-restart-en')
    await newOrder.locator('[data-spend-confirm-action="cancel"]').click()
    expect((await requested).ok).toBe(false)
    const creates = providerCreates()
    expect(creates, 'wire evidence: exactly one provider create request').toBe(1)
    walk.report.trial = { first: first.code ?? 'succeeded', submission: identity, recovered: recovered.submission,
      assets: completed.state.assets.map(({ type, url }) => ({ type, url })), imageWidth, localUrl, providerCreates: creates,
      limitation: 'Scripted MCP caller; no claim of real-model tool-selection accuracy.' }
    if (afterJourney) await afterJourney({ restartIn, win: () => win, identity, providerCreates, cardProbe })
  } finally { await closeHosts() }
}

/** Zero-cost only, in the real window: a record that cannot be read must not lock the model, must not place an
 * order by itself, and the card must say out loud that this order may cost twice, in both languages. */
export async function runUnreadableRecordJourney(paid, { restartIn, win, identity, providerCreates, cardProbe }) {
  const { walk } = paid
  const claims = path.join(walk.settingsDir, 'app-executions', '.nomi', 'intent-claims', identity.intentId, 'quarantine')
  const events = path.join(walk.settingsDir, 'app-executions', '.nomi', 'runs', identity.intentId, 'events.ndjson')
  const garbled = '\u0000garbled{{{\n'
  const dialog = () => win().locator('[data-spend-confirm-dialog]')
  async function askForNewOrder(call, locale) {
    fs.writeFileSync(events, garbled)
    const before = providerCreates()
    const plain = await call()
    expect(plain.code).toBe('submission_unknown')
    expect(plain.submission.recordDamage).toBe('journal_unreadable')
    expect(plain.submission.allowedActions).toEqual(['inspect_provider', 'request_new_attempt'])
    await expectAbsent(dialog(), { provenBy: cardProbe, message: 'a plain call asks nobody' })
    expect(providerCreates(), 'a plain call places no order').toBe(before)
    const requested = call({ ...args, newAttemptOf: plain.submission.attemptId })
    requested.catch(() => {})
    await expect(dialog()).toBeVisible({ timeout: stationTimeout({ operations: 2 }) })
    await expect(dialog()).toContainText(uiText(locale, 'runtime.modelTrial.uncertainPrior'))
    await expect(dialog().locator('[data-spend-confirm-action="confirm"]')).toHaveText(uiText(locale, 'runtime.capability.confirmGenerate'))
    return { before, requested }
  }

  const zh = await askForNewOrder(await restartIn('zh-CN'), 'zh-CN')
  await walk.snap('trial-uncertain-new-order-zh')
  await dialog().locator('[data-spend-confirm-action="confirm"]').click()
  await expect.poll(providerCreates, { timeout: stationTimeout({ operations: 2 }) }).toBe(zh.before + 1)
  const opened = await zh.requested
  expect(opened.submission.attemptId).toBe('attempt-r1-1')
  expect(fs.readFileSync(path.join(claims, 'r1', 'events.ndjson'), 'utf8'), 'the bad record is moved aside, byte for byte').toBe(garbled)

  const en = await askForNewOrder(await restartIn('en'), 'en')
  await walk.snap('trial-uncertain-new-order-en')
  await dialog().locator('[data-spend-confirm-action="cancel"]').click()
  const declined = await en.requested
  expect(declined.ok).toBe(false)
  expect(declined.code).toBe('needs_input')
  expect(providerCreates(), 'cancelling places no order').toBe(en.before)
  expect(fs.readFileSync(path.join(claims, 'r2', 'events.ndjson'), 'utf8')).toBe(garbled)
  walk.report.unreadableRecord = { opened: opened.submission, declined: declined.submission, providerCreates: providerCreates() }
}
