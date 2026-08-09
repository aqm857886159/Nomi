// Release smoke: launch the packaged MCP server from an isolated cwd so repository files cannot
// mask a missing package asset. It creates one isolated draft per signed client, but never calls a provider.
import { spawn } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import readline from 'node:readline'

const bundlePath = path.resolve(process.argv[2] || '')
const executablePath = process.platform === 'darwin'
  ? path.join(bundlePath, 'Contents', 'MacOS', 'Nomi')
  : bundlePath
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-packaged-mcp-smoke-'))
const capabilityDir = path.join(tempRoot, 'capability')
const token = crypto.randomBytes(24).toString('hex')
fs.mkdirSync(capabilityDir, { recursive: true })
fs.writeFileSync(path.join(capabilityDir, 'token'), token, { mode: 0o600 })
const clients = ['claude', 'codex', 'cursor']

if (!fs.existsSync(executablePath)) {
  throw new Error(`Packaged Nomi executable not found: ${executablePath}`)
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

async function smokeClient(client) {
  const child = spawn(executablePath, [], {
    cwd: tempRoot,
    env: {
      ...process.env,
      NOMI_MCP_STDIO: '1',
      NOMI_SETTINGS_DIR: tempRoot,
      NOMI_ELECTRON_USER_DATA_DIR: tempRoot,
      NOMI_CAPABILITY_DIR: capabilityDir,
      NOMI_PROJECTS_DIR: path.join(tempRoot, 'projects'),
      NOMI_MCP_CLIENT: client,
      NOMI_MCP_CLIENT_PROOF: proofFor(client),
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
    assert(tools.length === 13, `${client} expected 13 tools, got ${tools.length}`)
    for (const name of ['nomi_start_playbook', 'nomi_get_run', 'nomi_subscribe_run', 'nomi_get_artifact']) {
      assert(tools.some((tool) => tool.name === name), `${client} ${name} is missing`)
    }

    const resources = (await rpc('resources/list')).result?.resources || []
    const director = resources.find((resource) => resource.uri === 'nomi-skill://director-cinematography')
    assert(director, `${client} director cinematography resource is missing`)
    const body = (await rpc('resources/read', { uri: director.uri })).result?.contents?.[0]?.text || ''
    assert(body.includes('镜头语言') && body.length > 1_000, `${client} director cinematography body is incomplete`)

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
try {
  const evidence = []
  for (const client of clients) evidence.push(await smokeClient(client))
  const first = evidence[0]
  console.log(`PACKAGED MCP SMOKE PASS: ${first.tools} tools, ${first.resources} resources, director body ${first.body} chars, origins ${evidence.map((item) => item.origin).join('/')}`)
} catch (error) {
  exitCode = 1
  console.error(error instanceof Error ? error.message : String(error))
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
}

process.exitCode = exitCode
