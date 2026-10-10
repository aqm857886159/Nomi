import fs from 'node:fs'
import path from 'node:path'

function nativeSources(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name)
    if (entry.isDirectory()) return nativeSources(file)
    return entry.isFile() && /\.[mc]ts$/.test(entry.name) && !/\.(?:d|test)\.[mc]ts$/.test(entry.name) ? [file] : []
  })
}

/**
 * 手写的纯 JS CommonJS 模块（electron 目录下手写的 .cjs，不是 .cts）：tsc 不处理它们，由构建原样拷进 dist-electron 的同一相对路径。
 * 构建（build-electron.mjs）与下面的产物检查读这同一个清单，不各写一份。
 */
export function plainCjsSources(electronDir) {
  const found = []
  const walk = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name)
      if (entry.isDirectory()) { if (!/^(?:fixtures|__fixtures__|__tests__)$/.test(entry.name)) walk(file) }
      else if (entry.isFile() && /.cjs$/.test(entry.name) && !/.test.cjs$/.test(entry.name)) found.push(file)
    }
  }
  if (fs.existsSync(electronDir)) walk(electronDir)
  return found
}

/** Check files only: starting Electron must not initialize the SDK or a session. */
export function assertElectronBuildArtifacts(repoRoot) {
  const { main } = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'))
  if (typeof main !== 'string' || !main) throw new Error('package.json must declare the Electron main entry')
  const configDir = path.join(repoRoot, 'electron')
  const { compilerOptions } = JSON.parse(fs.readFileSync(path.join(configDir, 'tsconfig.pi.json'), 'utf8'))
  const rootDir = path.resolve(configDir, compilerOptions.rootDir)
  const outDir = path.resolve(configDir, compilerOptions.outDir)
  const sources = nativeSources(path.join(configDir, 'agentLane'))
  if (!sources.length) throw new Error('Electron private pi runtime has no source modules')
  const outputs = sources.map((file) => path.join(outDir, path.relative(rootDir, file)
    .replace(/\.mts$/, '.mjs').replace(/\.cts$/, '.cjs')))
  const plain = plainCjsSources(configDir).map((file) => path.join(repoRoot, 'dist-electron', path.relative(configDir, file)))
  const missing = [path.resolve(repoRoot, main), ...outputs, ...plain, path.join(repoRoot, 'dist-electron', 'feature-flags.json')]
    .filter((file) => !fs.statSync(file, { throwIfNoEntry: false })?.isFile())
  if (missing.length) {
    throw new Error(`Electron 构建产物不完整：\n${missing.map((file) => path.relative(repoRoot, file)).join('\n')}\n` +
      '→ 先执行：pnpm run build')
  }
}
