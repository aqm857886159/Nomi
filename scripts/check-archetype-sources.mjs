#!/usr/bin/env node
// 门岗：模型档案的契约出处必须落成结构化字段（规则 G1/G3，docs/engineering-rules.md）。
//
// 为什么要这个门岗（2026-08-12 真实缺陷）：Seedance 2.5 档案里参考图/视频/音频上限写的是
// 9/3/3、比例默认 16:9，而 kie 与 apimart 官方文档都是 30/10/10、默认 adaptive——四个数
// 没一个来自文档。而文件头注释白纸黑字写着「契约逐项对账自 kie 官方文档」。
// 注释是自由文本，**声称对过和真的对过之间没有任何验证手段**。落成字段才检查得了。
//
// 棘轮：存量未登记的进白名单，只减不增（与 filesize / tokens / i18n 同款纪律）。
// 一刀切会让门岗永远红、进而被习惯性忽略——被忽略的门岗等于不存在。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const archetypeDirs = [
  path.join(repoRoot, 'src/config/modelArchetypes'),
  // Pure source-backed facts are shared by renderer and Electron. Keep them in
  // the same provenance gate so moving an owner cannot hide an unverified model.
  path.join(repoRoot, 'electron/shared/videoCapabilities'),
]
const baselinePath = path.join(repoRoot, 'scripts/archetype-sources-baseline.json')

/** 未登记出处的存量档案。**只减不增** —— 补一个删一行，新增档案不许进这里。 */
const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'))
const allowed = new Set(baseline.unsourced)

const files = archetypeDirs.flatMap((dir) => fs
  .readdirSync(dir)
  .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts') && !['index.ts', 'types.ts', 'archetypeMeta.ts', 'recommendation.ts'].includes(f))
  .map((file) => ({ file, path: path.join(dir, file) })))

const problems = []
const unsourced = []

for (const entry of files) {
  const { file } = entry
  const src = fs.readFileSync(entry.path, 'utf8')
  // 一个文件可能声明多个档案；按 `id: "..."` 逐个认。
  const ids = [...src.matchAll(/^\s{2}id:\s*["']([^"']+)["']/gm)].map((m) => m[1])
  if (ids.length === 0) continue
  const hasSources = /^\s{2}sources:\s*\[/m.test(src)

  if (!hasSources) {
    unsourced.push(file)
    if (!allowed.has(file)) {
      problems.push(`✗ ${file}: 缺 sources —— 新档案必须登记官方文档出处（url + checkedAt）`)
    }
    continue
  }

  // 有 sources 就得是像样的：URL 必须 https，checkedAt 必须 ISO 日期。
  const urls = [...src.matchAll(/url:\s*["']([^"']+)["']/g)].map((m) => m[1])
  const dates = [...src.matchAll(/checkedAt:\s*["']([^"']+)["']/g)].map((m) => m[1])
  if (urls.length === 0) problems.push(`✗ ${file}: sources 里没有 url`)
  if (urls.length !== dates.length) problems.push(`✗ ${file}: url 与 checkedAt 数量不匹配（每条出处都要有对账日期）`)
  for (const url of urls) {
    if (!/^https:\/\//.test(url)) problems.push(`✗ ${file}: 出处必须是 https 官方文档地址，收到 ${url}`)
  }
  for (const date of dates) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) problems.push(`✗ ${file}: checkedAt 必须是 YYYY-MM-DD，收到 ${date}`)
  }
}

// 棘轮回收：白名单里已经补好出处的，必须同步从白名单删掉，否则它就成了永久豁免。
const stale = [...allowed].filter((f) => !unsourced.includes(f))
for (const file of stale) {
  problems.push(`✗ ${file}: 已补出处但仍留在白名单里 —— 从 ${path.relative(repoRoot, baselinePath)} 删掉这行（棘轮只减不增）`)
}

// ── 第二段：Agent 可选文本模型的 token 价目出处 ────────────────────────────────
//
// 同一条纪律的另一个实例（方案 §1.7 / P4）：**面板上那个金额也是一个契约数字**。
// 病史：`createNomiProvider` 给每个模型填 `cost: {input:0, output:0, …}`，于是 pi 算出来的
// 花费恒为 0；面板拿 `> 0` 当「有没有价目」的判据，结果「免费」「还没花钱」「我们没有价目」
// 三件事印出来一模一样——都是空白。根因是**目录里根本没有放 per-token 价的地方**
// （`Model.pricing` 是每次生成扣多少点，不是 per-token）。2026-09-07 补上 `Model.tokenPricing` 后，
// 这道门保证它不会又变成一个「写了类型但没人填」的字段。
//
// 判据：每个 curated 文本模型（= Agent 主控能选中的那批）要么声明 `tokenPricing`（带 https 出处
// + ISO 对账日期），要么显式 `free: true`。两者互斥。
// 豁免：`meta.promptRefineOnly` 的条目——`textBrainResolver.isPromptRefineOnlyModel`
// （electron/ai/textBrainResolver.ts:26-31）明确把它们挡在 Agent 主控之外，它们不按 token 计费
// 也不是「免费」，两个字段都不该有。豁免判据与生产判据是同一个字段名，不是另立一套。
//
// 棘轮：官方定价页上查不到价的存量模型登记在基线里，**只减不增**（补一个删一行）。
// 这不是偷懒：DeepSeek 官方定价页 2026-09-07 实查只列 v4 三行，V3.2 / V3.1-terminus 一个字没有——
// 编一个数字比留一个「不可知」更糟。
const textSeedFiles = ['apimartTexts.ts', 'agnesTexts.ts', 'modelscopeTexts.ts']
const allowedUnpriced = new Set(baseline.textModelsWithoutTokenPricing ?? [])
const unpriced = []

/** 对象字面量里某个属性的初始化表达式。找不到返回 undefined。 */
const prop = (node, name) => node.properties.find((p) =>
  ts.isPropertyAssignment(p) && ts.isIdentifier(p.name) && p.name.text === name)?.initializer

const literalText = (node) => (node && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)))
  ? node.text : undefined

for (const file of textSeedFiles) {
  const abs = path.join(repoRoot, 'electron/catalog', file)
  const source = ts.createSourceFile(abs, fs.readFileSync(abs, 'utf8'), ts.ScriptTarget.Latest, true)
  // 出处常量会被抽成 `const X_PRICING_SOURCE = {...}` 复用；先把它们收下来，
  // 否则每个模型的 `source: X` 都会被误判成「没有 url」。
  const sourceConsts = new Map()
  const visitConsts = (node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      let init = node.initializer
      if (ts.isAsExpression(init)) init = init.expression
      if (ts.isObjectLiteralExpression(init) && prop(init, 'url')) sourceConsts.set(node.name.text, init)
    }
    ts.forEachChild(node, visitConsts)
  }
  visitConsts(source)

  // **只扫 `*_TEXT_MODELS` 那个数组**。同一个文件里 `*_TEXT_MAPPINGS` 的条目也带 `modelKey`
  // （它指的是「这条 mapping 服务哪个模型」），把它们一起扫进来会对同一个模型报两遍、
  // 还会要求一条 mapping 声明价目 —— 门岗自己制造的假红比没有门岗更贵。
  const models = []
  const visitModels = (node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && /_TEXT_MODELS$/.test(node.name.text)
        && node.initializer && ts.isArrayLiteralExpression(node.initializer)) {
      for (const element of node.initializer.elements) {
        if (!ts.isObjectLiteralExpression(element)) {
          problems.push(`✗ ${file}: ${node.name.text} 里有一个不是对象字面量的条目 —— 门岗读不了算出来的模型表`)
          continue
        }
        const key = literalText(prop(element, 'modelKey'))
        if (key === undefined) problems.push(`✗ ${file}: ${node.name.text} 里有一个条目没有字面量 modelKey`)
        else models.push({ key, node: element })
      }
    }
    ts.forEachChild(node, visitModels)
  }
  visitModels(source)
  if (models.length === 0) problems.push(`✗ ${file}: 一个 *_TEXT_MODELS 条目都没扫到 —— 种子文件的形状变了，门岗先红再说`)

  for (const { key, node } of models) {
    const identity = `${file}:${key}`
    // 不是 chat 模型的那批：生产侧同一个字段把它们挡在 Agent 主控之外。
    const meta = prop(node, 'meta')
    const refineOnly = meta && ts.isObjectLiteralExpression(meta)
      && prop(meta, 'promptRefineOnly')?.kind === ts.SyntaxKind.TrueKeyword
    const pricing = prop(node, 'tokenPricing')
    const free = prop(node, 'free')?.kind === ts.SyntaxKind.TrueKeyword
    if (refineOnly) {
      if (pricing || free) {
        problems.push(`✗ ${identity}: promptRefineOnly 的条目不按 token 计费，也不是「免费」—— 两个字段都不该声明`)
      }
      continue
    }
    if (pricing && free) {
      problems.push(`✗ ${identity}: tokenPricing 与 free 互斥 —— 花费那一行不能有两个互相矛盾的答案`)
      continue
    }
    if (free) continue
    if (!pricing) {
      unpriced.push(identity)
      if (!allowedUnpriced.has(identity)) {
        problems.push(`✗ ${identity}: 缺 tokenPricing —— Agent 可选文本模型必须声明 per-token 价目（USD/每百万 token，带官方出处）或显式 free: true`)
      }
      continue
    }
    if (!ts.isObjectLiteralExpression(pricing)) {
      problems.push(`✗ ${identity}: tokenPricing 必须是就地写死的对象字面量（门岗读不了算出来的价）`)
      continue
    }
    for (const field of ['inputPerMTokUsd', 'outputPerMTokUsd']) {
      if (!prop(pricing, field)) problems.push(`✗ ${identity}: tokenPricing 缺 ${field}`)
    }
    let src = prop(pricing, 'source')
    if (src && ts.isIdentifier(src)) src = sourceConsts.get(src.text)
    if (!src || !ts.isObjectLiteralExpression(src)) {
      problems.push(`✗ ${identity}: tokenPricing 缺 source —— 注释写「已对过官网」没人能反证，结构化出处才检查得了`)
      continue
    }
    const url = literalText(prop(src, 'url'))
    const checkedAt = literalText(prop(src, 'checkedAt'))
    if (!url || !/^https:\/\//.test(url)) problems.push(`✗ ${identity}: 价目出处必须是 https 官方定价页，收到 ${url}`)
    if (!checkedAt || !/^\d{4}-\d{2}-\d{2}$/.test(checkedAt)) problems.push(`✗ ${identity}: 价目 checkedAt 必须是 YYYY-MM-DD，收到 ${checkedAt}`)
  }
}

for (const staleKey of [...allowedUnpriced].filter((k) => !unpriced.includes(k))) {
  problems.push(`✗ ${staleKey}: 已补价目（或已下架）但仍留在 textModelsWithoutTokenPricing 里 —— 删掉这行（棘轮只减不增）`)
}

if (problems.length > 0) {
  console.error('档案出处门岗未通过（规则 G1/G3）：')
  for (const p of problems) console.error(p)
  console.error(`\n为什么有这条：注释可以写「已逐项对账」而实际没对过，没人能反证；结构化出处才检查得了。`)
  console.error(`补法：在档案里加 sources: [{ url: "官方文档地址", checkedAt: "YYYY-MM-DD", vendorKey, covers }]`)
  process.exit(1)
}

console.log(`✓ 档案出处门岗通过：扫 ${files.length} 个档案文件，${files.length - unsourced.length} 个已登记出处，${unsourced.length} 个待补（棘轮基线 ${allowed.size}）。`)
console.log(`✓ 文本模型价目门岗通过：扫 ${textSeedFiles.length} 个种子文件，${unpriced.length} 个模型无 per-token 价目（棘轮基线 ${allowedUnpriced.size}）。`)
