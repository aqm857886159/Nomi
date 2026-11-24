// Playwright's Electron driver pins the renderer in the focused state. Connect without
// that override for the two runs that measure Chromium's real page visibility events.
import path from 'node:path'
import { once } from 'node:events'
import { createInterface } from 'node:readline'
import { chromium } from 'playwright'
import { buildWorld } from './_world.mjs'
import { buildNomiLaunchEnv, CREDENTIAL_STORAGE_MODULE, prepareCredentialSource, prepareHostConfigDir,
  prepareLocalStorageSeed, repoRoot, spawnQuietElectron } from './_launchApp.mjs'

export async function launchVisibilityWalk({ initialLocalStorage, env, viewportSize, mainRequire }) {
  const world = buildWorld({ projects: [] })
  const hostConfigDir = path.join(world.rootDir, 'host-config')
  prepareHostConfigDir(hostConfigDir)
  const credential = prepareCredentialSource({ ...world, isolate: true, explicit: true, env, args: [] })
  const child = spawnQuietElectron([
    '-r', CREDENTIAL_STORAGE_MODULE, '-r', path.join(repoRoot, 'tests/ux/t5-onboarding-s6-visibility.cjs'), ...mainRequire.flatMap((file) => ['-r', file]),
    ...prepareLocalStorageSeed(world.rootDir, initialLocalStorage), '.', ...credential.args,
    '--remote-debugging-port=0', '--user-data-dir=' + world.userDataDir,
  ], { cwd: repoRoot, stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
    env: buildNomiLaunchEnv({ ...world, hostConfigDir, capabilityDir: path.join(world.rootDir, 'capability'),
      extraEnv: credential.env, fixtureCredentials: true }) })
  const exited = once(child, 'exit')
  let browser
  const close = async () => {
    try { await browser?.close() } finally {
      if (child.exitCode === null && child.signalCode === null) child.kill()
      await exited
      world.cleanup()
    }
  }
  try {
    const lines = createInterface({ input: child.stderr })
    const endpoint = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => lines.close(), 30_000)
      lines.on('line', (line) => {
        const match = /^DevTools listening on (ws:\/\/127\.0\.0\.1:\d+\/devtools\/browser\/[\w-]+)$/.exec(line)
        if (match) { resolve(match[1]); lines.close() }
      })
      lines.once('close', () => {
        clearTimeout(timeout)
        reject(new Error('Electron did not announce its loopback DevTools endpoint'))
      })
    })
    child.stderr.resume()
    browser = await chromium.connectOverCDP(endpoint, { noDefaults: true })
    const context = browser.contexts()[0]
    const win = context.pages()[0] ?? await context.waitForEvent('page')
    await win.setViewportSize(viewportSize)
    return { win, close, nativeVisibility: (action) => child.send(action) }
  } catch (error) { await close(); throw error }
}
