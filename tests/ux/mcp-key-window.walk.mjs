// R16 real-user MCP journey: an external Claude-shaped RPC request asks for a key,
// Nomi comes forward, consumes the durable handoff, and the same session continues
// after the key is saved. The profile is isolated; the key is synthetic.
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { launchNomiApp } from './_launchApp.mjs'
import { screenshotSettled, expectVisible, clickOrFail } from './_assert.mjs'

const repoRoot = path.resolve(new URL('.', import.meta.url).pathname, '../..')
const shotsDir = path.join(repoRoot, 'tests/ux/shots/mcp-key-window')
const FAKE_KEY = 'sk-nomi-mcp-key-window-walkthrough'

async function waitForAdvert(capabilityDir) {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const file = fs.readdirSync(capabilityDir).find((name) => /^instance(?:-[a-f0-9]+)?\.json$/.test(name))
    if (file) {
      try {
        const advert = JSON.parse(fs.readFileSync(path.join(capabilityDir, file), 'utf8'))
        if (Number(advert.port) > 0 && typeof advert.token === 'string' && advert.token.length > 0) return advert
      } catch { /* capability core is still writing the advert */ }
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error('MCP key-window walk: Nomi RPC advert did not become ready')
}

function proofFor(token, client = 'claude') {
  return crypto.createHmac('sha256', token).update(`nomi-mcp-client:v1:${client}`).digest('base64url')
}

async function rpc(advert, connectionAttestation, method, params) {
  const response = await fetch(`http://127.0.0.1:${advert.port}/rpc`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${advert.token}`,
      'x-nomi-mcp-client': 'claude',
      'x-nomi-mcp-client-proof': proofFor(advert.token),
      'x-nomi-mcp-connection-attestation': connectionAttestation,
    },
    body: JSON.stringify({ method, params }),
  })
  const body = await response.json()
  if (!response.ok || body.ok !== true) throw new Error(`${method} failed: ${JSON.stringify(body)}`)
  return body.result
}

async function main() {
  fs.mkdirSync(shotsDir, { recursive: true })
  const launched = await launchNomiApp({ name: 'mcp-key-window', syntheticCredentialStorage: true, settleMs: 900 })
  const { app, win } = launched
  try {
    await win.evaluate(() => {
      for (const key of ['nomi:splash:v1', 'nomi:journey-tour:v1', 'nomi:canvas-gesture-hint:v1', 'nomi.onboarding.scene3dCoach.v1'])
        window.localStorage.setItem(key, 'seen')
      window.localStorage.setItem('nomi:locale:v1', 'zh-CN')
      window.localStorage.setItem('nomi-color-scheme', 'light')
      window.localStorage.setItem('__nomiE2E', '1')
    })
    await win.reload()
    await win.waitForLoadState('domcontentloaded')

    const advert = await waitForAdvert(launched.capabilityDir)
    const connectionAttestation = crypto.randomBytes(32).toString('base64url')
    const begun = await rpc(advert, connectionAttestation, 'integration.begin', {
      kind: 'http-api-provider',
      name: 'Kling',
      baseUrl: 'https://api.kling.example/v1',
      providerKind: 'openai-compatible',
      authType: 'bearer',
    })
    const opened = await rpc(advert, connectionAttestation, 'integration.open_credentials', {
      sessionId: begun.id,
      expectedRevision: begun.revision,
    })

    const settings = win.locator('[data-settings-overlay="true"]')
    await expectVisible(settings, 'MCP open_credentials should bring Settings to the front')
    await expectVisible(settings.locator('[data-settings-tab-id="models"]'), '模型 tab should be selected')
    const wizard = settings
    await expectVisible(wizard.getByText('添加一个 AI 模型', { exact: true }), 'durable credential handoff should open the model onboarding page')
    const providerName = win.getByPlaceholder('如：TOAPI 中转')
    await expectVisible(providerName, 'the handoff should locate the requested provider')
    if (await providerName.inputValue() !== 'Kling') throw new Error('MCP key-window walk: provider name was not restored from the handoff')
    const focused = await app.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows().find((candidate) => !candidate.isDestroyed() && candidate.isVisible())
      return Boolean(window?.isFocused())
    })
    if (!focused) throw new Error('MCP key-window walk: main BrowserWindow was not focused')
    await screenshotSettled(win, { path: path.join(shotsDir, '01-provider-page.png') })

    const keyInput = win.getByPlaceholder('sk-...')
    await expectVisible(keyInput, 'provider key input should be visible')
    await keyInput.fill(FAKE_KEY)
    await clickOrFail(wizard.getByRole('button', { name: '保存连接' }), '保存连接')
    await expectVisible(settings.locator('[data-settings-tab-id="models"]'), 'Settings remains open after saving')

    const ready = await rpc(advert, connectionAttestation, 'integration.get', { sessionId: begun.id })
    if (ready.credentialStatus !== 'ready') throw new Error(`credential did not persist: ${JSON.stringify(ready)}`)
    const proposed = await rpc(advert, connectionAttestation, 'integration.propose', {
      sessionId: begun.id,
      expectedRevision: ready.revision,
      proposal: { candidates: [{ modelKey: 'kling-video-v1', kind: 'video' }], selections: [{ modelKey: 'kling-video-v1' }] },
    })
    if (proposed.credentialStatus !== 'ready' || proposed.stage !== 'needs_spend_confirmation')
      throw new Error(`propose regressed to credential state: ${JSON.stringify(proposed)}`)
    const confirmed = await rpc(advert, connectionAttestation, 'integration.request_confirmation', {
      sessionId: begun.id,
      expectedRevision: proposed.revision,
      idempotencyKey: 'mcp-key-window-walkthrough-confirm',
    })
    if (!confirmed.challengeId) throw new Error(`confirm did not return a challenge: ${JSON.stringify(confirmed)}`)

    await win.evaluate(async () => {
      const apply = window.__nomiCapabilityApply
      if (typeof apply !== 'function') throw new Error('capability apply bridge missing')
      await apply('host-config.repaired', {})
    })
    await expectVisible(win.getByText('已修复 Claude Code 的 Nomi 接入配置，重启 Claude Code 生效', { exact: true }), 'repair toast should be visible')
    await screenshotSettled(win, { path: path.join(shotsDir, '02-host-config-repaired-toast.png') })
    console.log(`MCP KEY WINDOW PASS: ${path.join(shotsDir, '01-provider-page.png')}`)
    console.log(`MCP KEY WINDOW PASS: ${path.join(shotsDir, '02-host-config-repaired-toast.png')}`)
    console.log(`credentialEntry=${Boolean(opened?.credentialEntry)} focused=${focused} stage=${proposed.stage}`)
  } finally {
    await launched.close()
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error))
  process.exitCode = 1
})
