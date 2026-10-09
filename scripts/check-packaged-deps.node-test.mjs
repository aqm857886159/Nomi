import { makeTempDir } from './_test-temp.mjs'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { analyzePackagedDeps, emitMainProcessBuild, validateAllowlist } from './check-packaged-deps.mjs'
import { externalPackageOf, scanModuleReferences } from './lib/moduleReferences.mjs'

function tempDir(prefix) {
  return makeTempDir(prefix)
}

/** 假安装树：name → { manifest }；resolvePackage 按名字查，不看 fromDir。 */
function fakeInstall(packages) {
  return (name) => (packages[name] ? { dir: `/fake/${name}`, manifest: { name, ...packages[name] } } : null)
}

test('扫描器认得 tsc 产出的全部加载写法，也认得 createRequire 的别名', () => {
  const text = [
    '"use strict";',
    'const fs = require("node:fs");',
    'const a = __importDefault(require("pkg-default"));',
    'const b = __importStar(require("@scope/pkg/sub/path"));',
    'Promise.resolve().then(() => __importStar(require("pkg-dynamic")));',
    'const node_module_1 = require("node:module");',
    'const requireFromHere = (0, node_module_1.createRequire)(__filename);',
    'requireFromHere.resolve("pkg-resolved");',
    'const loadFixture = (0, node_module_1.createRequire)(__filename);',
    'loadFixture("pkg-alias");',
    '(0, node_module_1.createRequire)(__filename)("./local.cjs");',
    'require.resolve("pkg-require-resolve/package.json");',
    'const quote = /["\']/g; require("after-regex");',
    '// require("in-comment")',
    'require(`pkg-template`);',
    'require(someVariable);',
  ].join('\n')
  const { references, unresolved } = scanModuleReferences('main.js', text)
  const byKind = (kind) => references.filter((ref) => ref.kind === kind).map((ref) => ref.specifier)
  assert.deepEqual(byKind('import'), ['node:fs', 'pkg-default', '@scope/pkg/sub/path', 'pkg-dynamic', 'node:module', 'pkg-alias', './local.cjs', 'after-regex', 'pkg-template'])
  assert.deepEqual(byKind('resolve'), ['pkg-resolved', 'pkg-require-resolve/package.json'])
  assert.equal(unresolved.length, 1)
  assert.match(unresolved[0].expression, /require\(someVariable\)/)
  assert.equal(references.find((ref) => ref.specifier === 'after-regex').line, 13)
})

test('扫描器认得 ESM 产物：import / export-from / import() / import.meta.resolve / createRequire(import.meta.url)', () => {
  const text = [
    'import { a } from "esm-static";',
    'export * from "esm-reexport";',
    'const m = await import("esm-dynamic");',
    'import.meta.resolve("esm-meta-resolve");',
    'import { createRequire } from "node:module";',
    'createRequire(import.meta.url).resolve("@anthropic-ai/sandbox-runtime/package.json");',
  ].join('\n')
  const { references } = scanModuleReferences('lane.mjs', text)
  assert.deepEqual(references.map((ref) => `${ref.kind}:${ref.specifier}`), [
    'import:esm-static', 'import:esm-reexport', 'import:esm-dynamic', 'resolve:esm-meta-resolve', 'import:node:module',
    'resolve:@anthropic-ai/sandbox-runtime/package.json',
  ])
})

test('内置模块、electron、相对路径不算外部包；作用域包取两段', () => {
  assert.equal(externalPackageOf('node:fs'), null)
  assert.equal(externalPackageOf('fs/promises'), null)
  assert.equal(externalPackageOf('electron'), null)
  assert.equal(externalPackageOf('electron/main'), null)
  assert.equal(externalPackageOf('original-fs'), null)
  assert.equal(externalPackageOf('./x'), null)
  assert.equal(externalPackageOf('#internal'), null)
  assert.equal(externalPackageOf('@scope/pkg/deep/file.js'), '@scope/pkg')
  assert.equal(externalPackageOf('pkg/sub'), 'pkg')
})

test('判词：有证据的留下，没证据的红，主进程要却不在 dependencies 的红', () => {
  const root = tempDir('nomi-packaged-deps-')
  const report = analyzePackagedDeps({
    rootDir: root,
    packageJson: {
      dependencies: { 'runtime-pkg': '1', 'resolved-pkg': '1', 'ui-only': '1', 'peer-of-runtime': '1', 'mentioned-pkg': '1' },
      devDependencies: { 'dev-imported': '1' },
    },
    budget: { runtimeAllowlist: {} },
    emitted: new Map([
      ['main.js', 'require("runtime-pkg"); require("electron"); require("node:path"); require("dev-imported");'],
      ['protocol/assets.js', 'const r = (0, m.createRequire)(__filename); r.resolve("resolved-pkg");'],
      ['proxy.js', 'const dir = path.join(root, "node_modules", "mentioned-pkg");'],
    ]),
    resolvePackage: fakeInstall({
      'runtime-pkg': { peerDependencies: { 'peer-of-runtime': '*', 'optional-peer': '*' }, peerDependenciesMeta: { 'optional-peer': { optional: true } } },
      'resolved-pkg': {},
      'mentioned-pkg': {},
      'peer-of-runtime': {},
    }),
  })
  assert.deepEqual(report.unused, ['ui-only'])
  assert.deepEqual(report.missing.map((item) => [item.name, item.declaredAs]), [['dev-imported', 'devDependencies']])
  assert.deepEqual(report.missingPeers, [])
  assert.deepEqual(report.dependencies['runtime-pkg'].map((item) => item.via), ['import'])
  assert.deepEqual(report.dependencies['resolved-pkg'].map((item) => item.via), ['resolve'])
  assert.deepEqual(report.dependencies['mentioned-pkg'].map((item) => item.via), ['mention'])
  assert.deepEqual(report.dependencies['peer-of-runtime'].map((item) => item.via), ['peer'])
  assert.equal(report.ok, false)
})

test('随包的包要的非可选 peer 不在 dependencies → 红（electron-builder 不跟 peer）', () => {
  const report = analyzePackagedDeps({
    rootDir: tempDir('nomi-packaged-deps-peer-'),
    packageJson: { dependencies: { 'runtime-pkg': '1' }, devDependencies: {} },
    budget: { runtimeAllowlist: {} },
    emitted: new Map([['main.js', 'require("runtime-pkg")']]),
    resolvePackage: fakeInstall({
      'runtime-pkg': { dependencies: { 'transitive-pkg': '1' } },
      'transitive-pkg': { peerDependencies: { 'needed-peer': '*' } },
    }),
  })
  assert.deepEqual(report.missingPeers, [{ name: 'needed-peer', requiredBy: ['transitive-pkg'] }])
  assert.equal(report.ok, false)
})

test('runtimeAllowlist：理由与出处必须是真话，行号漂移只提示', () => {
  const root = tempDir('nomi-packaged-deps-allow-')
  fs.mkdirSync(path.join(root, 'electron'), { recursive: true })
  fs.writeFileSync(path.join(root, 'electron', 'ffmpeg.ts'), 'line one\nconst p = require("path-loaded-tool").path\n')
  const dependencyNames = new Set(['path-loaded-tool', 'no-evidence', 'wrong-file'])
  const { problems, warnings } = validateAllowlist({
    'path-loaded-tool': { reason: 'spawned by path', evidence: ['electron/ffmpeg.ts:1'] },
    'no-evidence': { reason: 'x', evidence: [] },
    'wrong-file': { reason: 'x', evidence: ['electron/ffmpeg.ts:2'] },
    'not-a-dependency': { reason: 'x', evidence: ['electron/missing.ts:3'] },
  }, { rootDir: root, dependencyNames })
  assert.deepEqual(warnings, ['path-loaded-tool：出处 electron/ffmpeg.ts:1 这一行没提到它，现在在第 2 行'])
  assert.ok(problems.some((problem) => problem.startsWith('no-evidence：runtimeAllowlist 条目缺 evidence')))
  assert.ok(problems.some((problem) => problem.startsWith('wrong-file：出处文件 electron/ffmpeg.ts 里根本没提到这个包')))
  assert.ok(problems.some((problem) => problem.startsWith('not-a-dependency：在 runtimeAllowlist 里却不在 dependencies')))
  assert.ok(problems.some((problem) => problem.startsWith('not-a-dependency：出处文件 electron/missing.ts 不存在')))
})

test('allowlist 能救回一个按路径加载、代码里没写包名的依赖', () => {
  const root = tempDir('nomi-packaged-deps-allow-ok-')
  fs.writeFileSync(path.join(root, 'loader.ts'), 'spawn(join(resources, "binary-pkg"))\n')
  const report = analyzePackagedDeps({
    rootDir: root,
    packageJson: { dependencies: { 'binary-pkg': '1' }, devDependencies: {} },
    budget: { runtimeAllowlist: { 'binary-pkg': { reason: 'spawned by path', evidence: ['loader.ts:1'] } } },
    emitted: new Map([['main.js', 'spawn(join(resources, "bin"))']]),
    resolvePackage: fakeInstall({ 'binary-pkg': {} }),
  })
  assert.deepEqual(report.dependencies['binary-pkg'].map((item) => item.via), ['allowlist'])
  assert.equal(report.ok, true)
})

test('内存 emit 与 tsc 同源：只当类型用的导入被省掉，不算运行时证据', () => {
  const root = tempDir('nomi-packaged-deps-emit-')
  fs.mkdirSync(path.join(root, 'src'), { recursive: true })
  fs.writeFileSync(path.join(root, 'tsconfig.json'), JSON.stringify({
    compilerOptions: { module: 'commonjs', target: 'es2022', rootDir: 'src', outDir: 'out', strict: false, types: [], noEmitOnError: true },
    include: ['src/**/*.ts'],
  }))
  fs.writeFileSync(path.join(root, 'src', 'main.ts'), [
    "import type { OnlyType } from 'type-only-pkg'",
    "import { Shape } from 'type-used-pkg'",
    "import { run } from 'value-pkg'",
    'export const value: Shape | OnlyType | null = null',
    'run()',
  ].join('\n'))
  const emitted = emitMainProcessBuild(root, { configs: ['tsconfig.json'] })
  assert.deepEqual([...emitted.keys()], ['main.js'])
  const packages = scanModuleReferences('main.js', emitted.get('main.js')).references.map((ref) => externalPackageOf(ref.specifier)).filter(Boolean)
  assert.deepEqual(packages, ['value-pkg'])
})
