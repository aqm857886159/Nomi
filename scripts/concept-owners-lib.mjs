// check:concept-owners 的判据本体（R33 / R17 / R21.3，2026-09-29）。
//
// 守的不变量：**一个概念只有一个主人。** 按方案「横切治理层 §1」计数：`(subject, lifecycle, authority_kind,
// trust_domain)` 一组只许一个 owner；owner 之外不许再长出同名的定义（第二个写口）；`pending` 概念不许新增生产写入口、
// 读者只许是例外账（allowed_consumers）；根因合同声明的每个共享边界都必须是某个登记概念的写接口（没登记的新概念）。
//
// 判据只判「形状」，不证明语义 owner（方案原话）：同一件事换个名字重写一份，这里看不见——那一半归
// parity_test、变异测试和真实旅程，也归收货时 R33.3 那一问。门岗能保证的是：**登记表里写的主人今天真的还在、
// 还是唯一的定义处，而且新合同里冒出来的边界一定进了账**。
//
// 本文件只放纯函数：输入是登记表、基线、扫描结果，输出是 findings。读文件、跑 git 都在 scan / check 两个文件里。
import { splitSymbol } from './boundary-owners.mjs'
import { CONCEPT_SUBJECT_PATTERN as SUBJECT_PATTERN } from './concept-registry-lib.mjs'
import { IDENTITY_DIMENSIONS, isScannableSource, normalizePath, PRODUCTION_ROOTS, rootOf } from './concept-owners-scan.mjs'

export const REGISTRY_SCHEMA_VERSION = 2
export const BASELINE_VERSION = 1

/**
 * 合同侧判据的起点：登记表最后一次和 main 对账是 2026-09-26（#897 的 Phase 0 账本），
 * 所以从 09-27 起的根因合同，声明的共享边界都必须已经进账——既管住以后，也把 09-26 之后长出来的主人一次补齐。
 * 取合同文件名的日期前缀（同 DOOR_MAP_SINCE / INVARIANT_OWNER_LAYER_SINCE 的做法）。
 */
export const CONCEPT_OWNERS_SINCE = '2026-09-27'

/** 生命周期：方案「现有对象的生命周期映射」七段，加上非生成类状态各自的寿命。 */
export const LIFECYCLES = new Map([
  ['author', '作者意图 / 草稿（封存前可改）'],
  ['frozen-execution', '封存的执行合同与编译期判据（模式 / 变体 / 参数准入）'],
  ['spend-authority', '花费授权（报价、确认、令牌）'],
  ['execution', '执行（Run、job、调度、Agent 回合里的等待）'],
  ['provider-observation', '供应商回执、观察与产物取回'],
  ['materialized-artifact', '已落盘的产物与素材'],
  ['projection', '只读投影（界面派生、分组、显示名）'],
  ['live-interaction', '进程内实时交互态（手势、播放、视口、实时缩放）'],
  ['session', '一次进程 / 窗口会话内的记忆（不落盘）'],
  ['preference', '持久化的用户偏好（记住的视角、收起状态）'],
  ['project-data', '项目持久化数据（清单、素材归属）'],
  ['catalog', '模型 / 工具 / 供应商的声明与目录'],
  ['host', '宿主与进程配置（隔离头、后台启动、编辑器内核、诊断通道）'],
  ['delivery', '交付、测试与走查工具链'],
])

/** 这个 owner 行使的是哪一种权力。同一件事可以有「判据」和「写口」两个 owner，但各只有一个。 */
export const AUTHORITY_KINDS = new Map([
  ['decision', '判据 / 编译：决定一个派生事实'],
  ['writer', '唯一写口：写一份状态、账本或偏好'],
  ['schema', '形状 / 声明表：类型、schema、常量表、注册表'],
  ['gateway', '唯一出入口：一条线路或一个内核入口，所有调用都必须经过它'],
  ['lease', '应用租约：对框架内核的单向控制'],
  ['projection', '投影构建：只读 read model'],
])

/**
 * 事实的种类。方案列的是 durable / state-machine / value-object / projection 四类；
 * 另加 `rule`：准入、落家、变体、要不要弹确认这类**纯判据**不存状态，也不是投影（方案明文：投影不许重新决定
 * 模式、变体、准入、状态），硬塞进四类之一就是在登记表里说谎。
 */
export const FACT_KINDS = new Map([
  ['durable', '持久化的事实'],
  ['state-machine', '按状态转换前进的事实'],
  ['value-object', '不可变的值、形状或表'],
  ['projection', '由别的事实派生的只读视图'],
  ['rule', '无状态的判据：输入相同，结论相同'],
])

export const MIGRATION_STATUSES = new Map([
  ['converged', '唯一 owner 已落地，旧路径已删'],
  ['pending', 'owner 未定：不许新增生产写入口，读者只许是 allowed_consumers 这本例外账'],
])

/** `trust_domain` 不是自由填写的第二份真相：它由 owner 所在路径派生，门岗逐条核对。 */
export const TRUST_DOMAINS = new Map([
  ['main', 'electron/ 主进程（可信）'],
  ['shared', 'electron/shared/ 两侧共用的判据与契约'],
  ['preload', 'electron/preload 信任边界'],
  ['renderer', 'src/ 渲染层（不可信输入）'],
  ['test', 'tests/ 与 evals/ 的走查与评测'],
  ['tooling', 'scripts/ 与仓库根目录的构建 / 门岗脚本'],
  ['site', 'worker/、marketing/ 与 wrangler.json（官网）'],
])

const FORBIDDEN_KINDS = new Set(['definition', 'reference'])

const CONCEPT_KEYS = new Set([
  'name', 'subject', 'lifecycle', 'authority_kind', 'trust_domain', 'fact_kind', 'migration_status',
  'migration_strategy', 'owner', 'write_api', 'forbidden_derivations', 'identity_fields', 'parity_test',
  'allowed_consumers', 'since', 'notes',
])
const REQUIRED_KEYS = [
  'name', 'subject', 'lifecycle', 'authority_kind', 'trust_domain', 'fact_kind', 'migration_status',
  'owner', 'write_api', 'forbidden_derivations', 'allowed_consumers', 'since', 'notes',
]

const IDENTIFIER_PATTERN = /^[A-Za-z_$][A-Za-z0-9_$]*$/
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const TEST_FILE = /(?:^|\/)(?:tests?|__tests__)(?:\/|$)|\.(?:test|spec)\.[cm]?[jt]sx?$|\.node-test\.[cm]?js$/

export function isIdentifierSymbol(symbol) {
  return IDENTIFIER_PATTERN.test(String(symbol ?? ''))
}

export function trustDomainOfPath(file) {
  const rel = normalizePath(file)
  if (rel.startsWith('electron/shared/')) return 'shared'
  if (/^electron\/preload(?:[./]|$)/.test(rel)) return 'preload'
  if (rel.startsWith('electron/')) return 'main'
  if (rel.startsWith('src/')) return 'renderer'
  if (rel.startsWith('tests/') || rel.startsWith('evals/')) return 'test'
  if (rel.startsWith('worker/') || rel.startsWith('marketing/') || rel === 'wrangler.json') return 'site'
  return 'tooling'
}

/** 计数键：方案的「唯一 owner 按 (concept, lifecycle, authority_kind, trust_domain) 计数」。 */
export function ownerKey(concept) {
  return [concept.subject, concept.lifecycle, concept.authority_kind, concept.trust_domain].join('|')
}

function pairKey(path, symbol) {
  return `${normalizePath(path)}::${symbol}`
}

function text(value, min = 1) {
  return typeof value === 'string' && value.trim().length >= min
}

function finding(rule, fields) {
  return { rule, ...fields }
}

// ─── 登记表 ──────────────────────────────────────────────────────────────────

/** 结构、枚举、唯一性、trust_domain 与路径一致、路径存在。 */
export function validateRegistry(registry, { exists }) {
  const findings = []
  const invalid = (message, concept) => findings.push(finding('registry-invalid', { concept, message }))
  if (!registry || typeof registry !== 'object' || Array.isArray(registry)) {
    invalid('登记表根必须是对象')
    return findings
  }
  if (registry.schema_version !== REGISTRY_SCHEMA_VERSION) {
    invalid(`schema_version 必须是 ${REGISTRY_SCHEMA_VERSION}（字段定义见 docs/engineering-rules.md R33.4）`)
  }
  if (!Array.isArray(registry.concepts)) {
    invalid('concepts 必须是数组')
    return findings
  }
  const names = new Set()
  const keys = new Map()
  const pairOwners = new Map()
  for (const [index, concept] of registry.concepts.entries()) {
    const label = concept?.name ? String(concept.name) : `concepts[${index}]`
    if (!concept || typeof concept !== 'object' || Array.isArray(concept)) {
      invalid(`${label} 必须是对象`)
      continue
    }
    for (const key of Object.keys(concept)) {
      if (CONCEPT_KEYS.has(key)) continue
      const hint = key === 'consumers' ? '（v2 里叫 allowed_consumers）' : ''
      invalid(`不认识的字段 ${key}${hint}`, label)
    }
    for (const key of REQUIRED_KEYS) {
      if (concept[key] === undefined) invalid(`缺必填字段 ${key}`, label)
    }
    if (!text(concept.name)) invalid('name 必须是非空字符串', label)
    else if (names.has(concept.name)) invalid(`概念名重复：${concept.name}`, label)
    names.add(concept.name)
    if (concept.subject !== undefined && !SUBJECT_PATTERN.test(String(concept.subject))) {
      invalid(`subject 必须是点分的小写标识（如 generation.parameter-admission）：${concept.subject}`, label)
    }
    for (const [key, table] of [['lifecycle', LIFECYCLES], ['authority_kind', AUTHORITY_KINDS], ['fact_kind', FACT_KINDS],
      ['migration_status', MIGRATION_STATUSES], ['trust_domain', TRUST_DOMAINS]]) {
      if (concept[key] !== undefined && !table.has(concept[key])) {
        invalid(`${key} 不在取值表里：${concept[key]}（可选：${[...table.keys()].join(' / ')}）`, label)
      }
    }
    if (concept.migration_status === 'pending' && !text(concept.migration_strategy, 12)) {
      invalid('pending 概念必须写 migration_strategy：由哪张施工卡 / 哪条分支收口、收口的判据是什么（R33.4）', label)
    }
    if (concept.migration_strategy !== undefined && !text(concept.migration_strategy, 12)) {
      invalid('migration_strategy 写了就要写实（至少 12 个字符）', label)
    }
    if (concept.since !== undefined && !DATE_PATTERN.test(String(concept.since))) invalid(`since 必须是 YYYY-MM-DD：${concept.since}`, label)
    if (concept.notes !== undefined && !text(concept.notes)) invalid('notes 不能为空', label)

    const owner = concept.owner
    const ownerOk = owner && typeof owner === 'object' && !Array.isArray(owner) && text(owner.path) && text(owner.symbol)
      && Object.keys(owner).every((key) => key === 'path' || key === 'symbol')
    if (!ownerOk) {
      invalid('owner 必须是 { path, symbol }（pending 不再挂在 owner 上，改用 migration_status）', label)
    } else if (concept.trust_domain !== undefined && TRUST_DOMAINS.has(concept.trust_domain)
      && trustDomainOfPath(owner.path) !== concept.trust_domain) {
      findings.push(finding('trust-domain-mismatch', {
        concept: label,
        path: owner.path,
        message: `trust_domain 写的是 ${concept.trust_domain}，owner 所在路径派生出来是 ${trustDomainOfPath(owner.path)}`,
      }))
    }

    const writeApi = Array.isArray(concept.write_api) ? concept.write_api : null
    if (!writeApi || writeApi.length === 0) {
      invalid('write_api 必须是非空数组：这个概念合法的写 / 判据入口（owner 本身必须在里面）', label)
    } else {
      const seen = new Set()
      for (const entry of writeApi) {
        if (!entry || !text(entry.path) || !text(entry.symbol) || Object.keys(entry).some((key) => key !== 'path' && key !== 'symbol')) {
          invalid('write_api 每一条都必须是 { path, symbol }', label)
          continue
        }
        const pair = pairKey(entry.path, entry.symbol)
        if (seen.has(pair)) invalid(`write_api 重复：${pair}`, label)
        seen.add(pair)
        const claimed = pairOwners.get(pair)
        if (claimed && claimed !== label) {
          findings.push(finding('duplicate-owner', {
            concept: label,
            path: entry.path,
            symbol: entry.symbol,
            message: `写接口 ${pair} 同时登记在「${claimed}」与「${label}」名下——一个写接口只归一个概念，同一件事登记了两次`,
          }))
        }
        pairOwners.set(pair, label)
      }
      if (ownerOk && !seen.has(pairKey(owner.path, owner.symbol))) invalid('owner 必须同时出现在 write_api 里', label)
    }

    const forbidden = concept.forbidden_derivations
    if (!Array.isArray(forbidden)) {
      invalid('forbidden_derivations 必须是数组（没有已知的第二形状就写 []）', label)
    } else {
      const apiSymbols = new Set((writeApi ?? []).map((entry) => entry?.symbol))
      for (const entry of forbidden) {
        if (!entry || !isIdentifierSymbol(entry.symbol) || !FORBIDDEN_KINDS.has(entry.kind) || !text(entry.why, 6)
          || Object.keys(entry).some((key) => !['symbol', 'kind', 'why'].includes(key))) {
          invalid('forbidden_derivations 每一条都必须是 { symbol: 标识符, kind: definition|reference, why: 为什么禁止 }', label)
          continue
        }
        if (apiSymbols.has(entry.symbol)) invalid(`${entry.symbol} 既在 write_api 里又被列为禁止——自相矛盾`, label)
      }
    }

    if (concept.identity_fields !== undefined) {
      const fields = concept.identity_fields
      if (!Array.isArray(fields) || fields.length === 0 || fields.some((field) => !text(field)) || new Set(fields).size !== fields.length) {
        invalid('identity_fields 写了就必须是非空、不重复的字段名数组', label)
      }
    }
    if (concept.parity_test !== undefined) {
      if (!text(concept.parity_test) || !TEST_FILE.test(normalizePath(concept.parity_test))) {
        invalid(`parity_test 必须指向一个测试文件：${concept.parity_test}`, label)
      } else if (!exists(concept.parity_test)) {
        invalid(`parity_test 不存在：${concept.parity_test}`, label)
      }
    }

    const consumers = concept.allowed_consumers
    if (!Array.isArray(consumers) || consumers.some((consumer) => !text(consumer))) {
      invalid('allowed_consumers 必须是路径数组', label)
    } else {
      if (new Set(consumers.map(normalizePath)).size !== consumers.length) invalid('allowed_consumers 有重复路径', label)
      for (const consumer of consumers) {
        if (!exists(consumer)) {
          findings.push(finding('consumer-missing', { concept: label, path: consumer, message: `allowed_consumers 里的路径不存在：${consumer}` }))
        }
      }
    }

    if (concept.subject && concept.lifecycle && concept.authority_kind && concept.trust_domain) {
      const key = ownerKey(concept)
      const previous = keys.get(key)
      if (previous) {
        findings.push(finding('duplicate-owner', {
          concept: label,
          message: `「${previous}」与「${label}」的 (subject, lifecycle, authority_kind, trust_domain) 完全相同：${key}——同一件事两个主人`,
        }))
      } else {
        keys.set(key, label)
      }
    }
  }
  return findings
}

/**
 * 判据只吃结构合格的部分。坏掉的字段已经由 validateRegistry 报红；这里不让它把后面的判据炸成一串堆栈——
 * 门岗红了要告诉人「哪一条判据」，而不是让人去读 TypeError。
 */
export function sanitizeConcepts(concepts) {
  const entries = (value, valid) => (Array.isArray(value) ? value.filter(valid) : [])
  return (Array.isArray(concepts) ? concepts : [])
    .filter((concept) => concept && typeof concept === 'object' && !Array.isArray(concept))
    .map((concept) => ({
      ...concept,
      owner: concept.owner && typeof concept.owner === 'object' && !Array.isArray(concept.owner) ? concept.owner : null,
      write_api: entries(concept.write_api, (entry) => entry && text(entry.path) && text(entry.symbol)),
      forbidden_derivations: entries(concept.forbidden_derivations, (entry) => entry && text(entry.symbol) && FORBIDDEN_KINDS.has(entry.kind)),
      allowed_consumers: entries(concept.allowed_consumers, (entry) => text(entry)),
      identity_fields: Array.isArray(concept.identity_fields) ? concept.identity_fields.filter((field) => text(field)) : undefined,
    }))
}

/** 登记表里所有「写接口」：`path::symbol` → 概念名。 */
export function writeApiIndex(concepts) {
  const byPair = new Map()
  for (const concept of concepts) {
    for (const entry of concept.write_api ?? []) byPair.set(pairKey(entry.path, entry.symbol), concept.name)
  }
  return byPair
}

/** 需要找定义的全部符号：写接口里的标识符 + 列为「定义即违规」的旧形状。 */
export function definitionSymbols(concepts) {
  const symbols = new Set()
  for (const concept of concepts) {
    for (const entry of concept.write_api ?? []) if (isIdentifierSymbol(entry.symbol)) symbols.add(entry.symbol)
    for (const entry of concept.forbidden_derivations ?? []) {
      if (entry?.kind === 'definition' && isIdentifierSymbol(entry.symbol)) symbols.add(entry.symbol)
    }
  }
  return symbols
}

function writeApiPaths(concept) {
  return new Set((concept.write_api ?? []).map((entry) => normalizePath(entry.path)))
}

/**
 * 主人还在不在（owner-unresolved），以及 owner 之外有没有同名定义（第二写口）。
 *
 * 「同名定义」判的是**定义**不是**调用**：画布、Agent、MCP 从 owner import 同一个函数是多个入口、一个主人
 * （方案：「多个入口」≠「多个 owner」）；在别的文件里**再定义**一份同名的函数 / 表 / 类型，才是第二个写口。
 * 别名（`const x = owner.x`、选择器 `useStore((s) => s.x)`）和重导出不算定义。
 * 另一个登记概念**明确认领**的同名定义（同名不同事，各自登记、各有计数键）不算——那是账上写明的判断。
 * 写接口如果登记在接口 / 类型的**成员声明**上（依赖注入的钩子槽位，例如提交 outbox 的 `beforeDispatch`），
 * 它是一份契约：别处给这个槽位填的实现是接线，不是第二个主人，所以这类写接口不做同名检查。
 */
export function evaluateOwnership({ concepts, definitions, exists, read }) {
  const findings = []
  const secondWritePorts = []
  const claimed = writeApiIndex(concepts)
  const implementations = (symbol) => (definitions.get(symbol) ?? []).filter((definition) => definition.kind !== 'signature')
  for (const concept of concepts) {
    for (const entry of concept.write_api ?? []) {
      if (!text(entry?.path) || !text(entry?.symbol)) continue
      const file = normalizePath(entry.path)
      if (!exists(file)) {
        findings.push(finding('owner-unresolved', { concept: concept.name, path: file, symbol: entry.symbol, message: '写接口所在路径不存在' }))
        continue
      }
      if (isIdentifierSymbol(entry.symbol) && isScannableSource(file)) {
        const defined = (definitions.get(entry.symbol) ?? []).some((definition) => definition.path === file)
        if (!defined) {
          findings.push(finding('owner-unresolved', {
            concept: concept.name,
            path: file,
            symbol: entry.symbol,
            message: '这个文件里没有这个符号的定义（别名、重导出不算定义）——主人搬家了、改名了，还是没了？',
          }))
        }
      } else if (!String(read(file) ?? '').includes(entry.symbol)) {
        findings.push(finding('owner-unresolved', { concept: concept.name, path: file, symbol: entry.symbol, message: '这个文件里找不到这个字面量' }))
      }
    }

    const ownPaths = writeApiPaths(concept)
    const targets = new Map()
    for (const entry of concept.write_api ?? []) {
      if (!isIdentifierSymbol(entry.symbol)) continue
      // 登记处只有成员声明、没有实现 = 契约槽位（见上）；槽位的填充不查同名。
      const slotOnly = !implementations(entry.symbol).some((definition) => definition.path === normalizePath(entry.path))
      if (slotOnly && !targets.has(entry.symbol)) continue
      targets.set(entry.symbol, 'write_api')
    }
    for (const entry of concept.forbidden_derivations ?? []) {
      if (entry?.kind === 'definition' && isIdentifierSymbol(entry.symbol)) targets.set(entry.symbol, 'forbidden')
    }
    for (const [symbol, origin] of targets) {
      for (const definition of implementations(symbol)) {
        if (claimed.has(pairKey(definition.path, symbol))) continue
        if (origin === 'forbidden' && ownPaths.has(definition.path)) continue
        secondWritePorts.push({ concept: concept.name, path: definition.path, symbol, line: definition.line, origin })
      }
    }
  }
  return { findings, secondWritePorts }
}

function referenceSymbols(concept) {
  return new Set((concept.forbidden_derivations ?? []).filter((entry) => entry?.kind === 'reference').map((entry) => entry.symbol))
}

/**
 * 需要数门的概念：pending 的（暂定主人的写接口 + 列为 reference 的旧路），以及任何带 reference 禁令的。
 * 扫描根 = 生产两根 + 写接口自己住的根（owner 在 tests/ 的走查类概念，门也在 tests/）。
 */
export function doorWatch(concept) {
  const symbols = new Set(referenceSymbols(concept))
  if (concept.migration_status === 'pending') {
    for (const entry of concept.write_api ?? []) if (isIdentifierSymbol(entry.symbol)) symbols.add(entry.symbol)
  }
  const roots = new Set(PRODUCTION_ROOTS)
  for (const entry of concept.write_api ?? []) {
    const root = rootOf(entry.path)
    if (root) roots.add(root)
  }
  return { symbols: [...symbols], roots: [...roots] }
}

/**
 * 门的政策（方案「pending owner 禁止新增生产写入口；已有 read/projection consumers 只能按例外账读取」）：
 *   · 写接口所在文件之外的每一扇门，路径都必须在 allowed_consumers（例外账）里——新消费者要协调会话批准、写进账；
 *   · pending 概念登记为 reference 的**旧路**（与暂定主人竞争同一件事的那条路）的**写门**另外冻结进基线，只减不增：
 *     旧路上不许再长一个写口，哪怕是例外账里的文件。
 * 暂定主人自己的接口不冻结：迁移本来就是把消费者一个个挪到它上面（例如画布缩放的 useCanvasLiveZoom）。
 */
export function evaluateDoorPolicy({ concept, doors }) {
  const findings = []
  const writeDoors = []
  const ownPaths = writeApiPaths(concept)
  const consumers = new Set((concept.allowed_consumers ?? []).map(normalizePath))
  const legacy = referenceSymbols(concept)
  const pending = concept.migration_status === 'pending'
  for (const door of doors) {
    const file = normalizePath(door.path)
    if (ownPaths.has(file)) continue
    if (!consumers.has(file)) {
      findings.push(finding(pending ? 'pending-unlisted-consumer' : 'forbidden-reference', {
        concept: concept.name,
        path: file,
        symbol: door.symbol,
        message: pending
          ? `pending 概念多了一个不在例外账里的${door.kind === 'write' ? '写' : '读'}入口`
          : `碰了列为 reference 禁令的 ${door.symbol}，而这个文件不在 allowed_consumers 里`,
      }))
    }
    if (pending && door.kind === 'write' && legacy.has(door.symbol)) {
      writeDoors.push({ concept: concept.name, path: file, symbol: door.symbol })
    }
  }
  return { findings, writeDoors }
}

/**
 * 身份比对（原 check:identity-compare）：每个「长得像身份比对」的函数都必须是某个登记身份概念的写接口，
 * 且逐字比的维度 = 登记的 identity_fields（只算已知身份维度）。维度漂了就是身份漂了（#802 的形状）。
 */
export function evaluateIdentity({ concepts, comparators }) {
  const findings = []
  const byPair = new Map()
  for (const concept of concepts) {
    for (const entry of concept.write_api ?? []) byPair.set(pairKey(entry.path, entry.symbol), concept)
  }
  const expectedOf = (concept) => (concept.identity_fields ?? []).filter((field) => IDENTITY_DIMENSIONS.has(field)).sort()
  const detected = new Set()
  for (const site of comparators) {
    const pair = pairKey(site.path, site.symbol)
    detected.add(pair)
    const concept = byPair.get(pair)
    if (!concept) {
      findings.push(finding('identity-comparator', {
        path: site.path,
        symbol: site.symbol,
        message: `登记表之外又长出一份身份比对（比了 ${site.dimensions.join(' / ')}）：改成 import owner 的那一份；`
          + '确实是另一种身份，就把它登记成一个概念并写明 identity_fields（原 check:identity-compare 的判据）',
      }))
      continue
    }
    const expected = expectedOf(concept)
    if (expected.join(',') !== site.dimensions.join(',')) {
      findings.push(finding('identity-drift', {
        concept: concept.name,
        path: site.path,
        symbol: site.symbol,
        message: `登记的身份维度是 [${expected.join(' / ') || '（没写 identity_fields）'}]，现在比的是 [${site.dimensions.join(' / ')}]——维度漂了就是身份漂了`,
      }))
    }
  }
  for (const concept of concepts) {
    const expected = expectedOf(concept)
    if (expected.length < 2) continue
    const owner = concept.owner
    if (owner && !detected.has(pairKey(owner.path, owner.symbol))) {
      findings.push(finding('identity-drift', {
        concept: concept.name,
        path: owner.path,
        symbol: owner.symbol,
        message: `登记的比对函数不再逐字比 [${expected.join(' / ')}]（改成委托了、改名了或已删除）——身份的主人换了就改登记，别让登记替一个不存在的比对背书`,
      }))
    }
  }
  return findings
}

// ─── 根因合同 ────────────────────────────────────────────────────────────────

export function contractDate(file) {
  const match = /(?:^|\/)(\d{4}-\d{2}-\d{2})-/.exec(normalizePath(file))
  return match ? match[1] : null
}

export function governedContracts(contracts, since = CONCEPT_OWNERS_SINCE) {
  return contracts.filter(({ file }) => {
    const date = contractDate(file)
    return Boolean(date) && date >= since
  })
}

function boundaryParts(symbol) {
  return splitSymbol(symbol).map((part) => part.replace(/\(\)$/, '')).filter(Boolean)
}

function isDirectoryLike(file) {
  const rel = normalizePath(file)
  return rel.endsWith('/') || rel.endsWith('/**') || !/\.[A-Za-z0-9]+$/.test(rel)
}

/**
 * 合同 → 概念。**没登记的新概念在合同检查里失败**：受管合同（日期 ≥ CONCEPT_OWNERS_SINCE）声明的每个
 * `shared_boundaries`（那条不变量的执行边界，也就是它的主人）都必须是某个登记概念的写接口。
 *
 * 刻意**不**拿合同门表的每一扇写门判红：门表是「宁可多数一扇」的普查（R21.3），拿它判红会逼作者少数门，
 * 那正是门表要消灭的「我扫过了」。门表在这里只用来把合同归到它碰到的概念上（`--map` 打印）；
 * 「第二个写口」在活代码上判（evaluateOwnership / evaluateDoorPolicy），合同快照会过期，活代码不会。
 */
export function evaluateContracts({ concepts, contracts, since = CONCEPT_OWNERS_SINCE }) {
  const findings = []
  const mapping = []
  const apiEntries = concepts.flatMap((concept) => (concept.write_api ?? []).map((entry) => ({
    concept: concept.name,
    path: normalizePath(entry.path),
    symbol: entry.symbol,
  })))
  const symbolsByConcept = new Map(concepts.map((concept) => [concept.name, new Set([
    ...(concept.write_api ?? []).map((entry) => entry.symbol),
    ...(concept.forbidden_derivations ?? []).map((entry) => entry?.symbol),
  ])]))
  for (const { file, contract } of governedContracts(contracts, since)) {
    const touched = new Set()
    for (const boundary of Array.isArray(contract?.shared_boundaries) ? contract.shared_boundaries : []) {
      if (!text(boundary?.path) || !text(boundary?.symbol)) continue
      const boundaryPath = normalizePath(boundary.path).replace(/\/\*\*$/, '').replace(/\/$/, '')
      for (const part of boundaryParts(boundary.symbol)) {
        const match = apiEntries.find((entry) => entry.symbol === part
          && (entry.path === boundaryPath || (isDirectoryLike(boundary.path) && entry.path.startsWith(`${boundaryPath}/`))))
        if (match) {
          touched.add(match.concept)
          continue
        }
        findings.push(finding('unregistered-boundary', {
          contract: file,
          path: boundaryPath,
          symbol: part,
          message: `${file} 声明的共享边界 ${boundaryPath}#${part} 不是任何登记概念的写接口`,
        }))
      }
    }
    for (const door of Array.isArray(contract?.doors) ? contract.doors : []) {
      for (const [name, symbols] of symbolsByConcept) if (symbols.has(door?.symbol)) touched.add(name)
    }
    mapping.push({ contract: file, concepts: [...touched].sort() })
  }
  return { findings, mapping }
}

// ─── 基线（棘轮：存身份不存裸数字，只减不增）───────────────────────────────

function entryKey(entry) {
  return `${entry.concept}|${normalizePath(entry.path)}|${entry.symbol}`
}

function reasonIsSubstantive(value) {
  return text(value, 12) && !/\b(?:TODO|TBD|FIXME)\b/.test(value)
}

export function validateBaseline(baseline, { conceptsByName }) {
  const findings = []
  const invalid = (message) => findings.push(finding('baseline-invalid', { message }))
  if (!baseline || typeof baseline !== 'object' || Array.isArray(baseline)) {
    invalid('基线根必须是对象')
    return findings
  }
  if (baseline.version !== BASELINE_VERSION) invalid(`基线 version 必须是 ${BASELINE_VERSION}`)
  for (const bucket of ['second_write_ports', 'pending_write_doors']) {
    if (!Array.isArray(baseline[bucket])) {
      invalid(`${bucket} 必须是数组`)
      continue
    }
    const seen = new Set()
    for (const entry of baseline[bucket]) {
      if (!entry || !text(entry.concept) || !text(entry.path) || !text(entry.symbol)) {
        invalid(`${bucket} 每一条都要有 concept / path / symbol`)
        continue
      }
      const key = entryKey(entry)
      if (seen.has(key)) invalid(`${bucket} 重复：${key}`)
      seen.add(key)
      const concept = conceptsByName.get(entry.concept)
      if (!concept) invalid(`${bucket} 指向一个没登记的概念：${entry.concept}`)
      else if (bucket === 'pending_write_doors' && concept.migration_status !== 'pending') {
        invalid(`pending_write_doors 里的「${entry.concept}」已经不是 pending 了——收口之后这些冻结门应当删掉`)
      }
      if (bucket === 'second_write_ports' && !reasonIsSubstantive(entry.reason)) {
        invalid(`second_write_ports 的每一条都要写清为什么暂时收不掉（≥12 字，TODO 不算）：${key}`)
      }
    }
  }
  return findings
}

// ─── 未登记的合同边界：冻结存量，只减不增（2026-10-06）────────────────────────
// 受管合同里声明的共享边界还没登记成概念的写接口：存量债冻进基线（unregistered_boundaries），
// 新增的直接红；登记或合同删除后基线里对应条目必须删（陈旧也红）。登记 owner 要人判断，机器补不了。

export const boundaryKey = (entry) => `${entry.contract}|${normalizePath(entry.path)}|${entry.symbol}`

export function validateBoundaryBaseline(baseline) {
  const findings = []
  const bucket = baseline?.unregistered_boundaries
  if (!Array.isArray(bucket)) return [finding('baseline-invalid', { message: 'unregistered_boundaries 必须是数组（存量债冻结账）' })]
  const seen = new Set()
  for (const entry of bucket) {
    if (!entry || !text(entry.contract) || !text(entry.path) || !text(entry.symbol)) {
      findings.push(finding('baseline-invalid', { message: 'unregistered_boundaries 每一条都要有 contract / path / symbol' }))
      continue
    }
    const key = boundaryKey(entry)
    if (seen.has(key)) findings.push(finding('baseline-invalid', { message: `unregistered_boundaries 重复：${key}` }))
    seen.add(key)
  }
  return findings
}

/** 把合同扫描里的 unregistered-boundary 发现和冻结账对：账内的放行，账外的红，账里有而现在没了的陈旧也红。 */
export function applyBoundaryBaseline({ baseline, findings }) {
  const known = new Set((baseline?.unregistered_boundaries ?? []).map(boundaryKey))
  const live = new Set()
  const out = []
  for (const item of findings) {
    if (item.rule !== 'unregistered-boundary') { out.push(item); continue }
    const key = boundaryKey(item)
    live.add(key)
    if (!known.has(key)) out.push({ ...item, message: `${item.message}（新增：不在冻结的存量债里，必须当场登记）` })
  }
  for (const entry of baseline?.unregistered_boundaries ?? []) {
    if (live.has(boundaryKey(entry))) continue
    out.push(finding('baseline-stale', { path: entry.path, symbol: entry.symbol, message: `unregistered_boundaries 里这一条已经登记或合同已删——从基线删掉（棘轮只减不增）：${boundaryKey(entry)}` }))
  }
  return out
}

/** 观察到的 vs 基线：多出来的红（新的第二写口 / 新写门），基线里有而现在没有的也红（陈旧，要删——只减不增）。 */
export function evaluateBaseline({ baseline, observed, include = () => true }) {
  const findings = []
  const buckets = [
    ['second_write_ports', observed.secondWritePorts, 'second-write-port'],
    ['pending_write_doors', observed.pendingWriteDoors, 'pending-new-write-door'],
  ]
  for (const [bucket, entries, rule] of buckets) {
    const known = new Set((baseline[bucket] ?? []).filter((entry) => include(entry.concept)).map(entryKey))
    const live = new Set()
    for (const entry of entries) {
      if (!include(entry.concept)) continue
      const key = entryKey(entry)
      live.add(key)
      if (known.has(key)) continue
      findings.push(finding(rule, {
        concept: entry.concept,
        path: entry.path,
        symbol: entry.symbol,
        line: entry.line,
        message: rule === 'second-write-port'
          ? `${entry.origin === 'forbidden' ? '列为禁止的旧形状' : '写接口'} ${entry.symbol} 在主人之外又被定义了一份`
          : `pending 概念的旧路 ${entry.symbol} 多了一扇生产写门`,
      }))
    }
    for (const entry of baseline[bucket] ?? []) {
      if (!include(entry.concept) || live.has(entryKey(entry))) continue
      findings.push(finding('baseline-stale', {
        concept: entry.concept,
        path: entry.path,
        symbol: entry.symbol,
        message: `${bucket} 里这一条已经不存在了——删掉它（棘轮只减不增，别让基线替一个不存在的口子背书）`,
      }))
    }
  }
  return findings
}

// ─── 历史棘轮：和参照提交（merge-base）比 ─────────────────────────────────────

function referenceStatus(concept) {
  if (concept?.migration_status) return concept.migration_status
  return concept?.owner?.pending ? 'pending' : 'converged'
}

/** 在参照登记表里找「同一个概念」：同名、同 owner、或同计数键——改名不能让一个概念变成「新登记」。 */
export function matchReferenceConcept(concept, referenceConcepts) {
  return referenceConcepts.find((candidate) => candidate?.name === concept.name
    || (candidate?.owner && concept.owner
      && pairKey(candidate.owner.path, candidate.owner.symbol) === pairKey(concept.owner.path, concept.owner.symbol))
    || (candidate?.subject && ownerKey(candidate) === ownerKey(concept))) ?? null
}

/**
 * 基线只许随**新登记**的概念增加：参照登记表里已经有的概念，基线条目只许变少。
 * pending 冻结门另允许「这次才转成 pending」的概念登记它此刻的写门（冻结的是现状，不是放行新门）。
 * 参照提交上还没有基线文件（门岗首次引入）时不判增长——那一刻基线就是现状本身，没有可比的「之前」。
 * 另外：参照里有、现在没了的概念，如果它的主人还活着——那是把概念从账上删掉来躲判据（concept-dropped）。
 */
export function evaluateHistory({ baseline, referenceBaseline, concepts, referenceConcepts, ownerStillDefined }) {
  const findings = []
  const byName = new Map(concepts.map((concept) => [concept.name, concept]))
  for (const bucket of referenceBaseline ? ['second_write_ports', 'pending_write_doors'] : []) {
    const before = new Set((referenceBaseline?.[bucket] ?? []).map((entry) => `${normalizePath(entry.path)}|${entry.symbol}`))
    for (const entry of baseline[bucket] ?? []) {
      if (before.has(`${normalizePath(entry.path)}|${entry.symbol}`)) continue
      const concept = byName.get(entry.concept)
      if (!concept) continue
      const reference = matchReferenceConcept(concept, referenceConcepts)
      const seeding = !reference || (bucket === 'pending_write_doors' && referenceStatus(reference) !== 'pending')
      if (seeding) continue
      findings.push(finding('baseline-grew', {
        concept: entry.concept,
        path: entry.path,
        symbol: entry.symbol,
        message: `${bucket} 比参照提交多了这一条，而「${entry.concept}」早就登记过——基线只许随新登记的概念增加，已有概念的口子只减不增（R17.0）`,
      }))
    }
  }
  // 未登记边界的冻结账：参照基线已有这个桶时，只许变少（参照还没有 = 首次引入，本身就是现状）
  if (Array.isArray(referenceBaseline?.unregistered_boundaries)) {
    const before = new Set(referenceBaseline.unregistered_boundaries.map(boundaryKey))
    for (const entry of baseline.unregistered_boundaries ?? []) {
      if (before.has(boundaryKey(entry))) continue
      findings.push(finding('baseline-grew', { path: entry.path, symbol: entry.symbol, message: `unregistered_boundaries 比参照提交多了 ${boundaryKey(entry)}——存量债只许变少，新边界要当场登记，别抬基线（R17.0）` }))
    }
  }
  for (const reference of referenceConcepts) {
    if (!reference?.owner) continue
    const stillRegistered = concepts.some((concept) => matchReferenceConcept(concept, [reference]))
    if (stillRegistered) continue
    if (ownerStillDefined(reference.owner.path, reference.owner.symbol)) {
      findings.push(finding('concept-dropped', {
        concept: reference.name,
        path: reference.owner.path,
        symbol: reference.owner.symbol,
        message: `概念「${reference.name}」从登记表里消失了，但它的主人还在——撤销登记要先把主人收掉或并进别的概念`,
      }))
    }
  }
  return findings
}
