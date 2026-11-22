#!/usr/bin/env node
// T-8 结构防错 ESLint 规则红绿对照测试：
// 用真实仓库 eslint.config.mjs 跑 ESLint.lintText，证明每条规则对真实坏例子必红、对同批好例子零误报。
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, test } from 'node:test'
import { ESLint } from 'eslint'
import { judgeT8BaselineGrowth, loadT8Baseline, T8_BASELINE_PATH, verifyT8BaselineRatchet } from './t8-structural-guards.mjs'

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const eslint = new ESLint({ overrideConfigFile: 'eslint.config.mjs' })

async function ruleIds(code, filePath) {
  const [result] = await eslint.lintText(code, { filePath })
  return result.messages.filter((m) => m.severity === 2).map((m) => m.ruleId)
}

describe('T-8 第 2 类：禁止在已有/新增产品文件偷写通用轮子', () => {
  test('generic-fs-watch：回放 #1618 fs.watch 必红；单槽 lstat 指纹零误报', async () => {
    const bad = await ruleIds("import { watch } from 'node:fs'\nexport const w = watch('/tmp', { recursive: true })\n", 'electron/agentLane/probeWatch.mts')
    assert.ok(bad.includes('generic-fs-watch/no-restricted-syntax'), `期望命中 generic-fs-watch，实际：${bad}`)

    const badMember = await ruleIds("import fs from 'node:fs'\nexport const w = fs.watchFile('/tmp/a', () => {})\n", 'electron/assets/probeWatch.ts')
    assert.ok(badMember.includes('generic-fs-watch/no-restricted-syntax'))

    const good = await ruleIds("import { lstat } from 'node:fs/promises'\nexport async function fp(p: string) { return (await lstat(p, { bigint: true })).mtimeNs }\n", 'electron/agentLane/probeStat.mts')
    assert.ok(!good.includes('generic-fs-watch/no-restricted-syntax'))
  })

  test('generic-map-eviction：回放 #1406 / #1475 手写 Map.keys().next() 淘汰必红；普通 Map 读写零误报', async () => {
    const bad = await ruleIds(
      'const memo = new Map<string, number>()\nexport function put(k: string, v: number) { memo.set(k, v); if (memo.size > 16) { const o = memo.keys().next().value; if (o) memo.delete(o) } }\n',
      'electron/assets/probeCache.ts',
    )
    assert.ok(bad.includes('generic-map-eviction/no-restricted-syntax'), `期望命中 generic-map-eviction，实际：${bad}`)

    const good = await ruleIds(
      'const live = new Map<string, Promise<void>>()\nexport function track(k: string, p: Promise<void>) { live.set(k, p); return live.get(k) }\n',
      'electron/assets/probeTrack.ts',
    )
    assert.ok(!good.includes('generic-map-eviction/no-restricted-syntax'))
  })

  test('generic-raw-rename：electron/ 非 jsonFile.ts 裸调 fs.renameSync / fsp.rename 必红；electron/jsonFile.ts 豁免', async () => {
    const bad = await ruleIds("import fs from 'node:fs'\nexport function mv(a: string, b: string) { fs.renameSync(a, b) }\n", 'electron/assets/probeRename.ts')
    assert.ok(bad.includes('generic-raw-rename/no-restricted-syntax'))

    const badAsync = await ruleIds("import fsp from 'node:fs/promises'\nexport async function mv(a: string, b: string) { await fsp.rename(a, b) }\n", 'electron/assets/probeRenameAsync.ts')
    assert.ok(badAsync.includes('generic-raw-rename/no-restricted-syntax'))

    const goodOwner = await ruleIds("import fs from 'node:fs'\nexport function mv(a: string, b: string) { fs.renameSync(a, b) }\n", 'electron/jsonFile.ts')
    assert.ok(!goodOwner.includes('generic-raw-rename/no-restricted-syntax'))
  })

  test('generic-retry-loop：回放 #1409 指数退避重试必红；#1503 眨眼动效 / #1392 空闲看门狗零误报', async () => {
    const badLoop = await ruleIds(
      'async function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)) }\nexport async function run(fn: () => Promise<void>) { for (let i = 0; i < 3; i += 1) { try { return await fn() } catch { await sleep(Math.pow(2, i) * 100) } } }\n',
      'electron/telemetry/probeRetry.ts',
    )
    assert.ok(badLoop.includes('generic-retry-loop/no-restricted-syntax'), `期望命中 generic-retry-loop，实际：${badLoop}`)

    const badDelayMap = await ruleIds(
      'export function nextDelay(delay: number) { return Math.min(delay * 2, 60_000) }\n',
      'electron/telemetry/probeDelay.ts',
    )
    assert.ok(badDelayMap.includes('generic-retry-loop/no-restricted-syntax'))

    const goodBlink = await ruleIds(
      'export function scheduleBlink(cb: () => void) { const t = setTimeout(cb, 120); return () => clearTimeout(t) }\n',
      'src/design/probeIdentity.tsx',
    )
    assert.ok(!goodBlink.includes('generic-retry-loop/no-restricted-syntax'))

    const goodOwner = await ruleIds(
      'export function nextDelay(delay: number) { return Math.min(delay * 2, 60_000) }\n',
      'electron/sharingRetry.ts',
    )
    assert.ok(!goodOwner.includes('generic-retry-loop/no-restricted-syntax'))
  })
})

describe('T-8 第 3 类：禁止同一判断写两层', () => {
  test('vendor-failure-one-home：非主人文件新写 insufficient_quota / 余额不足 分类必红；vendorFailure.ts 豁免', async () => {
    const badRegex = await ruleIds('export const isBal = (msg: string) => /insufficient_quota|余额不足/.test(msg)\n', 'src/workbench/ai/probeClassify.ts')
    assert.ok(badRegex.includes('vendor-failure-one-home/no-restricted-syntax'))

    const badLiteral = await ruleIds('export const isBal = (code: string) => code === "insufficient_quota"\n', 'electron/ai/probeClassify.ts')
    assert.ok(badLiteral.includes('vendor-failure-one-home/no-restricted-syntax'))

    const goodOwner = await ruleIds('export const isBal = (code: string) => code === "insufficient_quota"\n', 'electron/shared/vendorFailure.ts')
    assert.ok(!goodOwner.includes('vendor-failure-one-home/no-restricted-syntax'))
  })

  test('dual-invalidation：回放 #1618 同模块并写 watch + lstat 必红；只留 lstat 零误报', async () => {
    const bad = await ruleIds(
      "import { watch } from 'node:fs'\nimport { lstat } from 'node:fs/promises'\nexport async function check(p: string) { watch(p, () => {}); return lstat(p) }\n",
      'electron/agentLane/probeDual.mts',
    )
    assert.ok(bad.includes('dual-invalidation/no-restricted-syntax'), `期望命中 dual-invalidation，实际：${bad}`)

    const good = await ruleIds(
      "import { lstat } from 'node:fs/promises'\nexport async function check(p: string) { return lstat(p) }\n",
      'electron/agentLane/probeSingle.mts',
    )
    assert.ok(!good.includes('dual-invalidation/no-restricted-syntax'))
  })
})

describe('T-8 推送前快检迁入 ESLint（检查总数只减不增）', () => {
  test('main-console：electron/ 直接调 console.log 必红；console.log = fn 赋值保护零误报', async () => {
    const bad = await ruleIds('export function f() { console.log("hi") }\n', 'electron/probeConsole.ts')
    assert.ok(bad.includes('main-console/no-restricted-syntax'))

    const goodAssign = await ruleIds('export function redirect(fn: typeof console.log) { console.log = fn }\n', 'electron/probeRedirect.ts')
    assert.ok(!goodAssign.includes('main-console/no-restricted-syntax'))
  })

  test('renderer-sync-ipc：preload 调 sendSync / invokeSync 必红；ipcRenderer.invoke 零误报', async () => {
    const bad = await ruleIds('declare const ipcRenderer: { sendSync(ch: string): unknown }\nexport const x = () => ipcRenderer.sendSync("ch")\n', 'electron/preload/probeBridge.ts')
    assert.ok(bad.includes('renderer-sync-ipc/no-restricted-syntax'))

    const good = await ruleIds('declare const ipcRenderer: { invoke(ch: string): Promise<unknown> }\nexport const x = () => ipcRenderer.invoke("ch")\n', 'electron/preload/probeBridge.ts')
    assert.ok(!good.includes('renderer-sync-ipc/no-restricted-syntax'))
  })

  test('builtin-vendor-literals：vendor.key === "apimart" / .has("kie") / 直调 deriveVendorKeyFromBaseUrl 必红', async () => {
    const badCmp = await ruleIds('export const f = (vendor: { key: string }) => vendor.key === "apimart"\n', 'src/workbench/probeVendor.ts')
    assert.ok(badCmp.includes('builtin-vendor-literals/no-restricted-syntax'))

    const badSet = await ruleIds('export const f = (s: Set<string>) => s.has("kie")\n', 'electron/probeVendor.ts')
    assert.ok(badSet.includes('builtin-vendor-literals/no-restricted-syntax'))

    const badHost = await ruleIds('declare function deriveVendorKeyFromBaseUrl(u: string): string\nexport const f = (u: string) => deriveVendorKeyFromBaseUrl(u)\n', 'electron/probeVendor.ts')
    assert.ok(badHost.includes('builtin-host-step/no-restricted-syntax'))

    const goodOwner = await ruleIds('declare function deriveVendorKeyFromBaseUrl(u: string): string\nexport const f = (u: string) => deriveVendorKeyFromBaseUrl(u)\n', 'electron/catalog/connectionVendorKey.ts')
    assert.ok(!goodOwner.includes('builtin-host-step/no-restricted-syntax'))
  })
})

describe('T-8 存量棘轮精确对账（t8-structural-guards-baseline.json 只减不增，同文件不许再加第 2 处）', () => {
  test('逐个 file × rule 实跑无 ignores ESLint：实际命中数必须严格等于基线 count', async () => {
    const baseline = loadT8Baseline(REPO_ROOT)
    const rules = baseline.rules ?? {}
    const allFiles = [...new Set(Object.values(rules).flatMap((entries) => Object.keys(entries)))].sort()
    const missing = allFiles.filter((file) => !fs.existsSync(path.join(REPO_ROOT, file)))
    assert.deepEqual(missing, [], `基线引用了已不存在的文件，请从 ${T8_BASELINE_PATH} 删掉：${missing.join('、')}`)
    const problems = await verifyT8BaselineRatchet({ root: REPO_ROOT, baseline })
    assert.deepEqual(problems, [], `T-8 存量棘轮漂移：\n${problems.join('\n')}`)
  })

  test('judgeT8BaselineGrowth：只减不增，同文件增数或新增冻结文件必红，减少或清零放行', () => {
    const base = { rules: { 'generic-raw-rename/no-restricted-syntax': { 'electron/a.ts': 2 } } }
    assert.deepEqual(judgeT8BaselineGrowth(base, { rules: { 'generic-raw-rename/no-restricted-syntax': { 'electron/a.ts': 1 } } }), [])
    assert.deepEqual(judgeT8BaselineGrowth(base, { rules: {} }), [])
    const grown = judgeT8BaselineGrowth(base, { rules: { 'generic-raw-rename/no-restricted-syntax': { 'electron/a.ts': 3, 'electron/b.ts': 1 } } })
    assert.equal(grown.length, 1)
    assert.match(grown[0], /electron\/a\.ts.*2 → 3/)
    assert.match(grown[0], /electron\/b\.ts.*0 → 1/)
  })
})
