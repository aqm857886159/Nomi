import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'
import { load } from 'js-yaml'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const actionPath = '.github/actions/cache-external-downloads'
// actions/cache@v4 跑在已弃用的 Node 20 上，每个 job 留一条弃用注解，CI 注解门岗判红（#1469）。三个缓存步骤只认这一个 Node 24 主版本。
const CACHE_ACTION = 'actions/cache@v6'
const protectedEnv = ['electron_config_cache', 'ELECTRON_CACHE', 'PLAYWRIGHT_BROWSERS_PATH', 'ELECTRON_BUILDER_CACHE']
const workflows = fs.readdirSync(path.join(root, '.github/workflows'))
  .filter(name => /\.ya?ml$/.test(name))
  .map(name => [name, load(fs.readFileSync(path.join(root, '.github/workflows', name), 'utf8'))])
const lock = fs.readFileSync(path.join(root, 'pnpm-lock.yaml'), 'utf8')
const scripts = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).scripts

function callsBuilder(command, seen = new Set()) {
  if (/(?:^|\s)electron-builder(?:\s|$)|scripts\/(?:vitest-fair-share|test-focused|run-gates-tests)\.mjs\b/.test(command)) return true
  for (const [, name] of command.matchAll(/\bpnpm\s+(?:run\s+)?([\w:-]+)/g)) {
    if (!scripts[name] || seen.has(name)) continue
    seen.add(name)
    if (callsBuilder(scripts[name], seen)) return true
  }
  return false
}

test('every dependency/browser install restores the shared cache first without overriding its environment', () => {
  let installs = 0
  for (const [file, workflow] of workflows) {
    for (const [id, job] of Object.entries(workflow.jobs ?? {})) {
      const steps = job.steps ?? []
      for (const [index, step] of steps.entries()) {
        const builder = callsBuilder(step.run ?? '')
        if (!builder && !/\bpnpm\s+(?:install|i)\b|ci-install-chromium\.sh|playwright\s+install\b/.test(step.run ?? '')) continue
        installs++
        const label = `${file}#${id}: ${step.run}`
        const cacheIndex = steps.findIndex(candidate => candidate.uses === `./${actionPath}`)
        assert.ok(cacheIndex >= 0 && cacheIndex < index, `${label}: cache must run before install`)
        const cache = steps[cacheIndex]
        assert.equal(cache.if, undefined, `${label}: cache cannot be conditional`)
        assert.equal(cache['continue-on-error'], undefined, `${label}: cache configuration cannot be ignored`)
        if (/ci-install-chromium\.sh|playwright\s+install\b/.test(step.run)) {
          assert.equal(cache.with?.playwright, 'true', `${label}: browser cache must be enabled`)
        }
        if (builder) assert.equal(cache.with?.builder, 'true', `${label}: builder cache must be enabled`)
        for (const owner of [workflow, job, ...steps]) {
          for (const key of protectedEnv) assert.equal(owner.env?.[key], undefined, `${label}: overridden ${key}`)
        }
      }
    }
  }
  assert.ok(installs > 0, 'workflow scan must find installs')
})

function prepare(action, lockSource = lock) {
  const writes = { env: '', output: '' }
  const step = action.runs.steps[0]
  assert.equal(step.shell, 'bash')
  assert.equal(step.if, undefined)
  assert.equal(step.id, 'versions')
  const source = /^node <<'NODE'\n([\s\S]+)\nNODE\s*$/.exec(step.run)?.[1]
  assert.ok(source, 'preparation must run node without installed dependencies')
  vm.runInNewContext(source, {
    require(id) {
      assert.equal(id, 'node:fs')
      return {
        readFileSync(file) { assert.equal(file, 'pnpm-lock.yaml'); return lockSource },
        appendFileSync(file, value) { assert.ok(file in writes); writes[file] += value },
      }
    },
    process: { env: { RUNNER_TEMP: '/runner/temp', GITHUB_ENV: 'env', GITHUB_OUTPUT: 'output' } },
  })
  return Object.fromEntries(Object.entries(writes).map(([file, value]) => [file, Object.fromEntries(value.trim().split('\n').map(line => line.split('=')))]))
}

test('cache paths, version keys and same-platform restore prefixes match the actual downloader environment', () => {
  const action = load(fs.readFileSync(path.join(root, actionPath, 'action.yml'), 'utf8'))
  assert.equal(action.runs.using, 'composite')
  assert.equal(action.runs.steps.length, 4)
  assert.equal(action.inputs.playwright.default, 'false')
  assert.equal(action.inputs.builder.default, 'false')
  const { env, output } = prepare(action)
  assert.equal(env.electron_config_cache, '/runner/temp/nomi-electron-cache')
  assert.equal(env.ELECTRON_CACHE, env.electron_config_cache)
  assert.equal(env.PLAYWRIGHT_BROWSERS_PATH, '/runner/temp/nomi-playwright-cache')
  assert.equal(env.ELECTRON_BUILDER_CACHE, '/runner/temp/nomi-electron-builder-cache')
  const dependencies = load(lock).importers['.'].devDependencies
  assert.equal(output.electron, dependencies.electron.version)
  assert.equal(output.playwright, dependencies.playwright.version)
  assert.equal(output['electron-builder'], dependencies['electron-builder'].version.split('(')[0])
  for (const [index, kind, variable] of [[1, 'electron', 'electron_config_cache'], [2, 'playwright', 'PLAYWRIGHT_BROWSERS_PATH']]) {
    const cache = action.runs.steps[index]
    assert.equal(cache.uses, CACHE_ACTION)
    assert.equal(cache.if, kind === 'playwright' ? "inputs.playwright == 'true'" : undefined)
    assert.equal(cache['continue-on-error'], undefined)
    assert.equal(cache.with.path, `\${{ env.${variable} }}`)
    assert.equal(cache.with.key, `${kind}-v1-\${{ runner.os }}-\${{ runner.arch }}-\${{ steps.versions.outputs.${kind} }}`)
    assert.equal(cache.with['restore-keys'].trim(), `${kind}-v1-\${{ runner.os }}-\${{ runner.arch }}-`)
  }
  const builderCache = action.runs.steps[3]
  assert.equal(builderCache.uses, CACHE_ACTION)
  assert.equal(builderCache.if, "inputs.builder == 'true'")
  assert.equal(builderCache['continue-on-error'], undefined)
  assert.equal(builderCache.with.path, '${{ env.ELECTRON_BUILDER_CACHE }}')
  assert.equal(builderCache.with.key, 'builder-v1-${{ runner.os }}-${{ runner.arch }}-${{ steps.versions.outputs.electron-builder }}-${{ github.workflow }}-${{ github.job }}')
  assert.equal(builderCache.with['restore-keys'].trim(), 'builder-v1-${{ runner.os }}-${{ runner.arch }}-${{ steps.versions.outputs.electron-builder }}-\nbuilder-v1-${{ runner.os }}-${{ runner.arch }}-')
  assert.throws(() => prepare(action, lock.replace('      electron-builder:', '      missing-electron-builder:')), /electron-builder/)
  assert.throws(() => prepare(action, lock.replace('      electron:', '      missing-electron:')), /electron/)
  assert.throws(() => prepare(action, lock.replace(/( {6}electron:\n {8}specifier: [^\n]+\n {8}version: )[^\n]+/, '$143x4x1')), /electron/)
  assert.equal(prepare(action, lock.replaceAll('\n', '\r\n')).output.electron, dependencies.electron.version)
  const changedVersion = lock.replace(/( {6}electron:\n {8}specifier: [^\n]+\n {8}version: )[^\n]+/, '$199.0.0')
  assert.equal(prepare(action, changedVersion).output.electron, '99.0.0')
})

test('Contracts runs this structural gate on every quality-gate execution', () => {
  const workflow = workflows.find(([name]) => name === 'quality-gate.yml')[1]
  const step = workflow.jobs.contracts.steps.find(candidate => candidate.run === 'node --test scripts/ci-external-download-cache.node-test.mjs')
  assert.ok(step, 'new workflows must not bypass the cache contract')
  assert.equal(step.if, undefined)
  assert.equal(step['continue-on-error'], undefined)
})
