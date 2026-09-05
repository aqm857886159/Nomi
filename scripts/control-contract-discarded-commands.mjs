// 控件交互契约 · 规则三：**被静默丢弃的命令**。check-control-contract.mjs 的一块，不是第二道门岗
// （「控件说谎」只能有一个 owner）。规则一二看的是 handler 里**没做事**；这条看的是 handler
// **做了事、事失败了、用户什么都看不到**——落在同一句合同（设计系统 §4.1 C1）上。
//
// 缘起（2026-09-06，#519）：常驻 Agent 面板的会话列表给每一行都渲染删除钮，包括当前会话，
//     onClick={() => void removeProjectAgentThread(thread.threadId)}
// 而 Host 对当前会话拒绝 `thread.remove`（projectAgentThreadReduction.ts 的 `thread_read_only`）。
// 裸 `void` 把这个拒绝丢进 unhandled rejection，面板顶上的错误条一个字都不显示：用户点删除、
// 弹窗不关、行还在、没有任何解释。修法（#519）是把命令包进 `runThreadCommand`，让拒绝走
// 和别的命令同一条错误条。
//
// **规则是照着证据收出来的，不是先定的。** 每收窄一次，都是拿真实误报换来的：
//
//   全仓 .tsx 里 `on*` handler 中被丢掉的调用          121 处
//    → 调用链摸得到主进程桥的                            10 处（其余是剪贴板、事件派发、纯本地状态）
//    → 被调的是 async / 返回 Promise 的                   9 处（clipNodeSourceFromAsset 是同步纯映射）
//    → 那个 Promise 真的会 reject 的                      5 处
//
// 被这四道筛掉的都是**长得像 bug 的好代码**，一条条记在这儿，免得谁再把规则放宽回去：
//   · recoverNodeResult / extractShotCutsToNodes：自己 try/catch 完，把失败写回节点状态告诉用户了
//   · productionRunStore.navigateTo：只 await 一个全程 try/catch 的 loadRun，压根 reject 不了
//   · confirmDialog：`new Promise(resolve => …)`，没有 reject 这条路（它从 src/design 桶文件
//     再导出，不跟着 `export … from` 追过去就会解析失败，而「解析失败」曾被当成「会 reject」）
//   · runPasteShareLinkImport：每个 IPC 都 try/catch 了，只剩一个**注入进来的**对话框裸 await——
//     看不见的东西不能硬说它会 reject，所以「解析不到」的默认答案是「不会」
//   · StoryboardPlanEditor 的 `void runAction(() => generateAnchorCard(…))`：命令写在回调里，
//     而 runAction 自己 try/catch 完 toast 了——回调是在它的 try 里跑的
//   · `getDesktopBridge()` 这句调用本身：同步返回一个对象，不是 Promise（不加这条，设置页
//     一口气误报十几处）
//
// 硬零 121 会是纯噪音，48 条不解释的棘轮同样是噪音——门岗自己的 header 写着「会瞎叫的门岗不如
// 没有」，上一版正则对真实代码报的 11 条全是误报。所以宁可漏，也不瞎叫；漏掉的写在最后。
//
// 判据（四条同时成立）：
//   1. JSX 上 `on*` 的值是内联箭头/函数，**或**本文件里定义的一个具名函数
//      （`onClick={handleThing}` 也要看，否则「把箭头体抽成具名 const」就是消音门岗的办法）
//   2. 里面有个调用的 Promise 没人要——`void f(…)`、`async () => await f(…)`、
//      以及裸飘着的 `f(…)` 都算（三种拼法同一个 bug；只盯 `void`，改成 async 就绕过去了）
//   3. 没人接住这个拒绝：不在带 catch 的 try 里，不挂在 `.catch` / `.then` 上，
//      也不是交给一个自己 try/catch 的函数去跑的回调。中间可以隔若干层同文件内的本地包装，
//      但那些包装自己也不能 try/catch——一 catch，拒绝就有人管了
//   4. 被调的是**会拒绝的跨进程命令**，两种认法：
//      a. 直接调桥上的方法：`getDesktopBridge()?.exports.cancel(jobId)`——主进程说不就是 reject
//      b. 声明在能（传递地）import 到 `src/desktop/bridge.ts` 的模块里、声明为 async 或返回
//         Promise、**且真的会 reject**：顺着 await 往下追（有界），追到某处 throw、或追到桥上
//         （桥的方法都是 `return invoke(…)` 的薄壳，主进程的拒绝正是从那儿回来的）才算；
//         追不到声明的（注入的依赖、第三方）当作不会 reject——见上面 runPasteShareLinkImport
//
// 抓不到的（诚实标注，别把它当万能）：
//   · 命令 reject 了、上层也 catch 了，但 catch 里只 console.warn 没告诉用户 → 语法上看不出
//     「有没有告诉用户」，留给 R13 走查
//   · 「成功地什么也没做」——命令 resolve 出 null / false 表示没做成，调用方不看
//     （TimelineSecondaryAddRow 的配乐钮就踩过：探测不出时长就返回 null，一声不吭）。
//     这是同一句合同下的另一种失效，但它不是 Promise 拒绝，靠类型和走查管
//   · 通过 props 传下去好几层才丢掉的 → 需要跨组件数据流
//   · 动态取到的命令（`handlers[kind]()`）→ 名字不是静态的
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const ts = require('typescript')

/** 顺着 await 往下追的层数上限。追不动就当「会 reject」（宁可多问一句，也别放过）。 */
const MAX_AWAIT_DEPTH = 6

/**
 * 一次扫描的全部状态。做成实例而不是模块级 Map，测试才能对着临时目录的 fixture 反复跑，
 * 不会被上一次扫描的缓存串味。
 */
class Scanner {
  constructor(root) {
    this.root = root
    this.src = path.join(root, 'src')
    // 渲染层通往主进程的**唯一**闸口（R26 的 check:boundaries 保证没有第二条）。
    // 「这个模块碰不碰主进程」就等于「它 import 得到这个文件吗」。
    this.bridge = path.join(this.src, 'desktop', 'bridge.ts')
    this.sources = new Map()
    this.imports = new Map()
    this.deps = new Map()
    this.reaches = new Map()
    this.decls = new Map()
    this.rejects = new Map()
  }

  sourceFile(file) {
    if (!this.sources.has(file)) {
      const text = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : ''
      this.sources.set(
        file,
        ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS),
      )
    }
    return this.sources.get(file)
  }

  /** 只解析相对路径 import；包名和 alias 不是本仓内部模块，追不到也不该追。 */
  resolveSpecifier(fromFile, spec) {
    if (!spec.startsWith('.')) return null
    const base = path.resolve(path.dirname(fromFile), spec)
    for (const candidate of [`${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts'), path.join(base, 'index.tsx')]) {
      if (fs.existsSync(candidate)) return candidate
    }
    return null
  }

  moduleDeps(file) {
    if (this.deps.has(file)) return this.deps.get(file)
    const set = new Set()
    this.deps.set(file, set)
    if (!fs.existsSync(file)) return set
    for (const statement of this.sourceFile(file).statements) {
      const specifier = statement.moduleSpecifier
      if (!specifier || !ts.isStringLiteral(specifier)) continue
      // `import type` 不产生运行时依赖：只带类型的模块碰不到主进程。
      if (ts.isImportDeclaration(statement) && statement.importClause?.isTypeOnly) continue
      const resolved = this.resolveSpecifier(file, specifier.text)
      if (resolved) set.add(resolved)
    }
    return set
  }

  reachesBridge(file) {
    if (this.reaches.has(file)) return this.reaches.get(file)
    this.reaches.set(file, false) // 环保护：循环 import 时先当「够不着」，由别的边定胜负
    if (file === this.bridge) {
      this.reaches.set(file, true)
      return true
    }
    let hit = false
    for (const dep of this.moduleDeps(file)) {
      if (this.reachesBridge(dep)) {
        hit = true
        break
      }
    }
    this.reaches.set(file, hit)
    return hit
  }

  /** 这个文件里，每个 import 进来的名字来自哪个模块（值 import；类型 import 不算）。 */
  importedNames(file) {
    if (this.imports.has(file)) return this.imports.get(file)
    const map = new Map()
    this.imports.set(file, map)
    if (!fs.existsSync(file)) return map
    for (const statement of this.sourceFile(file).statements) {
      if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue
      const clause = statement.importClause
      if (!clause || clause.isTypeOnly) continue
      const target = this.resolveSpecifier(file, statement.moduleSpecifier.text)
      if (clause.name) map.set(clause.name.text, target)
      if (!clause.namedBindings) continue
      if (ts.isNamedImports(clause.namedBindings)) {
        for (const element of clause.namedBindings.elements) if (!element.isTypeOnly) map.set(element.name.text, target)
      } else {
        map.set(clause.namedBindings.name.text, target)
      }
    }
    return map
  }

  /**
   * 在一个模块里按名字找函数声明。四种写法都认：函数声明、类方法、
   * `const f = () => …`、对象字面量的 `f: async () => …`（zustand store 就长这样）。
   */
  findFunction(file, name, seen = new Set()) {
    const key = `${file}#${name}`
    if (this.decls.has(key)) return this.decls.get(key)
    let found = null
    if (fs.existsSync(file)) {
      const nameOf = (node) => (node && ts.isIdentifier(node) ? node.text : null)
      const walk = (node) => {
        if (found) return
        if (ts.isFunctionDeclaration(node) && node.name?.text === name && node.body) {
          found = node
          return
        }
        if (ts.isMethodDeclaration(node) && nameOf(node.name) === name) {
          found = node
          return
        }
        if ((ts.isVariableDeclaration(node) || ts.isPropertyAssignment(node)) && nameOf(node.name) === name) {
          const fn = unwrapFunction(node.initializer)
          if (fn) {
            found = fn
            return
          }
        }
        node.forEachChild(walk)
      }
      walk(this.sourceFile(file))
      // 桶文件：`export { confirmDialog } from './confirmDialogStore'`。不跟过去的话，
      // 凡是从 src/design 这类 index.ts 引进来的函数都解析不到，而「解析不到」在
      // canReject 里是按「会 reject」算的——那就会把一堆永不 reject 的东西报成违规。
      if (!found) found = this.findReExported(file, name, seen)
    }
    this.decls.set(key, found)
    return found
  }

  findReExported(file, name, seen = new Set()) {
    if (seen.has(file)) return null
    seen.add(file)
    for (const statement of this.sourceFile(file).statements) {
      if (!ts.isExportDeclaration(statement) || !statement.moduleSpecifier || !ts.isStringLiteral(statement.moduleSpecifier)) continue
      if (statement.isTypeOnly) continue
      const target = this.resolveSpecifier(file, statement.moduleSpecifier.text)
      if (!target) continue
      const clause = statement.exportClause
      if (clause && ts.isNamedExports(clause)) {
        const element = clause.elements.find((entry) => entry.name.text === name)
        if (!element) continue
        const original = (element.propertyName ?? element.name).text
        const fn = this.findFunction(target, original)
        if (fn) return fn
        continue
      }
      // `export * from './x'`
      const fn = this.findFunction(target, name)
      if (fn) return fn
    }
    return null
  }

  /**
   * 把一个调用表达式解析到它的声明。`f(…)` 看 import 表；`store.getState().navigateTo(…)`
   * 取链尾的方法名，根名字是 import 就去那个模块找，否则在本文件里找。
   */
  resolveCall(callExpr, file) {
    const { root, member } = callTarget(callExpr.expression)
    if (!member) return null
    const imports = this.importedNames(file)
    if (root && imports.has(root)) {
      const module = imports.get(root)
      if (!module) return null
      const fn = this.findFunction(module, member)
      return fn ? { file: module, fn } : null
    }
    const fn = this.findFunction(file, member)
    return fn ? { file, fn } : null
  }

  /**
   * 这个函数的 Promise 会 reject 到调用方吗？
   *
   * 会：函数体里存在**没被 try(带 catch) 罩住**的 throw、await、或 `return <调用>`，
   * 且被 await/return 的那个东西自己也会 reject（顺着往下追，最多 MAX_AWAIT_DEPTH 层）。
   * catch 子句里的代码不算被罩住——`catch { … throw error }` 就是要往外抛。
   * 追不到声明（第三方、动态、超深）就当会 reject：这条规则宁可让人多写一个 catch，
   * 也不该悄悄放过一个真会静默失败的按钮。
   */
  canReject(fn, file, depth = 0, stack = new Set()) {
    if (!fn?.body) return true
    const key = `${file}#${fn.pos}`
    if (stack.has(key)) return false // 递归：这一支不额外贡献 reject
    if (this.rejects.has(key)) return this.rejects.get(key)
    stack.add(key)

    const settles = (expr) => {
      if (depth >= MAX_AWAIT_DEPTH) return true
      if (!ts.isCallExpression(expr)) return true
      if (ts.isPropertyAccessExpression(expr.expression) && (expr.expression.name.text === 'catch' || expr.expression.name.text === 'then')) {
        return false
      }
      const target = this.resolveCall(expr, file)
      // 追到桥本身就停：桥的方法都是 `return invoke(…)` 这种薄壳，语法上看不出会不会抛，
      // 而**主进程的拒绝正是从这儿回来的**——#519 的 `thread_read_only` 就走这条路。
      // 再往里追只会追进 ipc 壳里，得出「不会 reject」的错结论。
      if (target?.file === this.bridge) return true
      if (target) return this.canReject(target.fn, target.file, depth + 1, stack)
      // 解析不到声明的两种情况，答案相反，不能一刀切：
      //   `await api.update(…)`（api 来自 getDesktopBridge()）= 走 IPC，主进程说不就是 reject
      //   `await deps.prompt(…)`（注入进来的对话框）= 我们看不见它是什么，不能凭空说它会 reject
      // 早一版把两者都当「会 reject」，于是 runPasteShareLinkImport 这种把每个 IPC 都
      // try/catch 完、只剩一个注入对话框裸 await 的函数被报成违规——典型的瞎叫。
      return this.callCrossesBridge(expr, file)
    }

    let hit = false
    const walk = (node, guarded) => {
      if (hit) return
      // 不跨进嵌套函数：回调有自己的 Promise 身世。
      if (node !== fn && (ts.isArrowFunction(node) || ts.isFunctionExpression(node) || ts.isFunctionDeclaration(node))) return
      if (ts.isTryStatement(node)) {
        walk(node.tryBlock, guarded || Boolean(node.catchClause))
        if (node.catchClause) walk(node.catchClause, guarded)
        if (node.finallyBlock) walk(node.finallyBlock, guarded)
        return
      }
      if (!guarded) {
        if (ts.isThrowStatement(node)) {
          hit = true
          return
        }
        if (ts.isAwaitExpression(node) && settles(node.expression)) {
          hit = true
          return
        }
        if (ts.isReturnStatement(node) && node.expression && ts.isCallExpression(node.expression) && settles(node.expression)) {
          hit = true
          return
        }
      }
      node.forEachChild((child) => walk(child, guarded))
    }

    if (ts.isBlock(fn.body)) walk(fn.body, false)
    else hit = ts.isCallExpression(fn.body) ? settles(fn.body) : false

    stack.delete(key)
    this.rejects.set(key, hit)
    return hit
  }

  /**
   * 调的是**桥上的一个方法**：`getDesktopBridge()?.exports.cancel(jobId)`。
   * 注意不能只问「这句里有没有提到桥」——`getDesktopBridge()` 自己就提到了，可它同步返回一个
   * 对象，压根不是 Promise，把它当命令会在设置页一口气误报十几处。必须是「桥.某方法(…)」。
   */
  callNamesBridge(callExpr, file) {
    const callee = callExpr.expression
    if (!ts.isPropertyAccessExpression(callee)) return false
    return this.bridgeMention(file)(callee.expression)
  }

  /** 本文件里哪些名字是从桥那个模块 import 进来的；返回一个「这棵子树提到桥了吗」的判定。 */
  bridgeMention(file) {
    const bridgeNames = new Set()
    for (const [name, module] of this.importedNames(file)) if (module === this.bridge) bridgeNames.add(name)
    return (node) => {
      if (bridgeNames.size === 0) return false
      let hit = false
      const walk = (current) => {
        if (hit) return
        if (ts.isIdentifier(current) && bridgeNames.has(current.text)) {
          hit = true
          return
        }
        current.forEachChild(walk)
      }
      walk(node)
      return hit
    }
  }

  /**
   * 比 callNamesBridge 松一档：根名字是个本地变量、而它的初始化式里用到了桥也算
   * （`const api = getDesktopBridge()?.memory` 之后的 `await api.update(…)`）。
   * 只给 canReject 用——那里问的是「这个 await 会不会抛」，外层的 try/catch 已经算过了。
   */
  callCrossesBridge(callExpr, file) {
    const mentionsBridge = this.bridgeMention(file)
    if (mentionsBridge(callExpr.expression)) return true
    const { root } = callTarget(callExpr.expression)
    if (!root) return false
    let initializer = null
    const find = (node) => {
      if (initializer) return
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === root && node.initializer) {
        initializer = node.initializer
        return
      }
      node.forEachChild(find)
    }
    find(this.sourceFile(file))
    return Boolean(initializer && mentionsBridge(initializer))
  }

  /** 被调的是不是「会拒绝的跨进程命令」。 */
  commandFor(callExpr, file) {
    const { root, member } = callTarget(callExpr.expression)
    if (!root || !member) return null
    // 直接捅 IPC：`getDesktopBridge()?.exports.cancel(jobId)`。这是本类 bug 最赤裸的形状——
    // 主进程说不，Promise 就 reject，没人接就没人知道。桥上的方法在 bridge.ts 里是薄壳，
    // 按名字未必找得到声明，所以不走下面的「找声明 + 判 async」那条路。
    if (this.callNamesBridge(callExpr, file)) {
      return { command: `${root}(…).${member}`, module: relative(this.root, this.bridge) }
    }
    const module = this.importedNames(file).get(root)
    if (!module || !this.reachesBridge(module)) return null
    const decl = this.findFunction(module, member)
    if (!decl || !isAsyncish(decl, this.sourceFile(module))) return null
    if (!this.canReject(decl, module)) return null
    return { command: member, module: relative(this.root, module) }
  }

  /**
   * 在一段代码里找**没人接住**的命令调用。
   *
   * 三种写法是同一个 bug，所以一起看，不然「把 void 改成 async」就成了绕过门岗的逃生口：
   *   onClick={() => void hostCommand(id)}            裸 void 丢掉
   *   onClick={async () => { await hostCommand(id) }} React 不 await handler 的返回值
   *   onClick={() => { hostCommand(id) }}             飘着的 Promise（本仓 lint 没开
   *                                                   no-floating-promises，它需要类型信息）
   *
   * 三种情况算「有人接住」，整棵子树跳过：
   *   · 外面套着带 catch 的 try
   *   · 这个调用挂在 `.catch(…)` / `.then(…)` 上
   *   · 调的是一个**自己 try/catch 的函数**——它收下的回调是在它的 try 里跑的。
   *     StoryboardPlanEditor 的 `void runAction(() => generateAnchorCard(…))` 就靠这条放行：
   *     runAction 里 try/catch 完 toast 了，命令写在它的回调里不等于没人管。
   *
   * 不跨进嵌套函数（除了上面那条回调规则）——回调有自己的 Promise 身世。
   * handler 直接调本文件里的包装函数时往里追，包装可以再套包装。
   */
  unhandledCommands(node, file, locals, options = {}) {
    const { prefix = '', seen = new Set() } = options
    const found = []
    const walk = (current, guarded) => {
      if (found.length > 0 && prefix) return // 包装里找到一个就够了，不必列举
      if (current !== node && (ts.isArrowFunction(current) || ts.isFunctionExpression(current) || ts.isFunctionDeclaration(current))) return
      if (ts.isTryStatement(current)) {
        walk(current.tryBlock, guarded || Boolean(current.catchClause))
        if (current.catchClause) walk(current.catchClause, guarded)
        if (current.finallyBlock) walk(current.finallyBlock, guarded)
        return
      }
      if (ts.isCallExpression(current)) {
        const callee = current.expression
        if (ts.isPropertyAccessExpression(callee) && (callee.name.text === 'catch' || callee.name.text === 'then')) {
          current.forEachChild((child) => walk(child, true))
          return
        }
        const command = guarded ? null : this.commandFor(current, file)
        if (command) {
          found.push({ call: current, command: `${prefix}${command.command}`, module: command.module })
          return
        }
        const { root } = callTarget(callee)
        const wrapper = root && !this.importedNames(file).has(root) ? locals.get(root) : this.resolveCall(current, file)?.fn
        if (wrapper?.body) {
          // 包装自己接住了拒绝 → 它和它收下的回调都不算丢弃。
          if (handlesRejection(wrapper.body)) {
            current.forEachChild((child) => walk(child, true))
            return
          }
          if (!guarded && root && locals.has(root) && !seen.has(root)) {
            seen.add(root)
            const deeper = this.unhandledCommands(wrapper.body, file, locals, { prefix: `${prefix}${root} → `, seen })
            if (deeper.length > 0) {
              found.push({ call: current, command: deeper[0].command, module: deeper[0].module })
              return
            }
          }
        }
      }
      current.forEachChild((child) => walk(child, guarded))
    }
    const body = ts.isArrowFunction(node) || ts.isFunctionExpression(node) || ts.isFunctionDeclaration(node) ? node.body : node
    if (body) walk(body, false)
    return found
  }
}

function unwrapFunction(node) {
  let candidate = node
  // React.useCallback(fn, deps) / useMemo(() => fn) 之类：真正的函数是第一个实参。
  if (
    candidate &&
    ts.isCallExpression(candidate) &&
    candidate.arguments.length > 0 &&
    (ts.isArrowFunction(candidate.arguments[0]) || ts.isFunctionExpression(candidate.arguments[0]))
  ) {
    candidate = candidate.arguments[0]
  }
  return candidate && (ts.isArrowFunction(candidate) || ts.isFunctionExpression(candidate)) ? candidate : null
}

function isAsyncish(fn, sourceFile) {
  if (!fn) return false
  if (fn.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.AsyncKeyword)) return true
  return Boolean(fn.type && /^Promise\b/.test(fn.type.getText(sourceFile)))
}

/** `a.b().c(…)` → { root: 'a', member: 'c' }；`f(…)` → { root: 'f', member: 'f' }。 */
function callTarget(expr) {
  let node = expr
  let member = null
  for (;;) {
    if (ts.isPropertyAccessExpression(node)) {
      if (!member) member = node.name.text
      node = node.expression
      continue
    }
    if (ts.isCallExpression(node)) {
      node = node.expression
      continue
    }
    if (ts.isNonNullExpression(node) || ts.isParenthesizedExpression(node)) {
      node = node.expression
      continue
    }
    break
  }
  const root = ts.isIdentifier(node) ? node.text : null
  return { root, member: member ?? root }
}

/** 这段代码里有没有人接住拒绝：try、`.catch`、`.then`（两参形式也算表态了）。 */
function handlesRejection(node) {
  let hit = false
  const walk = (current) => {
    if (hit) return
    if (ts.isTryStatement(current)) {
      hit = true
      return
    }
    if (ts.isPropertyAccessExpression(current) && (current.name.text === 'catch' || current.name.text === 'then')) {
      hit = true
      return
    }
    current.forEachChild(walk)
  }
  walk(node)
  return hit
}

function localFunctions(scanner, file) {
  const map = new Map()
  const walk = (node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
      const fn = unwrapFunction(node.initializer)
      if (fn) map.set(node.name.text, fn)
    }
    if (ts.isFunctionDeclaration(node) && node.name) map.set(node.name.text, node)
    node.forEachChild(walk)
  }
  walk(scanner.sourceFile(file))
  return map
}

function relative(root, file) {
  return path.relative(root, file).replaceAll(path.sep, '/')
}

/**
 * 扫出所有「点了会失败、失败了没人说」的控件。
 * @param {{ root: string, files: readonly string[] }} input 仓库根 + 要扫的 .tsx 绝对路径
 * @returns {{ where: string, handler: string, discarded: string, command: string, module: string }[]}
 */
export function discardedCommandOffenders({ root, files }) {
  const scanner = new Scanner(root)
  const offenders = []
  for (const file of files) {
    const sourceFile = scanner.sourceFile(file)
    const locals = localFunctions(scanner, file)
    const rel = relative(root, file)
    const visit = (node) => {
      if (
        ts.isJsxAttribute(node) &&
        /^on[A-Z]/.test(node.name.getText()) &&
        node.initializer &&
        ts.isJsxExpression(node.initializer) &&
        node.initializer.expression
      ) {
        // 内联箭头，或 `onClick={handleThing}` 这种指名道姓（本文件里定义的那个函数）。
        // 后者必须一起看：否则「把箭头体抽成一个具名 const」就成了消音门岗的办法。
        const inline = node.initializer.expression
        const handler = ts.isArrowFunction(inline) || ts.isFunctionExpression(inline)
          ? inline
          : ts.isIdentifier(inline) && !scanner.importedNames(file).has(inline.text)
            ? locals.get(inline.text)
            : undefined
        if (handler) {
          const prefix = handler === inline ? '' : `${inline.getText(sourceFile)} → `
          for (const hit of scanner.unhandledCommands(handler, file, locals, { prefix })) {
            offenders.push({
              where: `${rel}:${sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1}`,
              handler: node.name.getText(),
              discarded: hit.call.getText(sourceFile).replace(/\s+/g, ' ').slice(0, 60),
              command: hit.command,
              module: hit.module,
            })
          }
        }
      }
      node.forEachChild(visit)
    }
    visit(sourceFile)
  }
  return offenders
}
