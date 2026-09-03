// Shared process harness for the model-integration release journeys.
// It deliberately exposes only MCP JSON-RPC and isolated directories: no Catalog,
// credential file, or repository source path is handed to the simulated agent.
import { spawn } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import readline from 'node:readline'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { packagedMcpRuntime } from './_packagedMcpRuntime.mjs'

const require = createRequire(import.meta.url)
export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

export function assert(condition, message) {
  if (!condition) throw new Error(`MODEL INTEGRATION JOURNEY FAIL: ${message}`)
}

export function makeIsolatedRoot(prefix = 'nomi-model-integration-') {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
  const dirs = {
    tempRoot,
    settingsDir: path.join(tempRoot, 'settings'),
    userDataDir: path.join(tempRoot, 'user-data'),
    projectsDir: path.join(tempRoot, 'projects'),
    capabilityDir: path.join(tempRoot, 'capability'),
  }
  for (const directory of Object.values(dirs).slice(1)) fs.mkdirSync(directory, { recursive: true, mode: 0o700 })
  return dirs
}

function parseOption(name) {
  const index = process.argv.indexOf(name)
  return index >= 0 ? String(process.argv[index + 1] || '') : ''
}

/** Resolve a release bundle, or use the compiled Electron entry without exposing src/ to the child. */
export function resolveRuntime() {
  const requested = parseOption('--packaged')
  const defaultBundle = path.join(repoRoot, 'release', 'mac-arm64', 'Nomi.app')
  if (requested || (process.platform === 'darwin' && fs.existsSync(defaultBundle))) {
    return packagedMcpRuntime(requested || defaultBundle)
  }
  const electronPath = require('electron')
  const compiledEntry = path.join(repoRoot, 'dist-electron', 'main.js')
  assert(fs.existsSync(compiledEntry), `compiled Electron entry missing: ${compiledEntry}`)
  return {
    command: electronPath,
    args: [compiledEntry, '--disable-gpu'],
    packaged: false,
    executablePath: electronPath,
  }
}

function proofFor(token, client) {
  return crypto.createHmac('sha256', token).update(`nomi-mcp-client:v1:${client}`).digest('base64url')
}

export function spawnModelIntegrationMcp({ dirs, client = 'codex', signed = true, runtime = resolveRuntime() }) {
  const token = crypto.randomBytes(24).toString('hex')
  fs.writeFileSync(path.join(dirs.capabilityDir, 'token'), token, { mode: 0o600 })
  const identity = signed
    ? { NOMI_MCP_CLIENT: client, NOMI_MCP_CLIENT_PROOF: proofFor(token, client) }
    : { NOMI_MCP_CLIENT: '', NOMI_MCP_CLIENT_PROOF: '' }
  const env = {
    ...process.env,
    NOMI_E2E: '1',
    NOMI_E2E_ALLOW_MULTI_INSTANCE: '1',
    NOMI_MCP_STDIO: '1',
    NOMI_APP_NAME: 'nomi',
    NOMI_SETTINGS_DIR: dirs.settingsDir,
    NOMI_ELECTRON_USER_DATA_DIR: dirs.userDataDir,
    NOMI_PROJECTS_DIR: dirs.projectsDir,
    NOMI_CAPABILITY_DIR: dirs.capabilityDir,
    ...identity,
  }
  const child = spawn(runtime.command, runtime.args, {
    cwd: dirs.tempRoot,
    env,
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  const pending = new Map()
  const stderr = []
  let sequence = 0
  let exit = null
  child.stderr.on('data', (chunk) => {
    for (const line of String(chunk).split('\n')) if (line.trim()) stderr.push(line.trim())
    if (stderr.length > 30) stderr.splice(0, stderr.length - 30)
  })
  const failPending = (error) => {
    for (const [id, entry] of pending) {
      clearTimeout(entry.timer)
      pending.delete(id)
      entry.reject(error)
    }
  }
  child.on('error', (error) => failPending(error instanceof Error ? error : new Error(String(error))))
  child.on('exit', (code, signal) => {
    exit = { code, signal }
    failPending(new Error(`MCP process exited: code=${code} signal=${signal}`))
  })
  readline.createInterface({ input: child.stdout }).on('line', (line) => {
    const value = line.trim()
    if (!value.startsWith('{')) return
    let message
    try {
      message = JSON.parse(value)
    } catch {
      return
    }
    if (message.id == null || !pending.has(message.id)) return
    const entry = pending.get(message.id)
    clearTimeout(entry.timer)
    pending.delete(message.id)
    entry.resolve(message)
  })

  function rpc(method, params = {}, timeoutMs = 30_000) {
    return new Promise((resolve, reject) => {
      const id = ++sequence
      const timer = setTimeout(() => {
        pending.delete(id)
        reject(new Error(`MCP RPC timeout: ${method}`))
      }, timeoutMs)
      pending.set(id, { resolve, reject, timer })
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`)
    })
  }

  async function callTool(name, args, timeoutMs = 60_000) {
    const response = await rpc('tools/call', { name, arguments: args }, timeoutMs)
    if (response.error) throw new Error(response.error.message || JSON.stringify(response.error))
    return response.result
  }

  async function initialize() {
    const response = await rpc(
      'initialize',
      {
        protocolVersion: '2025-11-25',
        capabilities: {},
        clientInfo: { name: 'model-integration-no-repo-harness', version: '1.0' },
      },
      60_000,
    )
    assert(response.result?.serverInfo?.name === 'nomi-capability-core', 'MCP initialize returned Nomi server identity')
    return response.result
  }

  async function terminate() {
    if (child.exitCode !== null || child.signalCode !== null) return
    try {
      child.stdin.end()
    } catch {
      /* already closed */
    }
    try {
      child.kill('SIGTERM')
    } catch {
      /* best effort */
    }
    await Promise.race([
      new Promise((resolve) => child.once('exit', resolve)),
      new Promise((resolve) => setTimeout(resolve, 2_000)),
    ])
    if (child.exitCode === null && child.signalCode === null) {
      try {
        child.kill('SIGKILL')
      } catch {
        /* best effort */
      }
    }
  }

  return { child, rpc, callTool, initialize, terminate, exit: () => exit, stderr: () => [...stderr], runtime }
}

export function parseToolResult(result) {
  const text = Array.isArray(result?.content) ? result.content.find((block) => block?.type === 'text')?.text || '' : ''
  let json = null
  try {
    json = JSON.parse(text)
  } catch {
    const start = text.indexOf('{')
    const end = text.lastIndexOf('}')
    if (start >= 0 && end > start) {
      try {
        json = JSON.parse(text.slice(start, end + 1))
      } catch {
        json = null
      }
    }
  }
  return { json, text, isError: Boolean(result?.isError), outcome: result?.structuredContent?.nomiOutcome || {} }
}

export function assertNoCredentialMaterial(value, label) {
  const serialized = JSON.stringify(value)
  assert(
    !/\b(?:sk-|AIza|AKIA|Authorization\s*:|Bearer\s+[A-Za-z0-9._-]{12,}|apiKey\s*[:=])/i.test(serialized),
    `${label} contains no credential-shaped material`,
  )
}
