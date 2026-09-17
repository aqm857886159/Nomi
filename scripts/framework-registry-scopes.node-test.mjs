// 「scope 指不到东西就报红」这条判据的自测（2026-09-18）。
//
// 为什么必须有：这道判据存在的全部理由，就是**它在真实登记表上会红**。
// 2026-09-18 之前两道门岗都把「目录不存在」当没事发生，于是 whisper-cpp 那条能力的两条禁令
// （其中一条守着用户定的硬约束「一条英语专用权重都不许有」）一次都没扫过，门岗还天天报绿。
// 判据自己不被测，下一次它被改回静默跳过时同样没人知道。
import assert from 'node:assert/strict'
import test from 'node:test'
import { deadScopes, declaredScopes, formatDeadScopes } from './framework-registry-scopes.mjs'

const registry = {
  frameworks: [{
    id: 'demo',
    surface: { scope: ['app/runtime/', 'app/gone/'] },
    capabilities: [
      { id: 'session-persistence', scope: ['app/runtime/'] },
      { id: 'steering', scope: ['app/moved-away/'] },
    ],
  }],
}

/** 假仓库：只有 app/runtime/ 下有源文件；app/empty/ 目录在但没有可扫的文件。 */
const files = ['app/runtime/session.ts', 'app/runtime/nested/steer.ts']
const listScopeFiles = (scope) => files.filter((file) => file.startsWith(scope))
const existing = new Set(['app/runtime/', 'app/empty/'])
const scopeExists = (scope) => existing.has(scope)

test('capability.scope 与 surface.scope 都会被枚举，并各自标出是哪一种', () => {
  const kinds = declaredScopes(registry).map((entry) => `${entry.owner}:${entry.kind}:${entry.scope}`)
  assert.deepEqual(kinds, [
    'surface:surface.scope:app/runtime/',
    'surface:surface.scope:app/gone/',
    'session-persistence:capability.scope:app/runtime/',
    'steering:capability.scope:app/moved-away/',
  ])
})

test('扫不到源文件的 scope 会被报出来；扫得到的不报', () => {
  const dead = deadScopes({ registry, listScopeFiles, scopeExists })
  assert.deepEqual(dead.map((entry) => entry.scope).sort(), ['app/gone/', 'app/moved-away/'])
  assert.ok(dead.every((entry) => entry.reason === '目录不存在'))
})

test('目录在、但一个可扫的源文件都没有 —— 同样算死 scope，措辞不同（修法不一样）', () => {
  const emptyDirRegistry = { frameworks: [{ id: 'demo', capabilities: [{ id: 'c', scope: ['app/empty/'] }] }] }
  const [dead] = deadScopes({ registry: emptyDirRegistry, listScopeFiles, scopeExists })
  assert.equal(dead.reason, '目录在，但没有可扫的非测试源文件')
})

test('only 能把判据限定在一种 scope 上（两道门岗各查自己那一种）', () => {
  const surfaceOnly = deadScopes({ registry, listScopeFiles, scopeExists, only: 'surface.scope' })
  assert.deepEqual(surfaceOnly.map((entry) => entry.scope), ['app/gone/'])
  const capabilityOnly = deadScopes({ registry, listScopeFiles, scopeExists, only: 'capability.scope' })
  assert.deepEqual(capabilityOnly.map((entry) => entry.scope), ['app/moved-away/'])
})

test('报红文案指名 framework / 归属 / 哪一种 scope / 具体路径 —— 不指名等于让人自己去猜', () => {
  const text = formatDeadScopes(deadScopes({ registry, listScopeFiles, scopeExists }), 'docs/x.json')
  assert.match(text, /demo\/surface 的 surface\.scope "app\/gone\/"/)
  assert.match(text, /demo\/steering 的 capability\.scope "app\/moved-away\/"/)
  assert.match(text, /docs\/x\.json/)
})

test('登记表没有 frameworks / capabilities 时不炸，返回空（合法性由各自的 validateRegistry 管）', () => {
  assert.deepEqual(deadScopes({ registry: {}, listScopeFiles: () => [] }), [])
  assert.deepEqual(declaredScopes(null), [])
})
