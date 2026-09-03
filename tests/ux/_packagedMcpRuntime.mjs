import fs from 'node:fs'
import path from 'node:path'

export function packagedMcpRuntime(bundlePath, cwd = null) {
  const resolvedBundlePath = path.resolve(bundlePath)
  const executablePath = process.platform === 'darwin'
    ? path.join(resolvedBundlePath, 'Contents', 'MacOS', 'Nomi')
    : resolvedBundlePath
  const launcherPath = process.platform === 'darwin'
    ? path.join(resolvedBundlePath, 'Contents', 'Frameworks', 'Nomi Helper.app', 'Contents', 'MacOS', 'Nomi Helper')
    : executablePath
  const launcherScript = process.platform === 'darwin'
    ? path.join(resolvedBundlePath, 'Contents', 'Resources', 'app.asar', 'dist-electron', 'capabilityCore', 'mcpNodeLauncher.js')
    : path.join(path.dirname(resolvedBundlePath), 'resources', 'app.asar', 'dist-electron', 'capabilityCore', 'mcpNodeLauncher.js')
  if (!fs.existsSync(executablePath) || !fs.existsSync(launcherPath)) {
    throw new Error(`Packaged MCP runtime missing executable/helper: ${executablePath} / ${launcherPath}`)
  }
  return {
    command: launcherPath,
    args: [launcherScript],
    cwd,
    executablePath,
    env: {
      ELECTRON_RUN_AS_NODE: '1',
      NOMI_MCP_APP_COMMAND: executablePath,
      NOMI_MCP_APP_ARGS: '[]',
    },
  }
}
