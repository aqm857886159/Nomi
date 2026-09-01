// Dev renderer server for the eval v2 dev leg (U3).
//
// WHY A REAL DEV SERVER (not the built dist)
// The canvas perf benchmark normally launches the dev Electron binary but loads
// the *built* dist/ renderer — production React, StrictMode stripped, immer
// freeze checks off. That is exactly the bundle whose numbers looked green while
// users on `pnpm dev` felt lag. To capture the real felt cost we start a Vite
// dev server here (dev React bundle: StrictMode double-render active, immer dev
// freeze on, unminified — so component display names are readable for the
// off-canvas render probe) and point Electron at it via NOMI_RENDERER_URL, the
// same env electron/main.ts:227 reads to load a URL instead of the dist file.
//
// This keeps the dev leg a *measurement configuration*, not a product change:
// zero src/ edits, we only choose which renderer URL the isolated E2E instance
// loads. If the server cannot come up, the caller is told so it can degrade to
// an approximate leg and say so, rather than silently measuring the prod bundle.

import net from 'node:net'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')

function isPortAvailable(port) {
  return new Promise((resolve) => {
    const server = net.createServer()
    server.once('error', () => resolve(false))
    server.once('listening', () => server.close(() => resolve(true)))
    server.listen(port, '127.0.0.1')
  })
}

async function findPort(preferred) {
  for (let port = preferred; port < preferred + 40; port += 1) {
    if (await isPortAvailable(port)) return port
  }
  throw new Error(`dev renderer: no free port from ${preferred}`)
}

function canConnect(host, port) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port })
    const done = (ok) => {
      socket.destroy()
      resolve(ok)
    }
    socket.once('connect', () => done(true))
    socket.once('error', () => done(false))
    setTimeout(() => done(false), 1000)
  })
}

/**
 * Start a Vite dev server serving the Nomi renderer from source.
 *
 * @param {{ preferredPort?: number, readyTimeoutMs?: number }} [options]
 * @returns {Promise<{ url: string, port: number, close: () => Promise<void> }>}
 *   url ends with /index.html so electron/main.ts appends the #/studio route.
 */
export async function startDevRendererServer(options = {}) {
  // Default to 5273 (the port the dev CSP in electron/main.ts:662 whitelists) so
  // the dev-leg origin matches the CSP allowance exactly. Falls back upward if
  // taken (e.g. a real `pnpm dev` is already running).
  const preferredPort = options.preferredPort || 5273
  const readyTimeoutMs = options.readyTimeoutMs || 90_000
  const port = await findPort(preferredPort)
  const viteBin = path.join(path.dirname(require.resolve('vite/package.json')), 'bin', 'vite.js')

  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  const child = spawn(
    process.execPath,
    [viteBin, '--host', '127.0.0.1', '--port', String(port), '--strictPort', '--clearScreen', 'false'],
    { cwd: repoRoot, env, stdio: ['ignore', 'pipe', 'pipe'] },
  )
  const logTail = []
  const keep = (chunk) => {
    for (const line of String(chunk).split('\n')) if (line.trim()) logTail.push(line)
    if (logTail.length > 30) logTail.splice(0, logTail.length - 30)
  }
  child.stdout?.on('data', keep)
  child.stderr?.on('data', keep)

  const close = () =>
    new Promise((resolve) => {
      if (child.exitCode !== null || child.signalCode) return resolve()
      child.once('exit', () => resolve())
      child.kill('SIGTERM')
      setTimeout(() => {
        try {
          child.kill('SIGKILL')
        } catch {
          /* already gone */
        }
        resolve()
      }, 3000)
    })

  // Poll TCP connect until the server accepts, then confirm the entry responds.
  const deadline = Date.now() + readyTimeoutMs
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`dev renderer exited early (code ${child.exitCode}). Last output:\n${logTail.slice(-12).join('\n')}`)
    }
    if (await canConnect('127.0.0.1', port)) break
    await new Promise((r) => setTimeout(r, 250))
  }
  if (!(await canConnect('127.0.0.1', port))) {
    await close()
    throw new Error(`dev renderer never became ready on 127.0.0.1:${port} within ${readyTimeoutMs}ms`)
  }

  return { url: `http://127.0.0.1:${port}/index.html`, port, close }
}
