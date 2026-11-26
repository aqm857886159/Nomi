// 付费走查的开关、护栏与收据，唯一一份（2026-09-26）。每条会真的调用供应商、真的扣费的脚本，开头只走这里。
//
// 为什么收成一处：以前每条付费脚本各写各的——有的只拒 CI、不要任何显式开关（agent-spend-real-image），
// 有的认 NOMI_CORE_A_LIVE，有的认 APIMART_E2E + NOMI_SPEND_OK。一次忘记的代价是真实账单，
// 防线得建在最早能拦住的那层（R17），而不是靠每个作者记得抄全。
//
// 三道闸 + 两张收据：
//   ① CI 里拒跑（CI 从来没有真钱，也不该有）；
//   ② 没有显式 NOMI_SPEND_OK=1 拒跑（与 tests/system/profiles.mjs 的付费档同一个开关）；
//   ③ 用户自己的 Nomi 开着拒跑——要拷他的真实资料目录，开着的 App 会让拷到的东西半新半旧；
//   收据一：原库指纹跑前记下，跑后比对，变了就红；
//   收据二：这一场真正发生的付费调用（媒体任务号 + 供应商回的 cost 字段；Agent 的 token 用量）。
//   只记事实、不折算金额——价目会变，而且这是公开仓库。
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { require as tsxRequire } from 'tsx/cjs/api'

import { verifyBuild } from '../../scripts/package-build-stamp.mjs'

import { laneMessages, readLaneTranscripts } from './agent-lane-observer.mjs'
import { decideSyntheticCredentialStorage } from './_launchApp.mjs'
import { createRuntimeWalk } from './agent-runtime-walk-support.mjs'
import { PAID_UNVERIFIED_EXIT_CODE, blockedError, guardLoadedError, hostedUploadRelayOrigin, newNetLogFile, paidRunVerdict, paidWalkAllowlist, readNetLog, REHEARSAL_STOPS, rehearsalLedgerRequests, rehearsalShouldStop, rehearsalVerdict, scriptErrorText, standInLaunchEnv, startRehearsalStandIn, watchNetLog } from './_paidNetwork.mjs'
import {
  ENV_KEY_ALLOW_CATALOG, ENV_KEY_VAR, ENV_KEY_VENDOR, assertNoSecretOnDisk, assertUsableEnvKey, connectApimartThroughVisibleUi,
  APIMART_TEXT_MODEL_KEYS, collectAppLogs, envKeyOf, filesContainingSecret, paidCredentialSource, readAuthorizedRows, redact, redactNetLogEntry, redactedError,
} from './_paidEnvKey.mjs'
import { stationTimeout } from './_station-budget.mjs'
import { readRealCatalog, realNomiIsRunning, realNomiProfile, realProfileFingerprint, removeRealCredentials, seedRealModels } from './_realProfile.mjs'

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
export const SPEND_OPT_IN_ENV = 'NOMI_SPEND_OK'
/** 付费走查缺省的 Agent 大脑（单源）：各脚本都从这里拿，不各写一个 key——写死的 deepseek-v3.2 在 10-27 退役后，Agent 生图付费走查就跑不起来了。它必须在 APIMART_TEXT_MODEL_KEYS 里（单测守）。 */
export const DEFAULT_PAID_BRAIN = Object.freeze({ vendorKey: ENV_KEY_VENDOR, modelKey: 'deepseek-v4-pro' })

// ── 演练（2026-11-15）：同一份付费脚本，带一个开关免费走一遍花钱前那段路 ──────────────────────────────
// 起因：付费脚本只在真要花钱时才被跑，花钱前那段路（开项目、建节点、选模型、填参数、找到生成钮）平时没人走，
// 界面一改就烂，烂了要到花钱那一刻才知道（11-15 一发真付费样片在点生成之前就挂了：新镜头落在视口外）。
// 演练 = 同一份脚本 + NOMI_PAID_REHEARSAL：传给网络闸的放行名单是空的（供应商一个请求都出不去，结构上花不了钱，
// 不靠脚本作者记得不点）；结果如实记走到哪一站、几发里走到几发、脚本自己报没报错（_paidNetwork.mjs#rehearsalVerdict），
// 落一张收据（脚本及其本地辅助模块的内容指纹 + 构建戳）。真付费入口开跑前把上次演练的情况打印出来——**只提醒、不拦**（第三版，11-15）：
// 两次事故里钱一分没花，硬闸买到的只是「少白等一轮」，它自己却会误拦真付费（有钥匙那档、跨版本对比），又能被一份手写文件绕过。
// 指纹只用来判「是不是同一个版本」，不当安全手段；真付费原有的拒跑（CI、NOMI_SPEND_OK、用户的 App 开着、新鲜构建）一条不动。
export const REHEARSAL_ENV = 'NOMI_PAID_REHEARSAL'
/** 两档。不要 Key 的那档能进夜间；要真 Key 的那档只在本机、花钱前跑。 */
export const REHEARSAL_TIERS = Object.freeze({
  'no-key': '不要 Key：一把假钥匙经可见接入页装进隔离副本，真实资料目录和环境变量里的真 Key 一概不读；只覆盖 APIMart 的模型',
  'real-key': '要真 Key、出不了网：凭据照真付费那样装（真实资料副本或环境变量 Key），放行名单是空的',
})
/** 不要 Key 那档的假钥匙：形状过得了接入页（单测直接拿产品的 isApimartKeyCandidate 判它），值一眼看得出是假的，不是秘密。 */
export const REHEARSAL_FAKE_KEY = 'sk-nomi-rehearsal-fake-key-not-a-secret'

/**
 * 替身供应商要答的免费探测：从产品种子里代码拥有的 `credentialProbe` 派生（不手抄第二份），答成「成功判据那个字段 = 0」。
 * 产品拿它判「key 能用」：网络被挡时它记待定、模型不放出来，假钥匙演练就卡在接入页（2026-11-15 真窗实测）。
 */
export function rehearsalFreeAnswers(probe) {
  const body = {}
  let node = body
  const keys = String(probe.successPath).split('.')
  keys.forEach((key, index) => { node[key] = index === keys.length - 1 ? 0 : {}; node = node[key] })
  return { [`${String(probe.request.method).toUpperCase()} ${probe.request.path}`]: body }
}
const apimartCredentialProbe = () => tsxRequire('../../electron/catalog/apimartVendor.ts', import.meta.url).APIMART_VENDOR_SEED.credentialProbe

/**
 * 替身要答的上传（r2）：供应商自己的上传口、App 的托管上传中转，都从产品代码拥有的声明派生（不手抄第二份）：
 * 路径取声明里的端点，回链字段取声明里的 `urlPath`。答一个本机假地址，流程接着走到「向供应商发创建请求」。
 */
export function rehearsalUploadAnswers(ingestion) {
  if (!ingestion || ingestion.strategy !== 'upload-multipart' || !ingestion.urlPath) return {}
  const pathname = ingestion.endpointPath ?? new URL(ingestion.endpoint).pathname
  return { [`POST ${pathname}`]: ingestion.urlPath }
}
const apimartUploadIngestion = () => tsxRequire('../../electron/catalog/assetIngestionRegistry.ts', import.meta.url).CURATED_ASSET_INGESTION.apimart
/** 中转的收法：路径跟着当前配置的中转端点（hostedUploadRelayOrigin 同一个来源），回链字段取产品的中转声明。 */
function relayUploadIngestion(relayOrigin, env) {
  const { nomiPublicAssetRelayCandidate } = tsxRequire('../../electron/catalog/assetLocalization.ts', import.meta.url)
  const declared = nomiPublicAssetRelayCandidate()?.ingestion
  const endpoint = String(env.NOMI_ASSET_RELAY_URL || '').trim() || declared?.endpoint
  if (!declared || !endpoint || new URL(endpoint).origin !== relayOrigin) return null
  return { ...declared, endpoint }
}

/**
 * 演练的终点（r2；第三版加了 brain）：缺省每份付费脚本都要走到「供应商收到会花媒体钱的那条创建请求」（vendor-create）。
 * 脚本本身就不发创建请求的在这里声明它的终点和理由，不能含糊；表外的一律 vendor-create：
 *   · vendor-read：只验接入、只查列表 / 余额；
 *   · brain：真付费时本来就只花文字模型的钱（对话、改写、读图、工具调用），大脑请求就是它的终点。
 * 本意花媒体钱、演练只走到大脑的（Agent 驱动出图 / 视频）不在这里：它们的结果如实记「只到大脑请求」，单列。
 */
export const REHEARSAL_ENDPOINTS = Object.freeze({
  'apimart-text-list-real.paid.mjs': { endsAt: 'vendor-read', why: '文字模型列表对账：只发两条只读 GET（模型列表、余额），本来就不发创建请求' },
  'agent-gpt6-responses-real.paid.mjs': { endsAt: 'brain', why: 'GPT-6.1 Sol 走 Responses 的一轮 Agent 任务（3 次大脑请求、2 次工具调用）：只花文字模型的钱，不生成媒体' },
  'agent-long-chat-real.paid.mjs': { endsAt: 'brain', why: '长对话的 token / 时长数字：只花文字模型的钱，不生成媒体' },
  'agent-shot-kind-real.paid.mjs': { endsAt: 'brain', why: '只看 Agent 起草出来的镜头种类：不点生成，只花文字模型的钱' },
  'agent-shot-table-remake-real.paid.mjs': { endsAt: 'brain', why: '只看 Agent 读不读得到分镜表的行、起草的是哪几行：只花文字模型的钱' },
  'creation-ai-rewrite-real.paid.mjs': { endsAt: 'brain', why: '写作区 AI 编辑：一次文字模型调用' },
  'deconstruct-real.paid.mjs': { endsAt: 'brain', why: '拆解：读图模型的对话请求就是它花钱的那条' },
  'look-at-canvas-selection-real.paid.mjs': { endsAt: 'brain', why: '只看工具写对率、回合成功率：只花文字模型的钱' },
  'storyboard-agent-bulk-real.paid.mjs': { endsAt: 'brain', why: '只让 Agent 编辑当前分镜，不提交媒体生成' },
  'text-tasks-pi-ai-real.paid.mjs': { endsAt: 'brain', why: '文本任务单次调用：只花文字模型的钱' },
  'tool-schema-real.paid.mjs': { endsAt: 'brain', why: '一回合文字模型的工具调用，不生成媒体' },
})
export function rehearsalEndpointOf(script, table = REHEARSAL_ENDPOINTS) {
  return table[path.basename(String(script))]?.endsAt ?? 'vendor-create'
}

/** 这一场是不是演练、哪一档；没设 = null。值不认识就抛（不猜成任何一档）。 */
export function paidRehearsalTier(env = process.env) {
  const value = String(env[REHEARSAL_ENV] ?? '').trim()
  if (!value) return null
  if (!Object.hasOwn(REHEARSAL_TIERS, value)) throw new Error(`${REHEARSAL_ENV} 只认 ${Object.keys(REHEARSAL_TIERS).join(' / ')}，收到 ${JSON.stringify(value)}（一分钱没花）`)
  return value
}

/**
 * 纯判据（单测钉它）：返回拒跑理由，null = 放行。
 * env-key 路（设了 APIMART_API_KEY）不碰真实资料目录，所以「用户的 Nomi 开着」不构成拒跑理由；
 * CI 拒跑与显式 NOMI_SPEND_OK 两道闸两条路一样。
 * 演练：不要 NOMI_SPEND_OK；和 NOMI_SPEND_OK=1 同时开 = 说不清要不要花钱，拒。不要 Key 那档可以在 CI 里跑（它不读任何 Key）。
 */
export function paidRunRefusal(script, { env = process.env, nomiRunning = false } = {}) {
  const rehearsal = String(env[REHEARSAL_ENV] ?? '').trim()
  if (rehearsal) {
    if (env[SPEND_OPT_IN_ENV] === '1') return `${script}：${REHEARSAL_ENV} 和 ${SPEND_OPT_IN_ENV}=1 同时开，说不清这一场要不要花钱——演练不要 ${SPEND_OPT_IN_ENV}，花钱不带演练开关`
    if (!Object.hasOwn(REHEARSAL_TIERS, rehearsal)) return `${REHEARSAL_ENV} 只认 ${Object.keys(REHEARSAL_TIERS).join(' / ')}，收到 ${JSON.stringify(rehearsal)}`
    if (rehearsal === 'real-key' && env.CI) return `${script} 的 real-key 演练要用真 Key，不在 CI 里跑（CI 用 no-key）`
    if (rehearsal === 'real-key' && nomiRunning && paidCredentialSource(env) === 'real-profile') return `${script} 要拷用户的真实资料目录，而 Nomi 正开着——关掉 App 再跑（开着拷到的是半新半旧的一份）`
    return null
  }
  if (env.CI) return `${script} 会真的调用供应商并扣费，不在 CI 里跑`
  if (env[SPEND_OPT_IN_ENV] !== '1') return `${script} 会花真钱：显式设 ${SPEND_OPT_IN_ENV}=1 才跑（一分钱没花）。花钱之前先免费演练同一份脚本：${REHEARSAL_ENV}=no-key node tests/ux/${path.basename(script)}——演练过了才放行真付费`
  if (nomiRunning && paidCredentialSource(env) === 'real-profile') return `${script} 要拷用户的真实资料目录，而 Nomi 正开着——关掉 App 再跑（开着拷到的是半新半旧的一份）`
  return null
}

/**
 * 花钱之前的两道构建检查（2026-10-17，起因：一项权限两档的真付费跑了 5 次，其中 2 次白跑——
 * 构建时别的线在同一工作树改了文件、构建失败，走查跑在旧产物上）。不满足就拒跑，一分钱不花：
 *   ① 产物比源码新：用构建自己盖的戳（scripts/package-build-stamp.mjs 的 verifyBuild，戳 = 构建当时的源码树指纹），
 *      戳缺、或和现在的源码树对不上（构建失败 / 构建后又有人改了文件）都拒；不另写一套时间戳比对；
 *   ② 产物里能找到调用方给的标记字面量（`buildMarkers`）：验某个修复的走查，传一句**会原样进产物**的字面量
 *      （界面文案、错误码、日志前缀），证明被验的修复真在产物里。函数名 / 变量名会被压缩，不能当标记。
 * 打包形态（--packaged）跑的是安装包自带的产物，不看仓库里的 dist，两道都不适用。
 */
export function assertPaidBuildReady(root, { markers = [], verify = verifyBuild, outputs = ['dist', 'dist-electron'] } = {}) {
  let identity
  try { identity = verify(root) }
  catch (error) { throw new Error(`付费走查拒跑（一分钱没花）：${String(error?.message ?? error)}——构建产物过期或缺失（构建失败，或构建后源码又被改过），先在无人改动的专用工作树里 pnpm build 成功再跑`) }
  const wanted = markers.filter((marker) => typeof marker === 'string' && marker.length > 0)
  if (markers.length !== wanted.length) throw new Error('付费走查拒跑（一分钱没花）：buildMarkers 里有空值或非字符串')
  const missing = new Set(wanted)
  const scan = (directory) => {
    if (!missing.size) return
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name)
      if (entry.isDirectory()) { if (entry.name !== 'node_modules') scan(file) }
      else if (entry.isFile() && /\.(?:m?js|cjs|html|css|json)$/.test(entry.name)) {
        const text = fs.readFileSync(file, 'utf8')
        for (const marker of missing) if (text.includes(marker)) missing.delete(marker)
      }
      if (!missing.size) return
    }
  }
  if (missing.size) for (const output of outputs) if (fs.existsSync(path.join(root, output))) scan(path.join(root, output))
  if (missing.size) throw new Error(`付费走查拒跑（一分钱没花）：构建产物里找不到被验修复的标记 ${[...missing].map((marker) => JSON.stringify(marker)).join('、')}——产物不含这次要验的修复（旧构建，或标记取成了会被压缩的函数名）`)
  // 构建戳（verifyBuild 返回的源码树身份）：演练收据记它，真付费核它——同一个戳，不另造一套。
  return identity
}

export function assertPaidRunAllowed(script, env = process.env, isNomiRunning = realNomiIsRunning, profile = realNomiProfile({ env })) {
  const rehearsal = String(env[REHEARSAL_ENV] ?? '').trim()
  // 不要 Key 的演练走假钥匙的 env-key 路：不读真实资料目录，所以也不问「用户的 Nomi 开着没有」。
  const envKeyRoute = rehearsal === 'no-key' || paidCredentialSource(env) === 'env-key'
  const wouldCopyProfile = !env.CI && (rehearsal ? rehearsal === 'real-key' && env[SPEND_OPT_IN_ENV] !== '1' : env[SPEND_OPT_IN_ENV] === '1')
  const refusal = paidRunRefusal(script, { env, nomiRunning: !envKeyRoute && wouldCopyProfile && isNomiRunning() })
  if (refusal) throw new Error(refusal)
  // env-key 路从头到尾不读真实资料目录：没有指纹可记，也就没有「跑后比对」。
  if (envKeyRoute) return { realProfileBefore: null, assertRealProfileUntouched: () => null }
  const before = realProfileFingerprint(profile)
  return {
    realProfileBefore: before,
    /** 跑后调用：原库的目录与钥匙必须一字不差；返回跑后指纹给报告用。 */
    assertRealProfileUntouched() {
      const after = realProfileFingerprint(profile)
      const changed = Object.keys({ ...before, ...after }).filter((name) => before[name] !== after[name])
      if (changed.length) throw new Error(`付费走查跑完，用户真实资料目录里的 ${changed.join('、')} 变了——走查写穿了原库，或期间有人开了 Nomi`)
      return after
    },
  }
}

// ── 演练收据（只用来提醒，不拦）──────────────────────────────────────────────
/** 收据放仓库里被忽略的 `.tmp/`（每个工作树一份）：在哪个工作树演练，就只在哪个工作树的真付费开跑前被打印出来。 */
export const REHEARSAL_RECEIPT_DIR = path.join(REPO_ROOT, '.tmp', 'paid-rehearsal', 'receipts')
export const REHEARSAL_RECEIPT_VERSION = 3
const LOCAL_IMPORT = /\bfrom\s*['"](\.{1,2}\/[^'"]+)['"]|\bimport\s*\(\s*['"](\.{1,2}\/[^'"]+)['"]\s*\)|\bimport\s+['"](\.{1,2}\/[^'"]+)['"]/g

/**
 * 脚本内容指纹：入口文件 + 它经相对路径 import 到的、住在 tests/ 下的全部本地模块（递归），按相对路径排序后整体散列。
 * 辅助模块（例如找生成钮的 _generateReach.mjs、_paidRun.mjs 自己）改了，同样算「脚本改过」；
 * tests/ 之外的源码由构建戳管（构建戳把 tests/ 排除在外，两者正好不重叠）。
 */
export function scriptFingerprint(entry, { repoBase = REPO_ROOT, readFile = (file) => fs.readFileSync(file, 'utf8'), exists = fs.existsSync } = {}) {
  const testsRoot = path.join(repoBase, 'tests') + path.sep
  const seen = new Map()
  const visit = (file) => {
    if (seen.has(file) || !exists(file)) return
    const text = readFile(file)
    seen.set(file, text)
    for (const match of text.matchAll(LOCAL_IMPORT)) {
      const target = path.resolve(path.dirname(file), match[1] ?? match[2] ?? match[3])
      if (target.startsWith(testsRoot)) visit(target)
    }
  }
  visit(path.resolve(entry))
  if (!seen.size) throw new Error(`算不出脚本指纹：入口文件不存在 ${entry}`)
  const hash = crypto.createHash('sha256')
  for (const [file, text] of [...seen].sort(([a], [b]) => a.localeCompare(b))) hash.update(`${path.relative(repoBase, file).split(path.sep).join('/')}\0${text}\0`)
  return { fingerprint: `sha256:${hash.digest('hex')}`, files: seen.size }
}

/** 安装包形态（--packaged）不看仓库 dist，构建身份换成安装包自带的 app.asar（大小 + 修改时间）；找不到 asar 就用可执行文件本身。 */
export function packagedBuildIdentity(argv, { stat = fs.statSync, exists = fs.existsSync } = {}) {
  const executable = argv[argv.indexOf('--packaged') + 1]
  if (!executable) throw new Error('--packaged 后面要跟安装包可执行文件的绝对路径')
  const candidates = [path.resolve(executable, '..', '..', 'Resources', 'app.asar'), path.join(path.dirname(executable), 'resources', 'app.asar'), executable]
  const file = candidates.find((candidate) => exists(candidate))
  if (!file) throw new Error(`安装包可执行文件不存在：${executable}`)
  const info = stat(file)
  return `packaged:${path.basename(file)}:size:${info.size}:mtime:${Math.round(info.mtimeMs)}`
}

export function rehearsalReceiptFile(script, receiptDir = REHEARSAL_RECEIPT_DIR) {
  return path.join(receiptDir, `${script.split(/[\\/]/).join('__')}.json`)
}

const STATUS_WORDS = { passed: '过', failed: '不过', 'brain-only': '只到大脑请求（不算过）' }

/**
 * 纯函数（单测钉它）：真付费开跑前打印的那段「上次演练」。永远不拦——返回几行字，openPaidWalk 打印完照跑。
 * 写：什么时候、过没过、走到哪一站、几发里走到几发；没有收据、收据不是这份脚本的、脚本或构建变过 → 明说「没演练过这个版本」。
 * 指纹只用来判「是不是同一个版本」，不是安全手段（收据是一份没签名的本地文件，本来就挡不住手写）。
 */
export function rehearsalReminder(receipt, { script, fingerprint, build, now = Date.now() }) {
  const redo = `想先免费走一遍：${REHEARSAL_ENV}=no-key node tests/ux/${path.basename(script)}（只授权非 APIMart 模型的用 ${REHEARSAL_ENV}=real-key）`
  const head = `[paid] 上次演练（只提醒，不拦）：${script}`
  if (!receipt || receipt.script !== script) return [head, '  没演练过这个版本：没有这份脚本的演练收据——照跑', `  ${redo}`]
  const hours = Number.isFinite(Date.parse(receipt.at)) ? Math.round((now - Date.parse(receipt.at)) / 36e5 * 10) / 10 : null
  const status = receipt.status ?? (receipt.passed === true ? 'passed' : 'failed')
  const shots = receipt.shots ? `，${receipt.shots.declared} 发里走到 ${receipt.shots.reached} 发` : ''
  const lines = [head, `  ${receipt.at ?? '时间不明'}${hours === null ? '' : `（${hours} 小时前）`} · ${STATUS_WORDS[status] ?? status} · 走到「${receipt.station ?? '未知'}」${shots}`]
  if (receipt.reason) lines.push(`  ${String(receipt.reason).slice(0, 300)}`)
  const changed = [
    ...(receipt.version !== REHEARSAL_RECEIPT_VERSION ? ['收据是旧格式'] : []),
    ...(fingerprint && receipt.fingerprint !== fingerprint ? ['脚本（或它的本地辅助模块）在演练之后改过'] : []),
    ...(!fingerprint ? ['算不出脚本指纹'] : []),
    ...(!build ? ['算不出构建身份'] : build !== receipt.build ? [`构建变了（演练时 ${receipt.build ?? '—'}，现在 ${build}）`] : []),
  ]
  if (changed.length) lines.push(`  没演练过这个版本：${changed.join('；')}——照跑`, `  ${redo}`)
  else if (status !== 'passed') lines.push(`  这个版本上次演练${STATUS_WORDS[status] ?? status}——照跑`, `  ${redo}`)
  return lines
}

function readReceipt(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) } catch { return null }
}

/** 真付费开跑前的提醒（openPaidWalk 缺省用它；单测换掉）。只打印，任何情况都不抛（算不出指纹也照跑）。 */
export function printRehearsalReminder({ script, entry, build, receiptDir = REHEARSAL_RECEIPT_DIR, log = console.log }) {
  let fingerprint = null
  try { fingerprint = scriptFingerprint(entry).fingerprint } catch { /* 算不出：提醒里明说 */ }
  const lines = rehearsalReminder(readReceipt(rehearsalReceiptFile(script, receiptDir)), { script, fingerprint, build })
  for (const line of lines) log(line)
  return lines
}

/** 演练收尾写这张（过不过都写）：真付费开跑前读它打印提醒，批量演练读它出清单。 */
export function writeRehearsalReceipt({ script, entry, build, tier, verdict, receiptDir = REHEARSAL_RECEIPT_DIR, now = () => new Date().toISOString() }) {
  const receipt = {
    version: REHEARSAL_RECEIPT_VERSION, script, fingerprint: scriptFingerprint(entry).fingerprint, build: build ?? null, tier,
    passed: verdict.passed === true, status: verdict.status ?? (verdict.passed === true ? 'passed' : 'failed'), reason: verdict.reason,
    station: verdict.station ?? null, endsAt: verdict.endsAt ?? null, shots: verdict.shots ?? null, scriptError: verdict.scriptError ?? null, request: verdict.request, at: now(),
  }
  fs.mkdirSync(receiptDir, { recursive: true })
  fs.writeFileSync(rehearsalReceiptFile(script, receiptDir), `${JSON.stringify(receipt, null, 2)}\n`)
  return receipt
}

/**
 * 花第一分钱之前，在被测 App 里把花钱面收窄到被授权的那几个模型（`seeded` = seedRealModels 的返回），
 * 再让 App 自己说它们「能用」。返回停掉了几个未授权的生成模型。
 *
 * 为什么非在 App 起来之后做：App 首启会把内置目录补进隔离副本（同一家 APIMart 下几十个生成模型），
 * 它们和被授权的那一个共用同一把 key——不停掉，Agent 在 list_models 里点到哪个贵的、全自动档就直接花了。
 * 停用走的是设置页同一条 IPC（`modelCatalog.upsertModel`），等于用户在设置里把别的生成模型关掉。
 * 可用性问的是主进程的唯一答案（含钥匙解不解得开）：Windows 上漏拷 Local State，这里就会红，一分钱没花。
 * 开发构建与打包产物（例如发版前在安装包上的真实核对）走的是同一份。
 */
export async function lockSpendToModels(win, seeded) {
  const authorized = new Set(seeded.map((row) => `${row.vendorKey}/${row.modelKey}`))
  const disabled = await win.evaluate(async (allowed) => {
    const off = []
    for (const row of (await window.nomiDesktop.modelCatalog.listModels({}))) {
      if (row.kind === 'text' || !row.enabled || allowed.includes(`${row.vendorKey}/${row.modelKey}`)) continue
      window.nomiDesktop.modelCatalog.upsertModel({ vendorKey: row.vendorKey, modelKey: row.modelKey, enabled: false })
      off.push(`${row.vendorKey}/${row.modelKey}`)
    }
    return off
  }, [...authorized])
  const rows = await win.evaluate(() => window.nomiDesktop.modelCatalog.listModels({}))
  const stillOn = rows.filter((row) => row.kind !== 'text' && row.enabled && !authorized.has(`${row.vendorKey}/${row.modelKey}`))
    .map((row) => `${row.vendorKey}/${row.modelKey}`)
  if (stillOn.length) throw new Error(`付费前置不成立：这些未授权的生成模型停不掉（一分钱没花）：${stillOn.join('、')}`)
  const unusable = seeded.map((want) => {
    const row = rows.find((candidate) => candidate.vendorKey === want.vendorKey && candidate.modelKey === want.modelKey)
    return row?.availability?.usable ? null : `${want.vendorKey}/${want.modelKey}：${JSON.stringify(row?.availability ?? '目录里没有')}`
  }).filter(Boolean)
  if (unusable.length) throw new Error(`付费前置不成立，被测 App 说这些模型不能用（一分钱没花）：\n  ${unusable.join('\n  ')}`)
  return disabled.length
}

/**
 * 付费走查的起点：先过闸，再建隔离实例（createRuntimeWalk），再把**点名的真实模型**连同凭据装进去。
 * 返回的 `finish(error)` 在 App 关掉之后删凭据副本、写收据、比对原库指纹。
 *
 * 凭据有两个来源（`paidCredentialSource`，唯一判据）：
 *   · real-profile（缺省）：从用户真实资料目录拷密文进隔离副本，跑完删凭据副本、比对原库指纹；
 *   · env-key（设了 APIMART_API_KEY）：不碰真实资料。`lockToAuthorizedModels(win)` 里走可见的接入页把 key 装进去，
 *     再收窄花钱面；跑完整个隔离副本删除并断言已删，key 不进日志 / 报告 / 账本落盘 / 异常信息。
 * `deps` 只给单测换掉重的那几个零件（真起 App、真走界面）；脚本里不传。
 */
export async function openPaidWalk(script, name, models, deps = {}) {
  const {
    env = process.env, createWalk = createRuntimeWalk, connect = connectApimartThroughVisibleUi, isNomiRunning = realNomiIsRunning, lockSpendTo = lockSpendToModels, readRows = readAuthorizedRows,
    // 验某个修复的走查传 buildMarkers：会原样进产物的字面量（界面文案 / 错误码），见 assertPaidBuildReady。
    buildMarkers = [], argv = process.argv.slice(2), assertBuild = assertPaidBuildReady,
    // 带本地参考素材的生成要先经应用的托管上传中转：按需把**当前配置的那一个**中转源加进放行名单（缺省关，别的付费走查行为不变）。
    hostedUploads = false,
    // App-scoped trials use the same Run layout outside a creator project. Receipt selection only; all spend guards stay unchanged.
    receiptRoot = (walk) => walk.report.projectRoot,
    // false = 供应商的源不进放行名单（零花费探测：就算误提交，网络闸也当场挡下，结构上花不了钱）。缺省 true，别的付费走查不变。
    vendorNetwork = true,
    // true = 闸把放行名单上公网请求的请求体（先脱敏：不记请求头、签名查询串与 key 形状的串打码）记进账本，`readAllowedRequests()` 读回。
    // 给要核「App 真正发给供应商的是什么」的付费走查用（参考图错发热修的真付费样本）；缺省关，别的付费走查不变。
    recordAllowedBodies = false,
    // true = 演练时这份脚本自己读账本判请求体、判完一发接着走下一发（archetype 那两行）：替身记下创建请求后不关 App，脚本自己收尾；
    // 替身最后一条记录之后 rehearsalGraceMs 还没收尾就兜底关 App，并判不过（脚本没走完）。脚本自己抛的错一律算数。
    // 要和 recordAllowedBodies 一起开。缺省关：没写那两行的脚本 =「走到创建请求就结束」，在那一刻由闸停下，之后报的错是关窗的后果、不判。
    judgesBodyInRehearsal = false,
    // 这份脚本这一场要走几发（每发一条终点那一类的请求）。演练要走到这么多条才算过，结果里写「N 发里走到 M 发」。
    // 大于 1 的要和 judgesBodyInRehearsal 一起开（不然第一发的创建请求就关 App 了）。
    rehearsalShots = 1,
    // 演练收据：入口文件（算脚本指纹）、真付费前的提醒（只打印，不拦）、演练收尾写收据。单测换掉；脚本里不传。
    entry = process.argv[1], remindRehearsal = printRehearsalReminder, writeReceipt = writeRehearsalReceipt, packagedBuild = packagedBuildIdentity,
    // 不要 Key 那档的本机替身（供应商 + 托管上传中转，_paidNetwork.mjs#startRehearsalStandIn）。单测换掉。
    startStandIn = startRehearsalStandIn,
    // 演练兜底：收窄之后替身 / 闸最后一条记录过了这么久脚本还没收尾，就关 App（判不过）。
    // 取一个模型回合的站预算（stationTimeout({ turns: 1 })）：两发之间脚本合法地要调画布、等确认框，60 秒不够（样片 B 调视口就被截过）。
    rehearsalGraceMs = stationTimeout({ turns: 1 }),
  } = deps
  const holdForScript = recordAllowedBodies && judgesBodyInRehearsal
  if (!Number.isInteger(rehearsalShots) || rehearsalShots < 1) throw new Error(`rehearsalShots 要是 ≥1 的整数，收到 ${JSON.stringify(rehearsalShots)}（一分钱没花）`)
  if (rehearsalShots > 1 && !holdForScript) throw new Error(`${script} 声明了 ${rehearsalShots} 发，但没开 recordAllowedBodies + judgesBodyInRehearsal：演练会在第一发的创建请求就关 App，走不全（一分钱没花）`)
  // 真实资料目录的位置跟着传进来的 env 走（缺省就是 process.env，和以前一样）；env-key 路根本不会用到它。
  const profile = realNomiProfile({ env })
  const guard = assertPaidRunAllowed(script, env, isNomiRunning, profile)
  const rehearsal = paidRehearsalTier(env)
  // 不要 Key 的演练：凭据换成一把假钥匙走 env-key 路（可见接入页）。真实资料目录、环境变量里的真 Key 一概不读。
  const credentialEnv = rehearsal === 'no-key' ? { ...env, [ENV_KEY_VAR]: REHEARSAL_FAKE_KEY } : env
  // 产物比源码新 + 产物里有被验修复的标记：不满足就拒跑，必须在建隔离副本、装凭据之前（一分钱没花、什么都没拷）。
  const build = argv.includes('--packaged') ? packagedBuild(argv) : assertBuild(REPO_ROOT, { markers: buildMarkers })?.tree
  const receiptScript = entry ? path.relative(REPO_ROOT, path.resolve(entry)).split(path.sep).join('/') : script
  // 能花钱的那一场（不是演练、供应商的源要进放行名单）开跑前打印上次演练的情况——只提醒，不拦；提醒本身出了任何错也照跑。
  if (!rehearsal && vendorNetwork) {
    try { remindRehearsal({ script: receiptScript, entry, build }) }
    catch (error) { console.log(`[paid] 上次演练的情况读不出来（只提醒，不拦）：${String(error?.message ?? error).slice(0, 200)}`) }
  }
  const envKey = paidCredentialSource(credentialEnv) === 'env-key' ? assertUsableEnvKey(envKeyOf(credentialEnv)) : ''
  const secrets = envKey ? [envKey] : []
  if (envKey) {
    try { assertEnvKeyModels(models) }
    catch (error) { throw rehearsal === 'no-key' ? new Error(`不要 Key 的演练只覆盖 APIMart 的模型：${error.message}——这份脚本在本机用 ${REHEARSAL_ENV}=real-key 演练`) : error }
  }
  // 出网名单按本场授权的供应商自动算（见 _paidNetwork.mjs），连同账本路径一起交给被测 App 的闸；调用方什么都不用配。
  // 演练：交给闸的名单是空的（一个源都不放）；同一份算出来的名单只拿来判「挡下的是不是授权供应商」（judgedAllow）。
  const hostedUploadOrigin = hostedUploads ? hostedUploadRelayOrigin(env) : null
  const vendorAllow = !vendorNetwork && !rehearsal ? [] : envKey
    ? paidWalkAllowlist(ENV_KEY_ALLOW_CATALOG, [ENV_KEY_VENDOR])
    : paidWalkAllowlist(readRealCatalog(profile), models.map((model) => model.vendorKey))
  const relayAllow = hostedUploadOrigin ? [hostedUploadOrigin] : []
  const judgedAllow = vendorAllow
  const allow = rehearsal ? [] : [...vendorAllow, ...relayAllow]
  const endsAt = rehearsalEndpointOf(receiptScript)
  const netLog = newNetLogFile()
  // 不要 Key 的演练：供应商的源改道到本机替身——只答免费探测（存 key 后的余额查询），别的请求记成被挡行、从不转发。
  // 带本地参考素材的（hostedUploads）：App 的托管上传中转也改道到一个本机替身——只答上传（回本机假地址），不转发，流程接着走到供应商（r2 裁决 1）。
  const standIns = []
  const closeStandIns = () => Promise.all(standIns.map((item) => item.close()))
  if (rehearsal === 'no-key') {
    try {
      const apimartUpload = apimartUploadIngestion()
      standIns.push(await startStandIn({ origin: ENV_KEY_ALLOW_CATALOG.vendors[0].baseUrlHint, netLog, role: 'vendor', freeAnswers: rehearsalFreeAnswers(apimartCredentialProbe()), uploadAnswers: rehearsalUploadAnswers(apimartUpload) }))
      if (hostedUploadOrigin) standIns.push(await startStandIn({ origin: hostedUploadOrigin, netLog, role: 'relay', uploadAnswers: rehearsalUploadAnswers(relayUploadIngestion(hostedUploadOrigin, env)) }))
    } catch (error) { await closeStandIns(); throw error }
  }
  const standIn = standIns.length ? { env: standInLaunchEnv(standIns), close: closeStandIns } : null
  // env-key 路：被测 App 的环境里把 key 这一项清成空串——key 只留在本进程的闭包里，子进程（含它的崩溃转储、诊断包）拿不到。
  const walk = await Promise.resolve().then(() => createWalk(name, { env: { NOMI_WALK_ALLOW_ORIGINS: allow.join(','), NOMI_WALK_NET_LOG: netLog, ...(recordAllowedBodies ? { NOMI_WALK_NET_BODIES: '1' } : {}), ...(envKey ? { [ENV_KEY_VAR]: '' } : {}), ...(standIn?.env ?? {}) } }))
    .catch(async (error) => { await standIn?.close(); throw error })
  walk.report.networkAllowlist = allow
  if (hostedUploadOrigin) walk.report.hostedUploadRelayAllowed = hostedUploadOrigin
  walk.report.credentialSource = rehearsal === 'no-key' ? `rehearsal-fake-key（${REHEARSAL_TIERS['no-key']}）` : envKey ? `env-key（${ENV_KEY_VAR}，只记变量名）` : 'real-profile'
  // 报告里的 rehearsal 一节归 openPaidWalk：拿本地引用写，收尾再挂回去（有的老脚本自己往 report.rehearsal 写一个布尔开关，会把它盖掉）。
  const rehearsalReport = rehearsal ? { tier: rehearsal, judgedAgainst: judgedAllow, relay: relayAllow, endsAt, shotsDeclared: rehearsalShots, ...(standIn ? { standIn: `改道到本机替身的源：${standIns.map((item) => item.redirect.from).join('、')}——只答免费探测和上传（回本机假地址），别的请求记成被挡行（方法、路径、脱敏后的请求体），从不转发` } : {}) } : null
  if (rehearsalReport) walk.report.rehearsal = rehearsalReport
  let blocked = null
  // 演练：App 是被谁、为什么停下的（REHEARSAL_STOPS 的键；null = 脚本自己收的尾）；收窄花钱面完成那一刻账本有几行。
  let stoppedBy = null
  let pendingStop = null
  let lockedAtEntry = null
  // 被挡就地失败：别等 UI 超时（以前一次连接被挡要干等 600 多秒）。关掉 App，让走查脚本里正在等的那一步立刻报错，
  // finish 再把真正的原因（被挡的 host 与层）换到报告里。
  // 演练：收窄之前挡下的授权供应商请求（存 key 后查余额等）照记不停；什么时候停、为什么停见 rehearsalShouldStop。
  const netWatch = watchNetLog(netLog, (entries) => {
    if (rehearsal) {
      stoppedBy = pendingStop
      console.error(`[rehearsal] 关 App：${REHEARSAL_STOPS[stoppedBy] ?? stoppedBy}`)
    } else {
      blocked = blockedError(entries, allow)
      console.error(`[paid] ${redact(blocked.message, secrets)}`)
    }
    walk.stopApp().catch(() => {})
  }, rehearsal ? { shouldFire: (entries) => (pendingStop = rehearsalShouldStop(entries, { lockedAtEntry, judgedAllow, relayAllow, holdForScript, graceMs: rehearsalGraceMs, endsAt })) } : {})
  const removeCredentialCopy = () => removeRealCredentials({ settingsDir: walk.settingsDir, userDataDir: walk.userDataDir, profile })
  let seeded = []
  if (!envKey) {
    try {
      seeded = seedRealModels({ settingsDir: walk.settingsDir, userDataDir: walk.userDataDir, models, profile })
      if (decideSyntheticCredentialStorage({ isolate: true, settingsDir: walk.settingsDir, userDataDir: walk.userDataDir })) throw new Error('real credential copy is missing its source marker')
    }
    catch (error) { netWatch.stop(); removeCredentialCopy(); await walk.fixture.close(); await standIn?.close(); throw error }
    walk.report.seededModels = seeded.map((row) => `${row.vendorKey}/${row.modelKey}`)
    walk.report.realProfileBefore = guard.realProfileBefore
    console.log(`[paid] 隔离副本装了：${walk.report.seededModels.join(' · ')}`)
  } else {
    console.log(`[paid] 凭据来源：环境变量 ${ENV_KEY_VAR}（走可见接入页，不读真实资料）；授权模型：${models.map((model) => `${model.vendorKey}/${model.modelKey}`).join(' · ')}`)
  }
  const label = (vendorKey, modelKey) => seeded.find((row) => row.vendorKey === vendorKey && row.modelKey === modelKey)?.labelZh
  // 接入 / 收窄花钱面只做一次：走查里谁先谁后不靠作者记——开项目（walk.newProject）之前一定先走到这里（见下面的包装）。
  let locked = false
  async function lockToAuthorizedModels(win) {
    if (locked) return walk.report.disabledUnauthorizedModels
    // 花第一分钱之前先确认闸装上了、账本写得进（否则被挡也没人知道）。
    const unguarded = guardLoadedError(readNetLog(netLog))
    if (unguarded) throw unguarded
    if (envKey) {
      // 接入页上的验证会真的打一次大脑模型（几个 token）——这是真人第一次接入时同样会发生的事，记进报告。
      walk.report.envKeyConnect = await connect(win, { apiKey: envKey, textModelKey: envKeyBrainOf(models), requiredModels: models })
      seeded = await readRows(win, models)
      walk.report.seededModels = seeded.map((row) => `${row.vendorKey}/${row.modelKey}`)
    }
    try { walk.report.disabledUnauthorizedModels = await lockSpendTo(win, seeded) }
    catch (error) { throw envKey ? redactedError(error, secrets) : error }
    locked = true
    lockedAtEntry = readNetLog(netLog).length
    return walk.report.disabledUnauthorizedModels
  }
  // 顺序由这里保证：走查没显式调 lockToAuthorizedModels 也好、先开项目后调也好，newProject 之前都已接入并收窄过。
  // （两份走查——agent-default-model-real、agent-long-chat-real——从来没调过它：env-key 路上就是没接入、也没收窄花钱面。）
  let currentWin = null
  const startWalk = walk.start
  walk.start = async (...args) => { const started = await startWalk(...args); currentWin = started.win; return started }
  const openProject = walk.newProject
  walk.newProject = async (...args) => {
    if (!currentWin) throw new Error('walk.newProject 要在 walk.start 之后调用')
    await lockToAuthorizedModels(currentWin)
    return openProject(...args)
  }
  /** env-key 路收尾：网络账本打码留一份、原件连同临时目录删掉；整个隔离副本删除并断言。 */
  function envKeyTeardown() {
    const entries = readNetLog(netLog).map((entry) => redactNetLogEntry(entry, secrets))
    fs.writeFileSync(path.join(walk.outputDir, 'net-log.redacted.jsonl'), entries.map((entry) => `${JSON.stringify(entry)}
`).join(''))
    fs.rmSync(path.dirname(netLog), { recursive: true, force: true })
    // 副本一删日志就没了：先把主进程日志与 Agent lane 记录（key 打码）拷进证据目录。
    walk.report.appLogsCopied = collectAppLogs({ tempRoot: walk.report.tempRoot, projectRoot: walk.report.projectRoot, outDir: walk.outputDir, secrets })
    fs.rmSync(walk.report.tempRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
    if (fs.existsSync(walk.report.tempRoot)) throw new Error(`隔离副本没删干净：${walk.report.tempRoot}`)
    if (fs.existsSync(path.dirname(netLog))) throw new Error('网络账本原件没删干净')
    walk.report.isolatedCopyRemoved = true
    // 报告落盘与打印之前最后一道：内存里的报告不含 key。含了就原地抹掉再红，落盘的是抹过的那份。
    if (JSON.stringify(walk.report).includes(envKey)) {
      const scrubbed = JSON.parse(redact(JSON.stringify(walk.report), secrets))
      for (const name of Object.keys(walk.report)) walk.report[name] = scrubbed[name]
      throw new Error('key 出现在报告内容里（已从落盘的报告里抹掉）——请更换这把 key')
    }
  }
  async function finish(error) {
    const finalEntries = netWatch.stop()
    await standIn?.close()
    blocked ??= blockedError(finalEntries, allow)
    walk.report.networkBlocked = finalEntries.filter((entry) => entry.kind === 'blocked').map(({ via, host, url }) => ({ via, host, url }))
    // 演练：被挡是预期，判的是「挡下的第一条是不是授权供应商、在不在收窄之后」（_paidNetwork.mjs#rehearsalVerdict）。
    const verdict = rehearsal ? rehearsalVerdict({ entries: finalEntries, lockedAtEntry, judgedAllow, relayAllow, scriptError: error ?? null, stoppedBy, hold: holdForScript, endsAt, shots: rehearsalShots }) : null
    if (verdict) {
      walk.report.rehearsal = rehearsalReport
      Object.assign(rehearsalReport, {
        passed: verdict.passed, status: verdict.status, station: verdict.station, shots: verdict.shots, stoppedBy: verdict.stoppedBy, reason: redact(verdict.reason, secrets),
        scriptError: verdict.scriptError === null ? null : redact(verdict.scriptError, secrets), scriptErrorCounted: verdict.scriptErrorCounted, blockedRequest: verdict.request, blockedBeforeSpendLock: verdict.preLock,
      })
      // 替身记下的供应商请求：方法、路径、请求体的键（请求体本身已脱敏，留在账本里；报告只放键，够看出「多发了一个键 / 少了比例」）。
      rehearsalReport.vendorRequests = rehearsalLedgerRequests(finalEntries).filter((_, index, all) => index >= all.length - 8).map((entry) => {
        let keys = null
        try { keys = Object.keys(JSON.parse(String(entry.body?.text ?? ''))).sort() } catch { /* 不是 JSON：只记方法和路径 */ }
        return { method: entry.method, path: blockedRequestPath(entry.url), bodyKeys: keys, bodyBytes: entry.body?.bytes ?? null }
      })
    }
    // 「只到大脑请求」不是坏了（替身答不了对话），报告不判红；收据和清单里如实单列。
    // 真付费：按产品唯一的上游错误归类判（_paidNetwork.mjs#paidRunVerdict）——服务商回余额 / 额度不足判「未验证」，产品错误照旧判「不过」。
    const paidVerdict = !rehearsal ? paidRunVerdict({
      entries: finalEntries,
      lockedAtEntry: locked ? lockedAtEntry : finalEntries.length,
      allow,
      vendorAllow: judgedAllow,
      scriptError: error ?? null,
    }) : null
    if (paidVerdict) {
      walk.report.paidVerdict = {
        status: paidVerdict.status,
        passed: paidVerdict.passed,
        verdict: paidVerdict.verdict,
        reason: redact(paidVerdict.reason, secrets),
        upstreamErrorKind: paidVerdict.upstreamErrorKind,
        request: paidVerdict.request,
        scriptError: paidVerdict.scriptError === null ? null : redact(paidVerdict.scriptError, secrets),
      }
    }
    const failure = verdict
      ? (verdict.passed || verdict.status === 'brain-only' ? undefined : new Error(`演练不过：${verdict.reason}`))
      : paidVerdict?.status === 'unverified'
        ? undefined
        : (blocked ?? error)
    await walk.finish(envKey && failure ? redactedError(failure, secrets) : failure, {
      ...(paidVerdict?.status === 'unverified' ? { result: 'unverified' } : {}),
      unscriptedFixture: true,
      collect: async () => {
        // App 已经关了：项目与截图是证据，先把收据取出来；凭据副本（目录里的 key 密文 + 钥匙）当场删掉。
        // env-key 路：收据读不出来（转录坏了等）也不许挡住收尾——副本里还躺着凭据密文，必须删。
        let spend
        try { spend = spendReceipt(receiptRoot(walk)) }
        catch (error) { if (!envKey) throw error; spend = { media: [], text: null, readError: redact(String(error?.message ?? error), secrets).slice(0, 300) } }
        // 演练绊线：供应商从没收到过请求，就不可能有供应商任务号；有了 = 出网闸漏了，判红。
        const tripped = rehearsal ? spend.media.filter((entry) => entry.taskId) : []
        if (tripped.length) throw new Error(`演练里出现了供应商任务号（${tripped.map((entry) => entry.taskId).join('、')}）——请求到了供应商，立即查出网闸`)
        if (envKey) {
          envKeyTeardown()
          return { spend, paidCalls: spend.media.length, credentialCopyRemoved: true }
        }
        const credentialCopyRemoved = removeCredentialCopy()
        const after = guard.assertRealProfileUntouched()
        return { spend, paidCalls: spend.media.length, realProfileAfter: after, credentialCopyRemoved }
      },
    })
    // 报告 / 日志 / 截图都落盘之后再核一遍证据目录：发现 key 就删掉那些文件并红。
    if (envKey) {
      const hits = filesContainingSecret(walk.outputDir, secrets)
      for (const hit of hits) fs.rmSync(path.join(walk.outputDir, hit), { force: true })
      assertNoSecretOnDisk(walk.outputDir, secrets)
      if (hits.length) throw new Error(`key 泄漏进了证据目录（${hits.join('、')}）——文件已删，请立即更换这把 key`)
    }
    if (verdict) {
      // 证据全落盘之后才算数：walk.finish 判红（收尾、收据、绊线任何一样）也是不过。
      const finishRed = walk.report.result === 'failed' && verdict.status !== 'failed'
      const passed = verdict.passed && !finishRed
      const status = finishRed ? 'failed' : verdict.status
      const reason = redact(finishRed ? `收尾判红：${scriptErrorText(walk.report.error)}` : verdict.reason, secrets)
      const receipt = writeReceipt({ script: receiptScript, entry, build, tier: rehearsal, verdict: { ...verdict, passed, status, reason, scriptError: rehearsalReport.scriptError } })
      console.log(`[rehearsal] ${{ passed: '通过', failed: '不过', 'brain-only': '只到大脑请求（不算过）' }[status]}：${reason}`)
      // 脚本自己的 catch 在被挡后会设 exitCode=1：演练通过 / 只到大脑时改回 0（只到大脑不是坏了，清单里单列）。
      process.exitCode = status === 'failed' ? 1 : 0
      return receipt
    }
    if (paidVerdict) {
      if (walk.report.result === 'failed' && paidVerdict.status !== 'failed') {
        Object.assign(walk.report.paidVerdict, {
          status: 'failed',
          passed: false,
          verdict: '不过',
          reason: redact(`收尾判红：${scriptErrorText(walk.report.error)}`, secrets),
        })
        if (walk.report.outputDir && fs.existsSync(path.join(walk.report.outputDir, 'report.json'))) {
          fs.writeFileSync(path.join(walk.report.outputDir, 'report.json'), JSON.stringify(walk.report, null, 2))
        }
      }
      const finalPaid = walk.report.paidVerdict
      console.log(`[paid] ${finalPaid.verdict}${finalPaid.reason && finalPaid.reason !== finalPaid.verdict ? `：${finalPaid.reason}` : ''}`)
      if (walk.report.result === 'failed') process.exitCode = 1
      else if (finalPaid.status === 'unverified') process.exitCode = PAID_UNVERIFIED_EXIT_CODE
      else if (walk.report.result === 'passed') process.exitCode = 0
      return finalPaid
    }
  }
  /** 闸记下的放行请求 / 上传响应（recordAllowedBodies 时才有；env-key 路再按 key 原串打码一遍）。要在 finish 之前读：env-key 路收尾会删账本原件。 */
  // 演练时读回替身记下的供应商请求（同一个形状，见 _paidNetwork.mjs#rehearsalLedgerRequests）：脚本读账本判请求体的那段演练时照样判（r2 裁决 2）。
  const readAllowedRequests = () => (rehearsal === 'no-key' ? rehearsalLedgerRequests(readNetLog(netLog)) : readNetLog(netLog)
    .filter((entry) => entry.kind === 'allowed-request' || entry.kind === 'allowed-response'))
    .map((entry) => (envKey ? redactNetLogEntry(entry, secrets) : entry))
  // `rehearsal`：这一场是不是演练（null / 'no-key' / 'real-key'）。脚本不需要为演练多写任何东西，想跳过只在真付费时才有意义的核对时可以读它。
  /**
   * 自带转发代理的脚本（在测试进程里压住 / 改写回包）从这里拿上游，不自己读放行名单：
   * 不演练 = 名单上的真供应商；不要 Key 的演练 = 本机供应商替身（不转发）；别的演练档 = 没有上游（脚本照旧在起窗前抛错）。
   * `launchEnvVia(proxyOrigin)` 把代理插在 App 和上游之间，其余改道（中转替身）原样保留——脚本不再整个覆盖改道表。
   */
  const vendorUpstream = () => {
    const from = (rehearsal ? judgedAllow : allow)[0] ?? null
    const sameOrigin = (a, b) => { try { return new URL(a).origin === new URL(b).origin } catch { return false } }
    const vendorStandIn = from ? standIns.find((item) => sameOrigin(item.redirect.from, from)) : null
    const target = vendorStandIn ? vendorStandIn.origin : rehearsal ? null : from
    const others = standIns.filter((item) => item !== vendorStandIn)
    return {
      from, target,
      launchEnvVia: (proxyOrigin) => ({
        NOMI_TEST_NETWORK_REDIRECTS: JSON.stringify([{ from, to: proxyOrigin }, ...others.map((item) => item.redirect)]),
        NOMI_LAB_TRUSTED_PRIVATE_ORIGINS: [proxyOrigin, ...standIns.map((item) => item.origin)].join(','),
      }),
    }
  }
  return { walk, label, lockToAuthorizedModels, finish, readAllowedRequests, rehearsal, vendorUpstream }
}

function blockedRequestPath(url) {
  try { return new URL(String(url)).pathname } catch { return null }
}

/** env-key 路只认 APIMart：别家的 key 这条路不管；点名了别家模型就在花钱前拒。 */
export function assertEnvKeyModels(models) {
  const foreign = models.filter((model) => model.vendorKey !== ENV_KEY_VENDOR)
  if (foreign.length) throw new Error(`${ENV_KEY_VAR} 只能授权 ${ENV_KEY_VENDOR} 的模型，这一场还点名了：${foreign.map((model) => `${model.vendorKey}/${model.modelKey}`).join('、')}（一分钱没花）`)
}

/** 接入页里要验证的文本模型：授权名单里点名的那个 APIMart 文本模型；没点名就用缺省的 DEFAULT_PAID_BRAIN。 */
export function envKeyBrainOf(models) {
  return models.find((model) => APIMART_TEXT_MODEL_KEYS.includes(model.modelKey))?.modelKey ?? DEFAULT_PAID_BRAIN.modelKey
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) } catch { return null }
}

/**
 * 画布那一台（卡上「生成」、节点 ↑、「直接生成」档交给画布的那一镜）的作业，provider 记成 `canvas:<vendorKey>`
 * （传输前缀，见 `electron/capabilityCore/canvasTransportProvider.ts#CANVAS_PROVIDER_PREFIX`）。收据里的供应商是前缀后面那一段。
 */
const CANVAS_PROVIDER_PREFIX = 'canvas:'
export function jobVendor(provider) {
  const value = String(provider ?? '')
  return value.startsWith(CANVAS_PROVIDER_PREFIX)
    ? { vendor: value.slice(CANVAS_PROVIDER_PREFIX.length), engine: 'canvas' }
    : { vendor: value || null, engine: 'production' }
}

/** 项目里所有制作 Run（`.nomi/runs/<runId>/run.json`，Agent 发起的付费都记在这里），按创建先后。 */
export function readProductionRuns(projectRoot) {
  const dir = path.join(projectRoot, '.nomi', 'runs')
  if (!fs.existsSync(dir)) return []
  return fs.readdirSync(dir).map((id) => readJson(path.join(dir, id, 'run.json'))?.run).filter(Boolean)
    .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)))
}

/**
 * 这一次出价（制作 Run `runId`）交给画布的那几镜各自的单镜 Run（盘上的交接记录 `handOvers[].canvasRunId`，取最近一次出价）。
 * D2 起卡上「生成」、「直接生成」档都走画布那一台：作业和产物住在这些 Run 里，制作 Run 自己一笔作业都不派。
 */
export function handedOverRuns(runs, runId) {
  const presentation = runs.find((run) => run.runId === runId)?.generationPlan?.presentations?.at(-1)
  const ids = new Set((presentation?.handOvers ?? []).map((entry) => entry.canvasRunId).filter(Boolean))
  return runs.filter((run) => ids.has(run.runId))
}

/**
 * 这一场真正发生的付费调用，全部从项目落盘读（App 关了之后也读得到）。媒体：画布节点上的每次提交 +
 * 制作 Run 里每个拿到供应商任务号的 job，按供应商任务号去重（同一笔可能两处都记）；
 * 文本：Agent 转录里每条回复的 usage。
 */
export function spendReceipt(projectRoot) {
  if (!projectRoot) return { media: [], text: null }
  const nodes = readJson(path.join(projectRoot, '.nomi', 'project.json'))?.payload?.generationCanvas?.nodes ?? []
  const runs = readProductionRuns(projectRoot)
  const media = new Map()
  for (const node of nodes) {
    for (const run of node.runs ?? []) {
      const taskId = run.taskId ?? (run.resultId && run.resultId === node.result?.id ? node.result?.taskId : undefined)
      media.set(taskId ?? `${node.id}:${run.id}`, {
        source: 'canvas', nodeId: node.id, kind: node.kind, vendor: node.meta?.modelVendor ?? null, model: node.meta?.modelKey ?? null,
        taskId: taskId ?? null, status: run.status, providerCost: node.result?.taskId === taskId ? node.result?.provenance?.cost ?? null : null,
      })
    }
  }
  for (const run of runs) {
    for (const job of run.jobs ?? []) {
      if (!job.providerTaskId) continue
      const node = nodes.find((candidate) => candidate.id === job.nodeId)
      const { vendor, engine } = jobVendor(job.provider)
      media.set(job.providerTaskId, {
        ...media.get(job.providerTaskId),
        source: 'production-run', engine, runId: run.runId, jobId: job.jobId, nodeId: job.nodeId ?? null, vendor, model: job.model,
        taskId: job.providerTaskId, status: job.status, providerCost: node?.result?.provenance?.cost ?? null,
      })
    }
  }
  // 制作 Run 落到节点上的那一次，节点自己的运行记录里没有供应商任务号（记的是 job）——它和 Run 里那条是同一笔。
  const runNodes = new Set([...media.values()].filter((entry) => entry.source === 'production-run').map((entry) => entry.nodeId))
  for (const [key, entry] of media) if (entry.source === 'canvas' && !entry.taskId && runNodes.has(entry.nodeId)) media.delete(key)
  const text = { replies: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, models: {} }
  for (const session of readLaneTranscripts(projectRoot)) {
    for (const message of laneMessages(session)) {
      if (message.role !== 'assistant' || !message.usage) continue
      text.replies += 1
      for (const key of ['input', 'output', 'cacheRead', 'cacheWrite']) text[key] += Number(message.usage[key]) || 0
      const model = `${message.provider ?? '?'}/${message.model ?? '?'}`
      text.models[model] = (text.models[model] ?? 0) + 1
    }
  }
  return { media: [...media.values()], text }
}

// ── 付费确认框的观察（画布与分镜表两条付费走查共用）──────────────────────────────

/** 确认框的稳定锚点（SpendConfirmDialog.tsx；按文案找是易碎选择器）。 */
export const SPEND_DIALOG = '[data-spend-confirm-dialog]'

/**
 * 「价格行」回来了没有。2026-09-26 起确认框不再印价格（官方额度上线前隐藏价格维度）；旧框里那一行是
 * 「预计金额 / Estimated amount」+「N 点 / 目录未标价」。任何货币符号或「点 / credits」计数出现在框里都算。
 * 按语义判，不按已删的 i18n 键判——键删了，字符串换个地方回来照样要红。
 */
export const PRICE_LINE = /预计金额|Estimated amount|目录未标价|[¥$]\s*\d|\d+(?:\.\d+)?\s*(?:点|credits?)\b/i

/**
 * 在真实 DOM 上挂一个观察者：确认框**出现过几次**，以及一个活体探针（某个元素的某个属性）走过哪些值。
 * 确认框可能一闪而过，事后查 locator 会漏；活体那一栏证明观察者真的在看——它一个值都没记到，「0 次弹框」不作数。
 */
export async function watchSpendDialogs(win, { selector, attribute }) {
  const slot = `__paidSpendWatch${Date.now()}`
  await win.evaluate(({ dialog, selector: probe, attribute: attr, slot: key }) => {
    const log = { dialogs: 0, liveness: [] }
    let open = false
    const sample = () => {
      const now = Boolean(document.querySelector(dialog))
      if (now && !open) log.dialogs += 1
      open = now
      const value = document.querySelector(probe)?.getAttribute(attr)
      if (value && log.liveness.at(-1) !== value) log.liveness.push(value)
    }
    window[key] = log
    sample()
    new MutationObserver(sample).observe(document.body, { childList: true, subtree: true, attributes: true })
  }, { dialog: SPEND_DIALOG, selector, attribute, slot })
  return { read: () => win.evaluate((key) => window[key], slot) }
}

// ── 不走 openPaidWalk 的付费走查：例外表（唯一一份）──────────────────────────────
// openPaidWalk 自动配好出网名单、被挡当场失败、花钱前核对闸已装上（_paidNetwork.mjs）。下面两条不走它，
// 各自的原因与它们**自己**的出网护栏写在这里；tests/ux/_paidRun.test.mjs 逐个 *.paid.mjs 核对：
// 要么调用 openPaidWalk、要么在这张表里，表里的文件不存在了也红（不留死条目）。
export const PAID_WALKS_WITHOUT_OPEN_PAID_WALK = Object.freeze([
  {
    file: 'tests/ux/apimart-domestic-line.paid.mjs',
    why: '在打好的安装包上，故意真出网到 APIMart 国内线路（要证明请求真的发往国内主机），不能用「只放授权名单、其余全拦」的闸。',
    networkGuard: '主进程出站走 scripts/apimart-line-netsim.cjs 的「只记账不拦截」档（RECORD_ONLY），脚本自己核对记账已在主入口前装上、官方主域 0 次；花钱面用 lockSpendToModels 收窄到被授权的一个模型。',
  },
  {
    file: 'tests/ux/core-a-storyboard.paid.mjs',
    why: '分镜表整条真旅程（可从上一场续跑、可在安装包上跑），整份真实目录按字节拷进隔离副本，自己管理凭据副本的生灭。',
    networkGuard: '没有出网闸：不挂 walkthrough-network-guard，也不开 NOMI_TEST_NETWORK_GUARD，真网直连。护栏只有 assertPaidRunAllowed（CI 拒跑、NOMI_SPEND_OK、用户 Nomi 开着拒跑、原库指纹）、确认框观察（watchSpendDialogs）与收据（spendReceipt）。这是已知缺口：不会自动配名单，也不会因被挡当场失败（因为根本不拦）。',
  },
])

/**
 * 纯判据（结构测试钉它）：给定仓库里所有 *.paid.mjs（相对路径）和读文件的函数，返回问题清单。
 * 每个文件要么调用 openPaidWalk，要么在例外表里；例外表里的文件必须存在，且确实没有调用 openPaidWalk（否则条目已过期）。
 */
export function paidWalkCoverageProblems(files, readFile, exceptions = PAID_WALKS_WITHOUT_OPEN_PAID_WALK) {
  const listed = new Map(exceptions.map((entry) => [entry.file, entry]))
  const problems = []
  for (const file of files) {
    const usesOpenPaidWalk = /\bopenPaidWalk\s*\(/.test(readFile(file))
    if (!usesOpenPaidWalk && !listed.has(file)) problems.push(`${file}：既没调用 openPaidWalk，也不在例外表里——花钱前核闸、被挡即失败都没覆盖到`)
    if (usesOpenPaidWalk && listed.has(file)) problems.push(`${file}：已经调用 openPaidWalk，例外表里的条目过期了，删掉`)
  }
  for (const entry of exceptions) {
    if (!files.includes(entry.file)) problems.push(`${entry.file}：例外表里的文件不存在了，删掉死条目`)
    if (!entry.why || !entry.networkGuard) problems.push(`${entry.file}：例外表条目缺理由或缺它自己的网络护栏说明`)
  }
  return problems
}

// ── 构建标记还在不在产品源码里（零花费结构核对，结构测试钉它）──────────────────────────────
// 起因（2026-10-24）：B3 把主进程参考守从「只剥不拒」改成「拒发」，旧付费脚本 reference-leak-hotfix.paid.mjs 的构建标记
// 'reference residue stripped before send' 随之从源码里消失。assertPaidBuildReady 只在付费那一刻搜产物，平时没有任何一道门
// 看得见，直到要真付费那天才发现脚本跑不起来。这里把同一件事前移到单测：每个 `buildMarkers: [...]` 的值都要能静态读出来
// （字符串字面量 / 同文件的 const 字面量 / uiText('语言', 'key')），且原样出现在产品源码里（不含测试文件）。
export const PRODUCT_SOURCE_DIRS = Object.freeze(['src', 'electron'])

const stripLineAndBlockComments = (source) => source.replace(/\r\n?/g, '\n').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
// 一项：'…' / "…" / `…`（不带插值）/ uiText('语言', 'key') / 标识符（可带一段调用，带了就读不出来、报问题）。
const MARKER_ENTRY = /'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"|`([^`$\\]*)`|\buiText\(\s*['"]([^'"]+)['"]\s*,\s*['"]([^'"]+)['"]\s*\)|([A-Za-z_$][\w$]*(?:\([^)]*\))?)/g
const QUOTED_VALUE = String.raw`(?:'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"|` + '`([^`$\\\\]*)`)'
const unescapeQuoted = (text) => text.replace(/\\(.)/g, '$1')

/** `buildMarkers: [...]` 里的一项 → { value } 或 { error }。 */
function resolveMarkerEntry(match, code, uiTextOf) {
  const [whole, single, double, template, locale, key, identifier] = match
  if (single !== undefined) return { value: unescapeQuoted(single) }
  if (double !== undefined) return { value: unescapeQuoted(double) }
  if (template !== undefined) return { value: template }
  if (locale !== undefined) {
    try { return { value: uiTextOf(locale, key) } } catch (error) { return { error: `uiText('${locale}', '${key}') 读不到（${String(error?.message ?? error).slice(0, 120)}）` } }
  }
  if (/^[A-Za-z_$][\w$]*$/.test(identifier)) {
    const constant = new RegExp(String.raw`\bconst\s+` + identifier.replace(/\$/g, '\\$') + String.raw`\s*=\s*` + QUOTED_VALUE).exec(code)
    if (constant) return { value: constant[3] ?? unescapeQuoted(constant[1] ?? constant[2]) }
  }
  return { error: `${whole} 读不出字面值（标记只认字符串字面量、同文件的 const 字面量、uiText('语言', 'key')）` }
}

/**
 * 纯判据：files 里每个 `buildMarkers: [...]` 的每一项，读得出字面值、且 sourceIncludes(值) 为真；返回问题清单。
 * @param {string[]} files 仓库相对路径
 * @param {(file: string) => string} readFile
 * @param {{ sourceIncludes: (text: string) => boolean, uiTextOf: (locale: string, key: string) => string }} deps
 */
export function paidBuildMarkerProblems(files, readFile, { sourceIncludes, uiTextOf }) {
  const problems = []
  for (const file of files) {
    const code = stripLineAndBlockComments(readFile(file))
    for (const list of code.matchAll(/\bbuildMarkers\s*:\s*\[([^\]]*)\]/g)) {
      const entries = [...list[1].matchAll(MARKER_ENTRY)]
      if (!entries.length) problems.push(`${file}：buildMarkers 是空的——要验修复就给一句会原样进产物的字面量，不验就别传`)
      for (const entry of entries) {
        const resolved = resolveMarkerEntry(entry, code, uiTextOf)
        if (resolved.error) { problems.push(`${file}：构建标记 ${resolved.error}`); continue }
        if (!resolved.value) { problems.push(`${file}：构建标记是空串`); continue }
        if (!sourceIncludes(resolved.value)) {
          problems.push(`${file}：构建标记 ${JSON.stringify(resolved.value)} 在产品源码（${PRODUCT_SOURCE_DIRS.join('/、')}/，不含测试）里找不到——被验的修复已改写或删掉，这条付费走查到付费那一刻会拒跑；同一提交换成新实现会进产物的字面量，或删掉这条走查`)
        }
      }
    }
  }
  return problems
}
