#!/usr/bin/env node
// T-8 结构防错 ESLint 规则红绿对照测试：
// 用真实仓库 eslint.config.mjs 跑 ESLint.lintText，证明每条规则对真实坏例子必红、对同批好例子零误报。
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { ESLint } from 'eslint'

const eslint = new ESLint({ overrideConfigFile: 'eslint.config.mjs' })

async function lintErrors(code, filePath) {
  const [result] = await eslint.lintText(code, { filePath })
  return result.messages.filter((m) => m.severity === 2)
}

async function ruleIds(code, filePath) {
  return (await lintErrors(code, filePath)).map((m) => m.ruleId)
}

describe('T-8 第 2 类：禁止在已有/新增产品文件偷写通用轮子', () => {
  test('generic-fs-watch：回放 #1618 fs.watch 必红；单槽 lstat 指纹零误报', async () => {
    const bad = await ruleIds(
      "import fs from 'node:fs'\nexport function start(dir: string) { return fs.watch(dir, () => {}) }\n",
      'electron/agentLane/probeWatch.mts',
    )
    assert.ok(bad.includes('generic-fs-watch/no-restricted-syntax'), `期望命中 generic-fs-watch，实际：${bad}`)

    const badNamed = await ruleIds(
      "import { watchFile } from 'node:fs'\nexport const x = watchFile\n",
      'electron/agentLane/probeWatch2.ts',
    )
    assert.ok(badNamed.includes('generic-fs-watch/no-restricted-syntax'))

    const good = await ruleIds(
      "import { lstat } from 'node:fs/promises'\nexport async function fp(dir: string) { return (await lstat(dir)).mtimeMs }\n",
      'electron/agentLane/probeStat.mts',
    )
    assert.ok(!good.includes('generic-fs-watch/no-restricted-syntax'))
  })

  test('generic-map-eviction：回放 #1406 / #1475 手写 Map.keys().next() 淘汰必红；普通 Map 读写零误报', async () => {
    const bad = await ruleIds(
      'const cache = new Map<string, number>()\nexport function put(k: string, v: number) { if (cache.size > 8) { const oldest = cache.keys().next().value; if (oldest) cache.delete(oldest) } cache.set(k, v) }\n',
      'src/workbench/probeCache.ts',
    )
    assert.ok(bad.includes('generic-map-eviction/no-restricted-syntax'), `期望命中 generic-map-eviction，实际：${bad}`)

    const good = await ruleIds(
      'const cache = new Map<string, number>()\nexport function put(k: string, v: number) { cache.set(k, v); return cache.get(k) }\n',
      'src/workbench/probeCacheOk.ts',
    )
    assert.ok(!good.includes('generic-map-eviction/no-restricted-syntax'))
  })

  test('generic-raw-rename：electron/ 非 jsonFile.ts 裸调 fs.renameSync / fsp.rename 必红；electron/jsonFile.ts 豁免', async () => {
    const bad = await ruleIds(
      "import fs from 'node:fs'\nexport function mv(a: string, b: string) { fs.renameSync(a, b) }\n",
      'electron/agentLane/probeRename.ts',
    )
    assert.ok(bad.includes('generic-raw-rename/no-restricted-syntax'))

    const badAsync = await ruleIds(
      "import fsp from 'node:fs/promises'\nexport async function mv(a: string, b: string) { await fsp.rename(a, b) }\n",
      'electron/agentLane/probeRename2.mts',
    )
    assert.ok(badAsync.includes('generic-raw-rename/no-restricted-syntax'))

    const goodOwner = await ruleIds(
      "import fs from 'node:fs'\nexport function mv(a: string, b: string) { fs.renameSync(a, b) }\n",
      'electron/jsonFile.ts',
    )
    assert.ok(!goodOwner.includes('generic-raw-rename/no-restricted-syntax'))
  })

  test('generic-retry-loop：回放 #1409 指数退避重试必红且报错只指 p-retry；#1503 眨眼动效 / #1392 空闲看门狗零误报', async () => {
    const badLoopErrors = await lintErrors(
      'const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))\nexport async function fetchWithRetry(fn: () => Promise<void>) { for (let i = 0; i < 3; i += 1) { try { return await fn() } catch { await sleep(Math.pow(2, i) * 100) } } }\n',
      'electron/ai/probeRetry.ts',
    )
    const hit = badLoopErrors.find((m) => m.ruleId === 'generic-retry-loop/no-restricted-syntax')
    assert.ok(hit, `期望命中 generic-retry-loop，实际：${badLoopErrors.map((m) => m.ruleId)}`)
    assert.match(hit.message, /p-retry/)
    assert.doesNotMatch(hit.message, /sharingRetry|vendorHttp|transientRetry/)

    const badDelayMap = await ruleIds(
      'export function nextDelay(retryDelayMs: number) { return Math.min(retryDelayMs * 2, 30000) }\n',
      'electron/ai/probeRetry2.ts',
    )
    assert.ok(badDelayMap.includes('generic-retry-loop/no-restricted-syntax'))

    const goodBlink = await ruleIds(
      'export function scheduleBlink(cb: () => void) { const t = setTimeout(cb, 2600); return () => clearTimeout(t) }\n',
      'src/ui/app-shell/shell/probeBlink.ts',
    )
    assert.ok(!goodBlink.includes('generic-retry-loop/no-restricted-syntax'))

    const goodIdle = await ruleIds(
      'export function watchdog(onTimeout: () => void) { return setInterval(onTimeout, 5000) }\n',
      'electron/agentLane/probeIdle.mts',
    )
    assert.ok(!goodIdle.includes('generic-retry-loop/no-restricted-syntax'))
  })
})

describe('T-8 第 3 类：禁止同一判断写两层', () => {
  test('vendor-failure-one-home：非主人文件（含 generationFailureDetect.ts）匹配 insufficient_quota / 余额不足必红；仅 vendorFailure.ts 豁免', async () => {
    const badRegex = await ruleIds(
      'export const isBal = (msg: string) => /余额不足|insufficient_quota/i.test(msg)\n',
      'electron/agentLane/probeClassify.mts',
    )
    assert.ok(badRegex.includes('vendor-failure-one-home/no-restricted-syntax'))

    const badDetect = await ruleIds(
      'export const isBal = (text: string) => text.includes("余额不足")\n',
      'electron/shared/generationFailureDetect.ts',
    )
    assert.ok(badDetect.includes('vendor-failure-one-home/no-restricted-syntax'), 'generationFailureDetect.ts 不再豁免，存量走 eslint-suppressions.json')

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

describe('T-8 原独立语法门岗迁入 ESLint（同提交删旧，总数真正净减）', () => {
  test('main-console：electron/**/*.{ts,mts,tsx,cts} 直接调 console.log 必红；console.log = fn 赋值保护零误报', async () => {
    const badTs = await ruleIds('export function f() { console.log("hi") }\n', 'electron/probeConsole.ts')
    assert.ok(badTs.includes('main-console/no-restricted-syntax'))

    const badMts = await ruleIds('export function f() { console.error("hi") }\n', 'electron/agentLane/probeConsole.mts')
    assert.ok(badMts.includes('main-console/no-restricted-syntax'))

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

    const badSet = await ruleIds('export const f = (s: Set<string>) => s.has("kie")\n', 'electron/probeVendor.mts')
    assert.ok(badSet.includes('builtin-vendor-literals/no-restricted-syntax'))

    const badHost = await ruleIds('declare function deriveVendorKeyFromBaseUrl(u: string): string\nexport const f = (u: string) => deriveVendorKeyFromBaseUrl(u)\n', 'electron/probeVendor.ts')
    assert.ok(badHost.includes('builtin-host-step/no-restricted-syntax'))

    const goodOwner = await ruleIds('declare function deriveVendorKeyFromBaseUrl(u: string): string\nexport const f = (u: string) => deriveVendorKeyFromBaseUrl(u)\n', 'electron/catalog/connectionVendorKey.ts')
    assert.ok(!goodOwner.includes('builtin-host-step/no-restricted-syntax'))
  })
})
