#!/usr/bin/env node
// 测试等待门岗（2026-08-25）。抓的是一整类**并行跑才炸**的测试写法：私有墙钟等待。
//
// 起因：electron/productionRun 十个测试文件各自复制了一份 waitFor(check, 500ms~5s 硬闹钟)，
// 拿「调过参的墙钟猜测」赛跑「真实文件锁 + fsync 编排链」。单跑几十 ms 绿得发亮；
// vitest 并行满载时 fsync 被放大百倍 → 链路合法地超过闹钟 → 间歇翻红（干净 main 上 5 跑 4 挂）。
// 写的人当场看不出毛病（本机单跑永远绿），靠自觉记不住，只能机器每次拦——P2 通用性判定的又一落地件。
//
// 规矩：测试里等后台编排链，一律 import productionRunTestHelpers 的 waitForProduction
// （60s 安全网、超时抛带标签错误）；不许再手写 waitFor / Date.now() 截止时间轮询。
// 2026-08-25 清零后本门岗硬零：任何新增当场报红，无棘轮基线。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

export function collectTestFiles(root = repoRoot) {
  const files = []
  const walk = (dir) => {
    if (!fs.existsSync(dir)) return
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === 'dist-electron') continue
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (/\.(?:[cm]?[jt]sx?)$/.test(entry.name) && (full.startsWith(path.join(root, 'tests') + path.sep) || /\.(?:test|spec|node-test|walk|e2e)\./.test(entry.name) || /sweep/.test(entry.name))) files.push(full)
    }
  }
  for (const dir of ['src', 'electron', 'evals', 'scripts', 'tests']) walk(path.join(root, dir))
  return files
}

function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, ' ')).replace(/^[ \t]*\/\/.*$/gm, '')
}

// 从「墙钟差」赋值出来的变量名，例如 `const elapsed = Date.now() - t0`。收集它们，是为了抓住
// `expect(elapsed).toBeLessThan(2000)` 这种把时间藏进变量的写法——只看 expect 那一行会正好漏掉它。
const CLOCK_DELTA_ASSIGNMENT = /\b(\w+)\s*=\s*(?:Date|performance)\.now\(\)\s*-/g
const BUDGET_MATCHER = /\.toBeLessThan(?:OrEqual)?\s*\(/

function collectClockDeltaNames(source) {
  const names = new Set()
  for (const match of source.matchAll(CLOCK_DELTA_ASSIGNMENT)) names.add(match[1])
  return names
}

// Parse callbacks so newlines, comments and quoted examples cannot bypass or falsely trigger the gate.
export function asyncWaitForFunctionLines(source, file = 'test.ts') {
  const parsed = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true)
  const lines = new Set()
  const visit = (node) => {
    if (ts.isCallExpression(node)) {
      const callee = node.expression
      const name = ts.isPropertyAccessExpression(callee) ? callee.name.text
        : ts.isElementAccessExpression(callee) && ts.isStringLiteral(callee.argumentExpression) ? callee.argumentExpression.text : null
      let predicate = node.arguments[0]
      while (predicate && ts.isParenthesizedExpression(predicate)) predicate = predicate.expression
      if (name === 'waitForFunction' && predicate &&
          (ts.isArrowFunction(predicate) || ts.isFunctionExpression(predicate)) &&
          predicate.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.AsyncKeyword)) {
        lines.add(parsed.getLineAndCharacterOfPosition(node.getStart(parsed)).line)
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(parsed)
  return lines
}

// Node after hooks are independent, registration-ordered callbacks. Directory deletion
// belongs to createLaneFixture's resource owner, never to a separate test hook: even
// awaiting one lane.close() there does not close sibling lanes, probes or crash children.
export function unownedLaneCleanupLines(source, file) {
  const lines = new Set()
  if (!file.replaceAll('\\', '/').startsWith('tests/agent-runtime/')) return lines
  const parsed = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true)
  const definitions = new Map()
  const removers = new Set(['rm', 'rmSync'])
  const hooks = new Set(['after', 'afterEach'])
  const contexts = new Set(['t'])
  const nameOf = (node) => {
    if (ts.isIdentifier(node)) return node.text
    if (ts.isPropertyAccessExpression(node)) return node.name.text
    if (ts.isElementAccessExpression(node) && ts.isStringLiteral(node.argumentExpression)) return node.argumentExpression.text
    return null
  }
  const collect = (node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) definitions.set(node.name.text, node.initializer)
    if (ts.isFunctionDeclaration(node) && node.name) definitions.set(node.name.text, node)
    if (ts.isParameter(node) && ts.isIdentifier(node.name) && node.type?.getText(parsed) === 'TestContext') contexts.add(node.name.text)
    if (ts.isCallExpression(node) && ['test', 'it'].includes(nameOf(node.expression))) {
      const callback = node.arguments.find((argument) => ts.isArrowFunction(argument) || ts.isFunctionExpression(argument))
      const context = callback?.parameters[0]?.name
      if (context && ts.isIdentifier(context)) contexts.add(context.text)
    }
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const module = node.moduleSpecifier.text
      const bindings = node.importClause?.namedBindings
      if (bindings && ts.isNamedImports(bindings)) {
        for (const item of bindings.elements) {
          const original = (item.propertyName ?? item.name).text
          if (/^(?:node:)?fs(?:\/promises)?$/.test(module) && ['rm', 'rmSync'].includes(original)) removers.add(item.name.text)
          if (module === 'node:test' && ['after', 'afterEach'].includes(original)) hooks.add(item.name.text)
        }
      }
    }
    ts.forEachChild(node, collect)
  }
  collect(parsed)
  const unwrap = (node, seen = new Set()) => {
    if (ts.isParenthesizedExpression(node)) return unwrap(node.expression, seen)
    if (ts.isIdentifier(node) && definitions.has(node.text) && !seen.has(node.text)) {
      seen.add(node.text)
      return unwrap(definitions.get(node.text), seen)
    }
    return node
  }
  const isLaneDirectory = (node, seen = new Set()) => {
    if (!node) return false
    if (/^(?:project|lane)Dir$/.test(nameOf(node) ?? '')) return true
    if (ts.isParenthesizedExpression(node)) return isLaneDirectory(node.expression, seen)
    if (ts.isIdentifier(node) && definitions.has(node.text) && !seen.has(node.text)) {
      seen.add(node.text)
      return isLaneDirectory(definitions.get(node.text), seen)
    }
    return false
  }
  const inspectCleanup = (node) => {
    if (ts.isCallExpression(node) && removers.has(nameOf(node.expression)) && isLaneDirectory(node.arguments[0])) {
      lines.add(parsed.getLineAndCharacterOfPosition(node.getStart(parsed)).line)
    }
    ts.forEachChild(node, inspectCleanup)
  }
  const visit = (node) => {
    if (ts.isCallExpression(node)) {
      const callee = node.expression
      const name = nameOf(callee)
      const isHook = ts.isIdentifier(callee) ? hooks.has(name)
        : name === 'afterEach' || (name === 'after' && contexts.has(nameOf(callee.expression)))
      if (isHook && node.arguments[0]) inspectCleanup(unwrap(node.arguments[0]))
    }
    ts.forEachChild(node, visit)
  }
  visit(parsed)
  return lines
}

// Test module declarations must resolve from a clean checkout, before any app build.
export function builtArtifactImportLines(source, file) {
  const lines = new Set()
  if (!file.replaceAll('\\', '/').startsWith('tests/')) return lines
  const parsed = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true)
  const visit = (node) => {
    let specifier
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) specifier = node.moduleSpecifier
    if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && ['require', 'tsImport', 'tsxRequire'].includes(node.expression.text)))) specifier = node.arguments[0]
    if (specifier && (ts.isStringLiteral(specifier) || ts.isNoSubstitutionTemplateLiteral(specifier)) &&
        /^(?:\.\.?[/\\]|[/\\]|file:)/.test(specifier.text) &&
        /(?:^|[/\\])dist(?:-electron)?[/\\]/.test(specifier.text)) {
      lines.add(parsed.getLineAndCharacterOfPosition(node.getStart(parsed)).line)
    }
    ts.forEachChild(node, visit)
  }
  visit(parsed)
  return lines
}

const RULES = [
  {
    id: 'built-artifact-test-import',
    label: '测试模块必须从源码加载，禁止 import dist/ 或 dist-electron/',
    test: (_line, context) => context.builtArtifactImportLines.has(context.lineIndex),
  },
  {
    id: 'unowned-lane-directory-cleanup',
    label: 'lane 目录清理必须由共享 fixture owner 等待全部资源 close 后执行，禁止独立 after/afterEach 删除',
    test: (_line, context) => context.unownedLaneCleanupLines.has(context.lineIndex),
  },
  {
    id: 'async-waitforfunction-predicate',
    label: 'waitForFunction 的 async 判据会把 Promise 当 truthy，形成空等待；改用 expect.poll + evaluate',
    test: (_line, context) => context.asyncWaitLines.has(context.lineIndex),
  },
  {
    id: 'private-waitfor',
    label: '测试文件里定义私有 waitFor——共享 waitForProduction 之外的第二套等待',
    test: (line) => /\bfunction waitFor\s*\(/.test(line) || /\bconst waitFor\s*=/.test(line),
  },
  {
    id: 'wallclock-deadline-poll',
    label: '测试文件里手写 Date.now() 截止时间轮询——拿墙钟猜测赛跑真实 I/O，并行必翻红',
    test: (line) => /\bDate\.now\(\)/.test(line) && /\bdeadline\b/i.test(line),
  },
  {
    // 2026-09-03 加。上一条只在同一行里还写着 deadline 时才认，于是漏掉了**跨进程起跑线**这种
    // 写法：projectLeaseStore.test.ts 里父进程取 `Date.now() + 1_000` 当起跑线发给 4 个 worker，
    // worker 侧 `while (Date.now() < startAt) { Atomics.wait(...) }` 自旋等到那一刻再一起冲。
    // 变量名叫 startAt 不叫 deadline，旧规则看不见。机器一忙 node 子进程根本来不及在 1 秒内启动，
    // 于是 ① 它们不再真正同时起跑——**这条用例要测的竞态被悄悄削弱了，而测试照常绿**；
    // ② 总耗时顶穿 20s 测试超时，红得像是代码坏了。正解是真握手（各自 ready → 父进程集齐后放行）。
    // 这条规则只认「自旋等到某个墙钟时刻」这一种形状，不碰 `new Date(Date.now() + N)` 这类
    // 把未来时间点当**测试数据**的合法用法（全仓实扫：那类 3 处，全是构造过期时间戳）。
    id: 'wallclock-rendezvous-spin',
    label: '测试文件里自旋等到某个墙钟时刻（while (Date.now() < X)）——拿「猜一个起跑时刻」当跨进程/跨线程汇合点，机器一忙就既削弱竞态又超时',
    test: (line) => /\bwhile\s*\(.*(?:Date|performance)\.now\(\)\s*[<>]/.test(line),
  },
  {
    // 2026-09-03 加。上一条抓的是「用墙钟等」，这条抓的是「用墙钟判分」——同一个病的另一面：
    // 预算在空闲机器上校准、在满载套件里执行，于是它按机器负载报红，而不是按代码报红。
    // 实证（同一天连炸三次，全部发生在与被测代码零相关的分支上）：
    //   · projectAgentHost「1,000-command bounded」——没有显式耗时断言，却用 1,000 次真实落盘
    //     往返把自己顶到 29,668ms / 30,000ms testTimeout，负载一高就红（隐式预算同样算数）；
    //   · projectAgentReducerPerformance「cubic growth path」——`performance.now() - t0 < 8_000`
    //     实测 8145ms 红，只超 1.8%，而这个预算此前已经从 2s 放宽过一次。再放宽只是往后埋雷。
    // 正确做法是换判据、不是放宽阈值：把要证的语义换成与机器速度无关的**计数器 / 工作量不变量**
    // （scan 次数、全量校验次数、两个等长窗口的 fs 调用数逐项相等…）。真要守常数因子性能，
    // 拆去 performance 风险面单独跑，别混在共享的并行单测套件里兼职——兼职的代价就是假红。
    id: 'wallclock-budget-assertion',
    label: '测试文件里拿墙钟耗时当判据（expect(耗时).toBeLessThan(预算)）——预算在空闲机校准、在满载机执行，必间歇假红',
    test: (line, context) => {
      if (!BUDGET_MATCHER.test(line) || !/\bexpect\s*\(/.test(line)) return false
      if (/(?:Date|performance)\.now\(\)/.test(line)) return true
      const expected = line.match(/\bexpect\s*\(\s*([A-Za-z_$][\w$]*)\s*\)/)
      return Boolean(expected && context.clockDeltaNames.has(expected[1]))
    },
  },
  {
    // 2026-09-03 加。上面三条抓的是「墙钟当判据」，这条抓的是**探针根本测不到它命名的那件事**
    // ——同一族假绿的另一种成因，而且更隐蔽：它不是偶尔红，是永远绿。
    //
    // 形状：spy 住 fs 的读接口，再拿 `mock.calls` 按**路径**过滤。可生产读文件的惯用写法是
    // 「按路径 open、按 fd 读」（`projectAgentCommandLedger.ts` 的 readRegular() 就是），
    // 于是 `readFileSync` 的第一个参数永远是数字 fd、永远不等于路径串，过滤器恒空、断言恒真。
    //
    // 实证：`projectAgentHost.test.ts` 那条「不许稳态重扫账本」的招牌断言就是这么写的。
    // 强制让它每条命令都全量重扫（关掉 validate() 的缓存）后，它数出的仍然是 0 条、照样绿——
    // 它为这个恒真的零付了 1000 次真实落盘往返的代价，然后在四个分支上超时，被判成「负载 flake」。
    // 同一天在 `projectAgentRepository.test.ts` 扫出第二份一模一样的写法（#410 只修了第一份）。
    //
    // 正解：改用**生产侧计数器**（`__projectAgentCommandLedgerScanCountForTests` /
    // `__projectAgentFullValidationCountForTests` 那一套），不经过 fs 间接层，不会悄悄失效；
    // 并配一条阳性对照用例钉住「这个计数器真的会涨」。
    id: 'fs-read-spy-path-filter',
    label: '按路径过滤 fs 读 spy 的 mock.calls——生产按 fd 读，过滤器恒空、断言恒真（造的是假绿，不是假红）',
    test: (line, context) =>
      context.spiesOnFsRead && /\.mock\.calls\b/.test(line) && /\.filter\(/.test(line) && /===/.test(line),
  },
]

// 生产读文件常见「按路径 open、按 fd 读」，所以按路径过滤读 spy 的调用记录必然落空。
const FS_READ_SPY = /spyOn\(\s*fs\s*,\s*['"](readFileSync|readFile|readSync|read)['"]/

// `wallclock-budget-assertion` 的棘轮基线（只减不增）。
//
// 为什么这条规则要基线，而上面两条是硬零：耗时断言其实有**两个语义完全不同的用法**，语法上分不开。
//   ① 「这段计算应该跑得够快」——预算量的是机器调度出来的工作量。这就是本次修的那一族假红：
//      在空闲机器上校准、在满载套件里执行，按负载报红。**这类一律不许有**，换计数器/工作量不变量。
//   ② 「被测代码自己有一个硬超时，它必须真的触发」——预算量的是**生产代码里的定时器**，
//      不是机器速度；负载只贡献调度零头。下面三处全是第二类（10s 快速失败预算、40ms 判分硬界），
//      它们测的正是「不许挂死」，删掉等于把该覆盖丢了。
// 所以：存量按文件登记数量、只减不增；任何**新增**一处都会当场红，逼写的人先说清自己是哪一类。
const WALLCLOCK_BUDGET_BASELINE = new Map([
  // 断言 launcher 的 FAST_FAIL_BUDGET_MS 生产超时真的生效（抢注者活着时绝不挂死等待）。
  ['electron/capabilityCore/mcpNodeLauncher.test.ts', 1],
  // 断言 verifyAndMaybeRetry 的判分总时长硬界真的生效（判分端点挂死时绝不拖到 300s 客户端超时）。
  ['electron/capabilityCore/shotVerifyOrchestrate.test.ts', 2],
])

// Station waits share the existing R18 gate. AST parsing excludes prose and comments.
export function stationWaitHits(source, file) {
  if (!/^(?:tests\/ux\/|scripts\/.*sweep|evals\/.*(?:walk|sweep))/.test(file)) return []
  if (/\.(?:node-test|test|spec)\./.test(file)) return []
  const parsed = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true)
  const definitions = new Map(), hits = []
  const collect = node => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) definitions.set(node.name.text, node.initializer)
    ts.forEachChild(node, collect)
  }
  collect(parsed)
  const number = (node, seen = new Set()) => {
    if (!node) return NaN
    if (ts.isNumericLiteral(node)) return Number(node.text)
    if (ts.isParenthesizedExpression(node)) return number(node.expression, seen)
    if (ts.isIdentifier(node) && definitions.has(node.text) && !seen.has(node.text)) {
      return number(definitions.get(node.text), new Set([...seen, node.text]))
    }
    if (ts.isBinaryExpression(node)) {
      const a = number(node.left, seen), b = number(node.right, seen)
      switch (node.operatorToken.kind) {
        case ts.SyntaxKind.AsteriskToken: return a * b
        case ts.SyntaxKind.PlusToken: return a + b
        case ts.SyntaxKind.SlashToken: return a / b
        case ts.SyntaxKind.MinusToken: return a - b
      }
    }
    return NaN
  }
  const nameOf = node => ts.isIdentifier(node) || ts.isStringLiteral(node) ? node.text
    : ts.isPropertyAccessExpression(node) ? node.name.text
    : ts.isElementAccessExpression(node) && ts.isStringLiteral(node.argumentExpression) ? node.argumentExpression.text : ''
  const visit = node => {
    if (ts.isCallExpression(node)) {
      const name = nameOf(node.expression)
      const waits = /^(?:waitFor|toBe|toHave|toContain|poll$|click$|dblclick$|fill$|press$|selectText$|setDefaultTimeout$|clickOrFail$|proveProbe$|expectVisible$|expectHidden$|expectCount$|expectText$|expectAbsent$)/.test(name)
      if (waits) {
        const values = []
        for (const argument of node.arguments) {
          if (ts.isObjectLiteralExpression(argument)) {
            for (const prop of argument.properties) {
              if (ts.isPropertyAssignment(prop) && nameOf(prop.name) === 'timeout') values.push(prop.initializer)
              if (ts.isShorthandPropertyAssignment(prop) && prop.name.text === 'timeout') values.push(prop.name)
            }
          } else if (['waitForTimeout', 'setDefaultTimeout', 'proveProbe', 'expectVisible', 'expectHidden', 'expectCount', 'expectText', 'expectAbsent'].includes(name)) values.push(argument)
        }
        if (values.some(value => number(value) >= 5000)) hits.push({
          line: parsed.getLineAndCharacterOfPosition(node.getStart(parsed)).line + 1,
          text: node.getText(parsed).replace(/\s+/g, ' '),
        })
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(parsed)
  return hits
}

// Keep debt identity stable without copying whole callbacks into the baseline.
const stationKey = (file, text) => JSON.stringify([file, createHash('sha256').update(text).digest('hex')])
const flattenStationBaseline = baseline => Object.fromEntries(Object.entries(baseline).flatMap(([file, entries]) =>
  Object.entries(entries).map(([fingerprint, count]) => [JSON.stringify([file, fingerprint]), count])))

export function main() {
  const hits = []
  const baseline = flattenStationBaseline(JSON.parse(fs.readFileSync(path.join(repoRoot, 'scripts/station-waits-baseline.json'), 'utf8')))
  const stationHits = []
  for (const file of collectTestFiles()) {
    const raw = fs.readFileSync(file, 'utf8')
    // 键里的路径必须归一成正斜杠：基线在 Linux CI 生成，Windows 上 path.relative 给反斜杠会让 824 条全部对不上、整片报陈旧
    // （同文件其余 path.relative 早已这样归一，这一行是新规则落下的）
    const stationFile = path.relative(repoRoot, file).replaceAll(path.sep, '/')
    stationHits.push(...stationWaitHits(raw, stationFile).map(hit => ({ ...hit, file: stationFile })))
    const source = stripComments(raw)
    const context = { clockDeltaNames: collectClockDeltaNames(source), spiesOnFsRead: FS_READ_SPY.test(source), asyncWaitLines: asyncWaitForFunctionLines(raw, file),
      builtArtifactImportLines: builtArtifactImportLines(raw, path.relative(repoRoot, file).replaceAll(path.sep, '/')),
      unownedLaneCleanupLines: unownedLaneCleanupLines(raw, path.relative(repoRoot, file).replaceAll(path.sep, '/')) }
    const unitTest = /\.test\.(tsx?|mts|cts|mjs)$/.test(file)
    source.split('\n').forEach((line, i) => {
      context.lineIndex = i
      for (const rule of RULES) {
        if (!unitTest && !['async-waitforfunction-predicate', 'unowned-lane-directory-cleanup', 'built-artifact-test-import'].includes(rule.id)) continue
        if (rule.test(line, context)) hits.push({ rule, file, line: i + 1, text: line.trim().slice(0, 120) })
      }
    })
  }

  const actual = new Map()
  for (const hit of stationHits) {
    const key = stationKey(hit.file, hit.text)
    actual.set(key, (actual.get(key) ?? 0) + 1)
  }
  const stationErrors = []
  // A future PR cannot add or enlarge debt entries, even while deleting other debt.
  const base = execFileSync('git', ['merge-base', 'HEAD', 'origin/main'], { cwd: repoRoot, encoding: 'utf8' }).trim()
  const baseFiles = execFileSync('git', ['ls-tree', '-z', '--name-only', base, 'scripts/station-waits-baseline.json'], { cwd: repoRoot, encoding: 'utf8' }).trim()
  if (baseFiles) {
    const previous = flattenStationBaseline(JSON.parse(execFileSync('git', ['show', `${base}:scripts/station-waits-baseline.json`], { cwd: repoRoot, encoding: 'utf8' })))
    for (const [key, count] of Object.entries(baseline)) if (count > (previous[key] ?? 0)) stationErrors.push(`station baseline growth: ${key}`)
  }
  for (const [key, count] of actual) if (count > (baseline[key] ?? 0)) stationErrors.push(`${key}: ${count} > baseline ${baseline[key] ?? 0}`)
  for (const [key, count] of Object.entries(baseline)) if ((actual.get(key) ?? 0) !== count) stationErrors.push(`stale station baseline: ${key}`)
  for (const error of stationErrors) console.log(`[station-fixed-timeout] ${error}`)
  for (const hit of stationHits) if ((actual.get(stationKey(hit.file, hit.text)) ?? 0) > (baseline[stationKey(hit.file, hit.text)] ?? 0))
    console.log(`  ${hit.file}:${hit.line} ${hit.text}`)
  console.log(`Station wait baseline: ${Object.values(baseline).reduce((a, b) => a + b, 0)} occurrences; new/stale: ${stationErrors.length}`)
  const budgetHits = hits.filter((hit) => hit.rule.id === 'wallclock-budget-assertion')
  const hardHits = hits.filter((hit) => hit.rule.id !== 'wallclock-budget-assertion')
  const budgetByFile = new Map()
  for (const hit of budgetHits) {
    const relative = path.relative(repoRoot, hit.file).replaceAll(path.sep, '/')
    budgetByFile.set(relative, [...(budgetByFile.get(relative) ?? []), hit])
  }

  const budgetViolations = []
  for (const [relative, fileHits] of budgetByFile) {
    const allowed = WALLCLOCK_BUDGET_BASELINE.get(relative) ?? 0
    if (fileHits.length > allowed) budgetViolations.push({ relative, fileHits, allowed })
  }
  const staleBaseline = [...WALLCLOCK_BUDGET_BASELINE].filter(
    ([relative, allowed]) => (budgetByFile.get(relative)?.length ?? 0) < allowed,
  )

  if (stationErrors.length > 0 || hardHits.length > 0 || budgetViolations.length > 0 || staleBaseline.length > 0) {
    console.log('✖ 测试等待门岗未通过：测试不许空等待、私有墙钟等待、墙钟判分或无 owner 的 lane 清理')
    for (const hit of hardHits.slice(0, 20)) {
      console.log(`    ${path.relative(repoRoot, hit.file).replaceAll(path.sep, '/')}:${hit.line}  [${hit.rule.id}]  ${hit.text}`)
    }
    for (const { relative, fileHits, allowed } of budgetViolations) {
      console.log(`    ${relative}  [wallclock-budget-assertion]  ${fileHits.length} 处 > 基线 ${allowed} 处`)
      for (const hit of fileHits) console.log(`        :${hit.line}  ${hit.text}`)
    }
    for (const [relative, allowed] of staleBaseline) {
      const actual = budgetByFile.get(relative)?.length ?? 0
      console.log(`    ${relative}  [wallclock-budget-assertion]  基线陈旧：登记 ${allowed} 处、实际 ${actual} 处`)
      console.log('        → 好事，把 WALLCLOCK_BUDGET_BASELINE 里的数字降到实际值（棘轮只减不增）')
    }
    if (hardHits.some((hit) => !['fs-read-spy-path-filter', 'async-waitforfunction-predicate', 'unowned-lane-directory-cleanup', 'built-artifact-test-import'].includes(hit.rule.id))) {
      console.log('  → 等后台编排链请 import electron/productionRun/productionRunTestHelpers 的 waitForProduction')
      console.log('    （60s 安全网只拦真死锁/真回归，不给磁盘排队计时；来龙去脉见 docs/plan/2026-08-25-fix-flaky-production-run-tests.md）')
    }
    if (hardHits.some((hit) => hit.rule.id === 'fs-read-spy-path-filter')) {
      console.log('  → fs-read-spy-path-filter：生产按 fd 读，按路径过滤读 spy 恒空、断言恒真（假绿）。')
      console.log('    改用生产侧计数器（__projectAgentCommandLedgerScanCountForTests 那一套），')
      console.log('    并配一条阳性对照用例钉住「它真的会涨」——见 docs/lessons/vacuous-probe-passes-forever.md')
    }
    if (hardHits.some((hit) => hit.rule.id === 'async-waitforfunction-predicate')) {
      console.log('  → async waitForFunction：改用 expect.poll(async () => page.evaluate(...), { timeout }).toBe(true)，真正等待异步读数。')
    }
    if (hardHits.some((hit) => hit.rule.id === 'unowned-lane-directory-cleanup')) {
      console.log('  → lane 目录交给 createLaneFixture；用 fixture.openLane / fixture.after 注册资源，等待全部 close 完成后再统一删除。')
    }
    if (budgetViolations.length > 0) {
      console.log('  → 新增的耗时断言：若它量的是「这段计算够不够快」，删掉换与机器速度无关的判据')
      console.log('    （计数器 / 两个等长窗口的工作量相等 / 直接观测被测机制），真要守常数因子性能请拆去 performance 风险面；')
      console.log('    若它量的是「生产代码的硬超时有没有生效」，在 WALLCLOCK_BUDGET_BASELINE 登记并写明理由。')
    }
    process.exit(1)
  }
  console.log(
    `✅ 测试等待门岗通过：0 处空等待/私有墙钟等待/无 owner 的 lane 清理（硬零），${budgetHits.length} 处墙钟预算断言（棘轮基线，只减不增）`,
  )

}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
