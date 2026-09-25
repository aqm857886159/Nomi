// 门岗自身的判据测试（R17：加规则必须先验它会红，否则这条规则从第一天起就是装饰）。
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { REGISTRY_FILE, collectSources, declaresDownloadedAssets, evaluate } from './check-supply-chain-pins.mjs'

const DAY = 86_400_000
const today = Date.parse('2026-09-17T00:00:00Z')

const goodPin = {
  id: 'fixture',
  what: '夹具资产',
  sourceFile: 'electron/shared/fixture/assets.ts',
  pinnedVersion: '1.2.3',
  upstreamReleasesUrl: 'https://example.invalid/releases',
  whyNotLatest: '上游每天出构建，升一版就可能静默改变输出；升版要用同一批真素材重测，数字没退再换。',
  pinnedAt: '2026-09-01',
  reviewBy: '2026-11-01',
}
const goodSource = 'export const X = { downloadUrl: "https://example.invalid/v1.2.3/a.zip", sha256: "ab" };'
const sourcesOf = (source = goodSource) => new Map([['electron/shared/fixture/assets.ts', source]])

test('登记与代码一致、日期没过 → 绿', () => {
  const { errors } = evaluate({ registry: { maxReviewDays: 120, pins: [goodPin] }, sources: sourcesOf(), today })
  assert.deepEqual(errors, [])
})

test('代码里的版本换了、登记没跟上 → 红（这是本门岗存在的第一理由）', () => {
  const source = goodSource.replace('1.2.3', '1.3.0')
  const { errors } = evaluate({ registry: { maxReviewDays: 120, pins: [goodPin] }, sources: sourcesOf(source), today })
  assert.match(errors.join('\n'), /在 electron\/shared\/fixture\/assets\.ts 里找不到/)
})

test('复查日期过了 → 红，而且话说清「不是顺手把日期往后挪」', () => {
  const expired = { ...goodPin, reviewBy: '2026-09-16' }
  const { errors } = evaluate({ registry: { maxReviewDays: 120, pins: [expired] }, sources: sourcesOf(), today })
  assert.match(errors.join('\n'), /复查日期 2026-09-16 已过/)
})

test('一次把自己放行超过上限天数 → 红', () => {
  const tooLong = { ...goodPin, reviewBy: '2027-09-01' }
  const { errors } = evaluate({ registry: { maxReviewDays: 120, pins: [tooLong] }, sources: sourcesOf(), today })
  assert.match(errors.join('\n'), /复查期 \d+ 天 > 上限 120 天/)
})

test('「为什么不跟 latest」写成一句空话 → 红', () => {
  const thin = { ...goodPin, whyNotLatest: '为了稳定' }
  const { errors } = evaluate({ registry: { maxReviewDays: 120, pins: [thin] }, sources: sourcesOf(), today })
  assert.match(errors.join('\n'), /whyNotLatest 太短/)
})

test('新接一家声明了下载资产却没登记 → 红', () => {
  const sources = sourcesOf()
  sources.set('electron/shared/other/assets.ts', goodSource)
  const { errors } = evaluate({ registry: { maxReviewDays: 120, pins: [goodPin] }, sources, today })
  assert.match(errors.join('\n'), /electron\/shared\/other\/assets\.ts 声明了运行时下载的资产/)
})

test('只有 sha256 没有 downloadUrl 的文件不算「运行时下载资产」，不误报', () => {
  assert.equal(declaresDownloadedAssets('const sha256 = "ab"'), false)
  assert.equal(declaresDownloadedAssets('downloadUrl: "x"'), false)
  assert.equal(declaresDownloadedAssets(goodSource), true)
})

test('时间字段写坏 → 红，不当成 0 天', () => {
  const broken = { ...goodPin, reviewBy: '很快' }
  const { errors } = evaluate({ registry: { maxReviewDays: 120, pins: [broken] }, sources: sourcesOf(), today })
  assert.match(errors.join('\n'), /pinnedAt \/ reviewBy 要是 YYYY-MM-DD/)
})

test('登记表空着但代码声明了下载资产 → 红（空登记不是通过）', () => {
  const { errors } = evaluate({ registry: { maxReviewDays: 120, pins: [] }, sources: sourcesOf(), today: today + DAY })
  assert.match(errors.join('\n'), /一条 pin 都没有/)
})

test('扫到的源文件键与登记表同一种写法（正斜杠）——Windows 上用 path.join 拼键会把每个已登记文件都报成「没登记」', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nomi-supply-pins-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  fs.mkdirSync(path.join(root, 'electron/shared/fixture'), { recursive: true })
  fs.writeFileSync(path.join(root, 'electron/shared/fixture/assets.ts'), goodSource)
  const sources = collectSources(root)
  assert.deepEqual([...sources.keys()], ['electron/shared/fixture/assets.ts'])
  assert.deepEqual(evaluate({ registry: { maxReviewDays: 120, pins: [goodPin] }, sources, today }).errors, [])
})

test('真仓库：每条登记的 sourceFile 都能在扫描结果里按原样查到', () => {
  const repoRoot = path.resolve(import.meta.dirname, '..')
  const registry = JSON.parse(fs.readFileSync(path.join(repoRoot, REGISTRY_FILE), 'utf8'))
  const keys = new Set(collectSources(repoRoot).keys())
  for (const pin of registry.pins) assert.ok(keys.has(pin.sourceFile), `${pin.sourceFile} 不在扫描结果里`)
})
