// 付费走查的第二个凭据来源：环境变量里的 APIMart key（2026-10-16）。
//
// 为什么存在：付费走查原来只有一条路——从用户**真实资料目录**拷凭据进隔离副本（_realProfile.mjs）。
// 有些会话（协调线、云端、没有真实资料的机器）按纪律不碰真实资料，却手里有一把专给验收用的 APIMart key。
// 这条路让它也能跑付费走查，而不绕过产品：
//   · 不读、不拷、不指纹真实资料目录（所以也不要求「用户的 Nomi 没开着」）；
//   · key 只经**可见的接入页**进被测 App（模型设置 → APIMart 只填 key 的页 → 保存 → 继续验证 → 验证大脑模型），
//     与真人第一次接入走的是同一条界面路径；不直接改目录、不往 store 里灌（接入页的净化器就是为拦这种注入而写的）；
//   · 之后照现有护栏把花钱面收窄到被授权的模型（lockSpendToModels），跑完整个隔离副本删除。
//
// key 的卫生是这个模块的硬约束（tests/ux/_paidEnvKey.test.mjs 钉死）：
//   key 不进任何日志、报告、截图文件名、网络账本落盘、异常信息。Playwright 的 `fill(value)` 超时会把 value
//   原样写进错误的调用日志——所以进接入页那一段的异常一律先过 redact 再往外抛。
import fs from 'node:fs'
import path from 'node:path'

import { expect } from './_assert.mjs'
import { stationTimeout } from './_station-budget.mjs'
import { openModelSettings } from './_shell.mjs'

export const ENV_KEY_VAR = 'APIMART_API_KEY'
export const ENV_KEY_VENDOR = 'apimart'
export const REDACTED = '[REDACTED]'

/** 把环境变量读成 key（去首尾空白）；没设 / 全空白 = ''。 */
export function envKeyOf(env = process.env) {
  return typeof env[ENV_KEY_VAR] === 'string' ? env[ENV_KEY_VAR].trim() : ''
}

/**
 * 这一场付费走查的凭据从哪来（纯判据）。设了 APIMART_API_KEY 才走 env-key；
 * 没设时是 real-profile——和这个模块出现之前一字不差。
 */
export function paidCredentialSource(env = process.env) {
  return envKeyOf(env) ? 'env-key' : 'real-profile'
}

/**
 * key 的形状检查。太短的串做「整串替换」会把正常文本一起抹掉，空白会让整串匹配失效；
 * 报错时**不回显** key 本身。
 */
export function assertUsableEnvKey(key) {
  if (key.length < 8 || /\s/.test(key)) {
    throw new Error(`${ENV_KEY_VAR} 的值形状不对（至少 8 位、不含空白）——不回显它，请重新核对环境变量`)
  }
  return key
}

const AUTH_HEADER = /(authorization["']?\s*[:=]\s*["']?)(?:bearer\s+|key\s+)?[^\s"',}]+/gi
const BEARER = /\b(bearer\s+)[A-Za-z0-9._~+/=-]{8,}/gi
const KEY_PARAM = /([?&](?:api[_-]?key|key|token|access_token)=)[^&\s"']+/gi

/** 文本里抹掉：给定的 secret 原串、鉴权头、Bearer 串、URL 里的 key/token 参数。 */
export function redact(text, secrets = []) {
  let out = String(text ?? '')
  for (const secret of secrets) if (secret) out = out.split(secret).join(REDACTED)
  return out
    .replace(AUTH_HEADER, `$1${REDACTED}`)
    .replace(BEARER, `$1${REDACTED}`)
    .replace(KEY_PARAM, `$1${REDACTED}`)
}

/** 异常过 redact 再往外抛：message 与 stack 都抹，cause 不带出（它可能是未抹的原异常）。 */
export function redactedError(error, secrets = []) {
  const message = redact(error instanceof Error ? error.message : String(error), secrets)
  const safe = new Error(message)
  safe.stack = redact(error instanceof Error ? error.stack ?? message : message, secrets)
  return safe
}

/** 网络账本的一行 → 抹过的一行（账本本来不记请求头，这是防它哪天开始记）。 */
export function redactNetLogEntry(entry, secrets = []) {
  return JSON.parse(redact(JSON.stringify(entry), secrets))
}

/**
 * 目录里（递归）有哪些文件含 secret 原串；返回相对路径清单，**不回显内容**。
 * 按字节找（latin1），文本与二进制一视同仁——截图 PNG 里不会有明文 key，但报告 / 日志 / 账本会。
 */
export function filesContainingSecret(dir, secrets) {
  const needles = secrets.filter(Boolean).map((secret) => Buffer.from(secret, 'utf8'))
  if (needles.length === 0 || !fs.existsSync(dir)) return []
  const hits = []
  const walk = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const file = path.join(current, entry.name)
      if (entry.isDirectory()) { walk(file); continue }
      if (!entry.isFile()) continue
      const bytes = fs.readFileSync(file)
      if (needles.some((needle) => bytes.includes(needle))) hits.push(path.relative(dir, file))
      // 文件名也不许带 key（截图文件名、临时文件名）。
      else if (needles.some((needle) => entry.name.includes(needle.toString('utf8')))) hits.push(path.relative(dir, file))
    }
  }
  walk(dir)
  return hits
}

/** 跑完核一遍：证据目录里不能有 key；有就抛（只说哪些文件，不说内容）。 */
export function assertNoSecretOnDisk(dir, secrets) {
  const hits = filesContainingSecret(dir, secrets)
  if (hits.length) throw new Error(`key 泄漏进了证据目录（${hits.length} 个文件）：${hits.join('、')}——立即删掉这些文件并更换这把 key`)
}

/**
 * 出网放行名单用的「目录」：env-key 路没有真实资料目录可读，APIMart 只有一个 API 源（裸 baseUrl，
 * electron/catalog/apimartVendor.ts 的 APIMART_VENDOR_SEED.baseUrl；单测核对两者一致），
 * 成品下载域名走 _paidNetwork.mjs 的 VENDOR_RESULT_DOMAINS。
 */
export const ENV_KEY_ALLOW_CATALOG = Object.freeze({
  vendors: [{ key: ENV_KEY_VENDOR, baseUrlHint: 'https://api.apimart.ai' }],
  mappings: [],
})

/** APIMart 内置的文本模型 key（electron/catalog/apimartTexts.ts 的 APIMART_TEXT_MODELS；单测核对两者一致）。 */
export const APIMART_TEXT_MODEL_KEYS = Object.freeze(['deepseek-v4-pro', 'deepseek-v4-flash', 'deepseek-v3.1-terminus', 'gemini-3.5-flash'])

/** 界面一步的安全网（公共预算 owner：tests/ux/_station-budget.mjs）；只是上限，不是完成条件。 */
const STEP_MS = stationTimeout({ operations: 1 })
const SLOW_STEP_MS = stationTimeout({ operations: 2 })

const TERMINAL_STAGES = new Set(['completed', 'partial', 'failed', 'cancelled', 'timed_out', 'stale'])

/**
 * 走可见的接入页把 APIMart key 装进被测 App，并验证一个文本模型（Agent 的大脑）。
 * 写法照 tests/ux/agent-vertical-spine-m0-m5.red.e2e.mjs 的 M3 段：点顶栏齿轮 → 设置里的「模型」页 → 点 APIMart →
 * 只填 key 的页（保存）→ 继续验证 → 获取可用模型 → 选大脑 → 验证 → 等认证走完 → 关设置。
 * 保存之后被授权的模型要是已经能用（接入页：「预置模型可用」），就跳过验证那一半。
 * 之后图片模型能不能用，由调用方的 lockSpendToModels 问主进程（不能用就在花钱前红）。
 *
 * 前提：无。项目库页和工作区里都行——入口是顶栏齿轮（`openModelSettings`，会等它出现），不是往 window 上派事件：
 * 事件是发了就走、不等有没有人听，页面刚（重）载、React 还没挂上监听时发出去就丢了，只剩 15 秒后一句「等不到模型设置页」
 * （2026-10-18 视频付费走查在项目库页接入时就是这么超时的，零花费）。
 *
 * 返回只含事实、不含 key 的小对象，给报告用。`stopAfterSave`：只做到「保存」为止（演练用）。
 */
export async function connectApimartThroughVisibleUi(win, { apiKey, textModelKey, requiredModels = [], certificationSeconds = 90, stopAfterSave = false }) {
  assertUsableEnvKey(apiKey)
  const secrets = [apiKey]
  try {
    await openModelSettings(win, { label: '接入：打开模型设置', timeout: STEP_MS })
    const home = win.locator('[data-model-settings-page="home"]').first()
    await home.waitFor({ state: 'visible', timeout: STEP_MS })
    const available = home.locator(`[data-model-home-available="${ENV_KEY_VENDOR}"]`).first()
    await available.waitFor({ state: 'visible', timeout: STEP_MS })
    await available.click()
    const keyPage = win.locator(`[data-key-only-vendor="${ENV_KEY_VENDOR}"]`).first()
    await keyPage.waitFor({ state: 'visible', timeout: STEP_MS })
    const keyInput = keyPage.locator(`#key-only-${ENV_KEY_VENDOR}`).first()
    if (!(await keyInput.isDisabled().catch(() => true))) {
      await keyInput.fill(apiKey)
      await keyPage.getByRole('button', { name: /保存|Save/i }).first().click()
    }
    await keyPage.locator('[data-key-only-success]').waitFor({ state: 'visible', timeout: STEP_MS })
    // 只演练「填 key → 保存」这一半（loopback 夹具没有认证那一整套）：key 已存住就停，验证那一半只在真 key 上跑。
    if (stopAfterSave) return { vendorKey: ENV_KEY_VENDOR, keySaved: true, certifiedTextModel: null, viaVisibleOnboarding: true }
    // 接入页保存之后会说「APIMart 已接入，预置模型可用」（演练截图实测）：要是被授权的模型这一刻都已经能用，
    // 就不必再跑「继续验证」（它还会花几个 token，而且预置的模型在选择页里是灰的、选不了）。问被测 App 自己，不猜。
    if (requiredModels.length) {
      // listModels 是异步 IPC（返回 Promise）：用 expect.poll 真正等它，不然 `.find` 落在 Promise 上、永远判成「不可用」。
      const presetUsable = await expect.poll(() => win.evaluate(async (want) => {
        const rows = (await window.nomiDesktop?.modelCatalog?.listModels?.({})) || []
        return want.every((item) => rows.find((row) => row.vendorKey === item.vendorKey && row.modelKey === item.modelKey)?.availability?.usable === true)
      }, requiredModels), { timeout: STEP_MS }).toBe(true).then(() => true, () => false)
      if (presetUsable) {
        await win.evaluate(() => window.dispatchEvent(new CustomEvent('nomi-model-catalog-changed')))
        await win.locator('[data-settings-close]').first().click()
        return { vendorKey: ENV_KEY_VENDOR, keySaved: true, certifiedTextModel: null, verification: 'skipped：保存后被授权的模型已可用', viaVisibleOnboarding: true }
      }
    }
    await keyPage.getByRole('button', { name: /继续验证|Continue verification/i }).first().click()

    const addPage = win.locator('[data-model-settings-page="add"]').first()
    await addPage.waitFor({ state: 'visible', timeout: STEP_MS })
    await addPage.getByRole('button', { name: /获取可用模型|Get available models/i }).first().click()
    const modelRow = addPage.getByRole('button', { name: textModelKey, exact: true }).first()
    await modelRow.waitFor({ state: 'visible', timeout: SLOW_STEP_MS })
    if (await modelRow.isDisabled().catch(() => true)) throw new Error(`接入页里 ${ENV_KEY_VENDOR}/${textModelKey} 已经配置过、选不了——隔离副本应该是干净的，不该出现这种情况`)
    await modelRow.click()
    const confirm = addPage.getByRole('button', { name: /(?:验证|自检)\s*1\s*个(?:模型)?|(?:Verify|Self-check)\s*1\s*model/i }).first()
    await confirm.waitFor({ state: 'visible', timeout: STEP_MS })
    await confirm.click()
    const verification = win.locator('[data-model-settings-page="verification"]').first()
    await verification.waitFor({ state: 'visible', timeout: STEP_MS })
    const runId = await verification.getAttribute('data-adapter-run-id')
    if (!runId) throw new Error('接入页的验证页没有给出认证运行号')
    let latest = null
    for (let attempt = 0; attempt < certificationSeconds; attempt += 1) {
      const polled = await win.evaluate(async (id) => window.nomiDesktop?.onboarding?.certificationGet?.({ runId: id }), runId)
      if (polled?.ok && polled.run) {
        latest = polled.run
        if (TERMINAL_STAGES.has(latest.stage)) break
      }
      await win.waitForTimeout(1_000)
    }
    if (!latest || latest.stage !== 'completed') throw new Error(`${ENV_KEY_VENDOR}/${textModelKey} 的认证没有走完：${latest?.stage ?? 'unknown'}`)
    // 晋升与验证页是异步的：等这一行真的 enabled + published + verified，再通知界面刷新。
    await expect.poll(() => win.evaluate(async ({ vendorKey, modelKey }) => {
      const model = ((await window.nomiDesktop?.modelCatalog?.listModels?.({})) || []).find((row) => row.vendorKey === vendorKey && row.modelKey === modelKey)
      return Boolean(model?.enabled === true && model?.published === true && model?.meta?.adapter?.state === 'verified')
    }, { vendorKey: ENV_KEY_VENDOR, modelKey: textModelKey }), { timeout: SLOW_STEP_MS }).toBe(true)
    await win.evaluate(() => window.dispatchEvent(new CustomEvent('nomi-model-catalog-changed')))
    const overlay = win.locator('[data-settings-overlay]').first()
    await overlay.waitFor({ state: 'visible', timeout: STEP_MS })
    await win.locator('[data-settings-close]').first().click()
    await overlay.waitFor({ state: 'hidden', timeout: STEP_MS })
    return { vendorKey: ENV_KEY_VENDOR, certifiedTextModel: textModelKey, certificationStage: latest.stage, viaVisibleOnboarding: true }
  } catch (error) {
    throw redactedError(error, secrets)
  }
}

/** 从被测 App 的目录里读出被授权的那几行（label 等），装成 lockSpendToModels 吃的形状。 */
export async function readAuthorizedRows(win, models) {
  const rows = await win.evaluate(() => window.nomiDesktop.modelCatalog.listModels({}))
  return models.map((want) => {
    const row = rows.find((candidate) => candidate.vendorKey === want.vendorKey && candidate.modelKey === want.modelKey)
    if (!row) throw new Error(`接入完成后目录里没有 ${want.vendorKey}/${want.modelKey}（一分钱没花）`)
    return { vendorKey: row.vendorKey, modelKey: row.modelKey, kind: row.kind, labelZh: row.labelZh }
  })
}

/**
 * 删隔离副本之前，把能解释「为什么没跑通」的日志拷进证据目录（key 打码）：被测 App 主进程日志
 * （`user-data/logs/*`）与 Agent lane 的会话记录 / 轨迹（项目 `.nomi/agent-sessions/**`）、制作 Run 事件。
 * 副本一删这些就没了——2026-10-16 真 key 首跑失败时正好因此查不了根因。返回拷了哪些文件（相对名）。
 */
export function collectAppLogs({ tempRoot, projectRoot, outDir, secrets, maxBytes = 8 * 1024 * 1024 }) {
  const sources = [
    [path.join(tempRoot, 'user-data', 'logs'), 'main-logs'],
    ...(projectRoot ? [[path.join(projectRoot, '.nomi', 'agent-sessions'), 'lane-sessions'], [path.join(projectRoot, '.nomi', 'runs'), 'runs']] : []),
  ]
  const copied = []
  const walk = (dir, label, rel = '') => {
    if (!fs.existsSync(dir)) return
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name)
      const relName = path.posix.join(rel, entry.name)
      if (entry.isDirectory()) { walk(file, label, relName); continue }
      if (!entry.isFile() || !/\.(?:log|jsonl|ndjson|json|txt)$/i.test(entry.name) || fs.statSync(file).size > maxBytes) continue
      const target = path.join(outDir, 'app-logs', label, relName.split('/').join('__'))
      fs.mkdirSync(path.dirname(target), { recursive: true })
      fs.writeFileSync(target, redact(fs.readFileSync(file, 'utf8'), secrets))
      copied.push(path.posix.join(label, relName))
    }
  }
  for (const [dir, label] of sources) walk(dir, label)
  return copied
}
