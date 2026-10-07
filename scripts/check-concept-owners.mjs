#!/usr/bin/env node
// 概念 owner 门岗（R33 / R17 / R21.3，2026-09-29）：一个概念只能有一个主人。
//
// 为什么要它：R33 的登记表（docs/engineering/concept-owners/，一个概念一个文件，读只走 loadConceptRegistry）从 09-22 起就在，但只有人在读——
// 「同一个概念出现第二个写口即违规」是登记表存在的唯一判据，却没有任何机器在执行它。
// 并行 lane 各自长出第二份实现，要等合并那一刻靠人逐行对账才发现（09-22 四个实例全是这么漏的）。
//
// 判据（全在 scripts/concept-owners-lib.mjs）：
//   · 登记表：v2 字段齐、枚举对、计数键 (subject, lifecycle, authority_kind, trust_domain) 不重、主人今天还在；
//   · 第二写口：写接口 / 旧形状的**定义**只许在主人那里（调用不算，别名不算，重导出不算）；
//   · pending：不许新增生产写入口（写门冻结进基线），读者只许是 allowed_consumers 那本例外账；
//   · 身份比对：每个「长得像身份比对」的函数都要登记、维度要对得上（原 check:identity-compare，2026-09-29 并入）；
//   · 合同：09-27 起的根因合同，声明的每个共享边界都必须是某个登记概念的写接口（没登记的新概念 = 红）；
//   · 棘轮：基线存身份不存裸数字、只减不增；和参照提交比，已有概念的口子只许变少。
//
// 用法：
//   node scripts/check-concept-owners.mjs                      # 门岗（gates:contracts 跑的就是它）
//   node scripts/check-concept-owners.mjs --map                # 另外打印「受管合同 → 碰到的概念」
//   node scripts/check-concept-owners.mjs --source-ref <提交> --concept <名字或 subject> ...
//        # 复验：拿现在这本账去判当年那份代码（先验会红，R17）。诊断模式不判合同与历史棘轮。
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  CONCEPT_OWNERS_SINCE,
  definitionSymbols,
  doorWatch,
  applyBoundaryBaseline,
  evaluateBaseline,
  evaluateContracts,
  evaluateDoorPolicy,
  evaluateHistory,
  evaluateIdentity,
  evaluateOwnership,
  governedContracts,
  isIdentifierSymbol,
  sanitizeConcepts,
  validateBaseline,
  validateBoundaryBaseline,
  validateRegistry,
} from './concept-owners-lib.mjs'
import {
  collectDefinitions,
  collectDoors,
  findIdentityComparators,
  gitRefSource,
  isScannableSource,
  normalizePath,
  underRoots,
  workingTreeSource,
} from './concept-owners-scan.mjs'
import { CONCEPT_OWNERS_DIR, loadConceptRegistry } from './concept-registry-lib.mjs'

export const BASELINE_PATH = 'scripts/concept-owners-baseline.json'
const CONTRACTS_DIR = 'docs/fixes'

const RULE_TEXT = {
  'registry-invalid': ['登记表结构不对', '按 docs/engineering-rules.md R33.4 的字段表补齐；结构坏了不能当放行。'],
  'trust-domain-mismatch': ['trust_domain 与主人所在路径对不上', 'trust_domain 由 owner 路径派生（electron/shared→shared，electron→main，src→renderer，tests/evals→test，scripts→tooling），改成派生值。'],
  'duplicate-owner': ['同一件事登记了两个主人', '合并成一个概念；确实是两种生命周期 / 权力 / 信任域，就让计数键 (subject, lifecycle, authority_kind, trust_domain) 说出差别。'],
  'owner-unresolved': ['登记的主人不在了', '主人搬家或改名 → 改登记；主人被并掉了 → 登记新主人。别让登记替一个不存在的主人背书。'],
  'consumer-missing': ['例外账里的路径不存在', '删掉这条，或改成现在的路径。'],
  'second-write-port': ['第二个写口：主人之外又定义了一份', '改成 import 主人那一份，删掉这份定义（P1 加新必删旧）；如果它其实是另一件事，就给它登记一个独立概念，写清 subject 与计数键。'],
  'pending-new-write-door': ['pending 概念的旧路新增了生产写入口', '主人定下来之前，旧路上不许再长写口：改走暂定主人的接口，或者先把这个概念收口（看它的 migration_strategy）。'],
  'pending-unlisted-consumer': ['pending 概念多了一个例外账之外的入口', 'pending 概念的消费者只许是 allowed_consumers 那本例外账：改走已有消费者；确需新增，由协调会话批准后写进 allowed_consumers。'],
  'forbidden-reference': ['碰了列为禁止引用的旧形状', '改走主人；确需引用，写进这个概念的 allowed_consumers 并说明理由。'],
  'identity-comparator': ['登记表之外又长出一份身份比对（原 check:identity-compare）', '改成 import 主人那一份比对函数；确实是另一种身份，就登记一个身份概念并写明 identity_fields。'],
  'identity-drift': ['身份维度漂了', '维度变了就是身份变了：改回去，或者更新登记的 identity_fields 并说明为什么。'],
  'unregistered-boundary': ['合同里冒出了没登记的主人', 'R33.4：改动碰到还没登记的概念，同一个 commit 当场登记——把这个边界写进一个概念的 write_api（新概念就新建一条）。'],
  'baseline-invalid': ['基线结构不对', '修正 scripts/concept-owners-baseline.json；结构坏了不能当放行。'],
  'baseline-stale': ['基线里有已经不存在的口子', '删掉那一条：棘轮只减不增，基线必须等于现状。'],
  'baseline-grew': ['基线比参照提交长了', '已登记概念的第二写口 / 冻结写门只许变少。修代码，别抬基线挤过门岗（R17.0 第 4 条）。'],
  'concept-dropped': ['概念从登记表里消失了，但主人还在', '撤销登记前先把主人收掉或并进别的概念；改名不算撤销（按名字、主人、计数键都能认出来）。'],
  'reference-unavailable': ['拿不到参照提交，证明不了棘轮没有回升', '设 CONCEPT_OWNERS_BASE_REF（或 ROOT_CAUSE_BASE_REF）指向 merge-base；拿不到参照就不放行（fail-closed）。'],
  'filter-unknown': ['--concept 点名的概念不存在', '用登记表里的 name 或 subject。'],
}

function readOption(argv, name) {
  const values = []
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] !== name) continue
    const value = argv[index + 1]
    if (!value || value.startsWith('--')) throw new Error(`${name} 后面要跟一个值`)
    values.push(value)
    index += 1
  }
  return values
}

export function parseArgs(argv) {
  const known = new Set(['--repo-root', '--source-ref', '--concept', '--map'])
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (!arg.startsWith('--')) continue
    if (!known.has(arg)) throw new Error(`不认识的选项：${arg}`)
    if (arg !== '--map') index += 1
  }
  const repoRoot = readOption(argv, '--repo-root').at(-1)
  const sourceRef = readOption(argv, '--source-ref').at(-1) ?? null
  return {
    repoRoot: repoRoot ? path.resolve(repoRoot) : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'),
    sourceRef,
    conceptFilter: readOption(argv, '--concept'),
    printMap: argv.includes('--map'),
  }
}

function readJsonFile(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}

function git(repoRoot, args) {
  return spawnSync('git', args, { cwd: repoRoot, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
}

/** 参照提交：显式 env 优先（CI 给的是 PR base），否则 merge-base(HEAD, origin/main)。拿不到就报错，不当通过。 */
export function loadReference(repoRoot, environment) {
  const explicit = [environment.CONCEPT_OWNERS_BASE_REF, environment.ROOT_CAUSE_BASE_REF]
    .map((value) => value?.trim())
    .find((value) => value && !/^0+$/.test(value))
  let ref
  if (explicit) {
    const verified = git(repoRoot, ['rev-parse', '--verify', `${explicit}^{commit}`])
    if (verified.status !== 0) return { error: `参照提交不可用：${explicit}` }
    ref = verified.stdout.trim()
  } else {
    const mergeBase = git(repoRoot, ['merge-base', 'HEAD', 'origin/main'])
    if (mergeBase.status !== 0 || !mergeBase.stdout.trim()) {
      return { error: '算不出 merge-base(HEAD, origin/main)；设 CONCEPT_OWNERS_BASE_REF 指定参照提交' }
    }
    ref = mergeBase.stdout.trim()
  }
  const show = (file) => {
    const result = git(repoRoot, ['show', `${ref}:${file}`])
    if (result.status !== 0) return { missing: true }
    try {
      return { value: JSON.parse(result.stdout) }
    } catch (error) {
      return { invalid: error instanceof Error ? error.message : String(error) }
    }
  }
  const baseline = show(BASELINE_PATH)
  if (baseline.invalid) return { error: `参照提交上的基线不是合法 JSON：${baseline.invalid}` }
  let registry
  try {
    registry = loadConceptRegistry(repoRoot, { ref })
  } catch (error) {
    return { error: `参照提交上的登记表读不了：${error instanceof Error ? error.message : String(error)}` }
  }
  return {
    ref,
    baseline: baseline.missing ? null : baseline.value,
    concepts: sanitizeConcepts(registry?.concepts),
  }
}

function listContracts(source, repoRoot, sourceRef) {
  let files
  if (sourceRef) {
    files = source.listAll().filter((file) => file.startsWith(`${CONTRACTS_DIR}/`))
  } else {
    const dir = path.join(repoRoot, CONTRACTS_DIR)
    files = fs.existsSync(dir) ? fs.readdirSync(dir).map((name) => `${CONTRACTS_DIR}/${name}`) : []
  }
  const contracts = []
  const errors = []
  for (const file of files.filter((name) => name.endsWith('.root-cause.json')).sort()) {
    try {
      contracts.push({ file, contract: JSON.parse(source.read(file) ?? 'null') })
    } catch (error) {
      errors.push(`无法解析根因合同 ${file}：${error instanceof Error ? error.message : String(error)}`)
    }
  }
  return { contracts, errors }
}

function render(findings, log) {
  const byRule = new Map()
  for (const item of findings) {
    const list = byRule.get(item.rule) ?? []
    list.push(item)
    byRule.set(item.rule, list)
  }
  for (const [rule, items] of byRule) {
    const [title, hint] = RULE_TEXT[rule] ?? [rule, '']
    log(`\n  ✖ ${title}（${rule}，${items.length} 处）`)
    for (const item of items) {
      const where = item.path ? `${item.path}${item.line ? `:${item.line}` : ''}${item.symbol ? ` · ${item.symbol}` : ''}` : ''
      const who = item.concept ? `「${item.concept}」` : ''
      log(`    - ${[who, where].filter(Boolean).join(' ')}${who || where ? '：' : ''}${item.message}`)
    }
    if (hint) log(`    → ${hint}`)
  }
}

export function run({ repoRoot, sourceRef = null, conceptFilter = [], printMap = false, environment = process.env, log = console.log, error = console.error }) {
  const findings = []
  let registry
  let baseline
  let source
  try {
    registry = loadConceptRegistry(repoRoot)
    if (!registry) throw new Error(`概念登记目录不存在：${CONCEPT_OWNERS_DIR}/`)
    const baselineFile = path.join(repoRoot, BASELINE_PATH)
    baseline = fs.existsSync(baselineFile) ? readJsonFile(baselineFile) : null
    source = sourceRef ? gitRefSource(repoRoot, sourceRef) : workingTreeSource(repoRoot)
  } catch (failure) {
    // 读不到 / 解析不了 = 红，不是跳过：一个拿不到证据的门岗只能报它真拿到的那个结论。
    error(`✖ 概念 owner 门岗无法开始：${failure instanceof Error ? failure.message : String(failure)}`)
    return 1
  }
  const concepts = sanitizeConcepts(registry?.concepts)
  const diagnostic = conceptFilter.length > 0
  const selected = diagnostic
    ? concepts.filter((concept) => conceptFilter.includes(concept.name) || conceptFilter.includes(concept.subject))
    : concepts
  for (const term of conceptFilter) {
    if (!concepts.some((concept) => concept.name === term || concept.subject === term)) {
      findings.push({ rule: 'filter-unknown', message: `没有叫「${term}」的概念` })
    }
  }
  const selectedNames = new Set(selected.map((concept) => concept.name))
  const include = (name) => !diagnostic || selectedNames.has(name)

  // ① 登记表本身
  for (const item of validateRegistry(registry, { exists: source.exists })) {
    if (!item.concept || include(item.concept)) findings.push(item)
  }

  // ② 参照提交（历史棘轮 / 概念消失）：诊断模式与 --source-ref 不判——它们判的是「那份代码」，不是这次改动。
  const reference = diagnostic || sourceRef ? null : loadReference(repoRoot, environment)
  if (reference?.error) findings.push({ rule: 'reference-unavailable', message: reference.error })

  // ③ 定义：写接口与旧形状的全部定义处（含参照登记表里主人的符号，用来判「概念消失但主人还在」）
  const files = source.listFiles()
  if (source.preload) source.preload(files.filter(isScannableSource))
  const symbols = definitionSymbols(concepts)
  for (const concept of reference?.concepts ?? []) {
    if (concept?.owner && isIdentifierSymbol(concept.owner.symbol)) symbols.add(concept.owner.symbol)
  }
  const definitions = collectDefinitions({ files, read: source.read, symbols: [...symbols] })

  const ownership = evaluateOwnership({ concepts, definitions, exists: source.exists, read: source.read })
  for (const item of ownership.findings) if (include(item.concept)) findings.push(item)

  // ④ 门：pending 概念的写门冻结、例外账；reference 禁令
  const pendingWriteDoors = []
  for (const concept of selected) {
    const watch = doorWatch(concept)
    if (watch.symbols.length === 0) continue
    const doors = collectDoors({ files: files.filter((file) => underRoots(file, watch.roots)), read: source.read, symbols: watch.symbols })
    const result = evaluateDoorPolicy({ concept, doors })
    findings.push(...result.findings)
    pendingWriteDoors.push(...result.writeDoors)
  }

  // ⑤ 身份比对（原 check:identity-compare）
  const comparators = findIdentityComparators({ files, read: source.read })
  for (const item of evaluateIdentity({ concepts, comparators })) {
    if (item.concept ? include(item.concept) : !diagnostic) findings.push(item)
  }

  // ⑥ 合同：受管合同的共享边界必须进账
  let mapping = []
  let governedCount = 0
  const unregisteredBoundaries = []
  if (!diagnostic) {
    const { contracts, errors } = listContracts(source, repoRoot, sourceRef)
    for (const message of errors) findings.push({ rule: 'registry-invalid', message })
    governedCount = governedContracts(contracts).length
    const result = evaluateContracts({ concepts, contracts })
    unregisteredBoundaries.push(...result.findings.filter((item) => item.rule === 'unregistered-boundary'))
    findings.push(...result.findings.filter((item) => item.rule !== 'unregistered-boundary'))
    mapping = result.mapping
  }

  // ⑦ 基线：存身份，只减不增
  const conceptsByName = new Map(concepts.map((concept) => [concept.name, concept]))
  const effectiveBaseline = baseline ?? { version: 1, second_write_ports: [], pending_write_doors: [] }
  if (!baseline) findings.push({ rule: 'baseline-invalid', message: `缺少 ${BASELINE_PATH}` })
  const baselineFindings = validateBaseline(effectiveBaseline, { conceptsByName })
  findings.push(...baselineFindings)
  const boundaryFindings = baseline ? validateBoundaryBaseline(effectiveBaseline) : []
  findings.push(...boundaryFindings)
  if (!diagnostic && boundaryFindings.length === 0) {
    findings.push(...applyBoundaryBaseline({ baseline: effectiveBaseline, findings: unregisteredBoundaries }))
  }
  if (baselineFindings.length === 0) {
    findings.push(...evaluateBaseline({
      baseline: effectiveBaseline,
      observed: { secondWritePorts: ownership.secondWritePorts, pendingWriteDoors },
      include,
    }))
  }
  if (reference && !reference.error) {
    const ownerStillDefined = (file, symbol) => {
      const rel = normalizePath(file)
      if (isIdentifierSymbol(symbol) && isScannableSource(rel)) {
        return (definitions.get(symbol) ?? []).some((definition) => definition.path === rel)
      }
      return source.exists(rel) && String(source.read(rel) ?? '').includes(symbol)
    }
    findings.push(...evaluateHistory({
      baseline: effectiveBaseline,
      referenceBaseline: reference.baseline,
      concepts,
      referenceConcepts: reference.concepts,
      ownerStillDefined,
    }))
  }

  // ⑧ 报告
  if (sourceRef) log(`源码取自${source.label}；登记表与基线用工作树里的——复验「现在这本账拦不拦得住那份代码」。`)
  if (diagnostic) log(`诊断模式：只判 ${selected.map((concept) => `「${concept.name}」`).join('、') || '（无）'} 的代码侧判据，合同与历史棘轮不判。`)
  if (printMap) {
    log(`\n受管合同（文件名日期 ≥ ${CONCEPT_OWNERS_SINCE}）→ 门表与共享边界碰到的概念：`)
    for (const row of mapping) log(`  ${row.contract} → ${row.concepts.length ? row.concepts.join('、') : '（没有碰到登记概念）'}`)
  }
  if (findings.length > 0) {
    error(`✖ 概念 owner 门岗失败（${findings.length} 处）——一个概念只能有一个主人（R33）：`)
    render(findings, error)
    error('\n  判据与字段表：docs/engineering-rules.md R33.4；方案：docs/plan/2026-09-26-architecture-single-owner-governance.md「横切治理层 §1」。')
    return 1
  }
  const pendingCount = selected.filter((concept) => concept.migration_status === 'pending').length
  const apiCount = selected.reduce((sum, concept) => sum + (concept.write_api?.length ?? 0), 0)
  const parityCount = selected.filter((concept) => concept.parity_test).length
  const historyNote = diagnostic || sourceRef
    ? ''
    : reference.baseline
      ? `；棘轮参照 ${reference.ref.slice(0, 9)}`
      : `；参照提交 ${reference.ref.slice(0, 9)} 上还没有基线（首次引入），本次只核当前快照`
  log(`✅ 概念 owner 门岗：${selected.length} 个概念（converged ${selected.length - pendingCount} / pending ${pendingCount}）`
    + ` · 写接口 ${apiCount} 个 · 第二写口 0 新增（基线在册 ${effectiveBaseline.second_write_ports.length}）`
    + ` · pending 冻结写门 ${pendingWriteDoors.length}`
    + (diagnostic ? '' : ` · 身份比对 ${comparators.length} 处全部登记 · 受管合同 ${governedCount} 份，未登记的共享边界 ${effectiveBaseline.unregistered_boundaries?.length ?? 0} 处冻结在基线（只减不增）`)
    + ` · parity_test ${parityCount}/${selected.length}${historyNote}`)
  return 0
}

function main() {
  let options
  try {
    options = parseArgs(process.argv.slice(2))
  } catch (error) {
    console.error(`✖ ${error instanceof Error ? error.message : String(error)}`)
    process.exit(2)
  }
  process.exitCode = run(options)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
