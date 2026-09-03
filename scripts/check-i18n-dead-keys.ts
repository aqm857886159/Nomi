// i18n **死键门岗**(2026-09-01)——正向门岗 check-i18n-key-refs 的**反向**。
//
// 正向问「每个引用都能解析到键吗」(坏引用 → 界面渲染出原始 key);
// 本门岗问反过来的那半:「每个键都还有人引用吗」——**没人引用的键就是死词条**。
// 它让词典虚胖、翻译时白翻一遍、改文案时改到根本不显示的地方,而 parity 与正向门岗都拦不住:
// 两边对称地留着同一条死键 = parity 眼里的平衡;没有任何引用 = 正向压根不会去查它。
//
// ── 为什么这道必须比正向**保守得多** ──
// 两个方向的误判代价**不对称**:
//   · 漏判(死键没扫出来)= 词典多留一条,无害。
//   · 误判(活键被判死 → 删掉)= 线上界面渲染出原始 key,**用户可见的破**。
// 所以引用采集是**召回优先**:宁可把可能的引用都算上、少报几个死键,也绝不为了「扫得干净」去猜。
//
// ── 四条采集规则(每条对应一类正向门岗看不见、但确实构成引用的写法) ──
// ① **全字面量池,不限于 t() 实参**。正向只认 `t('a.b')` 的第一个实参;但键常常先存进常量再传进去:
//      `const TABS = [{ labelKey: 'settings.tab.models' }]` … `t(TABS[i].labelKey)`
//    正向遇到 `t(变量)` 是**静默跳过**的(无法静态判定);反向若也只看 t() 实参,
//    就会把 settings.tab.models 误判成死键。故:**源码任何位置**出现的字符串字面量,
//    只要等于一个真实键路径,就算引用。
// ② **字符串字面量类型也算**。`t(`p.${x}` as 'p.example')` 里的 'p.example' 长在**类型位置**,
//    不是表达式,但它恰恰证明「这个动态前缀是活的」。TS 的 forEachChild 会走进类型节点,
//    故 LiteralTypeNode 内的 StringLiteral 与普通字面量一并采到。
// ③ **动态前缀覆盖**。`t(`p.${x}`)` 的前缀 p 之下,运行时可能取到任意成员,静态看不见。
//    凡被前缀覆盖的叶子一律**不判死**(降级为 B 档另账)。前缀来源两处:
//    注册表 DYNAMIC_KEY_PREFIXES(与正向门岗**共用同一份定义**,scripts/lib/i18nDynamicKeyPrefixes.ts)
//    + 源码里实际出现的模板 head(**仓库全量扫,不限 t() 实参**——键拼好存进变量再传的写法同样要覆盖)。
// ④ **复数变体**。`t('a.text', { count })` 解析到 a.text_one/a.text_other,基名本身不是叶子。
//    故基名被引用 ⇒ 它的全部复数变体都活。
//
// ── 判定分档:只有 A 档允许删 ──
//   · **A 档(dead,高置信)**:没有任何字面量等于它,且**不在任何动态前缀覆盖范围内**——
//     没有任何静态或动态路径能到达它。这才是「可证明的死」。
//   · **B 档(dynamic-unreached,存疑)**:被某条动态前缀覆盖,但字面量池里找不到补全它的那一段。
//     **不删**、只报数:补全它的那一段可能来自 TS 联合类型成员、枚举、服务端下发值或拼接结果,
//     静态扫不到 ≠ 运行时取不到。这一档是给人看的线索,不是给机器删的清单。
//
// 阳性对照(加规则先验它会红,R17):scripts/check-i18n-dead-keys.test.ts ——
// 塞一个谁都不引用的键,确认报成 A 档;再把它写进任意源文件的字符串字面量(以及只写进类型断言、
// 只写进模板前缀),确认它变回活的。
//
// 棘轮:A 档存量写进 scripts/i18n-dead-keys-baseline.json,**只减不增**。

import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { DYNAMIC_KEY_PREFIXES, type DynamicPrefix } from './lib/i18nDynamicKeyPrefixes'

// ── resource 树(与 parity / 正向门岗同一套 flatten) ──
export type Tree = { leaves: Set<string>; subtrees: Set<string> }

export function createTree(): Tree {
  return { leaves: new Set(), subtrees: new Set() }
}

export function buildTree(node: unknown, prefix: string, tree: Tree): void {
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

export const PLURAL_SUFFIXES = ['_zero', '_one', '_two', '_few', '_many', '_other']

export function pluralBaseOf(key: string): string | null {
  const suffix = PLURAL_SUFFIXES.find((s) => key.endsWith(s))
  return suffix ? key.slice(0, -suffix.length) : null
}

// ── 采集 ──
export type Collected = {
  /** 等于某个真实键路径的字面量(规则①②)。 */
  exactRefs: Set<string>
  /** 全部字符串字面量(含词典文件的译文值),用于 B 档「动态前缀 + 后缀」补全判定。 */
  literalPool: Set<string>
  /** 模板 head → 首次出现位置(规则③)。 */
  templateHeads: Map<string, string>
}

export function createCollected(): Collected {
  return { exactRefs: new Set(), literalPool: new Set(), templateHeads: new Map() }
}

export function collectFromSourceText(
  sourceText: string,
  options: { fileName: string; isDictionary: boolean },
  collected: Collected,
): void {
  const { fileName, isDictionary } = options
  const sourceFile = ts.createSourceFile(
    fileName,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    fileName.endsWith('.tsx') || fileName.endsWith('.jsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  )

  function visit(node: ts.Node): void {
    // 规则①②:任何位置的字符串字面量,含类型位置的 `as 'a.b'`(forEachChild 会走进类型节点)。
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      collected.literalPool.add(node.text)
      // 词典文件里的字面量是**译文值**,不是引用(本仓库无 $t() 嵌套,已实查确认);
      // 但它们仍进 literalPool——多算只会让判定更保守。
      if (!isDictionary) {
        collected.exactRefs.add(node.text)
        // chunkBoundary 的 'i18n:xxx' 标签:渲染时 slice 掉前缀再 t()。
        if (node.text.startsWith('i18n:')) collected.exactRefs.add(node.text.slice('i18n:'.length))
      }
    }
    // 规则③:模板 head 作为动态前缀。仓库全量扫、不限 t() 实参——
    // 键先拼好存进 const 再传进 t() 的写法(CapabilityModeEditor 就是),正向门岗看不见,这里必须覆盖。
    if (ts.isTemplateExpression(node) && !isDictionary) {
      const head = node.head.text
      if (head && !collected.templateHeads.has(head)) {
        const line = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1
        collected.templateHeads.set(head, `${fileName}:${line}`)
      }
    }
    ts.forEachChild(node, visit)
  }

  visit(sourceFile)
}

// ── 动态前缀 ──
// 前缀必须真的指向树里的东西,否则它什么也覆盖不了、还可能误伤:
//   · 以 '.' 结尾 → 去点后必须是真实子树。('canvas.' ✓)
//   · 不以 '.' 结尾(concat 半词,如 '…network.mode')→ 必须含 '.',父路径是真实子树,
//     且确实有叶子以它开头。这条把 `a${x}` 这种垃圾 head 挡在外面——
//     否则 head 'a' 会让 assetLibrary.* 整片被算作覆盖,门岗直接失效。
const KEYISH_HEAD = /^[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z0-9_]+)*\.?$/

export function isUsablePrefix(head: string, tree: Tree, leaves: string[]): boolean {
  if (!KEYISH_HEAD.test(head)) return false
  if (head.endsWith('.')) return tree.subtrees.has(head.slice(0, -1))
  const lastDot = head.lastIndexOf('.')
  if (lastDot < 0) return false
  if (!tree.subtrees.has(head.slice(0, lastDot))) return false
  return leaves.some((leaf) => leaf.startsWith(head))
}

/**
 * 汇总动态前缀:源码模板 head + 注册表。
 * 注册表 concat 条目已枚举全部字面量后缀 → 直接把具体键记为**精确引用**(不扩散成整片覆盖)。
 * 返回 前缀 → 来源 的映射,报告里用来说明「这块为什么没判死」。
 */
export function buildLivePrefixes(
  tree: Tree,
  collected: Collected,
  registry: DynamicPrefix[] = DYNAMIC_KEY_PREFIXES,
): Map<string, string> {
  const leaves = [...tree.leaves]
  const prefixes = new Map<string, string>()
  for (const [head, source] of collected.templateHeads) {
    if (isUsablePrefix(head, tree, leaves)) prefixes.set(head, source)
  }
  for (const entry of registry) {
    if (entry.kind === 'concat') {
      for (const suffix of entry.suffixes) collected.exactRefs.add(`${entry.prefix}${suffix}`)
      continue
    }
    const head = `${entry.prefix}.`
    if (isUsablePrefix(head, tree, leaves)) prefixes.set(head, 'DYNAMIC_KEY_PREFIXES')
  }
  return prefixes
}

// ── 判定 ──
export type Verdict = { key: string; tier: 'dead' | 'dynamic-unreached'; prefix?: string }

export function classify(tree: Tree, collected: Collected, livePrefixes: Map<string, string>): Verdict[] {
  const prefixList = [...livePrefixes.keys()]

  function directlyReferenced(key: string): boolean {
    if (collected.exactRefs.has(key)) return true
    const base = pluralBaseOf(key)
    return base !== null && collected.exactRefs.has(base) // 规则④
  }

  // B 档细分:动态前缀之下,字面量池里有没有能补全这个叶子的那一段。
  // 例:前缀 'generationCommon.' + 叶子 'generationCommon.node.foo.title',
  // 源码里出现过 'node.foo.title' / 'node.foo' / 'node' 任一段,就认为运行时可达。
  function dynamicallyReachable(key: string, prefix: string): boolean {
    const rest = key.slice(prefix.length)
    if (rest === '') return true
    if (collected.literalPool.has(rest)) return true
    const segments = rest.split('.')
    for (let i = 1; i <= segments.length; i += 1) {
      if (collected.literalPool.has(segments.slice(0, i).join('.'))) return true
    }
    return false
  }

  const verdicts: Verdict[] = []
  for (const key of [...tree.leaves].sort((a, b) => a.localeCompare(b, 'en'))) {
    if (directlyReferenced(key)) continue
    const prefix = prefixList.find((p) => key.startsWith(p))
    if (prefix === undefined) {
      verdicts.push({ key, tier: 'dead' })
    } else if (!dynamicallyReachable(key, prefix)) {
      verdicts.push({ key, tier: 'dynamic-unreached', prefix })
    }
  }
  return verdicts
}

// ── 门岗主流程 ──
const ROOT = process.cwd()
const BASELINE_PATH = path.join(ROOT, 'scripts/i18n-dead-keys-baseline.json')
// 扫这些根:渲染层、主进程、测试、脚本。测试与脚本里出现的键也算引用——
// 删掉会把走查/脚本弄红,而且那也确实是「有人在用」。
const SCAN_ROOTS = ['src', 'electron', 'tests', 'scripts']
const SCAN_EXTENSIONS = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs']

function isDictionaryFile(relative: string): boolean {
  return relative === 'src/i18n/resources.ts' || relative.startsWith('src/i18n/locales/')
}

type Baseline = { note: string; deadKeys: string[] }

async function main(): Promise<void> {
  const report = process.argv.includes('--report')
  const updateBaseline = process.argv.includes('--update-baseline')
  const prune = process.argv.includes('--prune')

  const { zhCN, en } = (await import('../src/i18n/resources')) as {
    zhCN: unknown
    en: unknown
  }
  const tree = createTree()
  buildTree(zhCN, '', tree)
  buildTree(en, '', tree) // 两份词典**取并集**:判死要求「两边都没人要」,单边缺失归 parity 管。

  const collected = createCollected()
  const files: string[] = []
  for (const root of SCAN_ROOTS) {
    const absolute = path.join(ROOT, root)
    if (!fs.existsSync(absolute)) continue
    files.push(
      ...ts.sys.readDirectory(absolute, SCAN_EXTENSIONS, ['node_modules', 'dist', 'build', 'out'], undefined),
    )
  }
  for (const file of files) {
    const relative = path.relative(ROOT, file).replaceAll('\\', '/')
    collectFromSourceText(fs.readFileSync(file, 'utf8'), { fileName: relative, isDictionary: isDictionaryFile(relative) }, collected)
  }

  const livePrefixes = buildLivePrefixes(tree, collected)
  const verdicts = classify(tree, collected, livePrefixes)
  const deadKeys = verdicts.filter((v) => v.tier === 'dead').map((v) => v.key)
  const unreached = verdicts.filter((v) => v.tier === 'dynamic-unreached')

  if (report) {
    console.log(`Scanned ${files.length} files across ${SCAN_ROOTS.join(', ')}.`)
    console.log(`Keys (zh ∪ en leaves): ${tree.leaves.size}`)
    console.log(`Exact literal references: ${collected.exactRefs.size}; literal pool: ${collected.literalPool.size}`)
    console.log(`Live dynamic prefixes: ${livePrefixes.size} (registry ${DYNAMIC_KEY_PREFIXES.length} + source-derived)`)
    console.log(`\nA 档 dead (high confidence, deletable): ${deadKeys.length}`)
    for (const key of deadKeys) console.log(`  ${key}`)
    console.log(`\nB 档 dynamic-unreached (suspect, DO NOT auto-delete): ${unreached.length}`)
    for (const v of unreached) console.log(`  ${v.key}   [covered by "${v.prefix}" @ ${livePrefixes.get(v.prefix ?? '') ?? '?'}]`)
    return
  }

  // --prune:把 A 档(且仅 A 档)从 zh/en 两棵树里删掉。B 档存疑、绝不自动删。
  // **基线里已登记的也不删**——基线 = 「已知没人引用、但主动留着」的存量(典型:译文是对的、
  // 只是代码没接上,删掉等于把正确翻译扔掉并把 bug 坐实)。要清这部分债,先把条目从基线摘掉再 prune。
  // 删完必须重跑 check:i18n 全链 + typecheck 复核。
  if (prune) {
    const parked = new Set(
      fs.existsSync(BASELINE_PATH) ? (JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8')) as Baseline).deadKeys : [],
    )
    const prunable = deadKeys.filter((key) => !parked.has(key))
    if (parked.size > 0) console.log(`基线登记的 ${parked.size} 条按约定跳过(主动留存,不删)。`)
    if (prunable.length === 0) {
      console.log('没有可删的 A 档死键。')
      return
    }
    const { pruneDictionaryKeys } = await import('./lib/i18nDictionaryEditor')
    const { results, unresolved } = pruneDictionaryKeys(ROOT, prunable)
    console.log(`已删除 ${prunable.length - unresolved.length}/${prunable.length} 条 A 档死键(zh + en 同删):`)
    for (const result of results) {
      console.log(`  ${path.relative(ROOT, result.file)} [${result.identifier}] -${result.removed}`)
    }
    if (unresolved.length > 0) {
      // 一处都没删到 = 词典拼装出现了本编辑器不认识的形状。报红而不是当作删成功——
      // 静默跳过会让人以为清理完了,实际键还在(scene3d 的展开合并就这么漏过一次)。
      console.error(`\n有 ${unresolved.length} 条键没能定位到定义处,一条都没删:`)
      for (const key of unresolved) console.error(`- ${key}`)
      console.error('  → 多半是 resources.ts 用了新的拼装写法,需要扩展 scripts/lib/i18nDictionaryEditor.ts 的归属解析。')
      process.exitCode = 1
      return
    }
    console.log('\n→ 复核: pnpm run check:i18n && pnpm run typecheck')
    return
  }

  if (updateBaseline) {
    const next: Baseline = {
      note: 'i18n 死键棘轮:A 档(高置信死键)存量,只减不增。新增死键必须在同一 PR 里删掉词条,而不是加进这份基线。生成: pnpm run check:i18n-dead-keys -- --update-baseline',
      deadKeys,
    }
    fs.writeFileSync(BASELINE_PATH, `${JSON.stringify(next, null, 2)}\n`, 'utf8')
    console.log(`i18n dead-key baseline updated: ${deadKeys.length} key(s).`)
    return
  }

  const baseline: Baseline = fs.existsSync(BASELINE_PATH)
    ? (JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8')) as Baseline)
    : { note: '', deadKeys: [] }
  const baselineSet = new Set(baseline.deadKeys)
  const deadSet = new Set(deadKeys)
  const added = deadKeys.filter((key) => !baselineSet.has(key))
  const removed = baseline.deadKeys.filter((key) => !deadSet.has(key))

  if (added.length === 0) {
    const shrink = removed.length > 0 ? `,较基线少 ${removed.length} 条(跑 --update-baseline 收紧棘轮)` : ''
    console.log(
      `i18n dead-key gate passed (${tree.leaves.size} keys, ${deadKeys.length} known-dead within baseline${shrink}; ${unreached.length} dynamic-unreached suspects)`,
    )
    return
  }

  console.error(`i18n dead-key gate failed: ${added.length} new dead key(s)`)
  console.error(`\n没有任何引用能到达这些键(既无字面量,也不在任何动态前缀覆盖范围内):`)
  for (const key of added) console.error(`- ${key}`)
  console.error(
    `\n  → 修法:要么把词条从 src/i18n/resources.ts 与 src/i18n/locales/*.ts 删掉(zh + en 同时删,保 parity);` +
      `\n     要么补上引用;若键是动态拼出来的,把静态前缀连同「为什么动态 + 枚举来源」加进 scripts/lib/i18nDynamicKeyPrefixes.ts。` +
      `\n     基线只减不增——不要把新死键加进 scripts/i18n-dead-keys-baseline.json。`,
  )
  process.exitCode = 1
}

// 直接跑才执行门岗;被测试 import 时只暴露上面那些纯函数。
// (不用顶层 await——tsx 的 cjs 输出不支持。)
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    console.error(error)
    process.exitCode = 1
  })
}
