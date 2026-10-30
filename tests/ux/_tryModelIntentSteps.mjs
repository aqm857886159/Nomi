import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import { expect } from './_assert.mjs'
import { stationTimeout } from './_station-budget.mjs'
import { parseToolResult } from './_mcpJourney.mjs'
import { ensureAgentPanelOpen } from './_shell.mjs'
import { uiText } from './full-walk/invariants.mjs'

export const TRIAL_MODEL = { vendorKey: 'apimart', modelKey: 'gemini-3.1-flash-image-preview' }
const args = { ...TRIAL_MODEL, prompt: 'A single red apple on a plain white table, soft daylight', taskKind: 'text_to_image', params: { size: '1:1', resolution: '1K' } }

/** Shared real/rehearsal journey: real GUI approval, two actual MCP host sessions, recovery and restart.
 * No Agent token spend is needed: the caller is the SDK host, with no private executor shortcut.
 */
export async function runTryModelIntentJourney(paid, { rehearsal = false } = {}) {
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
  try {
    if (rehearsal) walk.fixture.holdSubmits(true)
    let call = await host('codex')
    const firstCall = call()
    // Handle an early tool rejection without an unhandled rejection while awaiting the real card.
    firstCall.catch(() => {})
    const dialog = win.locator('[data-spend-confirm-dialog]')
    await expect(dialog).toBeVisible({ timeout: stationTimeout({ operations: 2 }) })
    await walk.snap('trial-confirm-zh')
    await dialog.locator('[data-spend-confirm-action="confirm"]').click()
    if (rehearsal) await expect.poll(() => walk.fixture.images.length, { timeout: stationTimeout({ operations: 2 }) }).toBe(1)
    const first = await firstCall
    const identity = first.submission
    if (rehearsal) expect(first.code).toBe('submission_unknown')
    const secondHost = await host('claude')
    for (const repeated of [await call(), await secondHost({ ...args, prompt: 'A different apple', params: { size: '16:9', resolution: '1K' } })]) {
      expect(repeated.submission.intentId).toBe(identity.intentId)
      expect(repeated.submission.attemptId).toBe(identity.attemptId)
      expect(repeated.submission.allowedActions).not.toContain('retry')
    }
    if (rehearsal) { expect(walk.fixture.images.length).toBe(1); walk.fixture.holdSubmits(false) }
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
    await closeHosts()
    await win.evaluate(() => localStorage.setItem('nomi:locale:v1', 'en'))
    await walk.stopApp()
    started = await walk.start()
    win = started.win
    call = await host('codex')
    const recovered = await call()
    expect(recovered.ok).toBe(true)
    expect(recovered.submission.attemptId).toBe(identity.attemptId)
    // Restart opens the project library. Reopen the isolated project through its real card
    // before asking the renderer to display a new-order confirmation.
    const projectCard = win.locator(`[data-project-card="true"][data-project-id="${projectId}"]`)
    await expect(projectCard).toBeVisible({ timeout: stationTimeout({ operations: 2 }) })
    await projectCard.click()
    await ensureAgentPanelOpen(win, 'Reopen the trial confirmation surface', { timeout: stationTimeout({ operations: 2 }) })
    // Asking for a second order only opens confirmation; cancelling it never submits a second job.
    const requested = call({ ...args, newAttemptOf: identity.attemptId })
    requested.catch(() => {})
    const newOrder = win.locator('[data-spend-confirm-dialog]')
    await expect(newOrder).toBeVisible({ timeout: stationTimeout({ operations: 2 }) })
    await expect(newOrder.locator('[data-spend-confirm-action="confirm"]')).toHaveText(uiText('en', 'runtime.capability.confirmGenerate'))
    await walk.snap('trial-new-confirm-after-restart-en')
    await newOrder.locator('[data-spend-confirm-action="cancel"]').click()
    expect((await requested).ok).toBe(false)
    if (rehearsal) expect(walk.fixture.images.length).toBe(1)
    const creates = rehearsal ? walk.fixture.images.length : paid.readAllowedRequests().filter((entry) =>
      entry.kind === 'allowed-request' && entry.method === 'POST' && /\/images\/generations$/.test(new URL(entry.url).pathname)).length
    expect(creates, 'wire evidence: exactly one provider create request').toBe(1)
    walk.report.trial = { first: first.code ?? 'succeeded', submission: identity, recovered: recovered.submission,
      assets: completed.state.assets.map(({ type, url }) => ({ type, url })), imageWidth, localUrl, providerCreates: creates, paidCalls: rehearsal ? 0 : creates,
      limitation: 'Scripted MCP caller; no claim of real-model tool-selection accuracy.' }
  } finally { await closeHosts() }
}
