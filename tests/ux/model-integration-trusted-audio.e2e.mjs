// Cross-process J1 fixture: the agent owns the MCP steps, while credentials and
// spend confirmation cross only Nomi's trusted renderer IPC boundary.
import { createServer } from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import {
  assert,
  assertNoCredentialMaterial,
  makeIsolatedRoot,
  parseToolResult,
  repoRoot,
  spawnModelIntegrationMcp,
} from './_modelIntegrationHarness.mjs'
import { launchNomiApp } from './_launchApp.mjs'

const require = createRequire(import.meta.url)

function silentWave() {
  const sampleRate = 8_000
  const samples = 800
  const bytes = Buffer.alloc(44 + samples * 2)
  bytes.write('RIFF', 0)
  bytes.writeUInt32LE(bytes.length - 8, 4)
  bytes.write('WAVEfmt ', 8)
  bytes.writeUInt32LE(16, 16)
  bytes.writeUInt16LE(1, 20)
  bytes.writeUInt16LE(1, 22)
  bytes.writeUInt32LE(sampleRate, 24)
  bytes.writeUInt32LE(sampleRate * 2, 28)
  bytes.writeUInt16LE(2, 32)
  bytes.writeUInt16LE(16, 34)
  bytes.write('data', 36)
  bytes.writeUInt32LE(samples * 2, 40)
  return bytes
}

async function startProvider() {
  const requests = []
  const wave = silentWave()
  const server = createServer((request, response) => {
    requests.push({ method: request.method, path: request.url })
    if (request.method === 'GET' && (request.url === '/v1/models' || request.url === '/models')) {
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ data: [{ id: 'tts-journey-audio' }] }))
      return
    }
    if (request.method === 'POST' && request.url === '/v1/audio/speech') {
      response.writeHead(200, { 'content-type': 'audio/wav', 'content-length': wave.length })
      response.end(wave)
      return
    }
    response.writeHead(404, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ error: { message: 'not found' } }))
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  assert(address && typeof address === 'object', 'fixture provider bound a local port')
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    requests,
    close: () => new Promise((resolve) => server.close(resolve)),
  }
}

function devRuntime() {
  const command = require('electron')
  const compiledEntry = path.join(repoRoot, 'dist-electron', 'main.js')
  assert(fs.existsSync(compiledEntry), `compiled Electron entry missing: ${compiledEntry}`)
  return { command, args: [compiledEntry, '--disable-gpu'], packaged: false, executablePath: command }
}

async function withMcp(dirs, runtime, run) {
  const client = spawnModelIntegrationMcp({ dirs, client: 'codex', signed: true, runtime })
  try {
    await client.initialize()
    return await run(client)
  } finally {
    await client.terminate()
  }
}

async function withTrustedRenderer(dirs, run) {
  const app = await launchNomiApp({
    name: 'model-integration-trusted-audio',
    tempRoot: dirs.tempRoot,
    userDataDir: dirs.userDataDir,
    settingsDir: dirs.settingsDir,
    projectsDir: dirs.projectsDir,
    capabilityDir: dirs.capabilityDir,
    settleMs: 300,
  })
  try {
    return await run(app.win)
  } finally {
    await app.close()
  }
}

async function run() {
  const dirs = makeIsolatedRoot('nomi-model-integration-trusted-audio-')
  const provider = await startProvider()
  const runtime = devRuntime()
  let sessionId = ''
  let revision = 0
  try {
    await withMcp(dirs, runtime, async (mcp) => {
      // 2026-09-11 工具面重做：建连接 + 开安全页是**一跳**（要 key 是后果，不是动词）。
      const begin = parseToolResult(await mcp.callTool('nomi_model_setup', {
        action: 'connect_provider',
        kind: 'http-api-provider',
        name: 'Trusted audio journey',
        baseUrl: provider.baseUrl,
        providerKind: 'openai-compatible',
        authType: 'bearer',
      }))
      assert(!begin.isError, `MCP creates an unverified audio session: ${begin.text}`)
      sessionId = begin.json?.setupId
      assert(Boolean(sessionId), 'connect_provider returns a setup handle')
      assert(begin.json?.nextAction?.kind === 'user_sees_key_page', 'the model is told the user must type a key, not to call another verb')
      revision = 0
    })

    await withTrustedRenderer(dirs, async (win) => {
      const saved = await win.evaluate(async ({ id }) => {
        const onboarding = window.nomiDesktop?.onboarding
        const current = await onboarding?.integrationSessionGet?.(id)
        const revision = Number(current?.revision)
        if (!Number.isInteger(revision)) throw new Error(`trusted renderer could not read setup ${id}`)
        const result = await onboarding?.integrationSessionSaveCredential?.({
          sessionId: id,
          expectedRevision: revision,
          apiKey: 'isolated-fixture-key',
        })
        if (result?.credentialStatus !== 'ready') throw new Error('trusted renderer did not store the credential')
        return result
      }, { id: sessionId })
      assert(saved?.credentialStatus === 'ready' && saved?.stage === 'draft', 'trusted renderer stores the credential')
      assertNoCredentialMaterial(saved, 'trusted credential projection')
    })

    await withMcp(dirs, runtime, async (mcp) => {
      // 模型入参里没有 expectedRevision：会话在上一段里被可信 UI 推进过，旧面在这里必然 stale。
      const chosen = parseToolResult(await mcp.callTool('nomi_model_setup', {
        action: 'choose_models',
        setupId: sessionId,
        models: [{ modelKey: 'tts-journey-audio', kind: 'audio' }],
      }))
      assert(!chosen.isError && chosen.json?.changeId, `MCP accepts the audio selection without a revision: ${chosen.text}`)

      // 免费自检。它证明地址通、key 被收下、模型 id 在对方清单里——**不出片**。
      const checked = parseToolResult(await mcp.callTool('nomi_model_setup', {
        action: 'check_connection',
        setupId: sessionId,
      }, 60_000))
      assert(!checked.isError, `free self-check runs: ${checked.text}`)
      assert(
        (checked.json?.blastRadius?.outboundRequests || []).every((request) => request.billable === false),
        'every outbound request on this path is declared free',
      )
      assert(
        (checked.json?.unverified || []).some((entry) => entry.claim === 'model_produces_output'),
        'a passing self-check still says nothing has been generated yet',
      )

      // 发布：自检过不过都发布，出现时带「未试跑」。
      const shown = parseToolResult(await mcp.callTool('nomi_model_setup', {
        action: 'show_models',
        vendorKey: checked.json?.vendorKey,
        modelKeys: ['tts-journey-audio'],
        visible: true,
      }))
      assert(!shown.isError && shown.json?.blastRadius?.modelsAppearing === 1, `show_models publishes the model: ${shown.text}`)

      const listed = parseToolResult(await mcp.callTool('nomi_list_models', { vendorKey: checked.json?.vendorKey }))
      const row = (listed.json?.state?.connections || [])
        .flatMap((connection) => connection.models || [])
        .find((model) => model.modelKey === 'tts-journey-audio')
      if (!row) throw new Error(`nomi_list_models never reported the onboarded model: ${listed.text}`)
      assert(row?.visibleInPicker === true, 'the chosen model is in the canvas picker')
      // 「已试跑」只有用户自己在画布上跑过一次才成立；自检永远点不亮它。
      assert(row?.tried === false, 'the model is published but labelled not yet tried')
      assertNoCredentialMaterial({ listed: listed.json, row }, 'completed MCP journey')
    })

    // 09-11 拍板的可证伪形式：接模型这条路上**一次生成都不发**。第一次真跑是用户自己点的。
    const audioCreates = provider.requests.filter((item) => item.method === 'POST' && item.path === '/v1/audio/speech')
    assert(audioCreates.length === 0, 'onboarding never spends: no audio generation request is sent at any point')
    console.log('MODEL INTEGRATION TRUSTED AUDIO PASS: MCP -> trusted renderer -> free self-check -> published as not-yet-tried')
  } finally {
    await provider.close().catch(() => undefined)
    fs.rmSync(dirs.tempRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
  }
}

run().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error))
  process.exitCode = 1
})
