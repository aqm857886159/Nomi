import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  assertElectronInstallIdentity,
  inspectElectronInstallIdentity,
  isPhysicalPathInside,
  isPathInside,
} from './electron-install-identity.mjs'
import { ensureElectronRuntime } from './install-electron-runtime.mjs'

const VERSION = '43.4.1'
const sourceRepoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function createRepo(options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-electron-identity-'))
  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({ devDependencies: { electron: options.declared ?? VERSION } }),
  )

  const modulesRoot = options.symlinkNodeModules
    ? fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-shared-modules-'))
    : path.join(root, 'node_modules')
  fs.mkdirSync(modulesRoot, { recursive: true })
  if (options.symlinkNodeModules) fs.symlinkSync(modulesRoot, path.join(root, 'node_modules'), 'junction')

  if (options.installed !== null) {
    const externalPackage = options.externalElectronLink || options.externalPnpmStore
    const electronRoot = externalPackage
      ? path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-external-electron-')), 'electron')
      : path.join(modulesRoot, 'electron')
    fs.mkdirSync(electronRoot, { recursive: true })
    fs.writeFileSync(path.join(electronRoot, 'package.json'), JSON.stringify({ version: options.installed ?? VERSION }))
    fs.writeFileSync(path.join(electronRoot, 'install.js'), '// fixture')
    if (options.dist !== null) {
      fs.mkdirSync(path.join(electronRoot, 'dist', 'fixture'), { recursive: true })
      fs.writeFileSync(path.join(electronRoot, 'dist', 'version'), options.dist ?? VERSION)
      fs.writeFileSync(path.join(electronRoot, 'path.txt'), 'fixture/electron')
      fs.writeFileSync(path.join(electronRoot, 'dist', 'fixture', 'electron'), '')
    }
    if (options.externalElectronLink) {
      fs.symlinkSync(electronRoot, path.join(modulesRoot, 'electron'), 'junction')
    } else if (options.externalPnpmStore) {
      fs.symlinkSync(path.dirname(electronRoot), path.join(modulesRoot, '.pnpm'), 'junction')
      fs.symlinkSync(path.join(modulesRoot, '.pnpm', 'electron'), path.join(modulesRoot, 'electron'), 'junction')
    }
  }
  return { root, modulesRoot }
}

function problemCodes(identity) {
  return identity.problems.map((problem) => problem.code)
}

test('path containment follows the host filesystem case semantics on Windows', () => {
  const root = 'C:\\Users\\A\\Nomi\\node_modules'
  assert.equal(isPathInside('c:\\users\\a\\nomi\\node_modules\\.pnpm\\electron', root, path.win32), true)
  assert.equal(isPathInside('C:\\Users\\A\\Nomi-other\\node_modules\\electron', root, path.win32), false)
})

test('physical containment rejects case-sensitive Windows twin worktrees', () => {
  const root = 'C:\\Work\\Nomi\\node_modules'
  const candidate = 'C:\\Work\\nomi\\node_modules\\.pnpm\\electron'
  const identities = new Map([
    [root, { dev: 1n, ino: 10n }],
    [candidate, { dev: 1n, ino: 20n }],
    [path.win32.dirname(candidate), { dev: 1n, ino: 21n }],
    ['C:\\Work\\nomi\\node_modules', { dev: 1n, ino: 22n }],
    ['C:\\Work\\nomi', { dev: 1n, ino: 23n }],
    ['C:\\Work', { dev: 1n, ino: 30n }],
    ['C:\\', { dev: 1n, ino: 31n }],
  ])
  const fsApi = {
    realpathSync: (value) => value,
    statSync: (value) => {
      const identity = identities.get(value)
      if (!identity) throw new Error(`missing fixture identity for ${value}`)
      return identity
    },
  }

  assert.equal(isPhysicalPathInside(candidate, root, fsApi, path.win32), false)
})

test('rejects a shared top-level node_modules link even when every version matches', () => {
  const { root } = createRepo({ symlinkNodeModules: true })
  let probeCalls = 0
  const identity = inspectElectronInstallIdentity(root, {
    probeRuntimeVersion: () => {
      probeCalls += 1
      return VERSION
    },
  })
  assert.deepEqual(problemCodes(identity), ['shared-node-modules'])
  assert.equal(probeCalls, 0, 'shared dependency structures must be rejected before executing their runtime')
  assert.throws(
    () => assertElectronInstallIdentity(root, { probeRuntimeVersion: () => VERSION }),
    /shared-node-modules/,
  )
})

test('rejects the observed pnpm link that detours through another worktree', () => {
  const { root } = createRepo({ externalElectronLink: true })
  const identity = inspectElectronInstallIdentity(root, { probeRuntimeVersion: () => VERSION })
  assert.deepEqual(problemCodes(identity), ['external-electron-package-link'])
})

test('rejects a lexical in-worktree package link whose intermediate pnpm store resolves outside', () => {
  const { root } = createRepo({ externalPnpmStore: true })
  let probeCalls = 0
  const identity = inspectElectronInstallIdentity(root, {
    probeRuntimeVersion: () => {
      probeCalls += 1
      return VERSION
    },
  })
  assert.deepEqual(problemCodes(identity), ['external-electron-package-link'])
  assert.equal(probeCalls, 0, 'an escaped runtime must never be executed while reporting its structural error')
})

test('rejects an installed Electron package from an older worktree', () => {
  const { root } = createRepo({ installed: '31.7.7', dist: '31.7.7' })
  const identity = inspectElectronInstallIdentity(root, {
    probeRuntimeVersion: () => '31.7.7',
  })
  assert.deepEqual(problemCodes(identity), [
    'installed-version-mismatch',
    'dist-version-mismatch',
    'runtime-version-mismatch',
  ])
})

test('rejects a missing downloaded Electron runtime', () => {
  const { root } = createRepo({ dist: null })
  const identity = inspectElectronInstallIdentity(root)
  assert.deepEqual(problemCodes(identity), ['runtime-not-installed'])
})

test('rejects stale dist metadata and the actual stale executable independently', () => {
  const staleDist = createRepo({ dist: '31.7.7' })
  assert.deepEqual(
    problemCodes(inspectElectronInstallIdentity(staleDist.root, { probeRuntimeVersion: () => VERSION })),
    ['dist-version-mismatch'],
  )

  const staleExecutable = createRepo()
  assert.deepEqual(
    problemCodes(
      inspectElectronInstallIdentity(staleExecutable.root, {
        probeRuntimeVersion: () => '31.7.7',
      }),
    ),
    ['runtime-version-mismatch'],
  )
})

test('accepts an isolated install only when package, dist, and executable match the declaration', () => {
  const { root } = createRepo()
  const identity = assertElectronInstallIdentity(root, { probeRuntimeVersion: () => `v${VERSION}` })
  assert.equal(identity.declaredVersion, VERSION)
  assert.equal(identity.installedVersion, VERSION)
  assert.equal(identity.distVersion, VERSION)
  assert.equal(identity.runtimeVersion, VERSION)
})

test('installer repairs only a missing runtime and then validates the exact executable', () => {
  const { root } = createRepo({ dist: null })
  let installs = 0
  const result = ensureElectronRuntime({
    repoRoot: root,
    runInstaller: () => {
      installs += 1
      const electronRoot = path.join(root, 'node_modules', 'electron')
      fs.mkdirSync(path.join(electronRoot, 'dist', 'fixture'), { recursive: true })
      fs.writeFileSync(path.join(electronRoot, 'dist', 'version'), VERSION)
      fs.writeFileSync(path.join(electronRoot, 'path.txt'), 'fixture/electron')
      fs.writeFileSync(path.join(electronRoot, 'dist', 'fixture', 'electron'), '')
    },
    probeRuntimeVersion: () => VERSION,
  })
  assert.equal(installs, 1)
  assert.equal(result.runtimeVersion, VERSION)
})

test('installer never mutates a shared node_modules or an already mismatched package', () => {
  for (const options of [
    { symlinkNodeModules: true, dist: null },
    { externalPnpmStore: true, dist: null },
    { installed: '31.7.7', dist: null },
  ]) {
    const { root } = createRepo(options)
    let installs = 0
    assert.throws(
      () =>
        ensureElectronRuntime({
          repoRoot: root,
          runInstaller: () => {
            installs += 1
          },
        }),
      /shared-node-modules|external-electron-package-link|installed-version-mismatch/,
    )
    assert.equal(installs, 0)
  }
})

test('Cloudflare Workers dependency install never launches the desktop Electron runtime', () => {
  const result = spawnSync(process.execPath, [path.join(sourceRepoRoot, 'scripts', 'install-electron-runtime.mjs')], {
    cwd: sourceRepoRoot,
    env: { ...process.env, WORKERS_CI: '1' },
    encoding: 'utf8',
  })

  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /Skipping Electron desktop runtime install in Cloudflare Workers Builds/)
  assert.doesNotMatch(result.stdout, /runtime installed and verified/)
})

test('all Electron entry points share the identity gate and install repair', () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(sourceRepoRoot, 'package.json'), 'utf8'))
  for (const script of ['build', 'dist', 'dist:mac:dir', 'test:e2e', 'test:mcp', 'test:journeys']) {
    assert.match(
      packageJson.scripts[script],
      /^pnpm run check:electron-install && /,
      `${script} must verify Electron before doing work`,
    )
  }
  // check:fresh-base 是纯 git 读操作（本地未整合 origin/main 就拦下），不算「repository work」，
  // 允许它站在 gates 链头；本门岗钉的顺序不变：Electron identity 仍先于一切真正的工作。
  assert.match(packageJson.scripts.gates, /^(?:pnpm run check:fresh-base && )?pnpm run gates:contracts && /)
  assert.match(packageJson.scripts['gates:contracts'], /^pnpm run check:gates-chain && /)
  const gatesIdentityIndex = packageJson.scripts['gates:contracts'].indexOf('pnpm run check:electron-install')
  const gatesWorkIndex = packageJson.scripts['gates:contracts'].indexOf('pnpm run check:filesize')
  assert.notEqual(gatesIdentityIndex, -1, 'full gates must contain the Electron identity check')
  assert.notEqual(gatesWorkIndex, -1, 'full gates must contain its first repository work gate')
  assert.ok(gatesIdentityIndex < gatesWorkIndex, 'full gates must verify Electron before repository work begins')
  // 这里钉的是**顺序**:Electron runtime 必须第一个装(identity gate 先于其它工作),git hook 紧随其后。
  // 尾部允许再追加安装器——原先用 `$` 把整串钉死,等于「不许新增任何安装器」,那不是本门岗的意图
  // (2026-09-02 加 install-claude-hooks 时撞上)。顺序仍不许动。
  assert.match(
    packageJson.scripts.postinstall,
    /^node \.\/scripts\/install-electron-runtime\.mjs && node \.\/scripts\/install-git-hooks\.cjs(?: && |$)/,
  )
  // Claude harness hook 是 R11/R25/self-check 的执行体,装齐才算装好;别被悄悄摘掉。
  assert.match(
    packageJson.scripts.postinstall,
    /node \.\/scripts\/install-claude-hooks\.cjs/,
    'postinstall must install the versioned Claude harness hooks',
  )

  const devSource = fs.readFileSync(path.join(sourceRepoRoot, 'scripts', 'dev-electron.mjs'), 'utf8')
  const startSource = fs.readFileSync(path.join(sourceRepoRoot, 'scripts', 'start-electron.mjs'), 'utf8')
  const clientSource = fs.readFileSync(path.join(sourceRepoRoot, 'scripts', 'lib', 'nomiClient.mjs'), 'utf8')
  for (const [label, source] of [
    ['dev', devSource],
    ['start', startSource],
  ]) {
    const assertionIndex = source.indexOf('assertElectronInstallIdentity(repoRoot)')
    const requireIndex = source.search(/require\(['"]electron['"]\)/)
    assert.notEqual(assertionIndex, -1, `${label} must contain the identity assertion`)
    assert.notEqual(requireIndex, -1, `${label} must contain the Electron require`)
    assert.ok(assertionIndex < requireIndex, `${label} must assert before resolving Electron`)
  }
  const clientAssertionIndex = clientSource.indexOf('assertElectronInstallIdentity(repoRoot)')
  const clientRequireIndex = clientSource.search(/require\(['"]electron['"]\)/)
  assert.notEqual(clientAssertionIndex, -1, 'MCP host must contain the identity assertion')
  assert.notEqual(clientRequireIndex, -1, 'MCP host must contain the Electron require')
  assert.ok(clientAssertionIndex < clientRequireIndex, 'MCP host must assert before resolving Electron')

  const identitySource = fs.readFileSync(path.join(sourceRepoRoot, 'scripts', 'electron-install-identity.mjs'), 'utf8')
  const signatureIndex = identitySource.indexOf('ensureElectronSignature(executablePath)')
  const probeIndex = identitySource.indexOf('spawnSync(executablePath, args')
  assert.notEqual(signatureIndex, -1)
  assert.notEqual(probeIndex, -1)
  assert.ok(signatureIndex < probeIndex, 'macOS signature safety must precede the executable probe')

  const windowsGate = fs.readFileSync(path.join(sourceRepoRoot, '.github', 'workflows', 'win-gate.yml'), 'utf8')
  assert.match(windowsGate, /- name: Verify actual Electron identity\n\s+run: pnpm run check:electron-install/)
})
