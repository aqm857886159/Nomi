// Compile the production include and generated manifest through electron-builder's real
// installer AND uninstaller templates. No Windows executables are run by this test.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { afterEach, expect, it } from 'vitest'
import { build, Platform, Arch } from 'electron-builder'
import { cleanupTestTemp, makeTempDir } from '../_test-temp.mjs'
import { SCAN_GUARDS, touchesScanGuard } from '../pre-push-scan-guards.mjs'

const require = createRequire(import.meta.url)
const { writeInstallerManifest } = require('./installer-manifest.cjs')
const repo = fileURLToPath(new URL('../../', import.meta.url))
const pkg = JSON.parse(fs.readFileSync(path.join(repo, 'package.json'), 'utf8'))
const templates = path.join(path.dirname(require.resolve('app-builder-lib/package.json', { paths: [path.dirname(require.resolve('electron-builder'))] })), 'templates', 'nsis')
const include = fs.readFileSync(path.join(repo, pkg.build.nsis.include), 'utf8')
const temps = []
afterEach(() => { for (const root of temps.splice(0)) cleanupTestTemp(root) })

async function compileInstallerTemplates(source) {
  if (pkg.build.nsis.script) throw new Error('Compile guard expects the stock electron-builder template; review custom nsis.script before packaging')
  const projectDir = makeTempDir('installer-compile-')
  temps.push(projectDir)
  const appOutDir = path.join(projectDir, 'payload')
  const output = path.join(projectDir, 'output')
  fs.mkdirSync(path.join(appOutDir, 'resources', '中文 空目录'), { recursive: true })
  for (const rel of ['Nomi.exe', 'resources/app.asar', "resources/it's $5 #1.txt"]) {
    fs.writeFileSync(path.join(appOutDir, rel), 'compile-only fixture')
  }
  fs.writeFileSync(path.join(projectDir, 'package.json'), JSON.stringify({
    name: pkg.name, version: pkg.version, description: pkg.description, author: pkg.author,
  }))
  const includeFile = path.join(projectDir, 'installer.nsh')
  fs.writeFileSync(includeFile, source)
  writeInstallerManifest({ appOutDir, projectDir, productFilename: pkg.build.productName,
    version: pkg.version, arch: 'x64', nsisOptions: pkg.build.nsis })
  const artifacts = []
  // Compile both stock template modes directly. The bootstrap is never executed:
  // syntax checking needs neither Wine on Linux nor access to a Windows desktop.
  // Its embedded uninstaller bytes are an inert fixture, just like Nomi.exe above.
  for (const uninstaller of [true, false]) {
    const embeddedUninstaller = path.join(projectDir, 'uninstaller-bytes.exe')
    fs.writeFileSync(embeddedUninstaller, 'compile-only uninstaller bytes')
    artifacts.push(...await build({
      projectDir, prepackaged: appOutDir,
      targets: Platform.WINDOWS.createTarget('nsis', Arch.x64), publish: 'never',
      effectiveOptionComputed: async ([defines]) => {
        if (uninstaller) defines.BUILD_UNINSTALLER = null
        defines.UNINSTALLER_OUT_FILE = embeddedUninstaller
        return false
      },
      config: {
        // Preserve production NSIS settings and toolsets. Select the stock template
        // explicitly to compile each mode without executing the bootstrap.
        ...structuredClone(pkg.build),
        publish: null,
        electronVersion: require('electron/package.json').version,
        directories: { output: path.join(output, uninstaller ? 'uninstaller' : 'installer'), buildResources: path.join(repo, 'build') },
        icon: path.join(repo, pkg.build.icon),
        win: { ...structuredClone(pkg.build.win), icon: path.join(repo, pkg.build.win.icon), signAndEditExecutable: false },
        nsis: { ...structuredClone(pkg.build.nsis), include: includeFile, script: path.join(templates, 'installer.nsi') },
      },
    }))
  }
  return artifacts
}

// Each compile test runs electron-builder and makensis for real: about 5 s on an idle Mac, past 20 s
// inside the full parallel vitest lane. The timeout only catches a hung compiler; the test never judges
// speed (same rule as testTimeout in vitest.config.ts and the other heavy fixtures under tests/ux).
const COMPILE_TIMEOUT_MS = 120_000

export function registerInstallerCompileTests() {
  it('manifest include uses a path the Windows NSIS 3.04 splitter can resolve', () => {
    const match = /^!include "(\$\{PROJECT_DIR\}[^"\n]+installer-manifest[^"\n]+)"$/m.exec(include)
    expect(match, 'the production manifest include must remain present').not.toBeNull()
    // NSIS v304 util.cpp get_dir_name/get_file_name split only at \\ on Windows.
    // Mac compilation alone cannot catch a forward slash left inside the basename.
    const expanded = match[1].replace('${PROJECT_DIR}', String.raw`D:\a\Nomi\Nomi`).replace('${PRODUCT_FILENAME}', 'Nomi')
    expect(expanded.split(String.fromCharCode(92)).at(-1)).toBe('Nomi-x64.nsh')
  })

  it('compiles the entire production installer and uninstaller with the generated manifest', async () => {
    const artifacts = await compileInstallerTemplates(include)
    const executables = artifacts.filter((file) => file.endsWith('.exe'))
    expect(executables).toHaveLength(2)
    for (const executable of executables) expect(fs.statSync(executable).size).toBeGreaterThan(0)
  }, COMPILE_TIMEOUT_MS)

  it('counterexample: an invalid NSIS instruction is rejected by the real compiler', async () => {
    await expect(compileInstallerTemplates(`${include}\nNomiInvalidInstruction\n`)).rejects.toThrow(/NomiInvalidInstruction|Invalid command/)
  }, COMPILE_TIMEOUT_MS)

  it('pre-push selects real compilation for every installer input', () => {
    const guard = SCAN_GUARDS.find((entry) => entry.file === 'tests/installer/installerScenarios.test.mjs')
    expect(guard).toBeTruthy()
    for (const file of ['build/installer.nsh', 'scripts/packaging/installer-manifest.cjs',
      'scripts/after-pack-mac.cjs', 'package.json', 'pnpm-lock.yaml']) {
      expect(touchesScanGuard(guard, [file]), file).toBe(true)
    }
  })
}
