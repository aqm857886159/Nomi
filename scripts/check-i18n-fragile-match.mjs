#!/usr/bin/env node
// 语言脆弱匹配门岗（2026-09-01）。抓的是一类**跨语言就静默失效**的分类逻辑:
//
//   `raw.includes('余额不足')` / `text.includes('未开通')` —— 按**中文文案子串**判错误类别。
//
// 为什么危险(与 check:i18n 硬零同源,但方向相反):
//   ① 供应商换一版文案、或返回英文原文,子串就匹配不到 → 分类静默降级到 unknown,
//      用户拿到「稍等重试」这句对确定性失败的误导(classifyError 的注释里记满了这类真实事故)。
//   ② 更隐蔽的一种:匹配的是**我们自己**另一个模块 throw 的中文串(assetLocalization 的
//      「超过了所有可用上传通道的大小上限」)。一旦那句被 i18n 化/改词,分类当场断——
//      而单测多半还绿(测试喂的就是那句写死的中文),只有真机换了语言才炸。这正是 R17 那一族
//      「本地看不出、线上才炸」的写法:靠自觉记不住,只能靠机器每次拦。
//
// 根治方向不是「把中文串也翻译」——那还是按文案分类,换汤不换药。是**改按机器可读的信号分类**:
//   · 供应商结构化错误 → VendorRequestError.structured(category/logicalCode/httpStatus),已就位;
//   · 我们自己 throw 的错误 → 附一个稳定的错误码标记(electron/shared/nomiErrorCodes.ts 的
//     NOMI_ERR:: 前缀),分类端匹配**码**而非人话,翻译人话不影响分类。
//
// 按棘轮跑(基线只减不增),和 check:heavy-path / check:tokens 同一套做法:存量进基线慢慢清零,
// 新增一处按文案分类当场报红。加规则必须先验它会红(R17)。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const BASELINE_FILE = path.join(repoRoot, 'scripts', 'i18n-fragile-match-baseline.json')
const UPDATE = process.argv.includes('--update-baseline')

// 抹注释必须逐行等高(不改变总行数,否则报出来的 file:line 点开是别处)——与 check-heavy-path 同一套。
function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, ''))
    .replace(/^[^\S\n]*\/\/.*$/gm, '')
}

// 只扫**产品源**里的 .ts/.tsx,跳过测试(测试里喂写死的中文串是合法的夹具,不是分类逻辑)。
function collectFiles() {
  const files = []
  const walk = (dir) => {
    if (!fs.existsSync(dir)) return
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === 'dist-electron') continue
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (/\.(tsx?|mts|cts)$/.test(entry.name) && !/\.(test|spec)\.[cm]?[jt]sx?$/.test(entry.name)) files.push(full)
    }
  }
  walk(path.join(repoRoot, 'src'))
  walk(path.join(repoRoot, 'electron'))
  return files
}

// 形状:`<expr>.includes('…中文…')` —— 用中文文案子串做分类判定。反引号模板串同样算
// (`${x}`.includes('中文') 也是按文案匹配)。CJK 判据用 CJK 统一表意文字区间。
const FRAGILE_INCLUDES = /\.includes\(\s*(['"`])[^'"`]*[㐀-鿿][^'"`]*\1\s*\)/

function scan(code, file) {
  const hits = []
  code.split('\n').forEach((line, i) => {
    if (FRAGILE_INCLUDES.test(line)) {
      hits.push({ file: path.relative(repoRoot, file).replaceAll('\\', '/'), line: i + 1, text: line.trim().slice(0, 140) })
    }
  })
  return hits
}

const files = collectFiles()
const found = []
for (const file of files) {
  for (const hit of scan(stripComments(fs.readFileSync(file, 'utf8')), file)) found.push(hit)
}

// 基线按 file → 命中行数 记(点开就是要改的那一族)。
const byFile = new Map()
for (const hit of found) byFile.set(hit.file, (byFile.get(hit.file) ?? 0) + 1)

if (UPDATE) {
  const next = Object.fromEntries([...byFile.entries()].sort((a, b) => a[0].localeCompare(b[0], 'en')))
  fs.writeFileSync(BASELINE_FILE, `${JSON.stringify(next, null, 2)}\n`)
  console.log(`✅ 已写入语言脆弱匹配基线:${byFile.size} 文件 / ${found.length} 处`)
  process.exit(0)
}

const baseline = fs.existsSync(BASELINE_FILE) ? JSON.parse(fs.readFileSync(BASELINE_FILE, 'utf8')) : {}
const regressions = []
for (const [file, count] of byFile) {
  const allowed = Number.isFinite(baseline[file]) ? baseline[file] : 0
  if (count > allowed) regressions.push({ file, count, allowed })
}

if (regressions.length > 0) {
  console.error('✖ 语言脆弱匹配门岗未通过——新增了「按中文文案子串分类」的写法(棘轮只减不增):')
  for (const { file, count, allowed } of regressions.sort((a, b) => b.count - a.count)) {
    console.error(`- ${file}  基线 ${allowed} → 现在 ${count}(新增 ${count - allowed})`)
    for (const hit of found.filter((h) => h.file === file).slice(0, 6)) {
      console.error(`    :${hit.line}  ${hit.text}`)
    }
  }
  console.error('  → 别把中文串也翻译了事(还是按文案分类)。改按机器信号:供应商用 structured.category;')
  console.error('    我们自己 throw 的错误附 electron/shared/nomiErrorCodes.ts 的 NOMI_ERR:: 码,分类端匹配码而非人话。')
  console.error(`  基线文件:scripts/i18n-fragile-match-baseline.json;重拍:node scripts/check-i18n-fragile-match.mjs --update-baseline`)
  process.exit(1)
}

console.log(`scanned=${files.length}`)
console.log(`✅ 语言脆弱匹配门岗通过:${found.length} 处存量(${byFile.size} 文件),棘轮只减不增。`)
