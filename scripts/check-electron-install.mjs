import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { assertElectronInstallIdentity } from './electron-install-identity.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

try {
  const identity = assertElectronInstallIdentity(repoRoot)
  console.log(
    `✅ Electron 安装身份一致：declared=${identity.declaredVersion} · package=${identity.installedVersion} · dist=${identity.distVersion} · runtime=${identity.runtimeVersion}`,
  )
} catch (error) {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
}
