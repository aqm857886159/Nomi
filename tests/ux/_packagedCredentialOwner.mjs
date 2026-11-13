// A packaged MCP Node transport cold-starts the same pre-main-instrumented GUI owner as walks.
import path from 'node:path'
import { launchNomiApp } from './_launchApp.mjs'

const [executablePath, ...args] = process.argv.slice(2)
if (!executablePath || !path.isAbsolute(executablePath)) throw new Error('packaged credential owner requires an absolute executable path')
const directories = ['NOMI_ELECTRON_USER_DATA_DIR', 'NOMI_SETTINGS_DIR', 'NOMI_PROJECTS_DIR', 'NOMI_CAPABILITY_DIR']
if (directories.some((name) => !process.env[name] || !path.isAbsolute(process.env[name]))) throw new Error('packaged credential owner requires isolated profile directories')
const env = { ...process.env, NOMI_MCP_STDIO: '' }
delete env.ELECTRON_RUN_AS_NODE
const instance = await launchNomiApp({
  executablePath, args, env, waitForWindow: false,
  tempRoot: path.dirname(process.env.NOMI_ELECTRON_USER_DATA_DIR),
  userDataDir: process.env.NOMI_ELECTRON_USER_DATA_DIR,
  settingsDir: process.env.NOMI_SETTINGS_DIR,
  projectsDir: process.env.NOMI_PROJECTS_DIR,
  capabilityDir: process.env.NOMI_CAPABILITY_DIR,
})
for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, async () => { await instance.close(); process.exit(0) })
instance.app.process().once('exit', (code) => { process.exitCode = code ?? 1 })
