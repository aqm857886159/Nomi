import { makeTempDir } from '../../scripts/_test-temp.mjs'
// 付费走查的 env-key 凭据来源：选路判据、key 卫生、整条 openPaidWalk 接线（换掉真 App / 真界面）。
// 全部合成目录与假 key，不碰任何真实资料、不起 App、不花钱、不出网。
import fs from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'

import { APIMART_TEXT_MODELS } from '../../electron/catalog/apimartTexts.ts'
import { APIMART_VENDOR_SEED } from '../../electron/catalog/apimartVendor.ts'
import { paidWalkAllowlist } from './_paidNetwork.mjs'
import {
  APIMART_TEXT_MODEL_KEYS, ENV_KEY_ALLOW_CATALOG, ENV_KEY_VAR, REDACTED, assertNoSecretOnDisk, assertUsableEnvKey, envKeyOf,
  filesContainingSecret, paidCredentialSource, redact, redactNetLogEntry, redactedError,
} from './_paidEnvKey.mjs'
import { assertEnvKeyModels, envKeyBrainOf, openPaidWalk, paidRunRefusal } from './_paidRun.mjs'
import { finalizeRuntimeWalk } from './agent-runtime-walk-support.mjs'

// 合成 key：形状像真 key，值纯属虚构。
const KEY = 'sk-test-ENVKEY-0123456789abcdef'

const roots = []
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
  delete globalThis.window
})
function tempRoot() {
  const root = makeTempDir('nomi-paid-env-key-test-')
  roots.push(root)
  return root
}

describe('凭据来源的唯一判据', () => {
  test('设了 APIMART_API_KEY 才走 env-key；没设 / 全空白仍是 real-profile（和这条路出现之前一样）', () => {
    expect(paidCredentialSource({})).toBe('real-profile')
    expect(paidCredentialSource({ [ENV_KEY_VAR]: '   ' })).toBe('real-profile')
    expect(paidCredentialSource({ [ENV_KEY_VAR]: KEY })).toBe('env-key')
    expect(envKeyOf({ [ENV_KEY_VAR]: `  ${KEY}\n` })).toBe(KEY)
  })

  test('env-key 路不要求「用户的 Nomi 没开着」（它不拷真实资料）；real-profile 路照旧要求；两路都挡 CI 与缺 NOMI_SPEND_OK', () => {
    const base = { NOMI_SPEND_OK: '1' }
    expect(paidRunRefusal('x.paid.mjs', { env: { ...base, [ENV_KEY_VAR]: KEY }, nomiRunning: true })).toBeNull()
    expect(paidRunRefusal('x.paid.mjs', { env: base, nomiRunning: true })).toContain('真实资料目录')
    expect(paidRunRefusal('x.paid.mjs', { env: { ...base, CI: '1', [ENV_KEY_VAR]: KEY } })).toContain('CI')
    expect(paidRunRefusal('x.paid.mjs', { env: { [ENV_KEY_VAR]: KEY } })).toContain('NOMI_SPEND_OK')
  })

  test('key 形状不对就拒，且报错里不回显它', () => {
    for (const bad of ['short', 'has space in it key']) {
      let message = ''
      try { assertUsableEnvKey(bad) } catch (error) { message = error.message }
      expect(message).toContain(ENV_KEY_VAR)
      expect(message).not.toContain(bad)
    }
    expect(assertUsableEnvKey(KEY)).toBe(KEY)
  })
})

describe('key 卫生：抹掉', () => {
  test('redact 抹掉原串、鉴权头、Bearer 串、URL 里的 key / token 参数', () => {
    const text = `fill("${KEY}") Authorization: Bearer ${KEY} | "authorization":"Bearer abcdefgh12345678" | https://x.test/v1?api_key=zzz999&k=1 | token=${KEY}`
    const out = redact(text, [KEY])
    expect(out).not.toContain(KEY)
    expect(out).not.toContain('abcdefgh12345678')
    expect(out).not.toContain('zzz999')
    expect(out).toContain(REDACTED)
  })

  test('Playwright 的 fill 超时会把 value 写进调用日志——redactedError 的 message 与 stack 都不带 key', () => {
    // 形状取自真 Playwright（2026-10-16 用 _electron 起一个带 disabled 输入框的页面实测：`- fill("<value>")` 原样出现在 Call log 里）。
    const original = new Error(`locator.fill: Timeout 30000ms exceeded.\nCall log:\n  - waiting for locator('#key-only-apimart')\n  - fill("${KEY}")`)
    const safe = redactedError(original, [KEY])
    expect(safe.message).not.toContain(KEY)
    expect(safe.stack).not.toContain(KEY)
    expect(safe.message).toContain('#key-only-apimart')
    expect(safe.cause).toBeUndefined()
  })

  test('网络账本的一行如果带了鉴权头 / key，落盘前被打码', () => {
    const entry = { kind: 'request', url: 'https://api.apimart.ai/v1/balance', headers: { authorization: `Bearer ${KEY}` }, extra: KEY }
    const out = redactNetLogEntry(entry, [KEY])
    expect(JSON.stringify(out)).not.toContain(KEY)
    expect(out.url).toBe(entry.url)
  })
})

describe('key 卫生：证据目录里不许有', () => {
  test('文件内容或文件名里有 key，就被找出来；报错只说文件、不说内容', () => {
    const dir = tempRoot()
    fs.writeFileSync(path.join(dir, 'clean.json'), '{"ok":true}')
    fs.mkdirSync(path.join(dir, 'sub'))
    fs.writeFileSync(path.join(dir, 'sub', 'report.json'), `{"leak":"${KEY}"}`)
    fs.writeFileSync(path.join(dir, `shot-${KEY}.png`), 'png')
    expect(filesContainingSecret(dir, [KEY]).sort()).toEqual([`shot-${KEY}.png`, path.join('sub', 'report.json')].sort())
    expect(() => assertNoSecretOnDisk(dir, [KEY])).toThrow(/泄漏/)
    let message = ''
    try { assertNoSecretOnDisk(dir, [KEY]) } catch (error) { message = error.message }
    expect(message).not.toContain('"leak"')
    fs.rmSync(path.join(dir, 'sub'), { recursive: true })
    fs.rmSync(path.join(dir, `shot-${KEY}.png`))
    expect(() => assertNoSecretOnDisk(dir, [KEY])).not.toThrow()
  })
})

describe('登记表和产品代码对得上', () => {
  test('env-key 路的出网名单只含 APIMart 的 API 源与成品域名；API 源和产品里的 APIMART_VENDOR_SEED 是同一个', () => {
    expect(ENV_KEY_ALLOW_CATALOG.vendors[0].baseUrlHint).toBe(APIMART_VENDOR_SEED.baseUrl)
    expect(paidWalkAllowlist(ENV_KEY_ALLOW_CATALOG, ['apimart'])).toEqual([APIMART_VENDOR_SEED.baseUrl, '*.getapib.org'])
  })

  test('接入页要验证的文本模型清单 = 产品里 APIMart 的文本模型（去掉只做提示词增强的那个）', () => {
    const chatKeys = APIMART_TEXT_MODELS.filter((model) => model.meta?.promptRefineOnly !== true).map((model) => model.modelKey)
    expect([...APIMART_TEXT_MODEL_KEYS].sort()).toEqual([...chatKeys].sort())
  })

  test('点名了别家的模型就在花钱前拒；大脑取名单里点名的 APIMart 文本模型，没点名用 deepseek-v4-pro', () => {
    expect(() => assertEnvKeyModels([{ vendorKey: 'kie', modelKey: 'x' }])).toThrow(/一分钱没花/)
    expect(() => assertEnvKeyModels([{ vendorKey: 'apimart', modelKey: 'z-image-turbo' }])).not.toThrow()
    expect(envKeyBrainOf([{ vendorKey: 'apimart', modelKey: 'deepseek-v4-flash' }, { vendorKey: 'apimart', modelKey: 'z-image-turbo' }])).toBe('deepseek-v4-flash')
    expect(envKeyBrainOf([{ vendorKey: 'apimart', modelKey: 'z-image-turbo' }])).toBe('deepseek-v4-pro')
  })
})

/** 一个能跑完 openPaidWalk 全程的假隔离实例：真文件、真 finalizeRuntimeWalk，只是不起 App。 */
function fakeWalkFactory() {
  const root = tempRoot()
  const tempRootDir = path.join(root, 'isolated-copy')
  const outputDir = path.join(root, 'evidence')
  fs.mkdirSync(path.join(tempRootDir, 'settings'), { recursive: true })
  fs.mkdirSync(path.join(tempRootDir, 'projects', 'p1', '.nomi'), { recursive: true })
  fs.writeFileSync(path.join(tempRootDir, 'settings', 'model-catalog.json'), '{"apiKeysByVendor":{"apimart":{"enc":"safeStorage"}}}')
  fs.mkdirSync(outputDir, { recursive: true })
  // 日志里带着 key（真 App 的日志不该有，但卫生不靠这个假设）：收尾要把它们抹过再拷进证据目录。
  fs.mkdirSync(path.join(tempRootDir, 'user-data', 'logs'), { recursive: true })
  fs.writeFileSync(path.join(tempRootDir, 'user-data', 'logs', 'nomi.log'), `INFO main boot
WARN agent Authorization: Bearer ${KEY} failed
`)
  fs.mkdirSync(path.join(tempRootDir, 'projects', 'p1', '.nomi', 'agent-sessions', 's'), { recursive: true })
  fs.writeFileSync(path.join(tempRootDir, 'projects', 'p1', '.nomi', 'agent-sessions', 's', 'a.jsonl'), `{"v":4,"kind":"header","id":"s"}
{"error":"fill(${KEY})"}
`)
  const seen = { opts: null, stopped: 0 }
  const createWalk = async (name, opts) => {
    seen.opts = opts
    const report = { name, tempRoot: tempRootDir, outputDir, projectRoot: path.join(tempRootDir, 'projects', 'p1') }
    return {
      report, outputDir, settingsDir: path.join(tempRootDir, 'settings'), userDataDir: path.join(tempRootDir, 'user-data'),
      fixture: { close: async () => {}, unexpected: [] },
      stopApp: async () => { seen.stopped += 1 },
      finish: async (error, { collect } = {}) => { await finalizeRuntimeWalk(report, { error, cleanup: [], collect }) },
    }
  }
  return { createWalk, seen, tempRootDir, outputDir, root }
}

/** 假界面：listModels / upsertModel 跑在内存里，lockSpendToModels 的 win.evaluate 直接调用传入的函数。 */
function fakeWin() {
  const rows = [
    { vendorKey: 'apimart', modelKey: 'deepseek-v4-flash', kind: 'text', labelZh: 'DeepSeek V4 Flash', enabled: true, availability: { usable: true } },
    { vendorKey: 'apimart', modelKey: 'z-image-turbo', kind: 'image', labelZh: 'Z-Image Turbo', enabled: true, availability: { usable: true } },
    { vendorKey: 'apimart', modelKey: 'gpt-image-2', kind: 'image', labelZh: 'GPT Image 2', enabled: true, availability: { usable: true } },
  ]
  globalThis.window = { nomiDesktop: { modelCatalog: {
    listModels: () => rows,
    upsertModel: ({ modelKey, enabled }) => { rows.find((row) => row.modelKey === modelKey).enabled = enabled },
  } } }
  return { evaluate: async (fn, arg) => fn(arg), rows }
}

// 这些测试用假 App 验的是凭据 / 收窄 / 收尾；构建检查有自己的测试（_paidRun.test.mjs）。
const noBuildCheck = () => {}
const MODELS = [{ vendorKey: 'apimart', modelKey: 'deepseek-v4-flash' }, { vendorKey: 'apimart', modelKey: 'z-image-turbo' }]

describe('openPaidWalk · env-key 路（假 App、假界面）', () => {
  function envFor(root) {
    // 真实资料目录指向一个不存在的地方：这一路要是去读它，当场就会抛「真实资料目录缺…」。
    return { NOMI_SPEND_OK: '1', [ENV_KEY_VAR]: KEY, NOMI_REAL_PROFILE_USER_DATA: path.join(root, 'no-such-real-profile') }
  }

  test('不读真实资料、key 经接入页函数进去、花钱面收窄、跑完隔离副本已删、key 不在任何落盘文件里', async () => {
    const { createWalk, seen, tempRootDir, outputDir, root } = fakeWalkFactory()
    const win = fakeWin()
    const connectCalls = []
    const paid = await openPaidWalk('x.paid.mjs', 'x', MODELS, {
      assertBuild: noBuildCheck, env: envFor(root), createWalk, isNomiRunning: () => true,
      connect: async (_win, args) => { connectCalls.push(args); return { vendorKey: 'apimart', certifiedTextModel: args.textModelKey, viaVisibleOnboarding: true } },
    })
    // 被测 App 的环境里 key 被清空（子进程拿不到）。
    expect(seen.opts.env[ENV_KEY_VAR]).toBe('')
    expect(seen.opts.env.NOMI_WALK_ALLOW_ORIGINS).toBe('https://api.apimart.ai,*.getapib.org')
    // 网络账本里塞一行带鉴权头的（账本本来不记请求头——这是防它哪天开始记）。
    fs.appendFileSync(seen.opts.env.NOMI_WALK_NET_LOG, `${JSON.stringify({ kind: 'guard-loaded', layers: ['fetch', 'socket', 'chromium'] })}\n`)
    await paid.lockToAuthorizedModels(win)
    fs.appendFileSync(seen.opts.env.NOMI_WALK_NET_LOG, `${JSON.stringify({ kind: 'request', url: 'https://api.apimart.ai/v1/balance', headers: { authorization: `Bearer ${KEY}` } })}\n`)
    expect(connectCalls).toEqual([{ apiKey: KEY, textModelKey: 'deepseek-v4-flash', requiredModels: MODELS }])
    expect(paid.label('apimart', 'z-image-turbo')).toBe('Z-Image Turbo')
    // 花钱面收窄：被授权的图片模型之外的生成模型都停了，文本模型不动。
    expect(win.rows.filter((row) => row.enabled).map((row) => row.modelKey).sort()).toEqual(['deepseek-v4-flash', 'z-image-turbo'])
    await paid.finish(undefined)

    expect(fs.existsSync(tempRootDir), '整个隔离副本已删除').toBe(false)
    const report = JSON.parse(fs.readFileSync(path.join(outputDir, 'report.json'), 'utf8'))
    expect(report.result).toBe('passed')
    expect(report.isolatedCopyRemoved).toBe(true)
    expect(report.credentialSource).toContain(ENV_KEY_VAR)
    expect(report.envKeyConnect.viaVisibleOnboarding).toBe(true)
    expect(report.realProfileBefore).toBeUndefined()
    expect(fs.existsSync(path.dirname(seen.opts.env.NOMI_WALK_NET_LOG)), '网络账本原件连同临时目录已删').toBe(false)
    expect(fs.readFileSync(path.join(outputDir, 'net-log.redacted.jsonl'), 'utf8')).toContain(REDACTED)
    expect(filesContainingSecret(outputDir, [KEY]), '证据目录里没有 key').toEqual([])
    expect(report.appLogsCopied.sort(), '主进程日志与 lane 记录先拷出来再删副本').toEqual(['lane-sessions/s/a.jsonl', 'main-logs/nomi.log'])
    expect(fs.readFileSync(path.join(outputDir, 'app-logs', 'main-logs', 'nomi.log'), 'utf8')).toContain('WARN agent')
    expect(fs.existsSync(path.join(root, 'no-such-real-profile')), '真实资料目录没被碰').toBe(false)
  })

  test('走查脚本抛的异常里带着 key（例如 Playwright 的 fill 日志）：报告里的 error 是抹过的', async () => {
    const { createWalk, outputDir, root } = fakeWalkFactory()
    const paid = await openPaidWalk('x.paid.mjs', 'x', MODELS, { assertBuild: noBuildCheck, env: envFor(root), createWalk, connect: async () => ({}) })
    process.exitCode = 0
    await paid.finish(new Error(`locator.fill: Timeout - fill("${KEY}")`))
    process.exitCode = 0
    const report = JSON.parse(fs.readFileSync(path.join(outputDir, 'report.json'), 'utf8'))
    expect(report.result).toBe('failed')
    expect(report.error).toContain(REDACTED)
    expect(report.error).not.toContain(KEY)
  })

  test('key 要是漏进了报告内容：落盘与打印的是抹过的那份，这一场判红', async () => {
    const { createWalk, outputDir, tempRootDir, root } = fakeWalkFactory()
    const paid = await openPaidWalk('x.paid.mjs', 'x', MODELS, { assertBuild: noBuildCheck, env: envFor(root), createWalk, connect: async () => ({}) })
    paid.walk.report.note = `oops ${KEY}`
    process.exitCode = 0
    await paid.finish(undefined)
    process.exitCode = 0
    const text = fs.readFileSync(path.join(outputDir, 'report.json'), 'utf8')
    expect(JSON.parse(text).result).toBe('failed')
    expect(text).not.toContain(KEY)
    expect(text).toContain('出现在报告内容里')
    expect(fs.existsSync(tempRootDir)).toBe(false)
  })

  test('证据目录里被塞进 key（例如截图文件名）：收尾把那个文件删掉并红', async () => {
    const { createWalk, outputDir, root } = fakeWalkFactory()
    const paid = await openPaidWalk('x.paid.mjs', 'x', MODELS, { assertBuild: noBuildCheck, env: envFor(root), createWalk, connect: async () => ({}) })
    const leaked = path.join(outputDir, `shot-${KEY}.png`)
    fs.writeFileSync(leaked, 'png')
    await expect(paid.finish(undefined)).rejects.toThrow(/泄漏/)
    process.exitCode = 0
    expect(fs.existsSync(leaked)).toBe(false)
  })

  test('Agent 转录读不出来（spendReceipt 抛错）也照样删副本、抹日志：收尾不被它挡住', async () => {
    const { createWalk, outputDir, tempRootDir, root } = fakeWalkFactory()
    fs.writeFileSync(path.join(tempRootDir, 'projects', 'p1', '.nomi', 'agent-sessions', 's', 'a.jsonl'), `not a header ${KEY}
`)
    const paid = await openPaidWalk('x.paid.mjs', 'x', MODELS, { assertBuild: noBuildCheck, env: envFor(root), createWalk, connect: async () => ({}) })
    await paid.finish(undefined)
    process.exitCode = 0
    expect(fs.existsSync(tempRootDir), '副本照样删了').toBe(false)
    expect(JSON.parse(fs.readFileSync(path.join(outputDir, 'report.json'), 'utf8')).spend.readError).toBeTruthy()
    expect(filesContainingSecret(outputDir, [KEY])).toEqual([])
  })

  test('点名别家的模型：在起 App 之前就拒', async () => {
    const { createWalk, root } = fakeWalkFactory()
    await expect(openPaidWalk('x.paid.mjs', 'x', [{ vendorKey: 'kie', modelKey: 'm' }], { assertBuild: noBuildCheck, env: envFor(root), createWalk })).rejects.toThrow(/一分钱没花/)
  })
})

describe('openPaidWalk · 没设 APIMART_API_KEY 时走原来的 real-profile 路', () => {
  test('去读真实资料目录（缺就抛「真实资料目录缺…」），不会悄悄走 env-key，也不会调接入页函数', async () => {
    const { createWalk, root } = fakeWalkFactory()
    let connected = false
    const env = { NOMI_SPEND_OK: '1', NOMI_REAL_PROFILE_USER_DATA: path.join(root, 'no-such-real-profile') }
    await expect(openPaidWalk('x.paid.mjs', 'x', MODELS, {
      assertBuild: noBuildCheck, env, createWalk, isNomiRunning: () => false, connect: async () => { connected = true },
    })).rejects.toThrow(/真实资料目录缺/)
    expect(connected).toBe(false)
  })

  test('而且 Nomi 开着时照旧拒跑', async () => {
    const { createWalk, root } = fakeWalkFactory()
    const env = { NOMI_SPEND_OK: '1', NOMI_REAL_PROFILE_USER_DATA: path.join(root, 'x') }
    await expect(openPaidWalk('x.paid.mjs', 'x', MODELS, { env, createWalk, isNomiRunning: () => true })).rejects.toThrow(/Nomi 正开着/)
  })
})
