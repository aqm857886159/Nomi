// Zero-paid-call assembly check: actual isolated Electron catalog encryption/decryption and
// C0 guard installation, with both transports replaced by a local function before attachment.
import { expect } from '../_assert.mjs'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { launchNomiApp } from '../_launchApp.mjs'

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'c0-real-assembly-'))
const bridge = path.join(tempRoot, 'bridge.cjs')
fs.writeFileSync(bridge, `module.exports = import(${JSON.stringify(new URL('./c0-real-main.mjs', import.meta.url).href)});`)
let launched
try {
  const bundle = process.argv[2] && path.resolve(process.argv[2])
  launched = await launchNomiApp({ name: 'c0-real-assembly', tempRoot,
    ...(bundle ? { executablePath: path.join(bundle, 'Contents/MacOS/Nomi') } : {}),
    env: { NOMI_DISABLE_AUTO_UPDATE: '1', NOMI_RENDERER_URL: '', VITE_DEV_SERVER_URL: '' },
  })
  const proof = await launched.app.evaluate(async ({ app }, { bridge, ledgerPath }) => {
    const require = process.mainModule.require.bind(process.mainModule)
    const catalog = require(`${app.getAppPath()}/dist-electron/catalog/catalogStore.js`)
    catalog.upsertModelCatalogVendorApiKey('apimart', { apiKey: 'c0-synthetic-credential', enabled: true })
    const transport = require(`${app.getAppPath()}/dist-electron/appFetch.js`)
    let relayed = 0, decrypted = false
    const send = async (input) => {
      if (String(input).endsWith('/v1/balance')) {
        return new Response(JSON.stringify({ success: true, used_balance: 0, used_credits: 0 }))
      }
      relayed++
      return new Response('synthetic-transport-response', { status: 201 })
    }
    // Read the application-stored ciphertext through the exact production reader, not a test secret decoder.
    const secrets = require(`${app.getAppPath()}/dist-electron/catalog/secrets.js`)
    decrypted = secrets.decryptApiKeyRecord(catalog.readCatalog().apiKeysByVendor.apimart) === 'c0-synthetic-credential'
    transport.appFetch = send
    globalThis.fetch = send
    const module = await require(bridge)
    const guard = await module.attachRealDispatch({ ledgerPath,
      quote: { textRequestUsd: .01, maxOutputTokens: 16000, videoPerSecondUsd: .0714, imageUsd: .010625 } })
    const request = (model) => transport.appFetch('https://api.apimart.ai/v1/chat/completions', {
      method: 'POST', body: JSON.stringify({ model, messages: [{ role: 'user', content: 'assembly only' }] }),
    })
    const response = await request('gpt-5-nano')
    let refused = false
    try { await request('unquoted-model') } catch { refused = true }
    const ledger = await guard.snapshot()
    return { decrypted, refused, relayed, responseStatus: response.status, response: await response.text(),
      reservations: ledger.requests.length, reservedCny: ledger.reservedCny, billedUsd: ledger.billedUsd,
      packaged: app.isPackaged }
  }, { bridge, ledgerPath: path.join(tempRoot, 'ledger.json') })
  expect(proof.decrypted).toBe(true)
  expect(proof.refused).toBe(true)
  expect(proof.relayed).toBe(1)
  expect(proof.responseStatus).toBe(201)
  expect(proof.response).toBe('synthetic-transport-response')
  expect(proof.reservations).toBe(1)
  expect(proof.reservedCny).toBe(.07)
  expect(proof.billedUsd).toBe(0)
  expect(proof.packaged).toBe(Boolean(process.argv[2]))
  console.log('C0 ASSEMBLY PASS: application credential path, bridge, reservation, relay, refusal; synthetic transport; paid calls=0')
} catch {
  console.error('C0 ASSEMBLY FAILED (raw exception suppressed)')
  process.exitCode = 1
} finally {
  await launched?.close()
  fs.rmSync(tempRoot, { recursive: true, force: true })
}
