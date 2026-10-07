import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { repoRoot, makeIsolatedDirs } from '../ux/_mcpJourney.mjs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { realNomiProfile } from '../ux/_realProfile.mjs'
const require = createRequire(import.meta.url)

export function parseMcpServerNames(configText = '') {
  const names = []
  const seen = new Set()
  const re = /^\s*\[mcp_servers\.(?:"((?:\\.|[^"])*)"|([A-Za-z0-9_-]+))\]\s*$/gm
  for (const match of configText.matchAll(re)) {
    const name = match[1] ? JSON.parse(`"${match[1]}"`) : match[2]
    if (!seen.has(name)) { seen.add(name); names.push(name) }
  }
  return names
}

function assertIsolatedNomiEnv(env) {
  const required = ['NOMI_MCP_STDIO', 'NOMI_ELECTRON_USER_DATA_DIR', 'NOMI_SETTINGS_DIR', 'NOMI_PROJECTS_DIR', 'NOMI_CAPABILITY_DIR']
  for (const key of required) {
    if (!env || typeof env[key] !== 'string' || !env[key].trim()) throw new Error(`Codex MCP env missing ${key}`)
  }
  if (env.NOMI_MCP_STDIO !== '1') throw new Error('Codex MCP env requires NOMI_MCP_STDIO=1')
  const root = path.resolve(env.NOMI_SETTINGS_DIR)
  const tempRoot = path.resolve(os.tmpdir())
  const relativeRoot = path.relative(tempRoot, root)
  if (!relativeRoot || relativeRoot === '..' || relativeRoot.startsWith(`..${path.sep}`) || path.isAbsolute(relativeRoot)) {
    throw new Error('Codex MCP isolation root must be a child of the system temp directory')
  }
  for (const [key, child] of [['NOMI_ELECTRON_USER_DATA_DIR', 'user-data'], ['NOMI_PROJECTS_DIR', 'projects'], ['NOMI_CAPABILITY_DIR', 'capability']]) {
    if (path.resolve(env[key]) !== path.join(root, child)) throw new Error(`Codex MCP env ${key} must be inside the isolation root`)
  }
}

export function buildCodexOverrides(configText, { command, args = [], env }) {
  assertIsolatedNomiEnv(env)
  const key = (name) => /^[A-Za-z0-9_-]+$/.test(name) ? name : JSON.stringify(name)
  const disabled = parseMcpServerNames(configText).map((name) => `mcp_servers.${key(name)}.enabled=false`)
  const commandValue = JSON.stringify(command)
  const argsValue = `[${args.map((arg) => JSON.stringify(arg)).join(',')}]`
  const envValue = `{${Object.entries(env).map(([key, value]) => `${key}=${JSON.stringify(String(value))}`).join(',')}}`
  return [...disabled, `mcp_servers.nomi.enabled=true`, `mcp_servers.nomi.command=${commandValue}`, `mcp_servers.nomi.args=${argsValue}`, `mcp_servers.nomi.env=${envValue}`]
}

function fileFingerprint(file) {
  if (!fs.existsSync(file)) return null
  const stat = fs.statSync(file)
  return { path: file, mtimeMs: stat.mtimeMs, size: stat.size }
}

export function captureFingerprint(home = os.homedir()) {
  const files = [path.join(home, '.codex', 'config.toml'), path.join(home, '.claude.json'), path.join(home, '.claude', 'settings.json')]
  const capabilityDir = path.join(home, '.nomi', 'capability-core')
  const capability = fs.existsSync(capabilityDir)
    ? fs.readdirSync(capabilityDir).sort().map((name) => fileFingerprint(path.join(capabilityDir, name)))
    : []
  const profile = realNomiProfile({ homedir: home })
  const profileFiles = [
    path.join(profile.userDataDir, 'Preferences'),
    path.join(profile.userDataDir, 'Local Storage', 'leveldb', 'LOG'),
  ]
  const logsDir = path.join(profile.userDataDir, 'logs')
  const logs = fs.existsSync(logsDir)
    ? fs.readdirSync(logsDir).sort().map((name) => fileFingerprint(path.join(logsDir, name)))
    : []
  return { files: files.map(fileFingerprint), capability, realProfile: { files: profileFiles.map(fileFingerprint), logs } }
}

export function compareFingerprints(before, after) {
  const a = JSON.stringify(before)
  const b = JSON.stringify(after)
  return { equal: a === b, before, after }
}

function seedProject(projectsDir, settingsDir) {
  const projectId = 'mcp-real-client-fixture'
  const projectName = 'MCP 真客户端预置项目'
  const root = path.join(projectsDir, projectId)
  fs.mkdirSync(path.join(root, '.nomi'), { recursive: true })
  const record = { id: projectId, name: projectName, version: 1, createdAt: Date.now(), updatedAt: Date.now(), savedAt: Date.now(), revision: 1, lastKnownRootPath: root, payload: { timeline: { fps: 30, tracks: [] }, generationCanvas: { nodes: [], edges: [], groups: [] } } }
  fs.writeFileSync(path.join(root, '.nomi', 'project.json'), JSON.stringify(record, null, 2))
  fs.writeFileSync(path.join(settingsDir, 'recent-workspaces.json'), JSON.stringify([{ id: projectId, name: projectName, rootPath: root, lastOpenedAt: Date.now(), missing: false, source: 'folder' }], null, 2))
  return { projectId, projectName }
}

function killTree(child) {
  if (!child?.pid) return
  if (process.platform === 'win32') spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], { windowsHide: true })
  else child.kill('SIGTERM')
}

function runProcess(command, args, env, timeoutMs = 300000) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
    let stdout = ''; let stderr = ''; let timer
    child.stdout.on('data', (chunk) => { stdout += chunk })
    child.stderr.on('data', (chunk) => { stderr += chunk })
    timer = setTimeout(() => { killTree(child); reject(new Error(`client timed out after ${timeoutMs}ms\n${stderr}`)) }, timeoutMs)
    child.on('error', (error) => { clearTimeout(timer); reject(error) })
    child.on('close', (code) => { clearTimeout(timer); resolve({ code, stdout, stderr }) })
  })
}

function parseArgs(argv) {
  const clientAt = argv.indexOf('--client')
  const client = clientAt >= 0 ? argv[clientAt + 1] : 'codex'
  if (!['codex', 'claude'].includes(client)) throw new Error('--client must be codex or claude')
  return { client, dryRun: argv.includes('--dry-run') }
}

export async function main(argv = process.argv.slice(2)) {
  const { client, dryRun } = parseArgs(argv)
  const dirs = makeIsolatedDirs('nomi-real-client-')
  process.once('exit', () => { fs.rmSync(dirs.tempRoot, { recursive: true, force: true }) })
  const fixture = seedProject(dirs.projectsDir, dirs.settingsDir)
  const electron = process.platform === 'win32' ? require('electron') : require('electron')
  const nomiArgs = [repoRoot]
  const nomiEnv = { ...process.env, NOMI_MCP_STDIO: '1', NOMI_ELECTRON_USER_DATA_DIR: dirs.userDataDir, NOMI_SETTINGS_DIR: dirs.settingsDir, NOMI_PROJECTS_DIR: dirs.projectsDir, NOMI_CAPABILITY_DIR: dirs.capabilityDir }
  const before = captureFingerprint()
  let command; let args; let env = nomiEnv; let configFile
  if (client === 'codex') {
    const configPath = path.join(os.homedir(), '.codex', 'config.toml')
    const configText = fs.existsSync(configPath) ? fs.readFileSync(configPath, 'utf8') : ''
    const overrides = buildCodexOverrides(configText, { command: electron, args: nomiArgs, env: {
      NOMI_MCP_STDIO: '1',
      NOMI_ELECTRON_USER_DATA_DIR: dirs.userDataDir,
      NOMI_SETTINGS_DIR: dirs.settingsDir,
      NOMI_PROJECTS_DIR: dirs.projectsDir,
      NOMI_CAPABILITY_DIR: dirs.capabilityDir,
    } })
    const codexArgs = ['exec', '--skip-git-repo-check', ...overrides.flatMap((value) => ['-c', value]), '列出 nomi 服务器的工具名，并调用 nomi_read 的只读 projects 工具，把结果原样贴出。']
    if (process.platform === 'win32') {
      const globalCodex = path.join(process.env.APPDATA || '', 'npm', 'node_modules', '@openai', 'codex', 'bin', 'codex.js')
      if (!fs.existsSync(globalCodex)) throw new Error(`Codex CLI entry not found: ${globalCodex}`)
      command = process.execPath; args = [globalCodex, ...codexArgs]
    }
    else { command = 'codex'; args = codexArgs }
  } else {
    configFile = path.join(dirs.tempRoot, 'mcp-config.json')
    fs.writeFileSync(configFile, JSON.stringify({ mcpServers: { nomi: { command: electron, args: nomiArgs, env: { NOMI_MCP_STDIO: '1', NOMI_ELECTRON_USER_DATA_DIR: dirs.userDataDir, NOMI_SETTINGS_DIR: dirs.settingsDir, NOMI_PROJECTS_DIR: dirs.projectsDir, NOMI_CAPABILITY_DIR: dirs.capabilityDir } } } }, null, 2))
    command = 'claude'; args = ['-p', '--no-session-persistence', '--strict-mcp-config', '--mcp-config', configFile, '列出 nomi 服务器的工具名，并调用 nomi_read 的只读 projects 工具，把结果原样贴出。']
  }
  console.log(JSON.stringify({ client, fixture, command, args, overrides: client === 'codex' ? args.slice(3, -1) : configFile }, null, 2))
  if (!dryRun) {
    const result = await runProcess(command, args, env)
    process.stdout.write(result.stdout); process.stderr.write(result.stderr)
    if (result.code !== 0) throw new Error(`client exited ${result.code}`)
    if (!result.stdout.includes('nomi_read') || !result.stdout.includes(fixture.projectName)) throw new Error('client output did not prove tool and fixture project')
    const after = captureFingerprint(); const comparison = compareFingerprints(before, after)
    console.log(JSON.stringify({ fingerprintEqual: comparison.equal, before, after }, null, 2))
    if (!comparison.equal) throw new Error('user fingerprints changed')
  }
  fs.rmSync(dirs.tempRoot, { recursive: true, force: true })
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((error) => { console.error(error.stack || error); process.exitCode = 1 })
