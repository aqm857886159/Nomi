import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import { expect } from './_assert.mjs'
import { parseToolResult } from './_mcpJourney.mjs'

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
  await walk.newProject()
  const clients = []
  async function host(name) {
    const endpointPath = path.join(started.capabilityDir, 'mcp-http.json')
    await expect.poll(() => fs.existsSync(endpointPath), { timeout: 30_000 }).toBe(true)
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
    await expect(dialog).toBeVisible({ timeout: 30_000 })
    await walk.snap('trial-confirm-zh')
    await dialog.locator('[data-spend-confirm-action="confirm"]').click()
    if (rehearsal) await expect.poll(() => walk.fixture.images.length, { timeout: 30_000 }).toBe(1)
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
    await expect.poll(async () => { completed = await call(); return completed.ok }, { timeout: 180_000 }).toBe(true)
    expect(completed.state.assets.length).toBeGreaterThan(0)
    await closeHosts()
    await win.evaluate(() => localStorage.setItem('nomi:locale:v1', 'en'))
    await walk.stopApp()
    started = await walk.start()
    win = started.win
    call = await host('codex')
    const recovered = await call()
    expect(recovered.ok).toBe(true)
    expect(recovered.submission.attemptId).toBe(identity.attemptId)
    await walk.snap('trial-original-after-restart-en')
    // Asking for a second order only opens confirmation; cancelling it never submits a second job.
    const requested = call({ ...args, newAttemptOf: identity.attemptId })
    requested.catch(() => {})
    const newOrder = win.locator('[data-spend-confirm-dialog]')
    await expect(newOrder).toBeVisible({ timeout: 30_000 })
    await newOrder.locator('[data-spend-confirm-action="cancel"]').click()
    expect((await requested).ok).toBe(false)
    if (rehearsal) expect(walk.fixture.images.length).toBe(1)
    walk.report.trial = { first: first.code ?? 'succeeded', submission: identity, recovered: recovered.submission,
      assets: completed.state.assets.map(({ type, url }) => ({ type, url })), paidCalls: rehearsal ? 0 : 1,
      limitation: 'Scripted MCP caller; no claim of real-model tool-selection accuracy.' }
  } finally { await closeHosts() }
}
