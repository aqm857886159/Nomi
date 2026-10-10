#!/usr/bin/env node
// 全功能走查目录（= 功能状态表）的自检门岗。目录是**活的**：它指向的代码、剧本、文案、事件只要有一样漂了，这里就红。
//
// 查什么（tests/ux/full-walk/catalog.mjs 的文件头写了为什么）：
//   1. owner 写成「文件#符号」，文件在、符号真的在那个文件里声明；
//   2. 每条旅程至少一条剧本 / 走查，而且脚本文件在；每个剧本至少挂在一条旅程上（没人引用的剧本不算覆盖）；
//   3. 每个非终态都有 deadline：引用现有登记处（文件#符号，可带 key）/ 等用户（只许用户态）/ 明写的 gap，三选一；
//   4. visibleText 的 i18n key 在中文、英文两份词典里都在；
//   5. metric 要么是 telemetryEvents 里登记过的事件名，要么明写 gap；
//   6. 功能清单里还没长成旅程的条目，要么挂到一条旅程上，要么写明 gap——不许悄悄漏掉；
//   8. ⑫ 的可点目标表：每一行写满 CLICK_TARGET_CONTRACT 的列，userExpectation 是一句人话，actualObservation 不许空着
//      （没跑过写 unverified），owner 指向真实符号，挂的剧本已登记；
//   7. 监视器 / 剧本里写到的每条规则、用户问题表里写的每条规则，都在 rules.mjs 登记了底层设计问题
//      （不登记，跑到那一步 violate 才抛错——那太晚，在这里就红）。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { loadDictionaries, UI_LOCALES } from '../tests/ux/full-walk/invariants.mjs'
import { rootOfRule } from '../tests/ux/full-walk/rules.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const STATE_KINDS = new Set(['user', 'system', 'terminal'])
const LOCALES = UI_LOCALES

// 只剥整行的 // 注释：块注释的正则会被字符串里的 `image/*` 这类内容骗走一大段源码（accept 列表就是这么写的）。
function stripComments(source) {
  return source.replace(/^\s*\/\/.*$/gm, '')
}

/** 符号在文件里真的有声明（函数 / 常量 / 类 / 类型 / 接口 / 枚举，含 export default function）。 */
export function symbolDeclared(source, symbol) {
  const name = String(symbol).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(^|[\\s;{}])(export\\s+)?(default\\s+)?(declare\\s+)?(async\\s+)?(function\\*?|const|let|var|class|type|interface|enum)\\s+${name}\\b`).test(stripComments(source))
}

function readSource(root, relative) {
  const file = path.join(root, relative)
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null
}

function checkRef(ref, root, label, problems) {
  const [file, symbol] = String(ref ?? '').split('#')
  if (!file || !symbol) { problems.push(`${label}：要写成「文件#符号」，收到 ${JSON.stringify(ref)}`); return null }
  const source = readSource(root, file)
  if (source === null) { problems.push(`${label}：文件 ${file} 不存在`); return null }
  if (!symbolDeclared(source, symbol)) problems.push(`${label}：${file} 里没有声明 ${symbol}`)
  return source
}

function lookup(tree, key) {
  return key.split('.').reduce((node, part) => (node && typeof node === 'object' ? node[part] : undefined), tree)
}

/** i18n key 存在：本身、或 i18next 复数形态（_one / _other）之一。 */
export function hasI18nKey(tree, key) {
  return [key, `${key}_one`, `${key}_other`].some((candidate) => typeof lookup(tree, candidate) === 'string')
}

export function loadTelemetryEventNames(root = repoRoot) {
  const source = readSource(root, 'electron/telemetry/telemetryEvents.ts') ?? ''
  const match = /TELEMETRY_EVENT_NAMES\s*=\s*\[([^\]]*)\]/.exec(source)
  return new Set(match ? [...match[1].matchAll(/'([^']+)'/g)].map((item) => item[1]) : [])
}

/**
 * @returns {string[]} 问题清单（空 = 目录成立）
 */
export function checkFullWalkCatalog({ journeys, playbooks, inventory, clickTargets = [], clickContract }, { root = repoRoot, dictionaries = loadDictionaries(), telemetryEvents = loadTelemetryEventNames(root) } = {}) {
  const problems = []

  // ── 剧本 ──
  const playbookIds = new Set()
  const playbookScripts = new Set()
  for (const playbook of playbooks ?? []) {
    const label = `剧本 ${playbook?.id ?? JSON.stringify(playbook)}`
    if (!/^pb\d{2}-[a-z0-9-]+$/.test(playbook?.id ?? '')) problems.push(`${label}：id 要是 pbNN-小写短横线`)
    else if (playbookIds.has(playbook.id)) problems.push(`${label}：id 重复`)
    playbookIds.add(playbook?.id)
    if (playbookScripts.has(playbook?.script)) problems.push(`${label}：script 重复（剧本编号必须唯一）`)
    playbookScripts.add(playbook?.script)
    if (!playbook?.title?.['zh-CN'] || !playbook?.title?.en) problems.push(`${label}：标题要中英两种`)
    if (typeof playbook?.paid !== 'boolean') problems.push(`${label}：paid 必须显式写 true / false`)
    const suffix = playbook?.paid ? '.paid.mjs' : '.walk.mjs'
    if (!String(playbook?.script ?? '').endsWith(suffix)) problems.push(`${label}：${playbook?.paid ? '付费' : '零花费'}剧本的文件名要以 ${suffix} 结尾`)
    if (!fs.existsSync(path.join(root, String(playbook?.script ?? '')))) problems.push(`${label}：脚本 ${playbook?.script} 不存在`)
    const variants = Array.isArray(playbook?.variants) ? playbook.variants : []
    if (!variants.length) problems.push(`${label}：至少一个变体`)
    for (const variant of variants) {
      if (!/^[a-z0-9-]+$/.test(variant?.id ?? '')) problems.push(`${label}：变体 id 要小写短横线`)
      if (!LOCALES.includes(variant?.locale)) problems.push(`${label}：变体 ${variant?.id} 的语言只能是 ${LOCALES.join(' / ')}`)
    }
  }

  // ── 旅程 ──
  const journeyIds = new Set()
  const referencedScripts = new Set()
  for (const journey of journeys ?? []) {
    const label = `旅程 ${journey?.id ?? JSON.stringify(journey)}`
    if (!/^J\d{2}-[a-z0-9-]+$/.test(journey?.id ?? '')) problems.push(`${label}：id 要是 JNN-小写短横线`)
    else if (journeyIds.has(journey.id)) problems.push(`${label}：id 重复`)
    journeyIds.add(journey?.id)
    if (!journey?.title?.['zh-CN'] || !journey?.title?.en) problems.push(`${label}：标题要中英两种`)
    const scripts = Array.isArray(journey?.scripts) ? journey.scripts : []
    if (!scripts.length) problems.push(`${label}：至少挂一条剧本 / 走查`)
    for (const script of scripts) {
      referencedScripts.add(script)
      if (!fs.existsSync(path.join(root, script))) problems.push(`${label}：剧本 ${script} 不存在`)
    }
    const invariants = Array.isArray(journey?.invariants) ? journey.invariants : []
    if (!invariants.length || invariants.some((id) => !Number.isInteger(id) || id < 1 || id > 9)) problems.push(`${label}：invariants 要是 1–9 的铁律编号`)
    const metric = journey?.metric
    if (!metric || (typeof metric.gap !== 'string' && !(metric.success && metric.failure))) problems.push(`${label}：metric 要么写成功 / 失败事件，要么写 gap`)
    if (metric && typeof metric.gap !== 'string') {
      for (const event of [metric.success, metric.failure]) {
        const name = String(event ?? '').split('{')[0]
        if (!telemetryEvents.has(name)) problems.push(`${label}：metric 事件 ${name} 不在 electron/telemetry/telemetryEvents.ts 的 TELEMETRY_EVENT_NAMES 里`)
      }
      if (metric.owner && !fs.existsSync(path.join(root, metric.owner))) problems.push(`${label}：metric owner ${metric.owner} 不存在`)
    }
    if (typeof metric?.gap === 'string' && metric.gap.trim().length < 6) problems.push(`${label}：metric gap 要写清缺什么`)
    const states = Array.isArray(journey?.states) ? journey.states : []
    if (!states.length) problems.push(`${label}：至少一个状态`)
    const stateIds = new Set()
    for (const state of states) {
      const stateLabel = `${label} · 状态 ${state?.id}`
      if (!/^[a-z0-9-]+$/.test(state?.id ?? '')) problems.push(`${stateLabel}：id 要小写短横线`)
      else if (stateIds.has(state.id)) problems.push(`${stateLabel}：同一条旅程里 id 重复`)
      stateIds.add(state?.id)
      if (!STATE_KINDS.has(state?.kind)) problems.push(`${stateLabel}：kind 只能是 user / system / terminal`)
      if (!Array.isArray(state?.actions)) problems.push(`${stateLabel}：actions 要是数组（没有可做的动作就写空数组）`)
      for (const key of Array.isArray(state?.visibleText) ? state.visibleText : ['(visibleText 不是数组)']) {
        for (const locale of LOCALES) {
          if (!hasI18nKey(dictionaries[locale], key)) problems.push(`${stateLabel}：visibleText ${key} 在 ${locale} 词典里不存在`)
        }
      }
      checkRef(state?.owner, root, `${stateLabel} · owner`, problems)
      if (state?.kind === 'terminal') continue
      const deadline = state?.deadline
      if (!deadline) { problems.push(`${stateLabel}：非终态必须写 deadline（登记处引用 / 等用户 / gap 三选一）`); continue }
      if (deadline.waitsFor === 'user') {
        if (state.kind !== 'user') problems.push(`${stateLabel}：只有用户态能写「等用户」，${state.kind} 态要引用登记处或写 gap`)
      } else if (typeof deadline.gap === 'string') {
        if (deadline.gap.trim().length < 6) problems.push(`${stateLabel}：deadline gap 要写清为什么没有时限`)
      } else if (deadline.ref) {
        const source = checkRef(deadline.ref, root, `${stateLabel} · deadline`, problems)
        if (source && deadline.key && !new RegExp(`(['"]?)${String(deadline.key).replace(/[.*+?^${}()|[\]\\-]/g, '\\$&')}\\1\\s*:`).test(source)) {
          problems.push(`${stateLabel}：deadline ${deadline.ref} 里没有「${deadline.key}」这一格`)
        }
      } else {
        problems.push(`${stateLabel}：deadline 形状不认识 ${JSON.stringify(deadline)}`)
      }
    }
  }
  for (const playbook of playbooks ?? []) {
    if (playbook?.script && !referencedScripts.has(playbook.script)) problems.push(`剧本 ${playbook.id}：没有挂在任何一条旅程上（没人引用的剧本不算覆盖）`)
  }

  // ── ⑫ 可点目标 ──
  const clickIds = new Set()
  for (const row of clickTargets) {
    const label = `可点目标 ${row?.id ?? JSON.stringify(row)}`
    if (!/^[a-z0-9-]+$/.test(row?.id ?? '') || clickIds.has(row?.id)) problems.push(`${label}：id 要小写短横线且不重复`)
    clickIds.add(row?.id)
    for (const field of clickContract?.fields ?? []) {
      if (row?.[field] === undefined) problems.push(`${label}：缺 ${field} 列（CLICK_TARGET_CONTRACT）`)
    }
    if (String(row?.userExpectation ?? '').trim().length < 6) problems.push(`${label}：userExpectation 要写一句用户点之前以为会发生什么`)
    if (!String(row?.actualObservation ?? '').trim()) problems.push(`${label}：actualObservation 不许空着（没跑过写 unverified）`)
    if (!(row?.ironLaws ?? []).includes('⑫')) problems.push(`${label}：ironLaws 要含 ⑫`)
    checkRef(row?.owner, root, `${label} · owner`, problems)
    if (!playbookIds.has(row?.playbook)) problems.push(`${label}：剧本 ${row?.playbook} 没在 FULL_WALK_PLAYBOOKS 登记`)
  }

  // ── 功能清单里还没长成旅程的条目 ──
  const inventoryIds = new Set()
  for (const item of inventory ?? []) {
    const label = `清单条目 ${item?.id ?? JSON.stringify(item)}`
    if (inventoryIds.has(item?.id)) problems.push(`${label}：id 重复`)
    inventoryIds.add(item?.id)
    if (!item?.title) problems.push(`${label}：要有标题`)
    const links = ['journey', 'gap'].filter((field) => item?.[field] !== undefined)
    if (links.length !== 1) problems.push(`${label}：要么挂一条旅程（journey），要么写 gap，二选一`)
    if (item?.journey !== undefined && !journeyIds.has(item.journey)) problems.push(`${label}：挂的旅程 ${item.journey} 不存在`)
    if (item?.gap !== undefined && String(item.gap).trim().length < 2) problems.push(`${label}：gap 要写清缺什么`)
  }
  return problems
}

/**
 * 规则都登记了归类：`issues` 是用户问题表（每条的 rules），`sources` 是走查源码 `{ file, text }`（扫字面量 `rule: '…'`）。
 * 拼出来的规则名（`sent-${…}`、`surface-${…}`）扫不到，由 violate 在运行时兜底抛错。
 * @returns {string[]}
 */
export function checkRuleRegistry({ issues = [], sources = [] }) {
  const problems = []
  for (const issue of issues) {
    for (const rule of issue?.rules ?? []) {
      if (!rootOfRule(rule)) problems.push(`用户问题 ${issue.id}：规则 ${rule} 没在 rules.mjs 登记底层设计问题`)
    }
  }
  for (const { file, text } of sources) {
    for (const match of String(text).matchAll(/\brule:\s*'([^']+)'/g)) {
      if (!rootOfRule(match[1])) problems.push(`${file}：规则 ${match[1]} 没在 rules.mjs 登记底层设计问题`)
    }
  }
  return problems
}

function fullWalkSources(root = repoRoot) {
  const dir = path.join(root, 'tests', 'ux', 'full-walk')
  const files = []
  const walk = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name)
      if (entry.isDirectory()) { if (entry.name !== 'reports') walk(full) } else if (entry.name.endsWith('.mjs')) files.push(full)
    }
  }
  walk(dir)
  return files.map((file) => ({ file: path.relative(root, file).split(path.sep).join('/'), text: fs.readFileSync(file, 'utf8') }))
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const catalog = await import(pathToFileURL(path.join(repoRoot, 'tests/ux/full-walk/catalog.mjs')).href)
  const { USER_REPORTED_ISSUES } = await import(pathToFileURL(path.join(repoRoot, 'tests/ux/full-walk/userReports.mjs')).href)
  const problems = [
    ...checkFullWalkCatalog({ journeys: catalog.FULL_WALK_JOURNEYS, playbooks: catalog.FULL_WALK_PLAYBOOKS, inventory: catalog.FULL_WALK_INVENTORY, clickTargets: catalog.CLICK_TARGETS, clickContract: catalog.CLICK_TARGET_CONTRACT }),
    ...checkRuleRegistry({ issues: USER_REPORTED_ISSUES, sources: fullWalkSources() }),
  ]
  if (problems.length) {
    console.error(`✖ 全功能走查目录不成立（${problems.length} 处）：\n  ${problems.join('\n  ')}`)
    process.exit(1)
  }
  const states = catalog.FULL_WALK_JOURNEYS.reduce((sum, journey) => sum + journey.states.length, 0)
  const gaps = catalog.FULL_WALK_JOURNEYS.flatMap((journey) => journey.states.filter((state) => state.deadline?.gap)).length
  console.log(`✓ 全功能走查目录：${catalog.FULL_WALK_JOURNEYS.length} 条旅程 · ${states} 个状态（${gaps} 个非终态没有登记时限，已明写 gap）· ${catalog.FULL_WALK_PLAYBOOKS.length} 条剧本 · 清单 ${catalog.FULL_WALK_INVENTORY.length} 条 · ⑫ 可点目标 ${catalog.CLICK_TARGETS.length} 个`)
}
