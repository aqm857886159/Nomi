#!/usr/bin/env node
/**
 * 文档索引棘轮：方案文档与教训文档必须被 docs/README.md 或 docs 树中的某个 INDEX.md 链接。
 *
 * baseline 记录具体文件路径，不记裸数字。裸数字会允许“收录一篇旧文档，同时新增一篇
 * 失联文档”蒙混过关；具体身份才能保证历史债只减不增。
 *
 * docs/lessons 一并纳管（2026-09-02）：教训库的入口就是 INDEX.md，孤儿教训文件等于不存在
 * ——没人会去 grep 一条自己不知道存在的坑。这条罩着的是纪律「新增一条就挂号」。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const docsRoot = path.join(repoRoot, 'docs')
const baselinePath = path.join(repoRoot, 'scripts', 'docs-index-baseline.json')
const scanRoots = [
  path.join(docsRoot, 'plan'),
  path.join(docsRoot, 'superpowers', 'plans'),
  path.join(docsRoot, 'lessons'),
]

function collectMarkdownFiles(root) {
  if (!fs.existsSync(root)) return []
  const files = []
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const file = path.join(root, entry.name)
    if (entry.isDirectory()) files.push(...collectMarkdownFiles(file))
    else if (entry.isFile() && entry.name.endsWith('.md')) files.push(file)
  }
  return files
}

function relative(file) {
  return path.relative(repoRoot, file).split(path.sep).join('/')
}

function stripNonProse(source) {
  return source
    .replace(/<!--[^]*?-->/g, '')
    .replace(/^\s*(```|~~~)[^\n]*\n[^]*?^\s*\1\s*$/gm, '')
}

function extractLinkTargets(indexFile) {
  const source = stripNonProse(fs.readFileSync(indexFile, 'utf8'))
  const targets = []
  // 本仓索引使用 inline Markdown links。目标允许 <...> 包裹，也允许可选 title。
  const pattern = /(!?)\[[^\n]*?\]\(\s*(?:<([^>\n]+)>|([^\s)\n]+))(?:\s+["'][^"'\n]*["'])?\s*\)/g
  for (const match of source.matchAll(pattern)) {
    if (match[1] === '!') continue
    const raw = (match[2] ?? match[3]).trim()
    if (!raw || raw.startsWith('#') || /^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(raw)) continue
    let decoded
    try {
      decoded = decodeURIComponent(raw)
    } catch {
      decoded = raw
    }
    const withoutSuffix = decoded.split(/[?#]/, 1)[0].replaceAll('\\', '/')
    const absolute = withoutSuffix.startsWith('/')
      ? path.resolve(repoRoot, withoutSuffix.slice(1))
      : path.resolve(path.dirname(indexFile), withoutSuffix)
    targets.push(relative(absolute))
  }
  return targets
}

function readBaseline() {
  if (!fs.existsSync(baselinePath)) return null
  const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'))
  const list = baseline.unindexedDocuments
  if (!Array.isArray(list) || list.some((value) => typeof value !== 'string')) {
    console.error(`✖ ${relative(baselinePath)} 的 unindexedDocuments 必须是文件路径字符串数组`)
    process.exit(1)
  }
  const duplicates = list.filter((value, index) => list.indexOf(value) !== index)
  if (duplicates.length > 0) {
    console.error(`✖ 基线里有重复路径：${[...new Set(duplicates)].join(', ')}`)
    process.exit(1)
  }
  return list
}

function writeBaseline(paths) {
  const baseline = {
    _comment: [
      '文档索引棘轮基线：只减不增。',
      '扫描 docs/plan/**/*.md、docs/superpowers/plans/**/*.md 与 docs/lessons/**/*.md。',
      '身份使用仓库相对路径；新增未收录文档必须进索引，不能追加到本数组。',
    ],
    unindexedDocuments: paths,
  }
  fs.writeFileSync(baselinePath, `${JSON.stringify(baseline, null, 2)}\n`)
}

// INDEX.md 是索引本身，不是被审的方案文档；否则新建一个目录索引会把自己判成违规。
const documents = scanRoots.flatMap(collectMarkdownFiles)
  .filter((file) => path.basename(file) !== 'INDEX.md')
  .map(relative)
  .sort()
const documentSet = new Set(documents)
const indexFiles = [path.join(docsRoot, 'README.md'), ...collectMarkdownFiles(docsRoot).filter((file) => path.basename(file) === 'INDEX.md')]
const indexed = new Set(indexFiles.flatMap(extractLinkTargets).filter((target) => documentSet.has(target)))
const unindexed = documents.filter((file) => !indexed.has(file))

const updateBaseline = process.argv.includes('--update-baseline')
const allowedList = readBaseline()
if (allowedList === null) {
  if (!updateBaseline) {
    console.error(`✖ 缺少 ${relative(baselinePath)}；先核对实扫结果，再用 --update-baseline 初始化存量`)
    process.exit(1)
  }
  writeBaseline(unindexed)
  console.log(`✅ 已初始化文档索引基线：${unindexed.length} 篇未收录存量`)
  process.exit(0)
}

const allowed = new Set(allowedList)
const added = unindexed.filter((file) => !allowed.has(file))
const removed = allowedList.filter((file) => !unindexed.includes(file))

if (updateBaseline) {
  if (added.length > 0) {
    console.error(`✖ 拒绝抬高基线：仍有 ${added.length} 篇新增未收录方案；先把它们写进索引`)
    for (const file of added) console.error(`  ${file}`)
    process.exit(1)
  }
  writeBaseline(allowedList.filter((file) => unindexed.includes(file)))
  console.log(`✅ 已下调文档索引基线：${allowedList.length} → ${allowedList.length - removed.length}`)
  process.exit(0)
}

console.log(
  `文档索引覆盖：${documents.length} 篇方案；${indexed.size} 篇已收录；${unindexed.length} 篇未收录（基线 ${allowedList.length}）`,
)

if (added.length > 0) {
  console.error(`✖ 文档索引回归：${added.length} 篇新增未收录方案`)
  for (const file of added) console.error(`  ${file}`)
  console.error('  → 在 docs/README.md 或某个 docs/**/INDEX.md 中用 Markdown 链接收录，不能抬高 baseline')
  process.exit(1)
}

if (removed.length > 0) {
  console.log(`↓ 存量减少 ${removed.length} 篇；请从 baseline 删除这些路径锁定战果：`)
  for (const file of removed) console.log(`  ${file}`)
}

console.log('✅ 文档索引棘轮通过（只减不增）')
