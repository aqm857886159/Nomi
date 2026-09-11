#!/usr/bin/env node
// 静默分支普查（2026-09-11）—— 把「错误被吞掉」这一族数出来，不只修撞见的那几处。
//
// 起因：付费卡链路上一天里连撞三处同病：
//   ① src/workbench/ai/v4/useAgentPanelSpendConfirm.ts  `.catch(() => undefined)` 把确认结果丢了；
//   ② electron/productionRun/productionActionIpc.ts      读通道 catch 返回 []，加载失败伪装成「没有待确认」；
//   ③ electron/capabilityCore/appIntegration.ts          装配失败只 logError，整条付费卡 lane 静默消失。
// 三处的共同形状是同一个：**失败没有回到调用方，于是界面上什么都不会响**。
//
// 本脚本只普查、不判罪。判罪（棘轮门岗 check:silent-branches）的设计写在
// docs/audit/2026-09-11-silent-branch-census.md，按 R17「加规则先验它会红」的纪律，
// 上面三处就是它的阳性对照。
//
// 解析方式与 check:vocabularies 同源：仓里已有的 `typescript` 编译器 API，不引新依赖。
//
// 用法：
//   node ./scripts/census-silent-branches.mjs             人读汇总（按类别 × 层）
//   node ./scripts/census-silent-branches.mjs --json      机读全量（给文档生成/门岗原型用）
//   node ./scripts/census-silent-branches.mjs --top 30    只看按用户可见后果排序的前 N 条
//   node ./scripts/census-silent-branches.mjs --category b --layer UI
//   node ./scripts/census-silent-branches.mjs --file src/workbench/ai/v4/useAgentPanelSpendConfirm.ts

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const ROOTS = ['src', 'electron']
const SOURCE_EXTENSION = /\.(?:ts|tsx|mts|cts)$/
// 测试、构建产物、走查脚本不算生产路径：走查里吞错只会让走查自己不准，不会让用户看不到东西。
const SKIP_PATH =
  /(?:^|\/)(?:node_modules|dist|dist-electron|release|\.tmp|__mocks__|__fixtures__|fixtures)(?:\/|$)|\.(?:test|spec|node-test)\.[^.]+$/

// ---------------------------------------------------------------------------
// 类别定义（与文档里的 a–f 一一对应）
// ---------------------------------------------------------------------------
const CATEGORIES = {
  a1: { id: 'a1', label: '空 catch（catch 块里一条语句都没有）' },
  a2: { id: 'a2', label: 'catch 只 log 不回错（写进日志，调用方拿到的仍是成功）' },
  b: { id: 'b', label: '.catch(() => 常量)（把 rejection 换成 undefined/null/[]/{}/false）' },
  c: { id: 'c', label: 'void promise 且无 .catch（fire-and-forget，失败只剩 unhandledRejection）' },
  d: { id: 'd', label: 'catch 里写空值：return []/null，或 setX(undefined)（失败伪装成「无数据」）' },
  e: { id: 'e', label: 'catch 不中断、直接落回成功路径（fallthrough）' },
  f: { id: 'f', label: '带 fallback / 兜底 / 默认为 注释的静默分支' },
}

// ---------------------------------------------------------------------------
// 层归属：决定「这条失败会让用户看到什么」
// ---------------------------------------------------------------------------
const LAYER_CONSEQUENCE = {
  UI: '界面停在旧状态或空状态——按钮转完圈回到原样，用户以为自己没点到，会重复点。',
  IPC: '渲染层收到一个「合法的空答案」，面板据此渲染「没有内容」，真相是主进程那边炸了。',
  MAIN: '主进程编排半装/半跑——功能整块静默缺席，界面上连入口都不出现，用户只会说「它没了」。',
  CORE: '纯数据/契约层把坏输入洗成好输出，错误顺着调用链向上消失，最终在很远的地方表现成别的 bug。',
  LOG: '只影响可观测性本身（日志/遥测写不出），用户直接感知为零。',
}

const LOGGING_PATH = /(?:^|\/)(?:logging|telemetry|analytics|metrics|crash|diagnostics)/i
// 两条都必须从文件名开头锚定。没锚的第一版把 `SpendConfirmDialog.tsx` 判成日志层
// ——"Dia**log**.tsx" 命中了 `log[A-Za-z]*\.tsx`——于是付费确认弹窗里的静默分支被
// 「日志兜底」这条豁免理由白白放过。**误判成豁免比漏报更坏**：漏报只是没数到，
// 误判是门岗亲手给真问题发了通行证。
const LOGGING_FILE = /^(?:log|logger|logging|telemetry|analytics|metric|crashReport|diagnostic)[A-Za-z]*\.(?:ts|tsx|mts|cts)$/
const IPC_FILE = /^[a-z][A-Za-z]*(?:Ipc|IPC|Preload|preload|Bridge|Channel)[A-Za-z]*\.(?:ts|tsx|mts|cts)$/

function layerOf(relativePath) {
  if (LOGGING_PATH.test(relativePath) || LOGGING_FILE.test(path.basename(relativePath))) return 'LOG'
  if (IPC_FILE.test(path.basename(relativePath))) return 'IPC'
  if (relativePath.startsWith('electron/')) {
    if (/preload|ipc/i.test(relativePath)) return 'IPC'
    return 'MAIN'
  }
  if (relativePath.endsWith('.tsx')) return 'UI'
  // src/ 下的非 tsx：hooks/store/组件辅助算 UI，其余算纯逻辑核。
  if (/(?:^|\/)(?:components?|workbench|design|panels?|views?|screens?|hooks?|stores?)(?:\/|$)/.test(relativePath)) return 'UI'
  return 'CORE'
}

// ---------------------------------------------------------------------------
// 用户可见后果的权重：钱 / 画布 / 生成任务 优先（用户点名的排序）
// ---------------------------------------------------------------------------
const DOMAIN_WEIGHTS = [
  { id: 'money', weight: 100, re: /spend|pricing|price|billing|budget|quota|payment|credit|approval|authoriz|receipt|confirm/i },
  { id: 'generation', weight: 80, re: /generation|productionRun|production|job|dispatch|schedul|provider|vendor|model|render|batch/i },
  { id: 'canvas', weight: 70, re: /canvas|reactFlow|node|graph|timeline|storyboard|shot/i },
  { id: 'project', weight: 55, re: /project|library|persist|repository|store|save|autosave|migration/i },
  { id: 'agent', weight: 50, re: /agent|session|mcp|tool|skill|capability/i },
  { id: 'asset', weight: 40, re: /asset|media|image|video|audio|upload|download|file/i },
  { id: 'settings', weight: 20, re: /setting|preference|theme|i18n|locale|telemetry/i },
]

function domainOf(relativePath, functionName) {
  const haystack = `${relativePath} ${functionName ?? ''}`
  for (const entry of DOMAIN_WEIGHTS) if (entry.re.test(haystack)) return entry
  return { id: 'other', weight: 10 }
}

// 类别自身的「响不响得出来」权重：完全无声 > 有日志 > 只影响可观测性。
const CATEGORY_WEIGHT = { a1: 40, d: 38, b: 35, e: 30, c: 25, a2: 18, f: 12 }
// 空 catch 里写了理由的（`} catch { /* 失败已记在节点上 */ }`），说明当时是想过的——
// 仍要普查（理由会过期、也可能是自我安慰），但排序上让给完全无声的那些。
const EXPLAINED_DISCOUNT = 22
const LAYER_WEIGHT = { UI: 30, IPC: 28, MAIN: 26, CORE: 14, LOG: 0 }

// ---------------------------------------------------------------------------
// 「设计如此」白名单：有明确理由、且理由成立的静默。单列不计入待修。
// 判据严格——**理由必须是领域约束，不能是「反正也处理不了」**。
// ---------------------------------------------------------------------------
const BY_DESIGN = [
  {
    match: (rel) => /ponytail-review-hook\.mjs$/.test(rel),
    reason: 'Ponytail hook 故意丢弃 stdout/stderr（见 memory：zero-bytes is by design）；真信号是 report 大小。',
  },
  {
    match: (rel) => layerOf(rel) === 'LOG',
    reason: '日志/遥测自身的兜底：写日志失败再抛会把主流程一起拖倒，属于可观测性降级而非功能失败。',
  },
  {
    match: (rel, snippet) => /localStorage|sessionStorage|indexedDB/i.test(snippet),
    reason: '浏览器存储访问在隐私窗口/禁用站点数据时会直接 throw，按约定必须 try/catch 且以「没有存过」继续。',
  },
  {
    match: (rel, snippet) => /JSON\.parse/.test(snippet) && /normaliz|parse|coerce|schema|guard/i.test(rel),
    reason: '外部输入归一层：坏输入返回 null/[] 是该层的契约（调用方据此判定「这条不合法」），不是吞错。',
  },
  {
    match: (rel, context) => /assertTrustedSender|assertTrustedFrame/.test(context),
    reason: '信任边界守卫：来路不明的 IPC 消息就是要**无声丢弃**——回一条错误等于告诉攻击方通道存在。安全上静默才是正解。',
  },
]

/**
 * @param context 被保护的那段代码（整条 try 语句），不是 `} catch {` 那一行。
 * 第一版只传 catch 行，于是 `try { localStorage.getItem(…) } catch { }` 里的
 * localStorage 豁免永远匹配不上——理由写在 try 里，判据却只看 catch。
 */
function byDesignReason(relativePath, context) {
  for (const entry of BY_DESIGN) {
    if (entry.match(relativePath, context)) return entry.reason
  }
  return null
}

// ---------------------------------------------------------------------------
// 文件收集
// ---------------------------------------------------------------------------
function collectFiles() {
  const files = []
  const walk = (dir) => {
    if (!fs.existsSync(dir)) return
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      const rel = path.relative(repoRoot, full).split(path.sep).join('/')
      if (SKIP_PATH.test(rel)) continue
      if (entry.isDirectory()) walk(full)
      else if (SOURCE_EXTENSION.test(entry.name)) files.push(rel)
    }
  }
  for (const root of ROOTS) walk(path.join(repoRoot, root))
  return files.sort()
}

// ---------------------------------------------------------------------------
// AST 辅助
// ---------------------------------------------------------------------------
const LOG_CALLEE =
  /^(?:console\.(?:log|info|warn|error|debug|trace)|log(?:Error|Warn|Info|Debug)?|logger\.[a-z]+|.*\.log(?:Error|Warn|Info|Debug)?|reportError|captureException|trace|debugLog)$/

function calleeText(node, source) {
  if (!ts.isCallExpression(node)) return ''
  return node.expression.getText(source)
}

/** 一条语句是不是「只是把错误写出去」（log / telemetry / 上报），而不是把错误还给调用方。 */
function isLogOnlyStatement(statement, source) {
  if (ts.isExpressionStatement(statement)) {
    let expr = statement.expression
    if (ts.isAwaitExpression(expr) || ts.isVoidExpression(expr)) expr = expr.expression
    if (ts.isCallExpression(expr)) return LOG_CALLEE.test(calleeText(expr, source))
  }
  return false
}

/**
 * 该 catch 块里有没有「真正把失败传出去」的动作。
 *
 * 必须走 AST 不能 grep 文本：第一版用正则扫块文本，被 `logError('capability',
 * 'resident-generation-adapter-install-failed', error)` 里的字符串 "failed" 骗过，
 * 于是今天三处证据之一（appIntegration.ts 的装配失败）被判成「已经报错了」漏掉。
 * 日志消息里的词不是控制流。
 */
// 仓里真实在用的「把失败摆到用户面前」命名（`grep -oE '(report|show|set|record|…)[A-Z]\\w*(Error|Failure|Feedback|…)'`
// 出来的高频词全在这个形状里：reportCanvasFeedback / setSaveError / recordModelFailure / showUndoToast …）。
// 用形状不用清单：清单会过期，形状跟着命名规范走。
const ERROR_SURFACE_CALLEE =
  /^(?:set|show|report|push|surface|notify|announce|emit|record|mark|raise|dispatch)[A-Za-z]*(?:Error|Errors|Failure|Failed|Feedback|Notice|Toast|Message|Banner|Problem|Warning|Unavailable|Rejected|Denied)$|^(?:toast|notify|alert|reject|onError|fail|setError)$/
const ERROR_SHAPED_KEY = /^(?:ok|success|error|errors|code|failure|failed|reason|message)$/
// 词表与 check:vocabularies 的 LIFECYCLE 失败端同源——一条失败态字面量进了实参，
// 就说明这次失败被命名并交给了下游状态机，界面上是有得看的。
const FAILURE_STATE_LITERAL = /^(?:error|failed|failure|fail|recoverable|denied|rejected|unavailable|timeout|cancelled|canceled|aborted|stopped|undone|blocked)$/i

function isErrorShapedReturn(expression, source) {
  if (!expression) return false
  if (ts.isObjectLiteralExpression(expression)) {
    return expression.properties.some((property) => {
      const name = property.name?.getText(source)
      if (!name) return false
      if (!ERROR_SHAPED_KEY.test(name.replace(/['"`]/g, ''))) return false
      // `{ ok: true }` 不算报错；`{ ok: false }` / `{ error }` / `{ code: 'failed' }` 算。
      if (ts.isPropertyAssignment(property) && property.initializer.kind === ts.SyntaxKind.TrueKeyword) {
        return name.replace(/['"`]/g, '') !== 'ok' && name.replace(/['"`]/g, '') !== 'success'
      }
      return true
    })
  }
  const text = expression.getText(source)
  return /^Promise\.reject\b/.test(text) || /\bnew\s+\w*Error\b/.test(text)
}

/** 只看本层语句，不下潜到嵌套函数体——嵌套回调里的 throw 影响不到本层的控制流。 */
function walkOwnLevel(node, source, visitor) {
  ts.forEachChild(node, (child) => {
    if (ts.isFunctionDeclaration(child) || ts.isFunctionExpression(child) || ts.isArrowFunction(child) || ts.isClassDeclaration(child)) return
    if (visitor(child) === true) return
    walkOwnLevel(child, source, visitor)
  })
}

function catchSurfacesError(clause, source) {
  let surfaces = false
  walkOwnLevel(clause.block, source, (node) => {
    if (surfaces) return true
    if (ts.isThrowStatement(node)) {
      surfaces = true
      return true
    }
    if (ts.isCallExpression(node)) {
      const callee = node.expression
      const name = ts.isPropertyAccessExpression(callee) ? callee.name.text : callee.getText(source)
      if (ERROR_SURFACE_CALLEE.test(name)) {
        surfaces = true
        return true
      }
      // 名字不带 Error 但**把失败命名给了下游**的写法：`setNodeStatus(id, 'recoverable', message)`、
      // `transition({ lifecycle: 'failed' })`。判据是实参里出现失败态字面量——
      // 这类调用把节点打成可见的错误/可找回状态，属于「响了」，不是吞掉。
      if (node.arguments.some((argument) => ts.isStringLiteralLike(argument) && FAILURE_STATE_LITERAL.test(argument.text))) {
        surfaces = true
        return true
      }
      if (
        node.arguments.some(
          (argument) =>
            ts.isObjectLiteralExpression(argument) &&
            argument.properties.some(
              (property) =>
                ts.isPropertyAssignment(property) &&
                ts.isStringLiteralLike(property.initializer) &&
                FAILURE_STATE_LITERAL.test(property.initializer.text),
            ),
        )
      ) {
        surfaces = true
        return true
      }
    }
    if (ts.isReturnStatement(node) && isErrorShapedReturn(node.expression, source)) {
      surfaces = true
      return true
    }
    return false
  })
  return surfaces
}

const EMPTY_VALUE = /^(?:undefined|null|void 0|\[\]|\{\}|false|0|''|""|``)$/

function isEmptyValueExpression(node, source) {
  const text = node.getText(source).replace(/\s+/g, ' ').trim()
  if (EMPTY_VALUE.test(text)) return true
  if (ts.isArrayLiteralExpression(node) && node.elements.length === 0) return true
  if (ts.isObjectLiteralExpression(node) && node.properties.length === 0) return true
  return false
}

/**
 * catch 块里「把失败写成空值」的两种写法（只看顶层语句，嵌套函数里的不算）：
 *   ① `return []` / `return null` / `return undefined` —— 失败伪装成「无数据」返回给调用方；
 *   ② `setPending(undefined)` / `setRows([])` —— 失败伪装成「无数据」写进 UI 状态。
 *
 * ② 是找②才发现的：exemplar A（付费卡）的链条真正断在
 * `catch { setPending(undefined) }`，不在下游那句 `.catch(() => undefined)`。
 * 只认 `return` 会把这类根因整片漏掉——UI 层本来就很少 return，它写 state。
 */
const STATE_SETTER = /^(?:set|update|replace|reset|apply|assign)[A-Z]\w*$/

function catchWritesEmpty(clause, source) {
  for (const statement of clause.block.statements) {
    if (ts.isReturnStatement(statement)) {
      if (!statement.expression) return { kind: 'return', value: 'undefined' }
      if (isEmptyValueExpression(statement.expression, source)) {
        return { kind: 'return', value: statement.expression.getText(source).replace(/\s+/g, ' ').trim() }
      }
      continue
    }
    if (ts.isExpressionStatement(statement) && ts.isCallExpression(statement.expression)) {
      const call = statement.expression
      const callee = call.expression
      const name = ts.isPropertyAccessExpression(callee) ? callee.name.text : callee.getText(source)
      if (!STATE_SETTER.test(name)) continue
      if (call.arguments.length !== 1) continue
      if (!isEmptyValueExpression(call.arguments[0], source)) continue
      return { kind: 'state', value: `${name}(${call.arguments[0].getText(source).replace(/\s+/g, ' ').trim()})` }
    }
  }
  return null
}

/** 往上找最近的具名函数/方法/箭头赋值，给人一个「这条住在哪」的锚。 */
function enclosingFunctionName(node, source) {
  let current = node.parent
  while (current) {
    if (ts.isFunctionDeclaration(current) && current.name) return current.name.getText(source)
    if (ts.isMethodDeclaration(current) && current.name) return current.name.getText(source)
    if (ts.isConstructorDeclaration(current)) return 'constructor'
    if ((ts.isFunctionExpression(current) || ts.isArrowFunction(current)) && current.parent) {
      const parent = current.parent
      if (ts.isVariableDeclaration(parent) && parent.name) return parent.name.getText(source)
      if (ts.isPropertyAssignment(parent) && parent.name) return parent.name.getText(source)
      if (ts.isPropertyDeclaration(parent) && parent.name) return parent.name.getText(source)
      if (ts.isCallExpression(parent)) {
        // useCallback / useMemo / ipcMain.handle('channel', …) —— 拿通道名当锚，比 <anonymous> 有用得多。
        const firstArg = parent.arguments[0]
        if (firstArg && ts.isStringLiteralLike(firstArg)) return `${parent.expression.getText(source)}(${firstArg.text})`
      }
    }
    if (ts.isClassDeclaration(current) && current.name) return current.name.getText(source)
    current = current.parent
  }
  return null
}

const FALLBACK_COMMENT = /fallback|兜底|默认为|默认值|best[- ]effort|尽力|忽略错误|silently|swallow|ignore (?:the )?error|不阻塞|不抛/i

/** 取一个节点前面挂着的注释文本（含上一行行注释与块注释）。 */
function leadingCommentText(node, fullText) {
  const ranges = ts.getLeadingCommentRanges(fullText, node.getFullStart()) ?? []
  return ranges.map((r) => fullText.slice(r.pos, r.end)).join('\n')
}

/** catch 块内部的注释（空 catch 里常见 `/* fallthrough *\/`）。 */
function innerCommentText(clause, source) {
  const text = clause.block.getText(source)
  return (text.match(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g) ?? []).join('\n')
}

function snippetAt(sourceFile, node) {
  const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
  const lines = sourceFile.text.split('\n')
  return (lines[line] ?? '').trim().slice(0, 160)
}

function lineOf(sourceFile, node) {
  return sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1
}

// ---------------------------------------------------------------------------
// 单文件扫描
// ---------------------------------------------------------------------------
function scanFile(relativePath) {
  const absolute = path.join(repoRoot, relativePath)
  const text = fs.readFileSync(absolute, 'utf8')
  const sourceFile = ts.createSourceFile(
    absolute,
    text,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
    relativePath.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  )
  const findings = []

  const push = (categoryId, node, extra = {}) => {
    const line = lineOf(sourceFile, node)
    const snippet = snippetAt(sourceFile, node)
    const fn = enclosingFunctionName(node, sourceFile)
    // 被保护的那段代码：catch 的话取整条 try，否则取当前语句所在行的上下文。
    let guarded = node
    while (guarded && !ts.isTryStatement(guarded) && !ts.isStatement(guarded)) guarded = guarded.parent
    const context = guarded ? guarded.getText(sourceFile).slice(0, 2000) : snippet
    findings.push({
      id: `${relativePath}:${line}:${categoryId}`,
      file: relativePath,
      line,
      category: categoryId,
      categoryLabel: CATEGORIES[categoryId].label,
      function: fn,
      layer: layerOf(relativePath),
      snippet,
      context,
      ...extra,
    })
  }

  const visit = (node) => {
    // ---- catch 家族：a1 / a2 / d / e / f ----
    if (ts.isCatchClause(node)) {
      const statements = node.block.statements
      const inner = innerCommentText(node, sourceFile)
      const surfaces = catchSurfacesError(node, sourceFile)
      const wroteEmpty = catchWritesEmpty(node, sourceFile)
      const tryStatement = node.parent
      // 「fallthrough」= catch 不中断控制流，且 try 语句后面还有语句 → 继续走成功路径。
      const continuesAfter = (() => {
        if (!ts.isTryStatement(tryStatement)) return false
        const block = tryStatement.parent
        if (!block || !('statements' in block)) return false
        const list = block.statements
        const index = list.indexOf(tryStatement)
        if (index < 0 || index === list.length - 1) return false
        const last = statements[statements.length - 1]
        if (!last) return true
        return !ts.isReturnStatement(last) && !ts.isThrowStatement(last) && !ts.isContinueStatement(last) && !ts.isBreakStatement(last)
      })()

      if (!surfaces) {
        if (wroteEmpty !== null) {
          push('d', node, { emptyVia: wroteEmpty.kind, returnedValue: wroteEmpty.value })
        } else if (statements.length === 0) {
          push('a1', node, { hasComment: inner.length > 0 })
        } else if (statements.every((s) => isLogOnlyStatement(s, sourceFile))) {
          push('a2', node, {})
        }
        if (continuesAfter && statements.every((s) => !ts.isReturnStatement(s) && !ts.isThrowStatement(s))) {
          push('e', node, {})
        }
      }
      if (FALLBACK_COMMENT.test(inner) || FALLBACK_COMMENT.test(leadingCommentText(tryStatement ?? node, text))) {
        if (!surfaces) push('f', node, { comment: (inner.match(/[^\n]+/) ?? [''])[0].trim().slice(0, 120) })
      }
    }

    // ---- b：.catch(() => 常量) ----
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'catch') {
      const handler = node.arguments[0]
      if (handler && (ts.isArrowFunction(handler) || ts.isFunctionExpression(handler))) {
        const body = handler.body
        let constantText = null
        if (!ts.isBlock(body)) {
          if (isEmptyValueExpression(body, sourceFile)) constantText = body.getText(sourceFile).replace(/\s+/g, ' ').trim()
        } else {
          const meaningful = body.statements.filter((s) => !isLogOnlyStatement(s, sourceFile))
          if (meaningful.length === 0 && body.statements.length >= 0) {
            constantText = body.statements.length === 0 ? '{}（空块）' : 'log-only'
          } else if (meaningful.length === 1 && ts.isReturnStatement(meaningful[0])) {
            const expr = meaningful[0].expression
            if (!expr) constantText = 'undefined'
            else if (isEmptyValueExpression(expr, sourceFile)) constantText = expr.getText(sourceFile).replace(/\s+/g, ' ').trim()
          }
        }
        if (constantText !== null) push('b', node.expression.name, { returnedValue: constantText })
      }
    }

    // ---- c：void <promise> 且整条表达式里没有 .catch ----
    if (ts.isVoidExpression(node)) {
      const operand = node.expression
      const operandText = operand.getText(sourceFile)
      const looksAsync =
        ts.isCallExpression(operand) ||
        ts.isAwaitExpression(operand) ||
        (ts.isParenthesizedExpression(operand) && /\(async\b|\.then\(|Promise\./.test(operandText))
      if (looksAsync && !/\.catch\s*\(/.test(operandText) && !/^void 0$/.test(operandText)) {
        // `void 0` 与同步 setter 不算；只认看起来是 promise 的。
        const asyncish =
          /async|Promise|\.then\(|await |refresh|load|fetch|save|persist|send|invoke|emit|dispatch|run|start|sync|write|read|reconcile|schedule/i.test(
            operandText,
          )
        if (asyncish) push('c', node, {})
      }
    }

    ts.forEachChild(node, visit)
  }

  visit(sourceFile)
  return findings
}

// ---------------------------------------------------------------------------
// 评分 & 归类
// ---------------------------------------------------------------------------
function enrich(finding) {
  const domain = domainOf(finding.file, finding.function)
  const design = byDesignReason(finding.file, finding.context ?? finding.snippet)
  const raw = domain.weight + (CATEGORY_WEIGHT[finding.category] ?? 0) + (LAYER_WEIGHT[finding.layer] ?? 0)
  const score = design ? 0 : Math.max(0, raw - (finding.hasComment ? EXPLAINED_DISCOUNT : 0))
  const { context: _context, ...rest } = finding
  return {
    ...rest,
    domain: domain.id,
    userImpact: LAYER_CONSEQUENCE[finding.layer],
    byDesign: design,
    score,
  }
}

function run(argv) {
  const files = collectFiles()
  const all = []
  for (const file of files) {
    try {
      all.push(...scanFile(file).map(enrich))
    } catch (error) {
      // 普查自身解析失败必须响——这正是本脚本在抓的病，不能自己犯。
      process.stderr.write(`[census] parse failed: ${file}: ${error instanceof Error ? error.message : String(error)}\n`)
      process.exitCode = 2
    }
  }

  const filterCategory = readOption(argv, '--category')
  const filterLayer = readOption(argv, '--layer')
  const filterFile = readOption(argv, '--file')
  let rows = all
  if (filterCategory) rows = rows.filter((r) => r.category === filterCategory)
  if (filterLayer) rows = rows.filter((r) => r.layer === filterLayer)
  if (filterFile) rows = rows.filter((r) => r.file.includes(filterFile))

  const actionable = rows.filter((r) => !r.byDesign)
  const byDesign = rows.filter((r) => r.byDesign)
  rows.sort((a, b) => b.score - a.score || a.file.localeCompare(b.file) || a.line - b.line)

  if (argv.includes('--json')) {
    process.stdout.write(
      JSON.stringify(
        {
          generatedFrom: 'scripts/census-silent-branches.mjs',
          roots: ROOTS,
          fileCount: files.length,
          total: rows.length,
          actionable: actionable.length,
          byDesign: byDesign.length,
          categories: CATEGORIES,
          layerConsequence: LAYER_CONSEQUENCE,
          // 每条只存自己的事实。`categoryLabel` / `userImpact` 是上面两张表按 category / layer
          // 查出来的同一句话——逐条再存一份，1127 条就是 1127 份重复，文件白胖一倍多。
          findings: rows.map(({ categoryLabel: _label, userImpact: _impact, ...rest }) => rest),
        },
        null,
        2,
      ) + '\n',
    )
    return
  }

  const topN = Number(readOption(argv, '--top') ?? 0)
  if (topN > 0) {
    for (const row of actionable.slice().sort((a, b) => b.score - a.score).slice(0, topN)) {
      process.stdout.write(`${row.score}\t${row.category}\t${row.layer}\t${row.file}:${row.line}\t${row.function ?? '-'}\t${row.snippet}\n`)
    }
    return
  }

  // 总表：类别 × 层
  const layers = ['UI', 'IPC', 'MAIN', 'CORE', 'LOG']
  process.stdout.write(`扫描 ${files.length} 个文件（${ROOTS.join(' + ')}，排除测试/产物）\n`)
  process.stdout.write(`命中 ${rows.length} 条（待修 ${actionable.length}，设计如此 ${byDesign.length}）\n\n`)
  process.stdout.write(`类别\t${layers.join('\t')}\t合计\n`)
  for (const id of Object.keys(CATEGORIES)) {
    const inCategory = actionable.filter((r) => r.category === id)
    const cells = layers.map((l) => inCategory.filter((r) => r.layer === l).length)
    process.stdout.write(`${id}\t${cells.join('\t')}\t${inCategory.length}\n`)
  }
  const totals = layers.map((l) => actionable.filter((r) => r.layer === l).length)
  process.stdout.write(`合计\t${totals.join('\t')}\t${actionable.length}\n`)
}

function readOption(argv, name) {
  const index = argv.indexOf(name)
  if (index === -1) return null
  const value = argv[index + 1]
  if (!value || value.startsWith('--')) throw new Error(`${name} requires a value`)
  return value
}

run(process.argv.slice(2))
