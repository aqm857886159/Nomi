import fs from 'node:fs'
import path from 'node:path'

function nativeSources(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name)
    if (entry.isDirectory()) return nativeSources(file)
    return entry.isFile() && /\.[mc]ts$/.test(entry.name) && !/\.(?:d|test)\.[mc]ts$/.test(entry.name) ? [file] : []
  })
}

/** Check files only: starting Electron must not initialize the SDK or a session. */
export function assertElectronBuildArtifacts(repoRoot) {
  const { main } = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'))
  if (typeof main !== 'string' || !main) throw new Error('package.json must declare the Electron main entry')
  const configDir = path.join(repoRoot, 'electron')
  const { compilerOptions } = JSON.parse(fs.readFileSync(path.join(configDir, 'tsconfig.pi.json'), 'utf8'))
  const rootDir = path.resolve(configDir, compilerOptions.rootDir)
  const outDir = path.resolve(configDir, compilerOptions.outDir)
  const sources = nativeSources(path.join(configDir, 'harness/runtime/pi'))
  if (!sources.length) throw new Error('Electron private pi runtime has no source modules')
  const outputs = sources.map((file) => path.join(outDir, path.relative(rootDir, file)
    .replace(/\.mts$/, '.mjs').replace(/\.cts$/, '.cjs')))
  const missing = [path.resolve(repoRoot, main), ...outputs]
    .filter((file) => !fs.statSync(file, { throwIfNoEntry: false })?.isFile())
  if (missing.length) {
    throw new Error(`Electron 构建产物不完整：\n${missing.map((file) => path.relative(repoRoot, file)).join('\n')}\n` +
      '→ 先执行：pnpm run build')
  }
}
