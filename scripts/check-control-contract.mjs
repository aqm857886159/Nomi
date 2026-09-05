#!/usr/bin/env node
// 控件交互契约门岗 —— 设计系统 §4.1 C1：「可点即有效，否则禁用并说明为什么」。
//
// 缘起（2026-08-03）：剪辑页那个「显示」下拉写成
//     onChange={(value) => { if (framingClipId) setTimelineClipFraming(framingClipId, ...) }}
// 却没有 disabled。播放头停在片段空隙上时目标为空 → if 短路 → 用户点了完全没反应、界面也不解释。
// 它活过了七道门岗、3634 个单测、多轮人眼走查——因为「语法对、语义错」：纯函数全对
// （空隙正确返回 []、mutator 正确 no-op），错的只有「UI 承诺可点、实际什么都不做」这层契约。
// 同类在本仓至少第 5 次（3D 空态启动器 / 连线参考图 / 死的 + 图标 / 确认落画布…）。
//
// 用 TypeScript AST 而不是正则：先写过一版正则，对真实代码报了 11 条**全是误报**
// （遮罩的 `event.target === event.currentTarget`、`event.button !== 0` 鼠标键过滤、
// 多语句 handler——本项目不写分号，正则根本切不开语句）。会瞎叫的门岗不如没有，很快就被绕过去。
//
// 判据（四条同时成立才算违规，刻意收窄到零误报）：
//   1. JSX 元素上有 onClick/onChange/onPointerDown/onSubmit，值是箭头函数
//   2. 函数体**只有一条语句**且是无 else 的 if；或首句是**裸** `return` 的早退守卫
//   3. 守卫条件**不来自 handler 自己的参数**——排除「点的是不是遮罩自己」「是不是左键」这类事件判定
//   4. 守卫的那个变量**被当参数传给了动作**——这条把「目标守卫」和「模式守卫/锁复检」分开：
//      `if (framingClipId) setFraming(framingClipId, …)` 拿不到目标就做不了事 = 真违规；
//      而 `if (splitMode) return` / `if (!connectable) return` 是「这个模式下本来就不做事」，
//      另一个模式自有它的处理，不是静默失效
//   5. 同一元素上没有 disabled / aria-disabled
//
// 抓不到的（诚实标注，别把它当万能）：
//   · 守卫藏在具名函数里、JSX 上只写 onClick={handler} → 需要跨函数数据流，留给 R13 走查断言
//   · disabled 了但没说明原因（契约 C4）→ 全仓 100+ 处 disabled={readOnly} 语境自明，做成硬门必成噪音
//   · 「这个控件该不该存在」「分组好不好看」→ 永远是人的判断，任何门岗都测不了
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const ts = require('typescript')

// fileURLToPath 而非 new URL().pathname：后者在 Windows 上给出 `/E:/…`，
// path.resolve 会把它当相对路径拼成 `E:\E:\…`，门岗在 Windows 机器上直接 ENOENT 崩掉。
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SRC = path.join(ROOT, 'src')
const HANDLERS = new Set(['onClick', 'onChange', 'onPointerDown', 'onSubmit'])

/** 例外必须写清理由；不写理由不许加。 */
// 2026-09-05：唯一一条例外（TextClipStyleControls 的字体下拉）随该组件一起删除——
// 字号/字体已迁进属性面板的 TextClipFields，那里拿到的是一个必然存在的 clip，无守卫可言。
const ALLOWLIST = new Map([])

function sourceFiles(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) sourceFiles(full, out)
    else if (entry.name.endsWith('.tsx') && !/\.(test|spec)\.tsx$/.test(entry.name)) out.push(full)
  }
  return out
}

/** 收集箭头函数形参里出现的标识符名（含解构），用于判定「守卫是不是在判事件参数」。 */
function parameterNames(fn) {
  const names = new Set()
  for (const param of fn.parameters) {
    const walk = (node) => {
      if (ts.isIdentifier(node)) names.add(node.text)
      else node.forEachChild(walk)
    }
    walk(param.name)
  }
  return names
}

/** 守卫条件里是否引用了 handler 自己的参数（是 → 这是事件判定，不是「拿不到目标」）。 */
function referencesParams(condition, paramNames) {
  let hit = false
  const walk = (node) => {
    if (hit) return
    if (ts.isIdentifier(node) && paramNames.has(node.text)) { hit = true; return }
    node.forEachChild(walk)
  }
  walk(condition)
  return hit
}

/**
 * 收集一棵子树里引用到的**变量名**。
 * 属性访问只取最左边那个真变量（`navigationLockedRef.current` → 只收 navigationLockedRef），
 * 否则满仓 ref 都带个 `.current`，会被当成「同一个变量」而误判成目标守卫。
 */
function identifiersIn(node) {
  const names = new Set()
  const walk = (n) => {
    if (ts.isPropertyAccessExpression(n)) { walk(n.expression); return } // 只走左侧，跳过属性名
    if (ts.isIdentifier(n)) { names.add(n.text); return }
    n.forEachChild(walk)
  }
  walk(node)
  return names
}

/** 函数体是不是「整体就是一条目标守卫」；是则返回 { condition, action }。 */
function wholeBodyGuard(fn) {
  if (!fn.body || !ts.isBlock(fn.body)) return null
  const statements = fn.body.statements
  if (statements.length === 0) return null
  const first = statements[0]
  if (!ts.isIfStatement(first) || first.elseStatement) return null

  // 形状一：整个 body 就只有这一条 if（本次 bug 的形状）——守卫为假时什么都不做。
  if (statements.length === 1) return { condition: first.expression, action: first.thenStatement }

  // 形状二：首句是**裸** return 的早退守卫（`if (!x) return`）。
  // 带参数的 return（如 `return event.stopPropagation()`）不算——那是有效果的，不是静默失效。
  const thenPart = first.thenStatement
  const bare =
    (ts.isReturnStatement(thenPart) && !thenPart.expression) ||
    (ts.isBlock(thenPart) &&
      thenPart.statements.length === 1 &&
      ts.isReturnStatement(thenPart.statements[0]) &&
      !thenPart.statements[0].expression)
  if (!bare) return null
  // 早退守卫的「动作」= 守卫之后的全部语句。
  const rest = statements.slice(1)
  if (rest.length === 0) return null
  return { condition: first.expression, action: rest }
}

/**
 * 目标守卫 = 守卫的那个变量**被当参数传给了动作**（`if (id) doSomething(id, …)`）——
 * 拿不到它就做不了这件事，所以拿不到时控件必须禁用。
 *
 * 只认「call 的实参」这一种用法，是为了区分开另一类：在动作里**再判一次同一把锁**
 * （3D 视口那个 `if (navigationLockedRef.current) return … setTimeout(() => { if (!navigationLockedRef.current) … })`）
 * ——那是锁的复检，不是「用目标」，控件也不该因此禁用。
 */
function isTargetGuard(condition, action) {
  const guarded = identifiersIn(condition)
  if (guarded.size === 0) return false
  const nodes = Array.isArray(action) ? action : [action]
  let hit = false
  const walk = (n) => {
    if (hit) return
    if (ts.isCallExpression(n)) {
      for (const arg of n.arguments) {
        // 不跨进嵌套函数体：`setTimeout(() => { if (!lockRef.current) … })` 传的是回调、不是目标。
        if (ts.isArrowFunction(arg) || ts.isFunctionExpression(arg)) continue
        for (const name of identifiersIn(arg)) if (guarded.has(name)) { hit = true; return }
      }
    }
    n.forEachChild(walk)
  }
  for (const node of nodes) walk(node)
  return hit
}

const offenders = []
for (const file of sourceFiles(SRC)) {
  const text = fs.readFileSync(file, 'utf8')
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const rel = path.relative(ROOT, file)

  const visit = (node) => {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const attrs = node.attributes.properties
      const hasDisabled = attrs.some(
        (a) => ts.isJsxAttribute(a) && (a.name.getText() === 'disabled' || a.name.getText() === 'aria-disabled'),
      )
      if (!hasDisabled) {
        for (const attr of attrs) {
          if (!ts.isJsxAttribute(attr) || !HANDLERS.has(attr.name.getText())) continue
          const init = attr.initializer
          if (!init || !ts.isJsxExpression(init) || !init.expression) continue
          const fn = init.expression
          if (!ts.isArrowFunction(fn) && !ts.isFunctionExpression(fn)) continue
          const guard = wholeBodyGuard(fn)
          if (!guard) continue
          const { condition, action } = guard
          if (referencesParams(condition, parameterNames(fn))) continue // 事件判定，不是目标守卫
          if (!isTargetGuard(condition, action)) continue // 模式守卫，不是「拿不到目标」
          const line = sf.getLineAndCharacterOfPosition(attr.getStart(sf)).line + 1
          const key = [...ALLOWLIST.keys()].find((k) => k.startsWith(`${rel}:`))
          if (key) continue
          offenders.push({
            where: `${rel}:${line}`,
            handler: attr.name.getText(),
            guard: condition.getText(sf).replace(/\s+/g, ' ').slice(0, 70),
          })
        }
      }
    }
    node.forEachChild(visit)
  }
  visit(sf)
}

if (offenders.length > 0) {
  console.error('✗ 控件交互契约门岗未通过（设计系统 §4.1 C1）：')
  console.error('  下面这些控件的 handler 里有目标守卫，控件本身却没有 disabled —— 用户点了会静默失效。')
  console.error('  修法：守卫为假时给控件 disabled，并用 title 说清「为什么现在点不了」。')
  console.error('  禁用的 <button> 自身不触发 title，要用外层 <span title={原因} style={{display:"contents"}}> 包住')
  console.error('  （既有范式见 NodeGenerationComposer.tsx 的生成钮）。\n')
  for (const o of offenders) console.error(`  · ${o.where}  ${o.handler} 守卫: ${o.guard}`)
  process.exit(1)
}

console.log(`✓ 控件交互契约门岗通过：无「点了没反应」的控件（例外 ${ALLOWLIST.size} 条，均已写明理由）。`)
