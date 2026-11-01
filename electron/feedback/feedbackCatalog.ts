// 反馈包里的模型目录：自建连接只留「是自建」。
//
// 目录是排查「这个模型调不通」最有用的一份，但用户自建中转那几行是他自己的东西：vendor key 从他的地址铸出来
// （`gw-example-com`、`internal-proxy-corp-local`），连接名和模型别名是他起的，映射和脚本里写着他的接口。
// 诊断包可以带（用户自己看过、自己决定发给谁），点一下就走的这条路不行。规矩和日志尾巴同一条、同一个判据
// （`builtinVendorOf`）：内置家留，其余塌成 `custom`。
//
// 内置家那几行也只留下面列出的字段，默认不要：
//   · 接口地址用户可以改成自己的中转，只有代码里登记过的才原样留；
//   · 兄弟连接（`apimart--mini`）的后半段是用户起的连接名，换成序号；
//   · `meta` 是杂物袋，手填的自定义头就住在里面，字段名不像密钥，`redactModelCatalog` 抹不到。
// 最后再过一遍：host 不是代码里登记过的 URL 一律换掉，不管它长在哪一格。
import { AI_SDK_PROVIDER_KINDS, VENDOR_AUTH_TYPES } from '../shared/contracts/modelAccessCapabilities'
import { BUILTIN_VENDOR_SEEDS, builtinVendorSeed } from '../catalog/builtinVendorSeeds'
import { applyBuiltinSeeds } from '../catalog/seedBuiltins'
import { CURRENT_CATALOG_VERSION } from '../catalog/types'
import { CONNECTION_KEY_SEPARATOR } from '../shared/builtinVendorIdentity'
import { codeDeclaredFallbackOrigins } from '../vendor/vendorBaseFallback'
import { builtinVendorOf } from './feedbackLogTail'

const CUSTOM_VENDOR = 'custom'
const CUSTOM_ADDRESS = '<custom-address>'
const URL_IN_TEXT = /\b[a-z][a-z0-9+.-]*:\/\/[^\s"'<>]*/gi
const BUILTIN_VENDOR_FIELDS = ['enabled', 'authType', 'authHeader', 'authScheme', 'authQueryParam', 'providerKind', 'network', 'assetIngestion', 'createdAt', 'updatedAt'] as const
const CREDENTIAL_FIELDS = ['enc', 'enabled', 'verificationPending', 'createdAt', 'updatedAt'] as const

type Row = Record<string, unknown>

function isRecord(value: unknown): value is Row {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function rowsOf(value: unknown): Row[] {
  return Array.isArray(value) ? value.filter(isRecord) : []
}

function pick(row: Row, fields: readonly string[]): Row {
  return Object.fromEntries(fields.filter((field) => row[field] !== undefined).map((field) => [field, row[field]]))
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase() || null
  } catch {
    return null
  }
}

let publishedHosts: ReadonlySet<string> | undefined

/**
 * 代码里登记过的 host：新装机的目录里有的（官方地址、上传通道、回调、价格出处），加上迁移前的旧地址和官方备用域。
 * 从种子算出来，用户填的地址进不了这张表，加新种子也不用来这里改。第一次发反馈才算。
 */
function isPublishedAddress(url: string): boolean {
  publishedHosts ??= new Set([
    ...(JSON.stringify(applyBuiltinSeeds({ version: CURRENT_CATALOG_VERSION, vendors: [], models: [], mappings: [], apiKeysByVendor: {} }, new Date(0).toISOString()).state).match(URL_IN_TEXT) ?? []),
    ...BUILTIN_VENDOR_SEEDS.flatMap((seed) => [...(seed.legacyBaseUrls ?? []), ...codeDeclaredFallbackOrigins(seed.key)]),
  ].flatMap((seeded) => hostOf(seeded) ?? []))
  const host = hostOf(url)
  return host !== null && publishedHosts.has(host)
}

/** 内置家的接口地址用户可以改；没带协议的也算他自己填的。 */
function projectAddress(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null
  return isPublishedAddress(value) ? value : CUSTOM_ADDRESS
}

/** 把每一个字符串（键和值）换一遍。 */
function mapStrings(node: unknown, change: (text: string) => string): unknown {
  if (typeof node === 'string') return change(node)
  if (Array.isArray(node)) return node.map((item) => mapStrings(item, change))
  if (!isRecord(node)) return node
  return Object.fromEntries(Object.entries(node).map(([key, value]) => [change(key), mapStrings(value, change)]))
}

function maskForeignUrls(text: string): string {
  return text.replace(URL_IN_TEXT, (url) => (isPublishedAddress(url) ? url : CUSTOM_ADDRESS))
}

/** 只认枚举里的值：这几格是自建行留下来的，不能让它们带出一段用户写的文字。 */
function enumValue(value: unknown, allowed: readonly string[]): string | null {
  return typeof value === 'string' && allowed.includes(value) ? value : null
}

/** 排查 401 和连不上要看的事实：配过没有、怎么存的、启用没有、走没走代理。材料本身和自定义头的名字都不要。 */
function credentialFacts(record: unknown): Row | null {
  if (!isRecord(record)) return null
  const network = isRecord(record.networkConfig) ? record.networkConfig : {}
  return {
    ...pick(record, CREDENTIAL_FIELDS),
    hasProxy: network.proxyUrl !== undefined,
    hasExtraHeaders: isRecord(network.extraHeaders) && Object.keys(network.extraHeaders).length > 0,
  }
}

/** 内置家的 vendor key → 出门用的名字：root 原样，兄弟连接和认证候选换成 `root--序号`。 */
function namesForBuiltinKeys(keys: readonly string[]): Map<string, string> {
  const names = new Map<string, string>()
  const seen = new Map<string, number>()
  for (const key of keys) {
    const root = builtinVendorOf(key)
    if (root === null || names.has(key)) continue
    if (key === root) {
      names.set(key, root)
      continue
    }
    const ordinal = (seen.get(root) ?? 1) + 1
    seen.set(root, ordinal)
    names.set(key, `${root}${CONNECTION_KEY_SEPARATOR}${ordinal}`)
  }
  return names
}

/**
 * 投影一份**已经抹过密钥**的目录（`redactModelCatalog` 的产物）。不是认识的形状回 null：
 * 认不出哪几行是自建，就保证不了地址不出门。
 *
 * 接口映射只留配过的厂商和这次出问题的那一家：目录占了反馈包的九成，其中映射又是大头，
 * 而绝大多数映射属于用户根本没配 key 的内置厂商。包小一半，弱网上才发得完。
 */
export function projectCatalogForReport(catalog: unknown, provider: string | null): Row | null {
  if (!isRecord(catalog) || !Array.isArray(catalog.vendors)) return null
  const vendors = rowsOf(catalog.vendors)
  const models = rowsOf(catalog.models)
  const mappings = rowsOf(catalog.mappings)
  const credentials = isRecord(catalog.apiKeysByVendor) ? catalog.apiKeysByVendor : {}
  const suppressed = rowsOf(catalog.suppressedBuiltinModels)
  const vendorKeyOf = (row: Row): string => String(row.vendorKey ?? '')
  const names = namesForBuiltinKeys([
    ...vendors.map((vendor) => String(vendor.key ?? '')),
    ...[...models, ...mappings, ...suppressed].map(vendorKeyOf),
    ...Object.keys(credentials),
  ])
  /** 属于内置家的一行：换掉它身上每一处原来的 key（映射 id 里也可能带着连接名）。 */
  const ownRows = (rows: Row[]): Row[] => rows.flatMap((row) => {
    const name = names.get(vendorKeyOf(row))
    if (name === undefined) return []
    const key = vendorKeyOf(row)
    return [(key === name ? row : mapStrings(row, (text) => text.split(key).join(name))) as Row]
  })
  const countOf = (rows: Row[], key: string): number => rows.filter((row) => vendorKeyOf(row) === key).length

  const projectVendorRow = (vendor: Row): Row => {
    const key = String(vendor.key ?? '')
    const name = names.get(key)
    if (name === undefined) {
      return {
        key: CUSTOM_VENDOR,
        enabled: vendor.enabled === true,
        authType: enumValue(vendor.authType, VENDOR_AUTH_TYPES),
        providerKind: enumValue(vendor.providerKind, AI_SDK_PROVIDER_KINDS),
        credential: credentialFacts(credentials[key]),
        modelCount: countOf(models, key),
        mappingCount: countOf(mappings, key),
      }
    }
    return {
      key: name,
      name: builtinVendorSeed(builtinVendorOf(key) ?? '')?.name,
      baseUrlHint: projectAddress(vendor.baseUrlHint),
      ...pick(vendor, BUILTIN_VENDOR_FIELDS),
    }
  }

  const configured = Object.keys(credentials).flatMap((key) => names.get(key) ?? [])
  const relevant = new Set(provider ? [...configured, provider] : configured)
  const ownMappings = ownRows(mappings).filter((mapping) => relevant.has(vendorKeyOf(mapping)))
  const ownModels = ownRows(models).map(({ customCall, ...model }) => (customCall === undefined ? model : { ...model, customCall: true }))
  return mapStrings({
    ...pick(catalog, ['version']),
    vendors: vendors.map(projectVendorRow),
    models: ownModels,
    modelsOmitted: models.length - ownModels.length,
    mappings: ownMappings,
    mappingsOmitted: mappings.length - ownMappings.length,
    apiKeysByVendor: Object.fromEntries(Object.entries(credentials).flatMap(([key, record]) => {
      const name = names.get(key)
      return name === undefined ? [] : [[name, { vendorKey: name, ...credentialFacts(record) }]]
    })),
    suppressedBuiltinModels: ownRows(suppressed),
  }, maskForeignUrls) as Row
}
