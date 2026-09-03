#!/usr/bin/env node
// 装配面平价门岗：一个接口把能力做成**可选成员**时，每个生产装配点都必须接上它——
// 否则漏接是「类型合法」的，tsc 不响、lint 不响，只有那个漏接的装配点自己拥有的运行时路径静默降级。
//
// 这道门为什么存在（2026-09-03 打包态事故 · 用户手上的版本真的坏了）：
//   `McpTransport.confirmGenerationInNomi?` 是可选的。mcpStdioServer（开发态）传了，
//   mcpNodeLauncher（打包态，ELECTRON_RUN_AS_NODE=1 裸 Node）没传。于是
//   mcpGateConfirmation.ts 的 `typeof transport.confirmGenerationInNomi === 'function'` 恒假，
//   nomi_operation_gate 恒返回 human_approval_required：外部 AI 说「需要人工批准」，
//   但根本没有人被问到。开发态 43/43 全绿，打包态 15/43——**本机永远不报**。
//
// 同族前科：2026-08-18 同样是 mcpNodeLauncher 的打包态路径分叉（electron 值导入进了裸 Node 闭包，
//   MODULE_NOT_FOUND），也是本机全绿、打包才炸。这类「两条装配路径手工各自组装同一组能力」
//   会一直复发，直到有机器每次都比对两边。
//
// 判据是**结构性的、不看名字**：对着接口枚举可选成员 → 逐个检查每个生产装配点有没有传。
// 新增可选成员自动纳入覆盖，不需要有人记得回来加一条。
//
// 欠账名单（UNWIRED）不是后门：登记项必须写明为什么没接，而且**双向断言**——
//   · 不在名单里的漏接 → 报红；
//   · 在名单里却其实已经接上的 → 也报红（防止名单腐烂成永久豁免）。

import fs from 'node:fs'
import path from 'node:path'

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..')

/**
 * 受检的接口 → 它的生产装配点。
 * 新增一族（别的接口也用可选成员分发能力）时在这里加一条即可。
 */
const SURFACES = [
  {
    label: 'McpTransport',
    interfaceFile: 'electron/capabilityCore/mcpProtocol.ts',
    interfaceName: 'McpTransport',
    factory: 'createMcpProtocol',
    assemblySites: [
      'electron/capabilityCore/mcpNodeLauncher.ts',
      'electron/capabilityCore/mcpStdioServer.ts',
    ],
    // member → 为什么这个生产装配点没接（必须是真理由，不是「以后再说」）
    unwired: {
      // 「客户端自带确认凭证」的强校验模式：两个生产装配点都没接，标准 MCP 客户端（Claude Code /
      // Cursor / Codex）也不产出凭证，所以这条路在今天的生产里没有对手方。
      //
      // 它**不是**死代码，行为是明确且可达的：客户端若真附了凭证而这里没有验证器，
      // mcpGateConfirmation.ts 不把它降级成「光秃秃的同意」，而是落 Nomi 兜底卡重问——
      // 收到一份自己看不懂的凭证，比压根没收到更该谨慎。这条由
      // mcpGenerationConfirmation.test.ts「客户端给了凭证但生产装配没有验证器」用例守着。
      //
      // 2026-09-03 更正：此前这里写「落空 = fail-closed 无风险」，低估了它。当时两个签发点还无条件带
      // handoff.clientAttestation:true，配上没接的验证器，把**整个「弹在调用方」的主确认面**堵死了——
      // 每次花钱确认都被赶回 Nomi 应用，Nomi 没开就直接拒绝。那面旗已随用户拍板删除；本成员保留为
      // 真正的升级钩子，接上它才谈得上强校验模式。
      verifyClientGenerationConfirmation:
        '强校验模式的升级钩子：两个生产装配点都没接，标准 MCP 客户端也不产出凭证。未接时行为明确——收到无法验证的凭证不降级、落 Nomi 兜底卡（有用例守）。要开强校验就接上它。',
    },
  },
]

function read(relative) {
  const absolute = path.join(repoRoot, relative)
  if (!fs.existsSync(absolute)) {
    console.error(`✗ 装配面平价：受检文件不存在：${relative}`)
    process.exit(1)
  }
  return fs.readFileSync(absolute, 'utf8')
}

/** 抽接口的可选成员名（`name?:` 或 `name?(`）。锚点失效即报红，不静默返回空集。 */
function optionalMembers(surface) {
  const source = read(surface.interfaceFile)
  const anchor = `export interface ${surface.interfaceName} {`
  const start = source.indexOf(anchor)
  if (start < 0) {
    console.error(`✗ 装配面平价：${surface.interfaceFile} 里找不到 \`${anchor}\`——本门岗的锚点失效了`)
    process.exit(1)
  }
  const body = source.slice(start, source.indexOf('\n}', start))
  const members = [...body.matchAll(/^ {2}([A-Za-z][A-Za-z0-9_]*)\?\s*[:(]/gm)].map((match) => match[1])
  if (members.length === 0) {
    console.error(`✗ 装配面平价：${surface.interfaceName} 上一个可选成员都没抽到——正则或接口形状变了，门岗已失效`)
    process.exit(1)
  }
  return members
}

/** 抽某个装配点传给工厂的顶层键名。括号配对取实参对象，再按第一层缩进匹配键。 */
function passedKeys(surface, siteFile) {
  const source = read(siteFile)
  const open = source.indexOf(`${surface.factory}({`)
  if (open < 0) {
    console.error(`✗ 装配面平价：${siteFile} 里找不到 \`${surface.factory}({\` 调用——本门岗的锚点失效了`)
    process.exit(1)
  }
  let depth = 0
  let end = -1
  for (let i = source.indexOf('{', open); i < source.length; i += 1) {
    if (source[i] === '{') depth += 1
    else if (source[i] === '}') {
      depth -= 1
      if (depth === 0) { end = i; break }
    }
  }
  if (end < 0) {
    console.error(`✗ 装配面平价：${siteFile} 的 ${surface.factory} 实参括号没配平`)
    process.exit(1)
  }
  const objectText = source.slice(source.indexOf('{', open), end)
  const firstKey = objectText.match(/\n([ \t]+)[A-Za-z][A-Za-z0-9_]*\s*[:(]/)
  if (!firstKey) return []
  const indent = firstKey[1]
  return [...objectText.matchAll(new RegExp(`\\n${indent}([A-Za-z][A-Za-z0-9_]*)\\s*[:(]`, 'g'))].map((m) => m[1])
}

const missing = []
const staleExemptions = []
let checkedMembers = 0

for (const surface of SURFACES) {
  const members = optionalMembers(surface)
  const keysBySite = new Map(surface.assemblySites.map((site) => [site, passedKeys(surface, site)]))
  for (const member of members) {
    checkedMembers += 1
    const absentAt = surface.assemblySites.filter((site) => !keysBySite.get(site).includes(member))
    const exempt = Object.prototype.hasOwnProperty.call(surface.unwired, member)
    if (absentAt.length > 0 && !exempt) {
      missing.push({ surface: surface.label, member, absentAt })
    }
    if (absentAt.length === 0 && exempt) {
      staleExemptions.push({ surface: surface.label, member })
    }
  }
}

console.log(
  `装配面平价：${SURFACES.length} 个接口 / ${checkedMembers} 个可选成员 / ` +
  `${SURFACES.reduce((sum, s) => sum + s.assemblySites.length, 0)} 个生产装配点`,
)

if (missing.length) {
  console.error(`✗ 装配面平价失败：${missing.length} 个可选成员在生产装配点漏接`)
  for (const entry of missing) {
    console.error(`  ${entry.surface}.${entry.member} 未传于：${entry.absentAt.join('、')}`)
  }
  console.error('  → 漏接是类型合法的，tsc 不会响；漏接的那个装配点在运行时静默降级。')
  console.error('  → 修法：在该装配点传入该成员。确实不接，就加进 SURFACES[].unwired 并写明为什么。')
  process.exit(1)
}

if (staleExemptions.length) {
  console.error(`✗ 装配面平价失败：${staleExemptions.length} 条欠账登记已过期（成员其实已接上）`)
  for (const entry of staleExemptions) {
    console.error(`  ${entry.surface}.${entry.member} 已在所有装配点接上`)
  }
  console.error('  → 从 SURFACES[].unwired 删掉它，别让名单腐烂成永久豁免。')
  process.exit(1)
}

const owed = SURFACES.flatMap((s) => Object.keys(s.unwired).map((m) => `${s.label}.${m}`))
if (owed.length) console.log(`↳ 已登记欠账 ${owed.length} 条（待裁决，非豁免）：${owed.join('、')}`)
console.log('✓ 装配面平价通过：每个可选成员要么全接、要么有登记理由')
