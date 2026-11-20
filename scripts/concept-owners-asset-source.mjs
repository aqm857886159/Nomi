// check:concept-owners 的一条形状探测：素材「算不算进项目、原件是哪份、来源记成什么」只由主进程素材库定（2026-11-20）。
//
// 主人之外认两类写法（整类，不认具体名字以外的写法就漏）：
//   ① sidecar-write：往 `.meta` 写（fs 写族 / 事务写，目标经字面量、模板、拼接、变量都算；写函数经别名、解构、
//      导入改名都算），或以任何形式拿到 sidecar 写函数 / meta 定稿 / 来源清洗（导入、改名、命名空间成员、动态导入解构、重导出）。
//   ② receipt-override：对主人回执（产回执调用的返回值、sidecar 读取）里的结论字段做属性赋值、Object.assign、展开后覆盖；
//      或一个对象字面量从回执取了身份（assetId / contentHash），却给别的结论字段填了不是只出自回执的值（混合回执）。
// 只扫生产代码（src、electron），测试与夹具不扫。
import ts from 'typescript'
import { isScannableSource, normalizePath, parseSource, PRODUCTION_ROOTS, rootOf } from './concept-owners-scan.mjs'

/** 素材库自己：定稿、写 sidecar、复用判定、生成两步发布都在这里。 */
export const ASSET_SOURCE_OWNER_FILES = new Set([
  'electron/assets/assetSourceEvidence.ts',
  'electron/assets/projectAssetStore.ts',
  'electron/assets/uploadContentStore.ts',
  'electron/assets/assetSidecar.ts',
  'electron/assets/generatedAssetStaging.ts',
])

/** 登记过理由的例外：文件 → 允许的形状。理由写在概念登记 asset.project-source-evidence.json。 */
export const ASSET_SOURCE_EXCEPTIONS = new Map([
  ['electron/assets/assetPreview.ts', new Set(['sidecar-write'])],
  ['electron/workspace/buildArtifactMigration.ts', new Set(['sidecar-write'])],
])

const SIDECAR_WRITERS = new Set(['writeAssetSidecarMeta', 'mergeAssetSidecarMeta', 'finalizeAssetMeta', 'sanitizeSourceEvidence', 'sanitizeAssetMetaForKind'])
const FS_WRITES = new Set(['writeFile', 'writeFileSync', 'appendFile', 'appendFileSync', 'rename', 'renameSync', 'copyFile', 'copyFileSync',
  'link', 'linkSync', 'symlink', 'symlinkSync', 'cp', 'cpSync', 'createWriteStream', 'open', 'openSync'])
/** 产回执的调用（主进程素材库的写口 + 渲染层桥与登记的两个包装）和 sidecar 读取。 */
export const ASSET_RECEIPT_PRODUCERS = new Set(['importLocalFile', 'importRemoteAsset', 'writeAsset', 'writeGeneratedAsset', 'copyAssetFile',
  'copyProjectAsset', 'moveAssetFile', 'storeAssetBytes', 'persistUploadBytes', 'persistUploadFile', 'publishVerifiedGeneratedAsset',
  'storedAssetRecord', 'importWorkbenchLocalAssetFile', 'importWorkbenchRemoteAssetUrl', 'importRemoteUrl', 'readAssetSidecarMeta'])
const RECEIPT_FIELDS = new Set(['sourceEvidence', 'usageStatus', 'contentType', 'contentHash', 'size', 'sizeBytes', 'url', 'relativePath', 'assetId'])
const IDENTITY_FIELDS = new Set(['assetId', 'contentHash'])
const FAMILY = new Set([...SIDECAR_WRITERS, ...ASSET_RECEIPT_PRODUCERS, 'meta'])
const IDENTIFIER_TOKEN = /[A-Za-z_$][A-Za-z0-9_$]*/g

function mentionsAny(text, wanted) {
  for (const match of text.matchAll(IDENTIFIER_TOKEN)) if (wanted.has(match[0])) return true
  return false
}

function unwrap(expression) {
  let node = expression
  while (node && (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isNonNullExpression(node)
    || ts.isTypeAssertionExpression(node) || ts.isAwaitExpression(node)
    || (typeof ts.isSatisfiesExpression === 'function' && ts.isSatisfiesExpression(node)))) node = node.expression
  return node
}

export function findAssetSourceBypass({ files, read }) {
  const found = []
  for (const file of files) {
    const rel = normalizePath(file)
    if (!isScannableSource(rel) || !PRODUCTION_ROOTS.includes(rootOf(rel)) || ASSET_SOURCE_OWNER_FILES.has(rel)) continue
    const text = read(rel)
    if (typeof text !== 'string' || !(mentionsAny(text, FAMILY) || text.includes('.meta'))) continue
    const allowed = ASSET_SOURCE_EXCEPTIONS.get(rel) ?? new Set()
    const source = parseSource(rel, text)
    const host = { getSourceFile: (name) => name === rel ? source : undefined, getDefaultLibFileName: () => '',
      writeFile() {}, getCurrentDirectory: () => '', getDirectories: () => [], fileExists: (name) => name === rel,
      readFile: (name) => name === rel ? text : undefined, getCanonicalFileName: (name) => name,
      useCaseSensitiveFileNames: () => true, getNewLine: () => '\n' }
    const checker = ts.createProgram([rel], { noResolve: true, noLib: true }, host).getTypeChecker()
    const member = (node) => ts.isPropertyAccessExpression(node) ? node.name.text
      : ts.isElementAccessExpression(node) && node.argumentExpression && ts.isStringLiteralLike(node.argumentExpression) ? node.argumentExpression.text : ''
    const symbolOf = (node) => ts.isShorthandPropertyAssignment(node.parent) && node.parent.name === node
      ? checker.getShorthandAssignmentValueSymbol(node.parent) : checker.getSymbolAtLocation(node)
    const writes = new Map()
    const collectWrites = (node) => {
      if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken && ts.isIdentifier(node.left)) {
        const symbol = checker.getSymbolAtLocation(node.left)
        if (symbol) { if (!writes.has(symbol)) writes.set(symbol, []); writes.get(symbol).push(node.right) }
      }
      ts.forEachChild(node, collectWrites)
    }
    collectWrites(source)
    /** 一个标识符的全部来历：声明的初值、解构的源、之后的赋值。参数没有来历（= 不知道）。 */
    const origins = (identifier) => {
      const symbol = symbolOf(identifier)
      if (!symbol) return []
      const out = []
      for (const declaration of symbol.declarations ?? []) {
        if (ts.isVariableDeclaration(declaration) && declaration.initializer) out.push({ node: declaration.initializer })
        else if (ts.isBindingElement(declaration)) {
          let pattern = declaration.parent
          while (pattern && !ts.isVariableDeclaration(pattern)) pattern = pattern.parent
          if (pattern?.initializer) out.push({ node: pattern.initializer, picked: (declaration.propertyName ?? declaration.name).getText(source) })
        } else if (ts.isImportSpecifier(declaration)) out.push({ imported: (declaration.propertyName ?? declaration.name).text })
      }
      for (const right of writes.get(symbol) ?? []) out.push({ node: right })
      return out
    }
    const calleeName = (expression, seen = new Set()) => {
      const node = unwrap(expression)
      if (!node || seen.has(node)) return ''
      seen.add(node)
      if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) return member(node)
      if (!ts.isIdentifier(node)) return ''
      for (const origin of origins(node)) {
        if (origin.imported) return origin.imported
        if (origin.picked) return origin.picked
        const name = calleeName(origin.node, seen)
        if (name) return name
      }
      return node.text
    }
    const metaPath = (expression, seen = new Set()) => {
      const node = unwrap(expression)
      if (!node || seen.has(node)) return false
      seen.add(node)
      if (ts.isStringLiteralLike(node)) return /\.meta$/.test(node.text)
      if (ts.isTemplateExpression(node)) return /\.meta$/.test(node.templateSpans.at(-1)?.literal.text ?? '')
      if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) return metaPath(node.right, seen)
      if (ts.isCallExpression(node) && ['join', 'resolve', 'format'].includes(member(node.expression))) return node.arguments.length > 0 && metaPath(node.arguments.at(-1), seen)
      if (ts.isConditionalExpression(node)) return metaPath(node.whenTrue, seen) || metaPath(node.whenFalse, seen)
      if (ts.isIdentifier(node)) return origins(node).some((origin) => origin.node && !origin.picked && metaPath(origin.node, seen))
      return false
    }
    /** 值出自主人回执（产回执调用 / sidecar 读取），或是它的成员。 */
    const receipt = (expression, seen = new Set()) => {
      const node = unwrap(expression)
      if (!node || seen.has(node)) return false
      seen.add(node)
      if (ts.isCallExpression(node)) {
        if (ASSET_RECEIPT_PRODUCERS.has(calleeName(node.expression))) return true
        return member(node.expression) === 'parse' && node.arguments.some((argument) => readsMeta(argument))
      }
      if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) return receipt(node.expression, seen)
      if (ts.isConditionalExpression(node)) return receipt(node.whenTrue, seen) && receipt(node.whenFalse, seen)
      if (ts.isIdentifier(node)) return origins(node).some((origin) => origin.node && receipt(origin.node, new Set(seen)))
      return false
    }
    const readsMeta = (expression) => {
      const node = unwrap(expression)
      return !!node && ts.isCallExpression(node) && /^readFile(?:Sync)?$/.test(member(node.expression) || calleeName(node.expression)) && metaPath(node.arguments[0])
    }
    /** 值只由回执和字面量拼成（helper 只吃回执也算）；混进别的来历（参数、扩展名推断、导入前的大小）就不是。 */
    const pure = (expression, seen = new Set()) => {
      const node = unwrap(expression)
      if (!node) return true
      if (seen.has(node)) return true
      seen.add(node)
      if (ts.isStringLiteralLike(node) || ts.isNumericLiteral(node) || node.kind === ts.SyntaxKind.TrueKeyword
        || node.kind === ts.SyntaxKind.FalseKeyword || node.kind === ts.SyntaxKind.NullKeyword) return true
      if (ts.isIdentifier(node) && node.text === 'undefined') return true
      if (receipt(node)) return true
      if (ts.isIdentifier(node)) {
        const list = origins(node)
        return list.length > 0 && list.every((origin) => origin.node && pure(origin.node, seen))
      }
      if (ts.isConditionalExpression(node)) return pure(node.whenTrue, seen) && pure(node.whenFalse, seen)
      if (ts.isBinaryExpression(node)) return pure(node.left, seen) && pure(node.right, seen)
      if (ts.isTypeOfExpression(node) || ts.isPrefixUnaryExpression(node)) return true
      if (ts.isCallExpression(node)) {
        const method = ts.isPropertyAccessExpression(node.expression)
        return (method ? pure(node.expression.expression, seen) : node.arguments.length > 0) && node.arguments.every((argument) => pure(argument, seen))
      }
      if (ts.isTemplateExpression(node)) return node.templateSpans.every((span) => pure(span.expression, seen))
      return false
    }
    const reported = new Set()
    const report = (node, shape) => {
      if (allowed.has(shape)) return
      const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1
      const identity = `${line}:${shape}`
      if (reported.has(identity)) return
      reported.add(identity)
      found.push({ path: rel, line, shape, value: node.getText(source).replace(/\s+/g, ' ').slice(0, 120) })
    }
    const propertyName = (node) => node.name && (ts.isIdentifier(node.name) || ts.isStringLiteralLike(node.name)) ? node.name.text : ''
    const visit = (node) => {
      // ① 拿到 sidecar 写函数 / 定稿 / 清洗：导入、重导出、命名空间成员、解构（含动态导入）。
      if ((ts.isImportSpecifier(node) || ts.isExportSpecifier(node)) && SIDECAR_WRITERS.has((node.propertyName ?? node.name).text)) report(node, 'sidecar-write')
      if (ts.isBindingElement(node) && SIDECAR_WRITERS.has((node.propertyName ?? node.name).getText(source))) report(node, 'sidecar-write')
      if ((ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) && SIDECAR_WRITERS.has(member(node))) report(node, 'sidecar-write')
      // ① 往 .meta 写。
      if (ts.isCallExpression(node) && FS_WRITES.has(calleeName(node.expression)) && node.arguments.slice(0, 2).some((argument) => metaPath(argument))) report(node, 'sidecar-write')
      // ② 属性赋值 / 复合赋值覆盖回执里的结论字段。
      if (ts.isBinaryExpression(node) && node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment && node.operatorToken.kind <= ts.SyntaxKind.LastAssignment
        && RECEIPT_FIELDS.has(member(node.left)) && receipt(node.left.expression)) report(node, 'receipt-override')
      // ② Object.assign(回执, …)。
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'assign'
        && ts.isIdentifier(node.expression.expression) && node.expression.expression.text === 'Object'
        && node.arguments.length > 1 && receipt(node.arguments[0])) report(node, 'receipt-override')
      if (ts.isObjectLiteralExpression(node)) {
        let spreadReceipt = false
        let identity = false
        for (const property of node.properties) {
          if (ts.isSpreadAssignment(property)) { if (receipt(property.expression)) spreadReceipt = true; continue }
          const name = propertyName(property)
          const value = ts.isPropertyAssignment(property) ? property.initializer : ts.isShorthandPropertyAssignment(property) ? property.name : null
          if (!value || !RECEIPT_FIELDS.has(name)) continue
          // ② 展开回执后再覆盖它的结论字段（原样取回执自己的同名字段不算）。
          if (spreadReceipt && !receipt(value)) report(property, 'receipt-override')
          if (IDENTITY_FIELDS.has(name) && receipt(value)) identity = true
        }
        // ② 混合回执：身份取自回执，别的结论字段却掺了回执以外的来历。
        if (identity) {
          for (const property of node.properties) {
            const name = propertyName(property)
            const value = ts.isPropertyAssignment(property) ? property.initializer : ts.isShorthandPropertyAssignment(property) ? property.name : null
            if (value && RECEIPT_FIELDS.has(name) && !IDENTITY_FIELDS.has(name) && !pure(value)) report(property, 'receipt-mixed')
          }
        }
      }
      ts.forEachChild(node, visit)
    }
    visit(source)
  }
  return found.sort((left, right) => `${left.path}:${left.line}`.localeCompare(`${right.path}:${right.line}`))
}
