// Release smoke: launch the packaged MCP server from an isolated cwd so repository files cannot
// mask a missing package asset. It creates one isolated draft per signed client, but never calls a provider.
import { spawn } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import readline from 'node:readline'
import { launchNomiApp } from './_launchApp.mjs'

const bundlePath = path.resolve(process.argv[2] || '')
const executablePath = process.platform === 'darwin'
  ? path.join(bundlePath, 'Contents', 'MacOS', 'Nomi')
  : bundlePath
const launcherPath = process.platform === 'darwin'
  ? path.join(bundlePath, 'Contents', 'Frameworks', 'Nomi Helper.app', 'Contents', 'MacOS', 'Nomi Helper')
  : executablePath
const launcherScript = process.platform === 'darwin'
  ? path.join(bundlePath, 'Contents', 'Resources', 'app.asar', 'dist-electron', 'capabilityCore', 'mcpNodeLauncher.js')
  : path.join(path.dirname(bundlePath), 'resources', 'app.asar', 'dist-electron', 'capabilityCore', 'mcpNodeLauncher.js')
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-packaged-mcp-smoke-'))
const capabilityDir = path.join(tempRoot, 'capability')
const token = crypto.randomBytes(24).toString('hex')
fs.mkdirSync(capabilityDir, { recursive: true })
fs.writeFileSync(path.join(capabilityDir, 'token'), token, { mode: 0o600 })
const clients = ['claude', 'codex', 'cursor']

if (!fs.existsSync(executablePath) || !fs.existsSync(launcherPath)) {
  throw new Error(`Packaged Nomi executable/helper not found: ${executablePath} / ${launcherPath}`)
}

function assert(condition, message) {
  if (!condition) throw new Error(`PACKAGED MCP SMOKE FAIL: ${message}`)
}

function proofFor(client) {
  return crypto
    .createHmac('sha256', token)
    .update(`nomi-mcp-client:v1:${client}`)
    .digest('base64url')
}

async function smokeClient(client, { signed = true } = {}) {
  const clientIdentity = signed
    ? {
        NOMI_MCP_CLIENT: client,
        NOMI_MCP_CLIENT_PROOF: proofFor(client),
      }
    : {
        // A generic host may connect and inspect the public catalog, but it must
        // remain external until Nomi installs a signed client capability.
        NOMI_MCP_CLIENT: '',
        NOMI_MCP_CLIENT_PROOF: '',
      }
  const child = spawn(launcherPath, [launcherScript], {
    cwd: tempRoot,
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      NOMI_MCP_STDIO: '1',
      NOMI_MCP_APP_COMMAND: executablePath,
      NOMI_MCP_APP_ARGS: '[]',
      NOMI_SETTINGS_DIR: tempRoot,
      NOMI_ELECTRON_USER_DATA_DIR: tempRoot,
      NOMI_CAPABILITY_DIR: capabilityDir,
      NOMI_PROJECTS_DIR: path.join(tempRoot, 'projects'),
      ...clientIdentity,
    },
    stdio: ['pipe', 'pipe', 'inherit'],
  })
  const pending = new Map()
  let sequence = 0
  readline.createInterface({ input: child.stdout }).on('line', (line) => {
    let message
    try {
      message = JSON.parse(line)
    } catch {
      return
    }
    const entry = pending.get(message.id)
    if (!entry) return
    clearTimeout(entry.timer)
    pending.delete(message.id)
    entry.resolve(message)
  })

  const failPending = (error) => {
    for (const [id, entry] of pending) {
      clearTimeout(entry.timer)
      pending.delete(id)
      entry.reject(error)
    }
  }
  child.on('error', failPending)
  child.on('exit', (code, signal) => {
    if (pending.size) failPending(new Error(`Packaged MCP exited: code=${code} signal=${signal}`))
  })

  const rpc = (method, params = {}, timeoutMs = 15_000) => new Promise((resolve, reject) => {
    const id = ++sequence
    const timer = setTimeout(() => {
      pending.delete(id)
      reject(new Error(`Packaged MCP timeout: ${client} ${method}`))
    }, timeoutMs)
    pending.set(id, { resolve, reject, timer })
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`)
  })

  const terminateChild = async () => {
    if (child.exitCode !== null || child.signalCode !== null) return
    child.kill('SIGTERM')
    await Promise.race([
      new Promise((resolve) => child.once('exit', resolve)),
      new Promise((resolve) => setTimeout(resolve, 2_000)),
    ])
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGKILL')
      await new Promise((resolve) => child.once('exit', resolve))
    }
  }

  try {
    const initialized = await rpc('initialize', {
      protocolVersion: '2025-11-25',
      capabilities: {},
      clientInfo: { name: 'nomi-packaged-smoke', version: '1.0' },
    }, 60_000)
    assert(initialized.result?.serverInfo?.name === 'nomi-capability-core', `${client} initialize handshake`)

    const tools = (await rpc('tools/list')).result?.tools || []
    // The catalog is intentionally extensible: semantic generation tools are additive
    // and provider/model declarations must not turn this smoke test into a fixed count.
    assert(tools.length >= 22, `${client} expected the legacy catalog baseline, got ${tools.length}`)
    const requiredTools = [
      'nomi_start_playbook', 'nomi_get_run', 'nomi_subscribe_run', 'nomi_get_artifact', 'nomi_control_run', 'nomi_decide_gate',
      'nomi_session_open', 'nomi_operation_create', 'nomi_submit_generation_plan', 'nomi_preview_execution',
      'nomi_request_generation_gate', 'nomi_decide_generation_gate', 'nomi_start_generation', 'nomi_operation_read',
      'nomi_cancel_generation', 'nomi_reconcile_generation',
    ]
    assert(new Set(tools.map((tool) => tool.name)).size === tools.length, `${client} tools/list contains duplicate names`)
    for (const name of requiredTools) {
      assert(tools.some((tool) => tool.name === name), `${client} ${name} is missing`)
    }

    const resources = (await rpc('resources/list')).result?.resources || []
    const director = resources.find((resource) => resource.uri === 'nomi-skill://director-cinematography')
    assert(director, `${client} director cinematography resource is missing`)
    const body = (await rpc('resources/read', { uri: director.uri })).result?.contents?.[0]?.text || ''
    assert(body.includes('镜头语言') && body.length > 1_000, `${client} director cinematography body is incomplete`)

    if (!signed) {
      const begin = await rpc('tools/call', {
        name: 'nomi_integration_begin',
        arguments: {
          kind: 'http-api-provider',
          name: 'Unsigned generic host',
          baseUrl: 'https://example.invalid/v1',
        },
      })
      assert(begin.result?.isError === true, `${client} unsigned integration.begin is rejected`)
      const openCredentials = await rpc('tools/call', {
        name: 'nomi_integration_open_credentials',
        arguments: { sessionId: 'unsigned-session', expectedRevision: 1 },
      })
      assert(openCredentials.result?.isError === true, `${client} unsigned credential handoff is rejected`)
      const start = await rpc('tools/call', {
        name: 'nomi_integration_start',
        arguments: {
          sessionId: 'unsigned-session',
          expectedRevision: 1,
          idempotencyKey: 'unsigned-start',
          receipt: 'unsigned-receipt',
        },
      })
      assert(start.result?.isError === true, `${client} unsigned certification start is rejected`)
      return { tools: tools.length, resources: resources.length, body: body.length, origin: 'external' }
    }

    // J0 positive path: a Nomi-signed host can create a durable integration
    // draft from an empty directory without exposing a credential or sending a
    // provider request. The companion external branch above proves that the
    // exact same write boundary remains closed to an unsigned generic host.
    const integrationBegin = await rpc('tools/call', {
      name: 'nomi_integration_begin',
      arguments: {
        kind: 'http-api-provider',
        name: `Packaged MCP integration draft - ${client}`,
        baseUrl: 'https://example.invalid/v1',
        authType: 'bearer',
        clientRequestId: `packaged-${client}-integration-draft`,
      },
    })
    assert(integrationBegin.result?.isError !== true, `${client} signed integration.begin succeeds without a credential`)
    const integration = JSON.parse(integrationBegin.result?.content?.[0]?.text || '{}')
    assert(typeof integration.id === 'string' && integration.ownerClientId === client, `${client} integration draft is owned by its signed identity`)
    assert(integration.stage === 'needs_credential' && integration.credentialStatus === 'missing', `${client} integration draft remains unverified until secure credential handoff`)
    assert(!JSON.stringify(integration).match(/authorization|api.?key|credentialRef/i), `${client} integration draft exposes no credential-shaped value`)

    const created = await rpc('tools/call', {
      name: 'nomi_create_project',
      arguments: { name: `Packaged MCP origin smoke - ${client}` },
    })
    const project = JSON.parse(created.result?.content?.[0]?.text || '{}')
    assert(project.id, `${client} isolated project creation`)
    const started = await rpc('tools/call', {
      name: 'nomi_start_playbook',
      arguments: {
        projectId: project.id,
        playbook: 'brand.promo',
        brief: { goal: `Verify the packaged ${client} origin without provider calls` },
      },
    })
    const run = started.result?.structuredContent?.nomiRunData
    assert(run?.origin?.host === client, `${client} expected signed origin, got ${run?.origin?.host || 'missing'}`)
    return { tools: tools.length, resources: resources.length, body: body.length, origin: run.origin.host }
  } finally {
    failPending(new Error(`Packaged MCP ${client} smoke finished`))
    await terminateChild()
  }
}

let exitCode = 0
let gui = null
try {
  gui = await launchNomiApp({
    name: 'packaged-mcp-smoke',
    executablePath,
    userDataDir: tempRoot,
    settingsDir: tempRoot,
    projectsDir: path.join(tempRoot, 'projects'),
    env: { NOMI_CAPABILITY_DIR: capabilityDir },
  })
  const evidence = []
  for (const client of clients) evidence.push(await smokeClient(client))
  evidence.push(await smokeClient('generic', { signed: false }))
  const first = evidence[0]
  console.log(`PACKAGED MCP SMOKE PASS: ${first.tools} tools, ${first.resources} resources, director body ${first.body} chars, origins ${evidence.map((item) => item.origin).join('/')}; unsigned generic writes rejected`)
} catch (error) {
  exitCode = 1
  console.error(error instanceof Error ? error.message : String(error))
} finally {
  await gui?.close().catch(() => undefined)
  fs.rmSync(tempRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
}

process.exitCode = exitCode
