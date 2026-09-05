// i18n **键引用解析门岗**(2026-09-01)。
//
// 抓的是一类 parity/可见文案硬零/typecheck **三道都漏**的病:
//   组件 `t('sidebar.workflows')` 引用了一个**两边词典都不存在**的键 → i18next 找不到,
//   直接把**原始 key 字符串**渲染到界面上(`sidebar.workflows` 长得像英文,中文界面里一眼看不出)。
//
// 为什么现有三道拦不住:
//   ① check:i18n-key-parity 查的是 zh↔en **对称**(两边键集合一致)。而「两边都缺同一个键」
//      恰好是**平衡**的——parity 全绿。2026-09-01 实测:sidebar.workflows / sidebar.workflowLibrary /
//      sidebar.resize 三个键 zh=false en=false,parity 一个都报不出来。
//   ② check:i18n 可见文案硬零查的是「源码里有没有裸中文字面量」。raw key 是英文 ASCII,一个汉字没有,
//      照样绿。
//   ③ tsc:renderer 的 `t` 虽然 `CustomTypeOptions.resources = typeof zhCN`,但这版 i18next 的 TFunction
//      对未知点分键**回落 string**、不报类型错(2026-09-01 实测:上面三个坏引用 tsc 全绿,exit 0)。
//      于是类型系统这道也漏。
//
// 根治:**静态提取 src/ 全部翻译引用,逐个对照真实 resources 树验证可解析**;解析不到 = 红,输出 file:line。
// 与 electron 侧的 desktopT 不同——那边 key 是 `DesktopTranslationKey` 字面量联合,写错 key 直接是编译错,
// tsc 拦得住;renderer 这边的 `as 'literal'` 断言把类型检查绕过去了,才需要这道运行前的解析校验补上。
//
// 动态键(模板拼接 `t(`prefix.${x}`)`)走**显式前缀注册表** DYNAMIC_KEY_PREFIXES:每条前缀必须写清
//   ① 为什么是动态的 ② 运行时可能取到的成员从哪来(枚举来源)。裸动态键(前缀不在注册表)= 红。
// 前缀在注册表 → 校验该前缀在树里确实是一棵**子树**(有后代键),防「注册了一个根本不存在的前缀」。
//
// 加规则先验它会红(R17):拿 sidebar.workflows 场景做阳性对照——临时把该键从 sidebar 命名空间删掉,
// 确认门岗报红并打印 file:line,再恢复。见 docs/engineering-rules.md R15 节。

import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import ts from 'typescript'
import { zhCN, en } from '../src/i18n/resources'
import { DYNAMIC_KEY_PREFIXES, type DynamicPrefix } from './lib/i18nDynamicKeyPrefixes'

const ROOT = process.cwd()
const SRC_ROOT = path.join(ROOT, 'src')
const REPORT = process.argv.includes('--report')

// ── 真实 resource 树(渲染层单一 default namespace,useTranslation() 全为裸调用、无 keyPrefix) ──
// 与 check-i18n-key-parity 同一套 flatten:叶子(string)记全路径,内部节点记为「有后代」。
type Tree = { leaves: Set<string>; subtrees: Set<string> }
function buildTree(node: unknown, prefix: string, tree: Tree): void {
  if (typeof node === 'string') {
    if (prefix) tree.leaves.add(prefix)
    return
  }
  if (node && typeof node === 'object') {
    if (prefix) tree.subtrees.add(prefix)
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      buildTree(value, prefix ? `${prefix}.${key}` : key, tree)
    }
  }
}

const zhTree: Tree = { leaves: new Set(), subtrees: new Set() }
const enTree: Tree = { leaves: new Set(), subtrees: new Set() }
buildTree(zhCN, '', zhTree)
buildTree(en, '', enTree)

// i18next 复数后缀:`t('key', { count })` 会解析到 `key_one` / `key_other` 等,基名本身**不作为叶子存在**。
// (spend.cost.text 就只有 text_one/text_other——调用 t('...text',{count}) 完全合法,但基名不是叶子。)
// 故判定「可解析」时,基名不在也算解析成功——只要任一复数变体在。CLDR 全部类别都覆盖上。
const PLURAL_SUFFIXES = ['_zero', '_one', '_two', '_few', '_many', '_other']
function hasPluralLeaf(tree: Tree, key: string): boolean {
  return PLURAL_SUFFIXES.some((suffix) => tree.leaves.has(`${key}${suffix}`))
}

// 一个 key 可解析 = 在 zh 或 en 任一树里是叶子(或有复数变体叶子)。
// (parity 门岗保证两边对称;这里对两边取并集,是为了在 parity 尚未跑到时也能独立成立、并让报错聚焦
//  「谁都没有」这种最硬的坏引用——单边缺失由 parity 专管,不在这道重复报。)
function resolvesAsLeaf(key: string): boolean {
  return (
    zhTree.leaves.has(key) ||
    enTree.leaves.has(key) ||
    hasPluralLeaf(zhTree, key) ||
    hasPluralLeaf(enTree, key)
  )
}

function resolvesAsLeafInLocale(tree: Tree, key: string): boolean {
  return tree.leaves.has(key) || hasPluralLeaf(tree, key)
}
// 一个前缀可解析 = 在任一树里是「有后代的子树」。
function resolvesAsSubtree(prefix: string): boolean {
  return zhTree.subtrees.has(prefix) || enTree.subtrees.has(prefix)
}

// 定义住 scripts/lib/i18nDynamicKeyPrefixes.ts(与反向死键门岗 check-i18n-dead-keys 共用同一份;
// 抄两份必漂移——删一条前缀后正向红了改这份、反向那份还留着,就会把活键判死并删掉)。
// 本门岗对注册表的用法:① 校验每条前缀在 resources 树里真实存在(防假注册)② 判定动态键是否在册。

// 前缀合法性(防「假注册」——注册了一条 resources 里其实不存在的前缀):
//   · subtree 条目:前缀本身必须是「有后代的子树」。
//   · concat 条目:枚举的每个 prefix+suffix 必须是叶子(直接验到具体键)。
type StaleRegistration = { prefix: string; why: string; reason: string }
const staleRegisteredPrefixes: StaleRegistration[] = []
for (const entry of DYNAMIC_KEY_PREFIXES) {
  if (entry.kind === 'concat') {
    const missing = entry.suffixes.filter((suffix) => !resolvesAsLeaf(`${entry.prefix}${suffix}`))
    if (missing.length > 0) {
      staleRegisteredPrefixes.push({ prefix: entry.prefix, why: entry.why, reason: `concat 后缀无对应叶子: ${missing.map((s) => entry.prefix + s).join(', ')}` })
    }
  } else {
    if (!resolvesAsSubtree(entry.prefix)) {
      staleRegisteredPrefixes.push({ prefix: entry.prefix, why: entry.why, reason: '前缀在 resources 树里不是子树' })
    }
    if (entry.members) {
      const duplicates = entry.members.filter((member, index) => entry.members.indexOf(member) !== index)
      if (entry.members.length === 0) {
        staleRegisteredPrefixes.push({ prefix: entry.prefix, why: entry.why, reason: '成员来源为空，无法证明动态键覆盖范围' })
      }
      if (duplicates.length > 0) {
        staleRegisteredPrefixes.push({ prefix: entry.prefix, why: entry.why, reason: `成员来源重复: ${[...new Set(duplicates)].join(', ')}` })
      }
      for (const member of entry.members) {
        const key = `${entry.prefix}.${member}`
        const missingLocales = [
          !resolvesAsLeafInLocale(zhTree, key) ? 'zh-CN' : '',
          !resolvesAsLeafInLocale(enTree, key) ? 'en' : '',
        ].filter(Boolean)
        if (missingLocales.length > 0) {
          staleRegisteredPrefixes.push({
            prefix: entry.prefix,
            why: entry.why,
            reason: `成员缺少译文叶子: ${key} (${missingLocales.join('、')})`,
          })
        }
      }
    }
  }
}

// 动态键匹配:concat 条目按「前缀是拼接起点」判定(head 去掉尾点后 === concat.prefix);
// subtree 条目按「前缀相等」判定。concat 优先(它的 prefix 更长、更具体)。
function matchDynamic(staticPrefix: string): DynamicPrefix | undefined {
  const concat = DYNAMIC_KEY_PREFIXES.find((e) => e.kind === 'concat' && e.prefix === staticPrefix)
  if (concat) return concat
  return DYNAMIC_KEY_PREFIXES.find((e) => e.kind !== 'concat' && e.prefix === staticPrefix)
}

// ── 源码扫描 ──
type Finding = { file: string; line: number; kind: string; detail: string }

function isSourceFile(fileName: string): boolean {
  const relative = path.relative(ROOT, fileName).replaceAll('\\', '/')
  return (
    !relative.includes('/__tests__/') &&
    !/\.(?:test|spec|stories)\.[cm]?[jt]sx?$/.test(relative) &&
    // 词典本身与其类型声明不算「引用」。
    relative !== 'src/i18n/resources.ts' &&
    !relative.startsWith('src/i18n/locales/')
  )
}

// 取模板字面量的静态前缀:head 文本直到第一个 ${…}。`t(`a.b.${x}`)` → 'a.b'(去掉尾随的点)。
// 若 head 为空(键完全从变量拼,如 `t(`${a}.${b}`)`)→ 返回 null,由调用方按「无静态前缀」报红。
//
// 例外:`t(`${key}.label`)` 这种「head 为空、首段是一个引用了模板字面量 const 的标识符」——
// 顺着那个 const 的初始化模板取它的静态前缀,再接上本模板 head 之后的第一段静态文本。
// (CreationPromptPicker 的 `const key = `creationAi.mode.${id}`` 就是这形状:真实键是
//  `creationAi.mode.${id}.label`,静态前缀应是 `creationAi.mode`。)不做更深的常量折叠——只这一跳,
// 覆盖现存写法即可,再深就该改成静态键或直接注册前缀。
// 剥掉 `as const` / `as X` / 括号,拿到里面真正的表达式。
function unwrapExpression(node: ts.Expression): ts.Expression {
  let current = node
  while (ts.isAsExpression(current) || ts.isParenthesizedExpression(current) || ts.isTypeAssertionExpression(current)) {
    current = current.expression
  }
  return current
}

function resolveConstTemplatePrefix(sourceFile: ts.SourceFile, name: string): string | null {
  let found: string | null = null
  const walk = (node: ts.Node): void => {
    if (
      found === null &&
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === name &&
      node.initializer
    ) {
      const init = unwrapExpression(node.initializer) // `const key = `…` as const` 的 initializer 是 AsExpression。
      if (ts.isTemplateExpression(init)) {
        const head = init.head.text
        if (head) found = head.replace(/\.+$/, '')
      }
    }
    ts.forEachChild(node, walk)
  }
  walk(sourceFile)
  return found
}

function staticPrefixOfTemplate(node: ts.TemplateExpression, sourceFile: ts.SourceFile): string | null {
  const head = node.head.text
  if (head) return head.replace(/\.+$/, '') // 去掉尾随点:'antigravity.state.' → 'antigravity.state'。
  // head 为空:`${ident}...` —— 若首段插值是引用某 const 模板的标识符,顺藤取其前缀。
  const firstSpan = node.templateSpans[0]
  if (firstSpan && ts.isIdentifier(firstSpan.expression)) {
    return resolveConstTemplatePrefix(sourceFile, firstSpan.expression.text)
  }
  return null
}

// 判断一个调用是不是翻译函数调用:`t(...)` 或 `i18n.t(...)` / `<x>.t(...)`(方法名为 t)。
function isTranslationCall(node: ts.CallExpression): boolean {
  const callee = node.expression
  if (ts.isIdentifier(callee)) return callee.text === 't'
  if (ts.isPropertyAccessExpression(callee)) return callee.name.text === 't'
  return false
}

function lineOf(sourceFile: ts.SourceFile, node: ts.Node): number {
  return sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1
}

function scanFile(fileName: string): Finding[] {
  const sourceText = fs.readFileSync(fileName, 'utf8')
  const sourceFile = ts.createSourceFile(
    fileName,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    fileName.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  )
  const relative = path.relative(ROOT, fileName).replaceAll('\\', '/')
  const findings: Finding[] = []

  function checkStaticKey(key: string, line: number, kind: string): void {
    // `i18n:` 前缀由 chunkBoundary 在渲染时 slice 掉再 t();这里已在调用方剥离,传进来的是纯 key。
    if (key === '') return // 空 key(如 chunkBoundary 里 `'i18n:'` 这个前缀常量本身,slice 后为空)——不是引用。
    if (resolvesAsLeaf(key)) return
    // 引用了一个「有后代的子树」而非叶子(如 t('sidebar') 指向对象)——i18next 会返回 [object Object]/键本身,
    // 同样是坏引用。
    if (resolvesAsSubtree(key)) {
      findings.push({ file: relative, line, kind: `${kind}-points-at-subtree`, detail: key })
      return
    }
    findings.push({ file: relative, line, kind, detail: key })
  }

  function checkDynamicPrefix(prefix: string | null, line: number, raw: string): void {
    if (prefix === null) {
      findings.push({ file: relative, line, kind: 'dynamic-no-static-prefix', detail: raw })
      return
    }
    if (!matchDynamic(prefix)) {
      findings.push({ file: relative, line, kind: 'dynamic-unregistered-prefix', detail: `${raw}  (static prefix: ${prefix})` })
    }
    // 已注册前缀的「前缀/后缀存在性」由 staleRegisteredPrefixes 统一校验,不逐调用点重复报。
  }

  function visit(node: ts.Node): void {
    // ① `'i18n:...'` 字符串字面量(chunkBoundary label)——渲染时会 i18n.t(slice('i18n:'.length))。
    if ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) && node.text.startsWith('i18n:')) {
      checkStaticKey(node.text.slice('i18n:'.length), lineOf(sourceFile, node), 'chunk-label')
    }

    // ② 翻译函数调用 t(...) / i18n.t(...)
    if (ts.isCallExpression(node) && isTranslationCall(node) && node.arguments.length > 0) {
      const arg = node.arguments[0]
      if (ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg)) {
        checkStaticKey(arg.text, lineOf(sourceFile, arg), 't-call')
      } else if (ts.isTemplateExpression(arg)) {
        checkDynamicPrefix(staticPrefixOfTemplate(arg, sourceFile), lineOf(sourceFile, arg), arg.getText(sourceFile))
      }
      // 其它形态(变量键 `t(keyVar)`、条件表达式 `t(a ? 'x' : 'y')`)——条件表达式拆两支查:
      else if (ts.isConditionalExpression(arg)) {
        for (const branch of [arg.whenTrue, arg.whenFalse]) {
          if (ts.isStringLiteral(branch) || ts.isNoSubstitutionTemplateLiteral(branch)) {
            checkStaticKey(branch.text, lineOf(sourceFile, branch), 't-call')
          } else if (ts.isTemplateExpression(branch)) {
            checkDynamicPrefix(staticPrefixOfTemplate(branch, sourceFile), lineOf(sourceFile, branch), branch.getText(sourceFile))
          }
        }
      }
      // 纯变量键(无字面量可查)静默跳过——无法静态判定,且这些点极少;真要覆盖需运行时插桩,超出本门岗范围。
    }

    ts.forEachChild(node, visit)
  }

  visit(sourceFile)
  return findings
}

const files = ts.sys.readDirectory(SRC_ROOT, ['.ts', '.tsx'], undefined, undefined).filter(isSourceFile)
const findings = files.flatMap(scanFile)

// 稳定排序,报告可读。
findings.sort((a, b) => a.file.localeCompare(b.file, 'en') || a.line - b.line || a.detail.localeCompare(b.detail, 'en'))

if (REPORT) {
  console.log(`Scanned ${files.length} source files; ${zhTree.leaves.size} resolvable keys.`)
  console.log(`Registered dynamic prefixes: ${DYNAMIC_KEY_PREFIXES.length}`)
  console.log(`Unresolved references: ${findings.length}`)
  for (const f of findings) console.log(`  ${f.file}:${f.line} [${f.kind}] ${f.detail}`)
  if (staleRegisteredPrefixes.length > 0) {
    console.log(`Stale dynamic registrations: ${staleRegisteredPrefixes.length}`)
    for (const p of staleRegisteredPrefixes) console.log(`  - ${p.prefix} (${p.reason})`)
  }
  process.exit(0)
}

const problems = findings.length + staleRegisteredPrefixes.length
if (problems === 0) {
  console.log(
    `i18n key-ref gate passed (${files.length} files scanned, ${zhTree.leaves.size} keys, ${DYNAMIC_KEY_PREFIXES.length} dynamic prefixes; every reference resolves)`,
  )
  process.exit(0)
}

console.error(`i18n key-ref gate failed: ${problems} problem(s)`)
if (findings.length > 0) {
  console.error(`\nUnresolvable translation references (would render the raw key on screen):`)
  for (const f of findings) {
    if (f.kind === 'dynamic-unregistered-prefix') {
      console.error(`- ${f.file}:${f.line}  未注册的动态键前缀 → ${f.detail}`)
    } else if (f.kind === 'dynamic-no-static-prefix') {
      console.error(`- ${f.file}:${f.line}  动态键没有静态前缀(整个 key 从变量拼)→ ${f.detail}`)
    } else if (f.kind.endsWith('-points-at-subtree')) {
      console.error(`- ${f.file}:${f.line}  引用指向对象子树而非叶子文案 → "${f.detail}"`)
    } else {
      console.error(`- ${f.file}:${f.line}  [${f.kind}] "${f.detail}" —— 两个词典都没有这个键`)
    }
  }
  console.error(
    `\n  → 修法:把键补进它真正该住的命名空间(zh + en 同时),或改用已存在的键;` +
      `动态键把静态前缀连同「为什么动态 + 枚举来源」加进 scripts/check-i18n-key-refs.ts 的 DYNAMIC_KEY_PREFIXES。`,
  )
}
if (staleRegisteredPrefixes.length > 0) {
  console.error(`\n注册表里有失效前缀或成员(等于假注册):`)
  for (const p of staleRegisteredPrefixes) console.error(`- ${p.prefix}  —— ${p.reason}\n    (${p.why})`)
  console.error(`  → 该前缀词条可能被删/改名;更新 DYNAMIC_KEY_PREFIXES 或补回词条。`)
}
process.exit(1)
