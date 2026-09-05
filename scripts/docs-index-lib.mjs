/**
 * 「一篇文档有没有被索引收录」的唯一扫描定义。
 *
 * 为什么独立成库（2026-09-05）：判定「哪些文档没进索引」现在有两个消费者——
 *   · `check:docs-index`（棘轮门岗，报红）
 *   · `scripts/repair-doc-gates.mjs`（main 上的自动补齐，把漏的那篇写进索引）
 * 两处各写一份链接解析，迟早漂成两套语义：门岗认得的链接形态补齐脚本不认，
 * 于是「补齐了但门岗还红」或者反过来「门岗绿了但索引里其实没有」。
 * 这正是 R14.1 / check:vocabularies 要拦的「同一语义有几份定义」。改扫描只改这里。
 *
 * 边界：本库只回答「扫到哪些文档、哪些被链接到了」，**不碰基线、不决定红绿**——
 * 棘轮基线的读写与退出码仍归 `check-docs-index.mjs`，补齐策略仍归 repair 脚本。
 */
import fs from 'node:fs'
import path from 'node:path'

/** 受索引纪律管辖的文档目录（相对仓库根）。新增一类要纳管就加在这里。 */
export const INDEXED_DOC_ROOTS = ['docs/plan', 'docs/superpowers/plans', 'docs/lessons']

/** 递归收集 markdown 文件（绝对路径）。 */
export function collectMarkdownFiles(root) {
  if (!fs.existsSync(root)) return []
  const files = []
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const file = path.join(root, entry.name)
    if (entry.isDirectory()) files.push(...collectMarkdownFiles(file))
    else if (entry.isFile() && entry.name.endsWith('.md')) files.push(file)
  }
  return files
}

/** 仓库相对路径，统一 POSIX 分隔符——身份判据必须跨平台逐字相同。 */
export function toRepoRelative(repoRoot, file) {
  return path.relative(repoRoot, file).split(path.sep).join('/')
}

function stripNonProse(source) {
  return source
    .replace(/<!--[^]*?-->/g, '')
    .replace(/^\s*(```|~~~)[^\n]*\n[^]*?^\s*\1\s*$/gm, '')
}

/** 从一份索引文件里取出它链接到的所有仓内路径（仓库相对）。 */
export function extractLinkTargets(repoRoot, indexFile) {
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
    targets.push(toRepoRelative(repoRoot, absolute))
  }
  return targets
}

/** 索引文件集合：docs/README.md + docs 树下所有 INDEX.md（绝对路径）。 */
export function collectIndexFiles(repoRoot) {
  const docsRoot = path.join(repoRoot, 'docs')
  return [
    path.join(docsRoot, 'README.md'),
    ...collectMarkdownFiles(docsRoot).filter((file) => path.basename(file) === 'INDEX.md'),
  ].filter((file) => fs.existsSync(file))
}

/**
 * 一次扫描给出全部事实：受管文档、索引文件、已收录集合、未收录清单。
 * INDEX.md 是索引本身，不是被审的方案文档；否则新建一个目录索引会把自己判成违规。
 */
export function scanDocumentIndex(repoRoot) {
  const documents = INDEXED_DOC_ROOTS
    .flatMap((root) => collectMarkdownFiles(path.join(repoRoot, root)))
    .filter((file) => path.basename(file) !== 'INDEX.md')
    .map((file) => toRepoRelative(repoRoot, file))
    .sort()
  const documentSet = new Set(documents)
  const indexFiles = collectIndexFiles(repoRoot)
  const indexed = new Set(
    indexFiles.flatMap((file) => extractLinkTargets(repoRoot, file)).filter((target) => documentSet.has(target)),
  )
  return { documents, indexFiles, indexed, unindexed: documents.filter((file) => !indexed.has(file)) }
}
