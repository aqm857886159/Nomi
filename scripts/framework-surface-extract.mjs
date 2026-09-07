// 框架接触面门岗的两个抽取器（R29 第三份必交物）。判据在 framework-surface-lib.mjs，本文件只负责
// 把两边的事实机器化地读出来：
//
//   ① `declaredFields()` —— 用 TypeScript 编译器 API 读 `.d.ts`，把一个类型**真正公开的字段**抽出来。
//      为什么必须过 checker 而不是正则/纯语法：pi 的 `AgentHarnessTool` 是
//      `Omit<AgentTool<…>, "execute"> & { … }`，字段散在交叉类型、`Omit` 与基接口 `Tool` 三处。
//      正则抓 `interface X { … }` 会漏掉一大半，而**漏掉的字段在门岗里长得和「没有这个字段」一模一样**。
//
//   ② `scanAssignments()` —— 纯语法 AST 扫我们自己的代码，找「谁给这个字段赋了值、值是不是字面量」。
//      不过 checker：对 src/ + electron/ 建全量 Program 要几十秒，而这里要判的事情
//      （`executionMode: 'sequential'` 是不是字面量）纯语法就够。
//
// **锚点**是这个扫描器能用的原因。按字段名全仓瞎抓会被 `name` / `id` / `style` 淹没；
// 锚点把范围收到「我们真的在造这个框架形状」的那几处：JSX 元素名、类型标注、调用实参。
import fs from 'node:fs'
import path from 'node:path'
import ts from 'typescript'
import { fieldKey } from './framework-surface-lib.mjs'

const SOURCE_EXTENSIONS = /\.(tsx?|mts|cts)$/
const TEST_FILE = /\.(test|spec|node-test)\.[cm]?[jt]sx?$/
const SKIP_DIRECTORIES = new Set(['node_modules', 'dist', 'dist-electron', '.tmp', '.git'])

const PROGRAM_OPTIONS = {
  target: ts.ScriptTarget.ESNext,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  allowImportingTsExtensions: true,
  noEmit: true,
  skipLibCheck: true,
  strict: false,
}

const programs = new Map()

function programFor(absoluteDts) {
  let cached = programs.get(absoluteDts)
  if (!cached) {
    const program = ts.createProgram([absoluteDts], PROGRAM_OPTIONS)
    cached = { program, checker: program.getTypeChecker() }
    programs.set(absoluteDts, cached)
  }
  return cached
}

function exportedSymbol(checker, sourceFile, name) {
  const moduleSymbol = checker.getSymbolAtLocation(sourceFile)
  if (!moduleSymbol) return undefined
  return checker.getExportsOfModule(moduleSymbol).find((symbol) => symbol.getName() === name)
}

/** 剥到「真正带字段的那个形状」：`| undefined` 联合、`Promise<T>`、函数返回值，逐层脱掉。 */
function unwrap(checker, type, depth = 0) {
  if (!type || depth > 4) return type
  if (type.isUnion()) {
    const meaningful = type.types.filter((member) => !(member.flags & (ts.TypeFlags.Undefined | ts.TypeFlags.Null | ts.TypeFlags.Void)))
    if (meaningful.length === 1) return unwrap(checker, meaningful[0], depth + 1)
    const withProps = meaningful.find((member) => checker.getPropertiesOfType(member).length > 0)
    if (withProps) return unwrap(checker, withProps, depth + 1)
    return type
  }
  const symbolName = type.getSymbol()?.getName()
  if (symbolName === 'Promise') {
    const [inner] = checker.getTypeArguments(type) ?? []
    if (inner) return unwrap(checker, inner, depth + 1)
  }
  if (checker.getPropertiesOfType(type).length === 0) {
    const [signature] = checker.getSignaturesOfType(type, ts.SignatureKind.Call)
    if (signature) return unwrap(checker, checker.getReturnTypeOfSignature(signature), depth + 1)
  }
  return type
}

function propertyType(checker, symbol) {
  const declaration = symbol.valueDeclaration ?? symbol.declarations?.[0]
  if (!declaration) return undefined
  return checker.getTypeOfSymbolAtLocation(symbol, declaration)
}

/** 只留**这个包自己声明**的字段。`ReactFlowProps` 继承了 React 的 263 个 HTML 属性——
 *  那是 React 的接触面，不是 React Flow 的；混进来只会把真正该看的 122 个知识点淹掉。 */
function declaredHere(symbol, declaredIn) {
  return (symbol.declarations ?? []).some((declaration) => {
    const fileName = declaration.getSourceFile().fileName.split(path.sep).join('/')
    return declaredIn.some((prefix) => fileName.includes(prefix))
  })
}

/**
 * 抽一个登记类型的字段名。
 *
 * `type.kind`：`"type"`（默认，具名导出类型）或 `"callParameter"`（某个导出函数的第 N 个参数）。
 * `type.expand`：要下钻的字段路径（点号写法）。钩子的返回形状就靠它——
 *   `HookMap.before_tool` 的值是 `{ event, result }`，`result` 才是我们真正要交的那张裁决。
 *
 * 抽不到就抛：抽空了却放行，等于门岗静默失效（本仓最贵的一类失效）。
 */
export function declaredFields({ repoRoot, source, type }) {
  const absolute = path.join(repoRoot, source.dtsPath)
  if (!fs.existsSync(absolute)) throw new Error(`dtsPath 指不到文件：${source.dtsPath}`)
  const { program, checker } = programFor(absolute)
  const sourceFile = program.getSourceFile(absolute)
  if (!sourceFile) throw new Error(`TypeScript 读不到 ${source.dtsPath}`)
  const symbol = exportedSymbol(checker, sourceFile, type.name)
  if (!symbol) throw new Error(`${source.dtsPath} 没有导出 ${type.name}`)

  let rootType
  if ((type.kind ?? 'type') === 'callParameter') {
    const declaration = symbol.valueDeclaration ?? symbol.declarations?.[0]
    const [signature] = checker.getSignaturesOfType(checker.getTypeOfSymbolAtLocation(symbol, declaration), ts.SignatureKind.Call)
    if (!signature) throw new Error(`${type.name} 不是可调用的，取不到参数类型`)
    const parameter = signature.getParameters()[type.parameterIndex ?? 0]
    if (!parameter) throw new Error(`${type.name} 没有第 ${type.parameterIndex ?? 0} 个参数`)
    rootType = unwrap(checker, propertyType(checker, parameter))
  } else {
    rootType = checker.getDeclaredTypeOfSymbol(symbol)
  }

  const declaredIn = type.declaredIn ?? [`node_modules/${source.package}/`]
  const collect = (target, prefix) => {
    const names = []
    for (const property of checker.getPropertiesOfType(target)) {
      if (!declaredHere(property, declaredIn)) continue
      names.push(prefix ? `${prefix}.${property.getName()}` : property.getName())
    }
    return names
  }

  const fields = collect(rootType, '')
  const known = new Set(fields)
  for (const requested of type.expand ?? []) {
    if (!known.has(requested)) throw new Error(`${type.name}.expand 里的「${requested}」不是已抽到的字段`)
    let cursor = rootType
    for (const segment of requested.split('.')) {
      const property = checker.getPropertiesOfType(cursor).find((entry) => entry.getName() === segment)
      if (!property) { cursor = undefined; break }
      cursor = unwrap(checker, propertyType(checker, property))
    }
    if (!cursor) throw new Error(`${type.name}.expand 的「${requested}」下钻失败`)
    // 下钻出来的形状常常是内联字面量（声明位置就在本包里），但也可能引到别的包；
    // 这里不再按 declaredIn 过滤——**已经点名要下钻的东西，就是要看全**。
    for (const property of checker.getPropertiesOfType(cursor)) {
      const name = `${requested}.${property.getName()}`
      if (!known.has(name)) { fields.push(name); known.add(name) }
    }
  }
  if (fields.length === 0) throw new Error(`${type.name} 抽到 0 个字段（类型没解析开，或 declaredIn 把全部过滤掉了）`)
  return fields
}

// ─── 我们自己的代码：锚点扫描 ────────────────────────────────────────────────

const LITERAL_KINDS = new Set([
  ts.SyntaxKind.StringLiteral,
  ts.SyntaxKind.NumericLiteral,
  ts.SyntaxKind.BigIntLiteral,
  ts.SyntaxKind.TrueKeyword,
  ts.SyntaxKind.FalseKeyword,
  ts.SyntaxKind.NullKeyword,
  ts.SyntaxKind.NoSubstitutionTemplateLiteral,
])

/** 字面量 = 「值和输入无关」。对象/数组只有在**元素全是字面量**时才算——
 *  `{ hideAttribution: true }` 是常量配置，`{ nodes }` 不是。 */
function isLiteralExpression(node) {
  if (!node) return true // JSX 的 `onlyRenderVisibleElements`（无 initializer）就是常量 true
  if (LITERAL_KINDS.has(node.kind)) return true
  if (ts.isPrefixUnaryExpression(node)) return isLiteralExpression(node.operand)
  if (ts.isJsxExpression(node)) return node.expression ? isLiteralExpression(node.expression) : true
  if (ts.isAsExpression(node) || ts.isSatisfiesExpression(node) || ts.isParenthesizedExpression(node)) {
    return isLiteralExpression(node.expression)
  }
  if (ts.isIdentifier(node) && node.text === 'undefined') return true
  if (ts.isArrayLiteralExpression(node)) return node.elements.every((element) => isLiteralExpression(element))
  if (ts.isObjectLiteralExpression(node)) {
    return node.properties.every((property) => ts.isPropertyAssignment(property) && isLiteralExpression(property.initializer))
  }
  return false
}

function positionOf(sourceFile, node) {
  return sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1
}

function shortText(node, sourceFile) {
  if (node === undefined) return 'true'
  // JSX 的 `{...}` 只是把表达式包进属性位置，不是值的一部分。留着它，登记表里就得写成
  // `{false}`，而同一个 `false` 在对象字面量那边写作 `false`——同一个值两种写法。
  const target = ts.isJsxExpression(node) && node.expression ? node.expression : node
  const text = target.getText(sourceFile).replace(/\s+/g, ' ').trim()
  return text.length > 90 ? `${text.slice(0, 87)}…` : text
}

/** 走一个对象字面量，记下 `field` 与（内联对象时）`field.child` 两级。 */
function walkObjectLiteral({ node, sourceFile, file, record, prefix = '', depth = 0 }) {
  if (depth > 2) return
  for (const property of node.properties) {
    if (ts.isSpreadAssignment(property)) {
      // `...(cond ? { prepareArguments } : {})` 是条件装配的常见写法，字段名就写在里面——
      // 整条跳过会让它在门岗眼里等于「没人赋值」，进而把一条真 derived 判成陈旧登记（假红）。
      // 所以下钻找展开式里的对象字面量；`...options` 这种没有字面量的仍然归不到名字上（已知盲点）。
      const collectNested = (candidate) => {
        if (ts.isObjectLiteralExpression(candidate)) {
          walkObjectLiteral({ node: candidate, sourceFile, file, record, prefix, depth })
          return
        }
        ts.forEachChild(candidate, collectNested)
      }
      collectNested(property.expression)
      continue
    }
    const nameNode = property.name
    if (!nameNode || !(ts.isIdentifier(nameNode) || ts.isStringLiteral(nameNode))) continue
    const name = prefix ? `${prefix}.${nameNode.text}` : nameNode.text
    if (ts.isShorthandPropertyAssignment(property)) {
      record(name, { file, line: positionOf(sourceFile, property), literal: false, text: shortText(property, sourceFile) })
      continue
    }
    if (ts.isMethodDeclaration(property)) {
      record(name, { file, line: positionOf(sourceFile, property), literal: false, text: `${name}() { … }` })
      continue
    }
    if (!ts.isPropertyAssignment(property)) continue
    const value = property.initializer
    record(name, {
      file, line: positionOf(sourceFile, property),
      literal: isLiteralExpression(value), text: shortText(value, sourceFile),
    })
    if (ts.isObjectLiteralExpression(value)) {
      walkObjectLiteral({ node: value, sourceFile, file, record, prefix: name, depth: depth + 1 })
    }
  }
}

function baseTypeName(typeNode) {
  if (!typeNode) return undefined
  const target = ts.isTypeReferenceNode(typeNode) ? typeNode.typeName : undefined
  if (!target) return undefined
  return ts.isQualifiedName(target) ? target.right.text : target.text
}

/**
 * 扫 `scope` 下的源码，按 `anchors` 找出对本类型字段的赋值点。
 * 返回 Map<fieldKey, sites[]>；同一个字段可能有多处（React Flow 那个 JSX 只有一处，工具工厂也只有一处，
 * 但门岗不假设唯一——多处时 derived/constant 的判定看的是「有没有任何一处是动态的」）。
 */
export function scanAssignments({ repoRoot, frameworkId, typeName, scope, anchors }) {
  const sites = new Map()
  if (!Array.isArray(anchors) || anchors.length === 0) return sites
  const record = (field, site) => {
    const key = fieldKey(frameworkId, typeName, field)
    const list = sites.get(key)
    if (list) list.push(site)
    else sites.set(key, [site])
  }
  for (const file of listSourceFiles(repoRoot, scope)) {
    const text = fs.readFileSync(path.join(repoRoot, file), 'utf8')
    const sourceFile = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
    const visit = (node) => {
      for (const anchor of anchors) {
        if (anchor.kind === 'jsxElement' && (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node))) {
          if (node.tagName.getText(sourceFile) !== anchor.name) continue
          for (const attribute of node.attributes.properties) {
            if (!ts.isJsxAttribute(attribute) || !ts.isIdentifier(attribute.name)) continue
            record(attribute.name.text, {
              file, line: positionOf(sourceFile, attribute),
              literal: isLiteralExpression(attribute.initializer),
              text: shortText(attribute.initializer, sourceFile),
            })
          }
        }
        if (anchor.kind === 'typeAnnotation') {
          const annotated = (ts.isVariableDeclaration(node) || ts.isPropertyDeclaration(node) || ts.isParameter(node))
            && baseTypeName(node.type) === anchor.name && node.initializer
          const asserted = (ts.isAsExpression(node) || ts.isSatisfiesExpression(node))
            && baseTypeName(node.type) === anchor.name
          const target = annotated ? node.initializer : asserted ? node.expression : undefined
          if (target && ts.isObjectLiteralExpression(target)) {
            walkObjectLiteral({ node: target, sourceFile, file, record })
          }
        }
        if (anchor.kind === 'callArgument' && ts.isCallExpression(node)) {
          if (node.expression.getText(sourceFile) !== anchor.name) continue
          const argument = node.arguments[anchor.argumentIndex ?? 0]
          if (argument && ts.isObjectLiteralExpression(argument)) {
            walkObjectLiteral({ node: argument, sourceFile, file, record })
          }
        }
      }
      ts.forEachChild(node, visit)
    }
    visit(sourceFile)
  }
  return sites
}

export function listSourceFiles(repoRoot, scope) {
  const files = []
  const walk = (dir) => {
    if (!fs.existsSync(dir)) return
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (SKIP_DIRECTORIES.has(entry.name)) continue
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (SOURCE_EXTENSIONS.test(entry.name) && !TEST_FILE.test(entry.name)) {
        files.push(path.relative(repoRoot, full).split(path.sep).join('/'))
      }
    }
  }
  for (const prefix of scope) walk(path.join(repoRoot, prefix))
  return files
}
