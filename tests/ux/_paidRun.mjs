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
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { verifyBuild } from '../../scripts/package-build-stamp.mjs'

import { laneMessages, readLaneTranscripts } from './agent-lane-observer.mjs'
import { createRuntimeWalk } from './agent-runtime-walk-support.mjs'
import { blockedError, guardLoadedError, hostedUploadRelayOrigin, newNetLogFile, paidWalkAllowlist, readNetLog, watchNetLog } from './_paidNetwork.mjs'
import {
  ENV_KEY_ALLOW_CATALOG, ENV_KEY_VAR, ENV_KEY_VENDOR, assertNoSecretOnDisk, assertUsableEnvKey, connectApimartThroughVisibleUi,
  APIMART_TEXT_MODEL_KEYS, collectAppLogs, envKeyOf, filesContainingSecret, paidCredentialSource, readAuthorizedRows, redact, redactNetLogEntry, redactedError,
} from './_paidEnvKey.mjs'
import { readRealCatalog, realNomiIsRunning, realNomiProfile, realProfileFingerprint, removeRealCredentials, seedRealModels } from './_realProfile.mjs'

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
export const SPEND_OPT_IN_ENV = 'NOMI_SPEND_OK'
/** 付费走查缺省的 Agent 大脑（单源）：各脚本都从这里拿，不各写一个 key——写死的 deepseek-v3.2 在 10-27 退役后，Agent 生图付费走查就跑不起来了。它必须在 APIMART_TEXT_MODEL_KEYS 里（单测守）。 */
export const DEFAULT_PAID_BRAIN = Object.freeze({ vendorKey: ENV_KEY_VENDOR, modelKey: 'deepseek-v4-pro' })

/**
 * 纯判据（单测钉它）：返回拒跑理由，null = 放行。
 * env-key 路（设了 APIMART_API_KEY）不碰真实资料目录，所以「用户的 Nomi 开着」不构成拒跑理由；
 * CI 拒跑与显式 NOMI_SPEND_OK 两道闸两条路一样。
 */
export function paidRunRefusal(script, { env = process.env, nomiRunning = false } = {}) {
  if (env.CI) return `${script} 会真的调用供应商并扣费，不在 CI 里跑`
  if (env[SPEND_OPT_IN_ENV] !== '1') return `${script} 会花真钱：显式设 ${SPEND_OPT_IN_ENV}=1 才跑`
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
  try { verify(root) }
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
}

export function assertPaidRunAllowed(script, env = process.env, isNomiRunning = realNomiIsRunning, profile = realNomiProfile({ env })) {
  const envKeyRoute = paidCredentialSource(env) === 'env-key'
  const refusal = paidRunRefusal(script, { env, nomiRunning: !envKeyRoute && !env.CI && env[SPEND_OPT_IN_ENV] === '1' && isNomiRunning() })
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
    // false = 供应商的源不进放行名单（零花费探测：就算误提交，网络闸也当场挡下，结构上花不了钱）。缺省 true，别的付费走查不变。
    vendorNetwork = true,
    // true = 闸把放行名单上公网请求的请求体（先脱敏：不记请求头、签名查询串与 key 形状的串打码）记进账本，`readAllowedRequests()` 读回。
    // 给要核「App 真正发给供应商的是什么」的付费走查用（参考图错发热修的真付费样本）；缺省关，别的付费走查不变。
    recordAllowedBodies = false,
  } = deps
  // 真实资料目录的位置跟着传进来的 env 走（缺省就是 process.env，和以前一样）；env-key 路根本不会用到它。
  const profile = realNomiProfile({ env })
  const guard = assertPaidRunAllowed(script, env, isNomiRunning, profile)
  // 产物比源码新 + 产物里有被验修复的标记：不满足就拒跑，必须在建隔离副本、装凭据之前（一分钱没花、什么都没拷）。
  if (!argv.includes('--packaged')) assertBuild(REPO_ROOT, { markers: buildMarkers })
  const envKey = paidCredentialSource(env) === 'env-key' ? assertUsableEnvKey(envKeyOf(env)) : ''
  const secrets = envKey ? [envKey] : []
  if (envKey) assertEnvKeyModels(models)
  // 出网名单按本场授权的供应商自动算（见 _paidNetwork.mjs），连同账本路径一起交给被测 App 的闸；调用方什么都不用配。
  const hostedUploadOrigin = hostedUploads ? hostedUploadRelayOrigin(env) : null
  const vendorAllow = !vendorNetwork ? [] : envKey
    ? paidWalkAllowlist(ENV_KEY_ALLOW_CATALOG, [ENV_KEY_VENDOR])
    : paidWalkAllowlist(readRealCatalog(profile), models.map((model) => model.vendorKey))
  const allow = [...vendorAllow, ...(hostedUploadOrigin ? [hostedUploadOrigin] : [])]
  const netLog = newNetLogFile()
  // env-key 路：被测 App 的环境里把 key 这一项清成空串——key 只留在本进程的闭包里，子进程（含它的崩溃转储、诊断包）拿不到。
  const walk = await createWalk(name, { env: { NOMI_WALK_ALLOW_ORIGINS: allow.join(','), NOMI_WALK_NET_LOG: netLog, ...(recordAllowedBodies ? { NOMI_WALK_NET_BODIES: '1' } : {}), ...(envKey ? { [ENV_KEY_VAR]: '' } : {}) } })
  walk.report.networkAllowlist = allow
  if (hostedUploadOrigin) walk.report.hostedUploadRelayAllowed = hostedUploadOrigin
  walk.report.credentialSource = envKey ? `env-key（${ENV_KEY_VAR}，只记变量名）` : 'real-profile'
  let blocked = null
  // 被挡就地失败：别等 UI 超时（以前一次连接被挡要干等 600 多秒）。关掉 App，让走查脚本里正在等的那一步立刻报错，
  // finish 再把真正的原因（被挡的 host 与层）换到报告里。
  const netWatch = watchNetLog(netLog, (entries) => {
    blocked = blockedError(entries, allow)
    console.error(`[paid] ${redact(blocked.message, secrets)}`)
    walk.stopApp().catch(() => {})
  })
  const removeCredentialCopy = () => removeRealCredentials({ settingsDir: walk.settingsDir, userDataDir: walk.userDataDir, profile })
  let seeded = []
  if (!envKey) {
    try { seeded = seedRealModels({ settingsDir: walk.settingsDir, userDataDir: walk.userDataDir, models, profile }) }
    catch (error) { netWatch.stop(); removeCredentialCopy(); await walk.fixture.close(); throw error }
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
    blocked ??= blockedError(finalEntries, allow)
    walk.report.networkBlocked = finalEntries.filter((entry) => entry.kind === 'blocked').map(({ via, host, url }) => ({ via, host, url }))
    const failure = blocked ?? error
    await walk.finish(envKey && failure ? redactedError(failure, secrets) : failure, {
      unscriptedFixture: true,
      collect: async () => {
        // App 已经关了：项目与截图是证据，先把收据取出来；凭据副本（目录里的 key 密文 + 钥匙）当场删掉。
        // env-key 路：收据读不出来（转录坏了等）也不许挡住收尾——副本里还躺着凭据密文，必须删。
        let spend
        try { spend = spendReceipt(walk.report.projectRoot) }
        catch (error) { if (!envKey) throw error; spend = { media: [], text: null, readError: redact(String(error?.message ?? error), secrets).slice(0, 300) } }
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
  }
  /** 闸记下的放行请求 / 上传响应（recordAllowedBodies 时才有；env-key 路再按 key 原串打码一遍）。要在 finish 之前读：env-key 路收尾会删账本原件。 */
  const readAllowedRequests = () => readNetLog(netLog)
    .filter((entry) => entry.kind === 'allowed-request' || entry.kind === 'allowed-response')
    .map((entry) => (envKey ? redactNetLogEntry(entry, secrets) : entry))
  return { walk, label, lockToAuthorizedModels, finish, readAllowedRequests }
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
