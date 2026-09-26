// 用户真实 Nomi 资料目录的唯一 owner（2026-09-26）。回答四件事：它在哪、哪几份文件带着凭据、
// 怎么把凭据带进一份隔离副本、跑前跑后怎么证明原库一个字节都没动。
//
// 为什么必须收成一处：真凭据 / 付费走查以前各自手写 `~/Library/Application Support/Nomi/...`
// （isoApp、agent-spend-*、core-a、batch-generate、agent-runtime-provider……二十多处），全是 macOS 路径，
// Windows 上一条都起不来。更隐蔽的是第二层——**只拷目录文件，Windows 上照样解不开 key**：
// safeStorage 的钥匙在 macOS 住钥匙串（按 app 名，同机同名即可解），Windows 却住在 userData 下的
// `Local State`（os_crypt.encrypted_key，DPAPI 绑当前用户账户）。隔离副本里没有这份文件，Chromium 首启
// 就新生一把钥匙，拷过去的密文成了死数据（实测 hasApiKey=false，见 canvas-follow-hand/session.mjs 的
// seedPlaceholderKey 注释）。所以「凭据」在 Windows 上是两份文件，不是一份。
//
// 纪律：凭据钥匙文件只按字节复制，从不解析、从不打印；目录文件的 apiKey 字段只原样搬运，不解密。
import { spawnSync } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'

const require = createRequire(import.meta.url)

/**
 * `app.getName()` 读的是 asar 里 package.json 的 `name`（`build.productName` 不进 asar，
 * 见 electron/settings/sideBySideInstallSeed.ts 的 STABLE_APP_NAME）。从 package.json 派生，不手抄。
 * macOS 的 APFS 默认大小写不敏感，历史上写成 `Nomi` 的也指向同一目录；Linux 大小写敏感，只能是它。
 */
const APP_NAME = require('../../package.json').name

/** 资料目录不在默认位置时（多用户 / 自定义 userData）的唯一覆盖口。 */
export const REAL_PROFILE_ENV = 'NOMI_REAL_PROFILE_USER_DATA'
export const REAL_CATALOG_FILE = 'model-catalog.json'

/**
 * 真实资料目录在哪、凭据由哪几份文件组成。纯函数（平台 / env / home 可注入），三平台同一份判据：
 *   darwin `~/Library/Application Support/<name>` · win32 `%APPDATA%\<name>` · linux `$XDG_CONFIG_HOME|~/.config/<name>`
 * （与 Electron `app.getPath('appData')` 同源；electron/capabilityCore/mcpDetectedClients.ts 的 appData 根同一套。）
 */
export function realNomiProfile({ platform = process.platform, env = process.env, homedir = os.homedir() } = {}) {
  const paths = platform === 'win32' ? path.win32 : path.posix
  const trimmed = (value) => String(value || '').trim()
  const appDataRoot = platform === 'darwin'
    ? paths.join(homedir, 'Library', 'Application Support')
    : platform === 'win32'
      ? trimmed(env.APPDATA) || paths.join(homedir, 'AppData', 'Roaming')
      : trimmed(env.XDG_CONFIG_HOME) || paths.join(homedir, '.config')
  const userDataDir = trimmed(env[REAL_PROFILE_ENV]) || paths.join(appDataRoot, APP_NAME)
  return {
    platform,
    userDataDir,
    catalogPath: paths.join(userDataDir, REAL_CATALOG_FILE),
    /** 住在 userData 里、解密目录密文必需的钥匙文件（只有 Windows 有；macOS / Linux 在系统钥匙串）。 */
    credentialStoreFiles: platform === 'win32' ? ['Local State'] : [],
  }
}

function requireFile(file, why) {
  if (!fs.existsSync(file)) throw new Error(`真实资料目录缺 ${path.basename(file)}（${file}）——${why}`)
}

/** 把凭据钥匙（Windows 的 Local State）按字节拷进隔离 userData。必须在被测 App 起来**之前**。 */
export function seedRealCredentialStore(userDataDir, profile = realNomiProfile()) {
  fs.mkdirSync(userDataDir, { recursive: true })
  for (const name of profile.credentialStoreFiles) {
    const from = path.join(profile.userDataDir, name)
    requireFile(from, '没有它，拷过去的 key 密文在这台机器上解不开')
    fs.copyFileSync(from, path.join(userDataDir, name))
  }
  return profile.credentialStoreFiles.slice()
}

/** 整份真实目录 + 凭据钥匙进隔离副本（隔离 settings 放目录、隔离 userData 放钥匙）。 */
export function seedRealCredentials({ settingsDir, userDataDir, profile = realNomiProfile() }) {
  requireFile(profile.catalogPath, '被测 App 需要这台机器上已配好的模型与 key')
  fs.mkdirSync(settingsDir, { recursive: true })
  fs.copyFileSync(profile.catalogPath, path.join(settingsDir, REAL_CATALOG_FILE))
  return { catalog: REAL_CATALOG_FILE, credentialStore: seedRealCredentialStore(userDataDir, profile) }
}

/**
 * 把隔离副本里带着凭据的那几份文件删掉（目录里的 key 密文 + Windows 的 Local State），别的原样留着——
 * 项目、截图、隔离设置都是证据，续跑还要用；只有凭据不许在跑完之后还躺在临时目录里。
 * 必须在被测 App 关掉之后调（开着时 Chromium 随时会把 Local State 写回去）。
 *
 * 目录是**一族**文件，不是一份：App 升级目录时会在旁边留备份（`model-catalog.bak.json`、
 * `model-catalog.v<旧版本>.bak.json`，2026-09-26 Windows 实测），它们带着同样的 key 密文。只删主文件等于没删。
 */
export function removeRealCredentials({ settingsDir, userDataDir, profile = realNomiProfile() }) {
  const catalogFamily = fs.existsSync(settingsDir)
    ? fs.readdirSync(settingsDir).filter((name) => name.startsWith('model-catalog') && name.endsWith('.json')).map((name) => path.join(settingsDir, name))
    : []
  const files = [...catalogFamily, ...profile.credentialStoreFiles.map((name) => path.join(userDataDir, name))]
  for (const file of files) fs.rmSync(file, { force: true })
  return files.every((file) => !fs.existsSync(file))
}

export function readRealCatalog(profile = realNomiProfile()) {
  requireFile(profile.catalogPath, '需要这台机器上已配好的模型与 key')
  return JSON.parse(fs.readFileSync(profile.catalogPath, 'utf8'))
}

/**
 * 把真实目录里**点名的几行**（连同它们的供应商、凭据密文、任务映射）装进一份已存在的隔离目录，
 * 并把凭据钥匙带进隔离 userData。同类的其余生成模型一律收起并停用，「新建卡片默认模型」设成被授权的那个：
 * 模型 / 用户在这一场里点谁，都只能点到被授权的那几个，花销可预期（付费走查在花钱前仍逐项核对落点）。
 *
 * `pricing` 是**走查夹具数据**，不是供应商报价：真实扣多少由供应商按它自己的价目表结算，
 * 这里的数只决定界面的形态（例如多镜付费卡能不能切「全部」一次派出）。
 * 返回装进去的每一行 `{ vendorKey, modelKey, kind, labelZh }`（走查按真名去选模型，不手抄标签）。
 */
export function seedRealModels({ settingsDir, userDataDir, models, profile = realNomiProfile() }) {
  const source = readRealCatalog(profile)
  const file = path.join(settingsDir, REAL_CATALOG_FILE)
  const catalog = JSON.parse(fs.readFileSync(file, 'utf8'))
  const now = new Date().toISOString()
  const seeded = new Map()
  const generationKinds = new Set()
  for (const want of models) {
    const identity = `${want.vendorKey}/${want.modelKey}`
    const vendor = source.vendors?.find((entry) => entry.key === want.vendorKey)
    const credential = source.apiKeysByVendor?.[want.vendorKey]
    if (!vendor) throw new Error(`真实目录里没有供应商 ${want.vendorKey}（${profile.catalogPath}）`)
    if (credential?.enc !== 'safeStorage') throw new Error(`${want.vendorKey} 的凭据不是 safeStorage 密文——明文 key 本仓 fail-closed`)
    const row = source.models?.find((entry) => entry.vendorKey === want.vendorKey && entry.modelKey === want.modelKey)
    if (!row) throw new Error(`真实目录里没有 ${identity}`)
    const mappings = (source.mappings ?? []).filter((entry) => entry.vendorKey === want.vendorKey && entry.modelKey === want.modelKey)
    if (row.kind !== 'text' && mappings.length === 0) throw new Error(`真实目录里没有 ${identity} 的任务映射`)
    if (!catalog.vendors.some((entry) => entry.key === vendor.key)) catalog.vendors.push({ ...vendor, enabled: true })
    catalog.apiKeysByVendor = { ...catalog.apiKeysByVendor, [want.vendorKey]: credential }
    catalog.models = catalog.models.filter((entry) => `${entry.vendorKey}/${entry.modelKey}` !== identity)
    catalog.models.push({ ...row, published: true, enabled: true, updatedAt: now, ...(want.pricing ? { pricing: want.pricing } : {}) })
    catalog.mappings = [
      ...(catalog.mappings ?? []).filter((entry) => `${entry.vendorKey}/${entry.modelKey}` !== identity),
      ...mappings.map((entry) => ({ ...entry, enabled: true })),
    ]
    if (row.kind !== 'text') generationKinds.add(row.kind)
    seeded.set(identity, { vendorKey: row.vendorKey, modelKey: row.modelKey, kind: row.kind, labelZh: row.labelZh })
  }
  for (const model of catalog.models) {
    if (!generationKinds.has(model.kind) || seeded.has(`${model.vendorKey}/${model.modelKey}`)) continue
    model.published = false
    model.enabled = false
  }
  fs.writeFileSync(file, `${JSON.stringify(catalog, null, 2)}\n`)
  // 「新建卡片默认模型」就是被授权的那一个（用户在设置里就是这么设的；electron/settings/generationModelDefaultsContract.ts）。
  // 缺了它，新卡按「池子里第一个健康的」挑——App 首启补进来的内置同类模型也在池子里，挑中谁不由走查说了算。
  const byTaskKind = {}
  for (const row of seeded.values()) {
    const identity = { vendorKey: row.vendorKey, modelKey: row.modelKey }
    if (row.kind === 'image') Object.assign(byTaskKind, { text_to_image: identity, image_edit: identity })
    if (row.kind === 'video') Object.assign(byTaskKind, { text_to_video: identity, image_to_video: identity })
  }
  if (Object.keys(byTaskKind).length) {
    fs.writeFileSync(path.join(settingsDir, 'generation-model-defaults.json'), `${JSON.stringify({ schemaVersion: 1, byTaskKind }, null, 2)}\n`)
  }
  seedRealCredentialStore(userDataDir, profile)
  return [...seeded.values()]
}

/**
 * 原库的凭据相关文件（目录 + 钥匙）此刻的指纹：内容散列 + 大小 + 修改时间。
 * 只用于「跑前 / 跑后一字不差」的比较与报告；散列不可逆，打印它不泄露任何内容。
 */
export function realProfileFingerprint(profile = realNomiProfile()) {
  const fingerprint = {}
  for (const name of [REAL_CATALOG_FILE, ...profile.credentialStoreFiles]) {
    const file = path.join(profile.userDataDir, name)
    if (!fs.existsSync(file)) { fingerprint[name] = 'missing'; continue }
    const stat = fs.statSync(file)
    const sha256 = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
    fingerprint[name] = `sha256:${sha256}:size:${stat.size}:mtime:${Math.round(stat.mtimeMs)}`
  }
  return fingerprint
}

/**
 * 用户自己的 Nomi（安装版）此刻开着没有。开着就不许拷资料目录：它随时在写目录与钥匙，
 * 拷到的是半新半旧的一份；而跑后指纹一变，也分不清是走查写穿了还是用户自己在用。
 * 开发构建跑的是 electron 可执行文件，不在此列。
 */
export function realNomiIsRunning(platform = process.platform) {
  const probe = platform === 'win32'
    ? spawnSync('tasklist', ['/FI', 'IMAGENAME eq Nomi.exe', '/FO', 'CSV', '/NH'], { encoding: 'utf8' })
    : spawnSync('pgrep', ['-x', platform === 'darwin' ? 'Nomi' : APP_NAME], { encoding: 'utf8' })
  if (probe.error) throw new Error(`查不了 Nomi 是否在运行：${probe.error.message}`)
  return platform === 'win32' ? /"Nomi\.exe"/i.test(probe.stdout || '') : probe.status === 0
}
