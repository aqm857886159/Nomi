import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { ESLint } from 'eslint'
import ts from 'typescript'
import { describe, expect, test } from 'vitest'

// 可达性判据只有一份：门岗自己的 resolveReachable。这里原先抄了一份只认 `pnpm run x` 的
// 正则闭包，gates:contracts 改成 runner 实参清单后它立刻报出「typecheck 不可达」的假红——
// 两份判据必然漂移（R14.1）。要改可达性语义只改 scripts/check-gates-chain.mjs。
import { resolveReachable } from './check-gates-chain.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (relative) => fs.readFileSync(path.join(repoRoot, relative), 'utf8')
const pkg = JSON.parse(read('package.json'))
const nativeTests = ['attachments', 'context', 'session', 'snapshot'].map((name) => `${name}.test.mts`)
const normalizedPath = (value) => path.resolve(value).split(path.sep).join('/')

function json(relative) {
  expect(fs.existsSync(path.join(repoRoot, relative)), `missing integration config: ${relative}`).toBe(true)
  return JSON.parse(read(relative))
}

function stringArrayProperty(relative, propertyName) {
  const source = ts.createSourceFile(relative, read(relative), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  let values
  const visit = (node) => {
    if (ts.isPropertyAssignment(node)
      && ((ts.isIdentifier(node.name) && node.name.text === propertyName)
        || (ts.isStringLiteralLike(node.name) && node.name.text === propertyName))
      && ts.isArrayLiteralExpression(node.initializer)) {
      values = node.initializer.elements
        .filter((element) => ts.isStringLiteralLike(element))
        .map((element) => element.text)
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  if (!values) throw new Error(`missing string-array property ${propertyName} in ${relative}`)
  return values
}

const reachable = (entry) => resolveReachable(pkg.scripts, entry)

describe('private pi build and test wiring', () => {
  test('pins the verified SDK graph while preserving non-Agent ai@4 and Nomi Zod', () => {
    for (const name of ['pi-agent-core', 'pi-ai', 'pi-coding-agent']) {
      expect(pkg.dependencies[`@earendil-works/${name}`]).toBe('0.85.1')
    }
    // The override set is exactly the pi packages that exist in the 0.85.1 tree:
    // the three direct dependencies plus the three they pull in (chord, pi-telemetry,
    // pi-tui). pi-client and pi-protocol left the tree in 0.85.1, so pinning them
    // would be a dead lock nobody can notice going stale.
    expect(Object.keys(pkg.pnpm.overrides ?? {}).filter((name) => name.startsWith('@earendil-works/')).sort())
      .toEqual(['@earendil-works/chord', '@earendil-works/pi-agent-core', '@earendil-works/pi-ai',
        '@earendil-works/pi-coding-agent', '@earendil-works/pi-telemetry', '@earendil-works/pi-tui'])
    for (const name of ['chord', 'pi-agent-core', 'pi-ai', 'pi-coding-agent', 'pi-telemetry', 'pi-tui']) {
      expect(pkg.pnpm.overrides?.[`@earendil-works/${name}`]).toBe('0.85.1')
    }
    expect(pkg.dependencies.typebox).toBe('1.3.7')
    expect(pkg.dependencies['zod-to-json-schema']).toBe('3.25.1')
    expect(pkg.dependencies.zod).toBe('^3.25.76')
    expect(pkg.dependencies.ai).toBe('^4.3.19')
    expect(pkg.engines.node).toBe('>=22.19.0')
  })

  test('uses an independent strict NodeNext island without changing the CommonJS host', () => {
    expect(json('electron/tsconfig.json').compilerOptions.module).toBe('CommonJS')
    const config = json('electron/tsconfig.pi.json')
    expect(config.compilerOptions).toMatchObject({ module: 'NodeNext', moduleResolution: 'NodeNext',
      rootDir: '.', outDir: '../dist-electron', strict: true, noEmitOnError: true })
    // 岛地有两块，因为直接摸 pi 的文件有两处：老 seam（harness/runtime/pi/）和阶段 1 的
    // agent lane（agentLane/，方案 2026-09-07 §6）。两块共用同一个 NodeNext 工程，
    // 而不是各起一个——两个 ESM 工程写同一个 outDir 迟早给同一个文件写出两份不同的产物。
    expect(config.include).toEqual(['harness/runtime/pi/**/*.mts', 'harness/runtime/pi/**/*.cts',
      'agentLane/**/*.mts'])
    const parsed = ts.getParsedCommandLineOfConfigFile(path.join(repoRoot, 'electron/tsconfig.json'), {}, {
      ...ts.sys, onUnRecoverableConfigFileDiagnostic: (diagnostic) => { throw new Error(String(diagnostic.messageText)) },
    })
    const program = ts.createProgram(parsed.fileNames, parsed.options)
    // CommonJS 那半**看不见**任何一块岛地的 .mts/.cts。断言两块而不只是老那块：
    // 只钉一块的话，新岛地哪天漏进 CJS 工程也是静默的——而那正是这条断言存在的意义。
    expect(program.getSourceFiles().filter((file) =>
      /(?:harness\/runtime\/pi|agentLane)\/.*\.[mc]ts$/.test(file.fileName))).toEqual([])
    const host = read('electron/ai/agentChatV2.ts')
    expect(host).toContain("../harness/skillIndex.js")
    expect(host).not.toMatch(/harness\/runtime\/pi\/.*\.(?:m|c)?js/)
  })

  test('root build and dev compile the same entry once; both launch paths check complete artifacts', () => {
    expect(pkg.scripts['build:electron']).toBe('node scripts/build-electron.mjs')
    const dev = read('scripts/dev-electron.mjs')
    expect(dev).toContain('build-electron.mjs')
    expect(dev).not.toContain('tscBin')
    expect(dev.match(/compileElectronMain\(\);/g)).toHaveLength(1)
    expect(read('scripts/start-electron.mjs')).toMatch(/assertElectronBuildArtifacts\(repoRoot\)/)
    const launch = read('tests/ux/_launchApp.mjs')
    expect(launch).toMatch(/if \(isDevElectron\)\s*\{\s*assertElectronBuildArtifacts\(repoRoot\)/)
    expect(launch).not.toContain('function assertBuilt(')
  })

  test('all four native suites run once outside Vitest against private production modules', () => {
    expect(pkg.scripts['test:agent-runtime']).toBe(
      'tsc -p tests/agent-runtime/tsconfig.json && node --test --test-concurrency=1 --test-timeout=60000 .tmp/agent-runtime-tests/tests/agent-runtime/*.test.mjs',
    )
    expect(reachable('test').has('test:agent-runtime')).toBe(true)
    expect(reachable('gates').has('test:agent-runtime')).toBe(true)
    const config = json('tests/agent-runtime/tsconfig.json')
    expect(config.compilerOptions).toMatchObject({ rootDir: '../..', outDir: '../../.tmp/agent-runtime-tests' })
    const vitestIncludes = stringArrayProperty('vitest.config.ts', 'include')
    for (const name of nativeTests) {
      const relative = `tests/agent-runtime/${name}`
      expect(fs.existsSync(path.join(repoRoot, relative)), `missing migrated suite: ${name}`).toBe(true)
      expect(vitestIncludes.some((pattern) => path.matchesGlob(relative, pattern))).toBe(false)
      const source = read(relative)
      expect(source).toContain("from 'node:test'")
      expect(source).toContain('../../electron/harness/runtime/pi/')
      expect(source).not.toMatch(/from ['"]vitest['"]|experiments\/pi-agent-runtime/)
    }
  })

  test('production and zero-error native test types remain reachable from root gates', () => {
    expect(pkg.scripts.typecheck).toContain('tsc -p electron/tsconfig.pi.json --noEmit')
    expect(reachable('gates').has('typecheck')).toBe(true)
    expect(reachable('gates').has('check:test-types')).toBe(true)
    expect(read('scripts/check-test-types.mjs')).toContain('tests/agent-runtime/tsconfig.json')
    const parsed = ts.getParsedCommandLineOfConfigFile(path.join(repoRoot, 'tests/agent-runtime/tsconfig.json'), {}, {
      ...ts.sys, onUnRecoverableConfigFileDiagnostic: (diagnostic) => { throw new Error(String(diagnostic.messageText)) },
    })
    expect(parsed.options.strict).toBe(true)
    expect(parsed.options.noEmitOnError).toBe(true)
    const suites = fs.readdirSync(path.join(repoRoot, 'tests/agent-runtime'))
      .filter((name) => /\.test\.mts$/.test(name))
      .map((name) => normalizedPath(path.join(repoRoot, 'tests/agent-runtime', name))).sort()
    expect(parsed.fileNames.filter((name) => /\.test\.mts$/.test(name)).map(normalizedPath).sort()).toEqual(suites)
  })

  test('ESLint applies production TS rules and Node globals to .mts and .cts', async () => {
    const eslint = new ESLint({ cwd: repoRoot })
    const extensions = ['mts', 'cts']
    const configs = await Promise.all(extensions.map((extension) =>
      eslint.calculateConfigForFile(`electron/harness/runtime/pi/example.${extension}`)))
    for (const config of configs) {
      expect(config.languageOptions.globals?.process).toBe(false)
      expect(config.rules['@typescript-eslint/no-unused-vars'][0]).toBe(1)
    }
  }, 60_000)
})
