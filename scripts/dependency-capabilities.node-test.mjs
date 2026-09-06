// 依赖能力清单抽取判据的测试（R17：加规则必须先证明它会红）。
// 喂的是假的 .d.ts / README 文本，不依赖真实 node_modules——没装依赖的机器上照样有断言可跑。
import assert from 'node:assert/strict'
import test from 'node:test'
import {
  capabilityWords,
  comparePackages,
  extractExportSymbols,
  extractReadmeHeadings,
  fingerprintOf,
  tokenize,
} from './dependency-capabilities-lib.mjs'

test('导出符号：声明式与导出列表两种写法都抽得到，default 不算', () => {
  const source = `
export declare class SessionManager {}
export declare function createRetryPolicy(): void
export type { AgentSessionEvent, Foo as SteerHandle }
export { internal as default }
declare class NotExported {}
`
  assert.deepEqual(extractExportSymbols(source), ['AgentSessionEvent', 'SessionManager', 'SteerHandle', 'createRetryPolicy'])
})

test('README 只取标题行，反引号与星号剥掉', () => {
  const readme = '# `pi` agent core\n\n正文不算\n\n## Session persistence\n### **Retry policy**\n'
  assert.deepEqual(extractReadmeHeadings(readme), ['pi agent core', 'Session persistence', 'Retry policy'])
})

test('分词拆驼峰、去短词与噪音词', () => {
  assert.deepEqual(tokenize('SessionManagerProps'), ['session', 'manager'])
  assert.deepEqual(tokenize('useNodesState'), ['nodes'])  // use 太短、state 是噪音词
  assert.deepEqual(tokenize('ai'), [])
})

test('词表按频次取前 N、落盘按字母序', () => {
  const words = capabilityWords({
    symbols: ['SessionManager', 'SessionStore', 'RetryPolicy'],
    headings: ['Session persistence'],
    limit: 3,
  })
  assert.deepEqual(words, ['manager', 'persistence', 'session'].slice(0, 3).sort())
  assert.ok(words.includes('session'), '出现三次的 session 必须在前三')
})

test('指纹只认版本与词表：版本变、词变都变，文件数不影响', () => {
  const a = fingerprintOf({ version: '1.0.0', words: ['session'] })
  assert.equal(a, fingerprintOf({ version: '1.0.0', words: ['session'] }))
  assert.notEqual(a, fingerprintOf({ version: '1.0.1', words: ['session'] }))
  assert.notEqual(a, fingerprintOf({ version: '1.0.0', words: ['session', 'retry'] }))
})

test('比对：新包 / 版本变 / 词表变都报红，一致则绿', () => {
  const stored = [{ name: 'pkg', version: '1.0.0', fingerprint: 'abc' }]
  assert.deepEqual(comparePackages({ generated: [{ name: 'pkg', version: '1.0.0', fingerprint: 'abc' }], stored }), [])
  assert.match(comparePackages({ generated: [{ name: 'other', version: '1', fingerprint: 'x' }], stored })[0], /清单里没有这个包/)
  assert.match(comparePackages({ generated: [{ name: 'pkg', version: '1.1.0', fingerprint: 'abc' }], stored })[0], /版本从 1\.0\.0 变成 1\.1\.0/)
  assert.match(comparePackages({ generated: [{ name: 'pkg', version: '1.0.0', fingerprint: 'zzz' }], stored })[0], /词表指纹/)
})
