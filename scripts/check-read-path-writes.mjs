#!/usr/bin/env node
/**
 * 「读路径不许可达写盘门」门岗（C3，2026-09-18）。
 *
 * 为什么要它（审计 `docs/audit/2026-09-17-ownership-lifetime-census.md` §3 / §6 C3）：
 * 19 处项目外写盘里有 2 处是**读路径顺手写的**——`resolveTikhubHost` /
 * `failoverTikhubHost` 在选路时把结果钉进用户的盘上偏好。用户把线路设成「自动」，
 * 某一刻主域恰好探不通，我们就悄悄替他改了偏好，而且主域恢复也不会变回来。
 *
 * 这个形状 09-14 已经有过一条教训（`docs/lessons/mcp-read-path-must-not-write-host-configs.md`，
 * 当时修在 `readMcpInfo`），但**教训没变成门岗**，于是同一个病在 connector 路由里又长了一份。
 * 这条门岗就是把那条教训变成机器判据——R17：能让门岗拦的别留给人。
 *
 * 判据：从每个**写盘门**沿静态调用图往上走，任何名字以 `read` / `resolve` / `list` /
 * `get` 开头的函数只要可达它，就是读路径写盘。
 * 名字是契约：叫 `resolveX` 就是在承诺「我只是算出答案」，写盘是另一件事，要另起一个名字
 * （`setX` / `commitX`），让调用方看得见自己在改盘。
 *
 * 用法：node scripts/check-read-path-writes.mjs
 *       node scripts/check-read-path-writes.mjs --root=<目录> --baseline=<文件>   （反例测试用：对一份夹具树跑同一套判据）
 */
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const argValue = (name) => process.argv.slice(2).find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3)
const repoRoot = path.resolve(argValue('root') ?? path.join(path.dirname(fileURLToPath(import.meta.url)), '..'))
const BASELINE = path.resolve(argValue('baseline') ?? path.join(repoRoot, 'scripts', 'read-path-writes-baseline.json'))
const rel = (file) => path.relative(repoRoot, file).split(path.sep).join('/')

/**
 * 写盘门 —— **刻意只有这几个**（审计 §3 的分类）：
 *   · `atomicWrite`：宿主配置（`~/.claude.json` 这类**别人的**文件）的唯一门；
 *   · `writeConnectorPrefs`：connector 偏好（用户在高级设置里调的那些）的唯一门；
 *   · 「项目在哪」的登记写（2026-10-29 收敛单，docs/plan/2026-10-29-project-location-owner.md）：
 *     `removeWorkspaceReference`（摘登记 = 项目从库里消失）、`bindWorkspaceLocation` / `bindWorkspaceLocations`（写登记）、
 *     `backfillWorkspaceOrigins`（冻结来源）。06-14 起 `listProjects` 凭「文件夹不在」推断「用户删了」就摘登记，
 *     升级清掉安装目录后整库项目没了——当时这里只认三个门，那条摘登记在门岗上是绿的；
 *   · `ensureDir`：读路径建目录（同一收敛单）。`legacyProjectDirById` / 设置「检查」「打开」先把默认根建出来，
 *     列表随后把整库灰卡当成「用户删了」。建目录只许发生在用户选位置、新建项目这类显式动作里；
 *   · `deleteWorkspaceProject`：删项目目录的销毁门（2026-10-22 V-plibrary N1）。空白草稿回收曾挂在
 *     `listProjects` 上，列举是异步的，期间排队等锁的保存被它删掉。删项目只许由用户的删除动作触发，
 *     任何 list / read / resolve / get 能走到它即红——这是**门岗自动拦**，不是结构上做不出来：
 *     它按门函数名连边、只认这四个读前缀，读路径里直接写 fs.rmSync、或从别的前缀（bootstrap / refresh / sync…）
 *     的函数走到删除，都不在这张图上（V-plibrary2 变异 C 实测），那一层靠测试兜。
 *
 * 明确**不**在范围内、并且不该被这条规则拦的三类，写在这里免得下一个人把它们加进来：
 *   · 日志（`logger.write` → `writeFileSync`）：几乎所有函数都可达它，它不是「用户状态」；
 *   · 清单迁移（`readWorkspaceManifest` 读时补写旧格式）：那是**拍板过**的惰性迁移，
 *     判据在它自己的事务层，不是「偷改偏好」；
 *   · 项目内容落盘：本来就该由用户动作触发，归根因合同的 `doors` 门表管（check:root-cause-contracts）。
 *
 * 这条门岗管的是一件很窄但很具体的事：**名字说「我只算答案」的函数，不许改用户的设置**。
 * 范围窄不是妥协——一条拦得住、没人想关掉的规则，比一条报 200 行然后被加进豁免名单的规则有用。
 */
const READ_PATH_WRITE_DOORS = new Set([
  'atomicWrite', 'writeConnectorPrefs', 'deleteWorkspaceProject',
  'removeWorkspaceReference', 'bindWorkspaceLocation', 'bindWorkspaceLocations', 'backfillWorkspaceOrigins', 'ensureDir',
])
/**
 * 名字承诺「我不改东西」的前缀。`check` / `reveal` / `locate` 是「项目在哪」收敛单加的：设置「检查目录」「打开位置」、
 * 「项目在哪」的读函数都只许看，不许建、不许摘。
 */
const READ_PREFIX = /^(read|resolve|list|get|check|reveal|locate)[A-Z]/

function walk(root, out = []) {
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const file = path.join(root, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist') continue
      walk(file, out)
    } else if (/\.(ts|tsx|mts|cts)$/.test(entry.name) && !/\.test\./.test(entry.name)) out.push(file)
  }
  return out
}

/** 每个函数直接调用了哪些名字。跨文件按**名字**连边——静态、保守，宁可多报不漏报。 */
const callsOf = new Map()
for (const root of ['src', 'electron']) {
  for (const file of walk(path.join(repoRoot, root))) {
    const name = rel(file)
    const sf = ts.createSourceFile(name, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true,
      file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
    const visit = (node, owner) => {
      let nextOwner = owner
      const declared = (ts.isFunctionDeclaration(node) && node.name?.text)
        || (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer
          && (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer)) ? node.name.text : null)
      if (declared) nextOwner = { site: `${name}::${declared}`, fn: declared }
      if (ts.isCallExpression(node) && nextOwner) {
        const callee = ts.isIdentifier(node.expression) ? node.expression.text
          : ts.isPropertyAccessExpression(node.expression) ? node.expression.name.text : null
        if (callee) {
          if (!callsOf.has(nextOwner.site)) callsOf.set(nextOwner.site, { fn: nextOwner.fn, callees: new Set() })
          callsOf.get(nextOwner.site).callees.add(callee)
        }
      }
      ts.forEachChild(node, (child) => visit(child, nextOwner))
    }
    visit(sf, null)
  }
}

/**
 * 名字 → 声明它的那些 site。
 *
 * **只沿「全仓只有一处声明」的名字连边**：`read` / `add` / `push` / `commit` 这类名字在这个
 * 仓库里有几十处同名声明，按名字连过去会把两条毫不相干的调用链接成一条，得出
 * 「readPath 能走到写盘门」这种由 30 段拼接而成的假路径。宁可少连几条真边，
 * 也不能报一条编出来的。连不上的地方由这条注释负责说清，不假装图是完整的。
 */
const sitesByName = new Map()
for (const [site, entry] of callsOf) {
  if (!sitesByName.has(entry.fn)) sitesByName.set(entry.fn, [])
  sitesByName.get(entry.fn).push(site)
}

function targetsFor(callee, fromSite) {
  const all = sitesByName.get(callee) ?? []
  // 同文件内的声明是确定的，优先。
  const file = fromSite.slice(0, fromSite.indexOf('::'))
  const local = all.filter((site) => site.startsWith(`${file}::`))
  if (local.length === 1) return local
  return all.length === 1 ? all : []
}

/** 这个 site 能不能走到某个写盘门；返回那条路径。 */
/** 这个 site 能不能走到 doors 里的某个门；返回那条路径。 */
function reachesWriteDoor(site, doors, seen = new Set()) {
  if (seen.has(site)) return null
  seen.add(site)
  const entry = callsOf.get(site)
  if (!entry) return null
  for (const callee of entry.callees) {
    if (doors.has(callee)) return [site, callee]
  }
  for (const callee of entry.callees) {
    for (const next of targetsFor(callee, site)) {
      const deeper = reachesWriteDoor(next, doors, seen)
      if (deeper) return [site, ...deeper]
    }
  }
  return null
}

/**
 * 按「site × 门」逐对记：登记是对一对说的，不是对一个 site 说的。登记过「listProjects 经启动发现写登记」不等于
 * 也允许它摘登记——往一个已登记的 site 里加一扇新门照样红（收敛单反例测试）。
 */
const found = []
for (const [site, entry] of callsOf) {
  if (!READ_PREFIX.test(entry.fn)) continue
  for (const door of READ_PATH_WRITE_DOORS) {
    const chain = reachesWriteDoor(site, new Set([door]))
    if (chain) found.push({ site, door, chain: chain.join(' → ') })
  }
}
found.sort((left, right) => left.site.localeCompare(right.site) || left.door.localeCompare(right.door))

const pairKey = (entry) => `${entry.site} ⇢ ${entry.door}`
const baseline = fs.existsSync(BASELINE) ? JSON.parse(fs.readFileSync(BASELINE, 'utf8')) : { registered: [] }
const registered = new Map(baseline.registered.map((entry) => [pairKey(entry), entry]))
const failures = []
for (const entry of baseline.registered) {
  if (typeof entry.why !== 'string' || entry.why.trim().length < 8) failures.push(`${pairKey(entry)}: 登记要写明它凭什么是读路径的一部分（why）`)
}
for (const entry of found) {
  if (!registered.has(pairKey(entry))) {
    failures.push(`${entry.site}: 名字承诺「只是算出答案」，实际能走到写盘门 ${entry.door}（${entry.chain}）。`
      + `把写的那一半挪进用户显式动作（setX / commitX），或登记并写明它凭什么是读路径的一部分。`)
  }
}
const foundKeys = new Set(found.map(pairKey))
for (const key of registered.keys()) {
  if (!foundKeys.has(key)) {
    failures.push(`${key}: 登记在案但已经不可达这扇写盘门（收敛掉了就把这条删掉——棘轮只减不增）`)
  }
}

if (failures.length) {
  console.error('check:read-path-writes 失败：\n')
  for (const failure of failures) console.error(`  ✗ ${failure}`)
  console.error('\n为什么有这条门岗：docs/audit/2026-09-17-ownership-lifetime-census.md §3 / §6 C3'
    + '\n同形状教训：docs/lessons/mcp-read-path-must-not-write-host-configs.md')
  process.exit(1)
}
console.log(`check:read-path-writes 通过（读路径可达写盘门 ${found.length} 处，全部已登记并说明）`)
