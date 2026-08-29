import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  assertElectronInstallIdentity,
  formatElectronInstallError,
  inspectElectronInstallIdentity,
} from './electron-install-identity.mjs'

const scriptPath = fileURLToPath(import.meta.url)

function defaultRunInstaller(repoRoot) {
  const installerPath = path.join(repoRoot, 'node_modules', 'electron', 'install.js')
  const result = spawnSync(process.execPath, [installerPath], {
    cwd: repoRoot,
    env: process.env,
    stdio: 'inherit',
    windowsHide: true,
  })
  if (result.error) throw result.error
  if (result.signal || result.status !== 0) {
    throw new Error(`Electron runtime installer failed (${result.signal ?? result.status ?? 'unknown'})`)
  }
}

export function ensureElectronRuntime(options = {}) {
  const repoRoot = options.repoRoot ?? path.resolve(path.dirname(scriptPath), '..')
  const inspectOptions = { probeRuntimeVersion: options.probeRuntimeVersion }
  const before = inspectElectronInstallIdentity(repoRoot, inspectOptions)
  const structuralProblems = before.problems.filter((entry) => entry.code !== 'runtime-not-installed')
  if (structuralProblems.length > 0) {
    const identity = { ...before, problems: structuralProblems }
    const error = new Error(formatElectronInstallError(identity))
    error.name = 'ElectronInstallIdentityError'
    error.identity = identity
    throw error
  }
  if (before.problems.some((entry) => entry.code === 'runtime-not-installed')) {
    ;(options.runInstaller ?? defaultRunInstaller)(repoRoot)
  }
  return assertElectronInstallIdentity(repoRoot, inspectOptions)
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === scriptPath
if (invokedDirectly) {
  if (process.env.WORKERS_CI === '1') {
    console.log('ℹ️  Skipping Electron desktop runtime install in Cloudflare Workers Builds')
  } else {
    try {
      const identity = ensureElectronRuntime()
      console.log(`✅ Electron ${identity.runtimeVersion} runtime installed and verified`)
    } catch (error) {
      console.error(error instanceof Error ? error.message : error)
      process.exitCode = 1
    }
  }
}
