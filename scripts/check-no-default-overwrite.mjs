#!/usr/bin/env node
/**
 * 「读不出来就别写默认值回去」门岗（批次 E，2026-09-21）。
 *
 * 为什么要它：09-21 用户报的事故——重装旧版后「所有模型配置都没了」。真正会抹掉文件的那条路
 * 是这么写的（`electron/catalog/catalogStore.ts` 旧 :69-74）：
 *
 *     const parsed = readJson(catalogPath(), null);
 *     if (!parsed) { const initial = defaultCatalog(); writeCatalog(initial); return initial; }
 *
 * `readJson` 把文件缺失、JSON 解析失败、Windows 上被杀软/索引器锁住的 EPERM 全吞成同一个 null。
 * 于是**一次读失败 = 把空目录原子写回、永久抹掉用户全部模型配置**，而且一声不吭。
 * 同一个形状在 `userPromptStore`（回落 `[]`，下一次写就抹平用户全部提示词）等十几处复制过。
 * 根因是「这份配置读不出来时该怎么办」没有主人（rootcause-config-loss-on-reinstall.md §3）。
 *
 * 判据**刻意很窄**——一条拦得住、没人想关掉的规则，比一条报两百行然后被塞进豁免名单的规则有用
 * （与 check:read-path-writes 同一条纪律）。只认两种**语法上就能看出来**的写法：
 *
 *   ① catch 块（含 promise 的 `.catch(...)` 回调）里直接调写盘门；
 *   ② `if (!x)` / `if (x == null)` 这类对「读回来的那个变量」的真假判断里直接调写盘门。
 *
 * 两种都对应同一句话：**我没读懂盘上那份，所以我要把我的默认值写上去。**
 * 合法的写默认只有一种——「文件确实不存在」，它在语法上长得不一样
 * （`if (outcome.status === "missing")`：对一个**显式区分过**缺失与失败的结果做等值比较）。
 *
 * 机制：棘轮。存量违规按身份（文件::函数::写盘门）冻结在 scripts/no-default-overwrite-baseline.json，
 * 新增当场红；baseline 里已经消失的也红，逼着同 commit 删掉那一行——否则就成了永久豁免。
 *
 * 用法：
 *   node ./scripts/check-no-default-overwrite.mjs
 *   node ./scripts/check-no-default-overwrite.mjs --update-baseline   （只在真降/初始化时用）
 */
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const BASELINE = path.join(repoRoot, 'scripts', 'no-default-overwrite-baseline.json')
const rel = (file) => path.relative(repoRoot, file).split(path.sep).join('/')

/**
 * 写盘门 —— 只认**把 JSON 配置落盘**的那几个名字。
 *
 * 刻意不收 `writeFileSync` / `appendFileSync`：日志、诊断包、临时文件都走它，收进来这条门岗
 * 会在 catch 块里报出一大片「写错误日志」，然后被无视。日志不是用户状态。
 * 也不收 `copyFileSync` / `renameSync`：留底与隔离恰恰是这次要**鼓励**的动作。
 */
const WRITE_DOORS = new Set([
  'writeJsonFileAtomic',
  'writeConfigFileAtomic',
  'writeCatalog',
  'atomicWrite',
  'writeConnectorPrefs',
])

/**
 * 「读回来的那个变量」的判据：初始化它的那个调用，名字以 `read` 开头。
 *
 * 刻意用前缀而不是一张固定的名字表：第一版写的是 `new Set(['readJson', …])`，反向验红时把 import
 * 改名成 `readJsonOld` 就整条溜过去了——一张名字表只拦得住照着抄的人，拦不住改个名的人。
 * 名字是契约：叫 `readX` 就是在说「我去把它读回来」，那么「读回来是空的所以我写默认值」这件事，
 * 无论那个 read 叫什么，都是同一个病。
 */
const isReadPrimitive = (name) => /^read[A-Z_]/.test(name)

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

function calleeName(node) {
  if (!ts.isCallExpression(node)) return null
  if (ts.isIdentifier(node.expression)) return node.expression.text
  if (ts.isPropertyAccessExpression(node.expression)) return node.expression.name.text
  return null
}

/** 这个子树里直接出现的写盘门（不跨函数——跨了就不是「语法上看得出来」了）。 */
function writeDoorsIn(node) {
  const hit = new Set()
  const visit = (current) => {
    const name = calleeName(current)
    if (name && WRITE_DOORS.has(name)) hit.add(name)
    ts.forEachChild(current, visit)
  }
  visit(node)
  return [...hit]
}

/** `if (!x)` / `if (x == null)` / `if (!x || …)` 里被测真假的那些标识符。 */
function falsinessSubjects(expression) {
  const names = []
  const visit = (node) => {
    if (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.ExclamationToken && ts.isIdentifier(node.operand)) {
      names.push(node.operand.text)
    }
    if (ts.isBinaryExpression(node)) {
      const nullish = node.operatorToken.kind === ts.SyntaxKind.EqualsEqualsToken
        || node.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken
      const isNullLiteral = (side) => side.kind === ts.SyntaxKind.NullKeyword
        || (ts.isIdentifier(side) && side.text === 'undefined')
      if (nullish && ts.isIdentifier(node.left) && isNullLiteral(node.right)) names.push(node.left.text)
      if (nullish && ts.isIdentifier(node.right) && isNullLiteral(node.left)) names.push(node.right.text)
    }
    ts.forEachChild(node, visit)
  }
  visit(expression)
  return names
}

const found = []

for (const root of ['src', 'electron', 'workers']) {
  const dir = path.join(repoRoot, root)
  if (!fs.existsSync(dir)) continue
  for (const file of walk(dir)) {
    const name = rel(file)
    const source = fs.readFileSync(file, 'utf8')
    const sf = ts.createSourceFile(name, source, ts.ScriptTarget.Latest, true,
      file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)

    /** 本文件里由读原语赋值出来的变量名。 */
    const readResults = new Set()
    const collectReads = (node) => {
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
        const callee = calleeName(node.initializer)
        if (callee && isReadPrimitive(callee)) readResults.add(node.name.text)
      }
      ts.forEachChild(node, collectReads)
    }
    collectReads(sf)

    const report = (node, shape, door) => {
      const line = sf.getLineAndCharacterOfPosition(node.getStart()).line + 1
      found.push({ site: `${name}:${line}`, shape, door })
    }

    const visit = (node) => {
      // ① catch 块里写盘。
      if (ts.isCatchClause(node)) {
        for (const door of writeDoorsIn(node.block)) report(node, 'catch', door)
      }
      // ①' promise 的 .catch(回调) 里写盘。
      if (calleeName(node) === 'catch' && ts.isCallExpression(node) && node.arguments.length === 1) {
        for (const door of writeDoorsIn(node.arguments[0])) report(node, 'promise-catch', door)
      }
      // ② `if (!读回来的东西) { 写默认值 }`。
      if (ts.isIfStatement(node)) {
        const subjects = falsinessSubjects(node.expression)
        if (subjects.some((subject) => readResults.has(subject))) {
          for (const door of writeDoorsIn(node.thenStatement)) report(node, 'falsy-read-result', door)
        }
      }
      ts.forEachChild(node, visit)
    }
    visit(sf)
  }
}

found.sort((left, right) => `${left.site}${left.door}`.localeCompare(`${right.site}${right.door}`))
const identity = (entry) => `${entry.site} ${entry.shape} → ${entry.door}`

if (process.argv.includes('--update-baseline')) {
  fs.writeFileSync(BASELINE, `${JSON.stringify({
    registered: found.map((entry) => ({ site: identity(entry), reason: '' })),
  }, null, 2)}\n`)
  console.log(`check:no-default-overwrite 基线已重算（${found.length} 处）——每条都要补上 reason 才会通过`)
  process.exit(0)
}

/**
 * 登记**必须带理由**，而且理由要能被读到。
 * 「登记是带条件的承诺，不是防线」（R17）——一张只有路径的豁免名单三个月后没人说得清它为什么在那儿。
 */
const baseline = fs.existsSync(BASELINE) ? JSON.parse(fs.readFileSync(BASELINE, 'utf8')) : { registered: [] }
const registered = new Map(baseline.registered.map((entry) => [entry.site, entry]))
const failures = []

for (const entry of found) {
  const row = registered.get(identity(entry))
  if (row && !String(row.reason || '').trim()) {
    failures.push(`${identity(entry)}：登记了但没写理由——写清它凭什么不是「读失败写默认」。`)
    continue
  }
  if (!row) {
    failures.push(`${identity(entry)}：读不出来就把默认值写回盘 = 永久抹掉用户配置。`
      + `改法：区分「文件不存在」（唯一允许写默认的场景）与「存在但读不了」（原样保留、改名留底、本次只读），`
      + `见 electron/configFileStore.ts。`)
  }
}
for (const site of registered.keys()) {
  if (!found.some((entry) => identity(entry) === site)) {
    failures.push(`${site}：登记在案但已经不在了——收敛掉就把这一行从 baseline 删掉（棘轮只减不增，不留永久豁免）。`)
  }
}

if (failures.length) {
  console.error('check:no-default-overwrite 失败：\n')
  for (const failure of failures) console.error(`  ✗ ${failure}`)
  console.error('\n为什么有这条门岗：scratchpad rootcause-config-loss-on-reinstall.md §3 / §6(a)'
    + '\n方案：docs/plan/2026-09-21-config-never-silently-lost.md')
  process.exit(1)
}
console.log(`scanned=${found.length}`)
console.log(`check:no-default-overwrite 通过（读失败写默认 ${found.length} 处，全部已登记）`)
