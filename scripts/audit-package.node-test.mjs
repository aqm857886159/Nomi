import { makeTempDir } from './_test-temp.mjs'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { checkBudgetFile, checkRuntimeClosure, compareWithBudget, measurePackage, updateBaseline } from './audit-package.mjs'

const require = createRequire(import.meta.url)
const MB = 1024 * 1024

function tempDir(prefix) {
  return makeTempDir(prefix)
}

function peHeader(machine) {
  const header = Buffer.alloc(128)
  header.write('MZ', 0, 'latin1')
  header.writeUInt32LE(64, 0x3c)
  header.write('PE\0\0', 64, 'latin1')
  header.writeUInt16LE(machine, 68)
  return header
}

function elfHeader(machine) {
  const header = Buffer.alloc(64)
  header.write('\x7fELF', 0, 'latin1')
  header[4] = 2
  header[5] = 1
  header.writeUInt16LE(machine, 18)
  return header
}

function write(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, content)
}

function report(overrides = {}) {
  return {
    schema: 1,
    platform: 'win32-x64',
    installers: [{ kind: 'nsis', file: 'Nomi-win-x64.exe', bytes: 200 * MB }],
    installedBytes: 600 * MB,
    asar: { bytes: 100 * MB, packedBytes: 100 * MB, byTopLevel: [], topPackages: [] },
    unpacked: { bytes: 150 * MB, byPackage: [] },
    locales: { count: 2, bytes: 2 * MB, names: ['en-US', 'zh-CN'] },
    packages: ['a', 'b'],
    forbidden: [],
    runtimeClosure: [],
    media: { ok: true, target: 'win32-x64', problems: [] },
    ...overrides,
  }
}

function recordedBudget() {
  return {
    headroomRatio: 0.05,
    platforms: {
      'win32-x64': {
        measuredAt: '2026-09-28',
        baseline: { installedBytes: 600 * MB, asarBytes: 100 * MB, unpackedBytes: 150 * MB, 'installer.nsis': 200 * MB },
        budgets: { installedBytes: Math.ceil(600 * MB * 1.05), asarBytes: Math.ceil(100 * MB * 1.05), unpackedBytes: Math.ceil(150 * MB * 1.05), 'installer.nsis': Math.ceil(200 * MB * 1.05) },
        locales: ['en-US', 'zh-CN'],
        packages: ['a', 'b'],
      },
    },
    history: [],
  }
}

test('和预算比：未超、名单一致 → 绿', () => {
  const verdict = compareWithBudget(report(), recordedBudget())
  assert.deepEqual(verdict.violations, [])
})

test('超预算、多一个包、多一个语言包、禁带文件、闭包断了 → 每条都红', () => {
  const verdict = compareWithBudget(report({
    asar: { bytes: 106 * MB, packedBytes: 106 * MB, byTopLevel: [], topPackages: [] },
    packages: ['a', 'b', 'surprise-ui-lib'],
    locales: { count: 3, bytes: 3 * MB, names: ['de', 'en-US', 'zh-CN'] },
    forbidden: [{ rule: 'source-map', path: 'resources/app.asar/dist-electron/main.js.map', bytes: 10 }],
    runtimeClosure: [{ kind: 'import', from: 'dist-electron/main.js:3', package: 'moved-to-dev' }],
  }), recordedBudget())
  assert.equal(verdict.violations.length, 5)
  assert.ok(verdict.violations.some((line) => line.startsWith('asarBytes 超预算')))
  assert.ok(verdict.violations.some((line) => line.includes('surprise-ui-lib')))
  assert.ok(verdict.violations.some((line) => line.includes('语言包多了：de')))
  assert.ok(verdict.violations.some((line) => line.includes('main.js.map')))
  assert.ok(verdict.violations.some((line) => line.includes('moved-to-dev')))
})

test('没登记的平台：到期前只提醒、禁带文件照样红；到期后红', () => {
  const budget = { headroomRatio: 0.05, platforms: { 'darwin-arm64': { unrecorded: { reason: 'no mac here', expires: '2026-10-12' } } } }
  const mac = report({ platform: 'darwin-arm64' })
  assert.deepEqual(compareWithBudget(mac, budget, { now: '2026-10-01' }).violations, [])
  assert.equal(compareWithBudget(mac, budget, { now: '2026-10-01' }).warnings.length, 1)
  const withMap = report({ platform: 'darwin-arm64', forbidden: [{ rule: 'foreign-binary', path: 'x', bytes: 1, binary: 'pe/x64' }] })
  assert.equal(compareWithBudget(withMap, budget, { now: '2026-10-01' }).violations.length, 1)
  assert.equal(compareWithBudget(mac, budget, { now: '2026-10-13' }).violations.length, 1)
  assert.equal(compareWithBudget(report({ platform: 'linux-x64' }), budget).violations.length, 1)
})

test('改基线：包有毛病不许登记', () => {
  assert.throws(() => updateBaseline(recordedBudget(), report({ forbidden: [{ rule: 'env-file', path: '.env', bytes: 1 }] })), /包本身有问题/)
  assert.throws(() => updateBaseline(recordedBudget(), report({ runtimeClosure: [{ kind: 'peer', from: 'node_modules/x', package: 'y' }] })), /包本身有问题/)
})

test('改基线：变小直接收紧；变大或多包必须写理由并记进 history', () => {
  const shrink = updateBaseline(recordedBudget(), report({ installedBytes: 500 * MB, packages: ['a'] }), { now: '2026-10-01' })
  assert.equal(shrink.budget.platforms['win32-x64'].budgets.installedBytes, Math.ceil(500 * MB * 1.05))
  assert.deepEqual(shrink.budget.platforms['win32-x64'].packages, ['a'])
  assert.deepEqual(shrink.budget.history, [])

  const bigger = report({ asar: { bytes: 120 * MB, packedBytes: 120 * MB, byTopLevel: [], topPackages: [] }, packages: ['a', 'b', 'c'] })
  assert.throws(() => updateBaseline(recordedBudget(), bigger), /基线只许往小改/)
  const allowed = updateBaseline(recordedBudget(), bigger, { allowGrowth: '新增 3D 预览器', now: '2026-10-01' })
  assert.equal(allowed.budget.history.length, 1)
  assert.equal(allowed.budget.history[0].reason, '新增 3D 预览器')
  assert.ok(allowed.budget.history[0].growth.some((line) => line.includes('新增 npm 包 c')))
})

test('改基线：从未登记的平台第一次登记，不需要理由', () => {
  const budget = { headroomRatio: 0.05, platforms: { 'darwin-arm64': { unrecorded: { reason: 'x', expires: '2026-10-12' } } } }
  const { budget: next } = updateBaseline(budget, report({ platform: 'darwin-arm64' }), { now: '2026-10-01' })
  assert.equal(next.platforms['darwin-arm64'].budgets.asarBytes, Math.ceil(100 * MB * 1.05))
  assert.equal(next.platforms['darwin-arm64'].unrecorded, undefined)
})

test('预算文件自检：欠账到期、排除名单与 build.files 不同步、importers 变了都红', () => {
  const budget = {
    headroomRatio: 0.05,
    platforms: { 'darwin-arm64': { unrecorded: { reason: 'x', expires: '2026-10-12' } } },
    excludedModules: { esbuild: { reason: 'build tool', evidence: ['chord/dist/node/bundle.js:4'], importers: ['@earendil-works/chord/dist/node/bundle.js'] } },
  }
  const packageJson = { build: { files: ['dist/**', '!**/node_modules/esbuild/**'] } }
  const importersOf = () => ['@earendil-works/chord/dist/node/bundle.js']
  assert.deepEqual(checkBudgetFile(budget, packageJson, { now: '2026-10-01', importersOf }), [])
  assert.equal(checkBudgetFile(budget, packageJson, { now: '2026-10-13', importersOf }).length, 1)
  const drifted = checkBudgetFile(budget, packageJson, { now: '2026-10-01', importersOf: () => ['@earendil-works/chord/dist/context/index.js', '@earendil-works/chord/dist/node/bundle.js'] })
  assert.equal(drifted.length, 1)
  assert.match(drifted[0], /import 它的文件变了/)
  const unregistered = checkBudgetFile(budget, { build: { files: ['!**/node_modules/esbuild/**', '!**/node_modules/left-pad/**'] } }, { now: '2026-10-01', importersOf })
  assert.deepEqual(unregistered, ['build.files 排除了 left-pad，但 excludedModules 没登记理由'])
  const unsynced = checkBudgetFile(budget, { build: { files: ['dist/**'] } }, { now: '2026-10-01', importersOf })
  assert.match(unsynced[0], /build.files 里没有对应的/)
})

test('运行时闭包：dist-electron 要的包、依赖、非可选 peer 必须解析得到；可选依赖、@types peer、排除名单不算', () => {
  const files = new Map([
    ['dist-electron/main.js', 'require("present-pkg"); require("moved-to-dev"); require("electron"); require("esbuild");'],
    ['node_modules/present-pkg/package.json', JSON.stringify({ dependencies: { 'nested-dep': '1', 'lost-dep': '1', esbuild: '1' }, optionalDependencies: { 'other-platform': '1' }, peerDependencies: { 'needed-peer': '*', '@types/react': '*', 'optional-peer': '*' }, peerDependenciesMeta: { 'optional-peer': { optional: true } } })],
    ['node_modules/present-pkg/node_modules/nested-dep/package.json', '{}'],
  ])
  const directories = new Set(['', 'dist-electron', 'node_modules', 'node_modules/present-pkg', 'node_modules/present-pkg/node_modules', 'node_modules/present-pkg/node_modules/nested-dep'])
  const archive = {
    entries: new Map([...files.keys()].map((key) => [key, { path: key, bytes: 1 }])),
    directories,
    exists: (relative) => files.has(relative),
    readText: (relative) => files.get(relative) ?? null,
  }
  const problems = checkRuntimeClosure(archive, { excluded: new Set(['esbuild']) })
  // esbuild 在排除名单里：第三方包声明它可以豁免，但 dist-electron 自己 import 它就是真缺模块。
  assert.deepEqual(problems.map((problem) => `${problem.kind}:${problem.package}`).sort(), ['dependency:lost-dep', 'import:esbuild', 'import:moved-to-dev', 'peer:needed-peer'])
})

test('端到端：量一个真 asar 的 Windows 产物——禁带文件、外平台二进制、语言包、闭包都查得出', async () => {
  const asar = require('@electron/asar')
  const root = tempDir('nomi-audit-package-')
  const stage = path.join(root, 'stage')
  write(path.join(stage, 'package.json'), '{"name":"nomi","main":"dist-electron/main.js"}')
  write(path.join(stage, 'dist-electron', 'main.js'), 'require("runtime-pkg"); require("ui-lib-moved-to-dev");')
  write(path.join(stage, 'dist-electron', 'main.js.map'), '{}')
  write(path.join(stage, 'public', 'tailwind.generated.css'), 'body{}')
  write(path.join(stage, 'node_modules', 'runtime-pkg', 'package.json'), '{"name":"runtime-pkg"}')
  write(path.join(stage, 'node_modules', 'runtime-pkg', 'index.js'), 'module.exports = 1')
  write(path.join(stage, 'node_modules', 'runtime-pkg', 'vendor', 'linux', 'helper'), elfHeader(0x3e))
  write(path.join(stage, 'node_modules', 'runtime-pkg', 'vendor', 'win', 'helper.exe'), peHeader(0x8664))
  const app = path.join(root, 'win-unpacked')
  write(path.join(app, 'Nomi.exe'), peHeader(0x8664))
  write(path.join(app, 'locales', 'en-US.pak'), 'x')
  write(path.join(app, 'locales', 'de.pak'), 'x')
  fs.mkdirSync(path.join(app, 'resources'), { recursive: true })
  await asar.createPackageWithOptions(stage, path.join(app, 'resources', 'app.asar'), { unpack: '{**/helper,**/helper.exe}' })
  const installer = path.join(root, 'Nomi-win-x64.exe')
  write(installer, Buffer.alloc(2048))

  const measured = measurePackage({ input: app, installers: [installer] })
  assert.equal(measured.platform, 'win32-x64')
  assert.deepEqual(measured.installers, [{ kind: 'nsis', file: 'Nomi-win-x64.exe', bytes: 2048 }])
  assert.deepEqual(measured.locales.names, ['de', 'en-US'])
  assert.deepEqual(measured.packages, ['runtime-pkg'])
  assert.deepEqual(measured.forbidden.map((hit) => `${hit.rule}:${hit.path}`).sort(), [
    'foreign-binary:resources/app.asar.unpacked/node_modules/runtime-pkg/vendor/linux/helper',
    'public-duplicate:resources/app.asar/public/tailwind.generated.css',
    'source-map:resources/app.asar/dist-electron/main.js.map',
  ])
  assert.deepEqual(measured.runtimeClosure.map((problem) => problem.package), ['ui-lib-moved-to-dev'])
  assert.equal(measured.media.ok, false, '合成产物里没有 ffmpeg/ffprobe，媒体目标检查必须如实报红')
  assert.ok(measured.unpacked.bytes > 0)
  fs.rmSync(root, { recursive: true, force: true })
})
