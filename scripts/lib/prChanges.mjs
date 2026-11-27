// 「这个 PR 改了什么」的本地 git 取法（2026-10-24）：对 base..head 做 diff，文件表、逐文件新增行、package.json 被删行都从这一处出。
// 合并前扫描（scripts/merge-preflight.mjs）用它：base = merge-base(基线分支末端, PR head)，head = fetch 到的 PR head。
// 推送前 / CI（scripts/check-pr-judgement.mjs）和合并前扫描调同一个函数，保持同一口径。
//
// 为什么不用 GitHub 的 PR diff / 文件表接口：GitHub 给 PR diff 设了硬上限——超过 300 个文件就整个不给
// （HTTP 406「the diff exceeded the maximum number of files (300)」；#1269 改了 321 个文件，合并前扫描只能打「取不到 PR diff」）；
// 官方文档另写了整个 diff 20,000 行 / 1 MB 的上限；文件表接口（pulls/<n>/files）最多 3000 个文件。本地 git 没有这些上限。
// 口径和 GitHub 一样：PR 页面看的是三点 diff = diff(merge-base(基线, head), head)；git 文档：`git diff A...B` ≡ `git diff $(git merge-base A B) B`。
//
// 改名不做检测（--no-renames）：改名 = 旧路径 D + 新路径 A。逃逸账本靠它看见「条目文件改名 = 旧 id 消失」——旧路径以 D 进文件表，
// ledgerChanges 照常把它算成被删；不需要单独的「旧路径」字段，也就没有「漏传旧路径」这种错法。
//
// 输出格式用参数钉死，不吃本机 / 仓库的 git 配置。每一项压住的配置：
//   --src-prefix=a/ --dst-prefix=b/  diff.noprefix / diff.mnemonicPrefix / diff.srcPrefix（前缀不是 a/ b/，逐文件新增行一行都认不出）；
//   --no-color                       color.ui=always（行首多了颜色转义，新增行全丢）；
//   --no-ext-diff --no-textconv      diff.external / textconv 驱动（输出换成别的工具的格式）；
//   --no-renames                     diff.renames（文件表多出 R 记录，状态和路径对不上）；
//   --no-relative                    diff.relative（只剩当前子目录）；
//   -O/dev/null                      diff.orderFile（文件顺序变了，报告里列的前几个文件跟着变）；
//   --diff-algorithm=myers           diff.algorithm；
//   --ignore-submodules=none --submodule=short   diff.ignoreSubmodules / diff.submodule；
//   -c core.quotePath=false          非 ASCII 路径在 diff 头里被转成八进制，对不上文件表（文件表用 -z，本来就不转义）。
import { addedLinesByFile, isGeneratedArtifact } from '../pr-judgement-lib.mjs'

export const PINNED_DIFF_ARGS = Object.freeze([
  '--no-color', '--no-ext-diff', '--no-textconv', '--no-renames', '--no-relative',
  '--src-prefix=a/', '--dst-prefix=b/', '-O/dev/null', '--diff-algorithm=myers',
  '--ignore-submodules=none', '--submodule=short',
])

/** --no-renames 之下 name-status 只会出这几种状态；出别的（R / C 带相似度）= 格式没钉住，宁可失败也不拿错位的文件表去判。 */
const SINGLE_STATUS = /^[ADMTUX]$/

/**
 * git(args) → 标准输出（失败抛错）。base / head：提交号或引用。
 * 返回 { files: [{ path, status, additions, binary }]（status 是 git 的一个字母：A 新增 / D 删除 / M 修改 / T 类型变了），
 *        addedByFile: Map(路径 → 该文件的新增行), packageRemovedLines: package.json 被删的行（去掉 diff 的「-」前缀） }。
 */
export function prChanges({ git, base, head, contentScope }) {
  const diff = (args, paths = []) => git(['-c', 'core.quotePath=false', 'diff', ...PINNED_DIFF_ARGS, ...args, base, head, '--', ...paths])
  const records = diff(['--name-status', '-z']).split('\0').filter(Boolean)
  if (records.length % 2 !== 0) throw new Error(`git diff --name-status 的输出不是「状态 + 路径」成对的（${records.length} 段）`)
  // -z 保留路径里的制表符、换行和非 ASCII 字符；二进制的两列都是 '-'。
  const stats = new Map()
  for (const record of diff(['--numstat', '-z']).split('\0').filter(Boolean)) {
    const row = /^(\d+|-)\t(\d+|-)\t(.+)$/s.exec(record)
    if (!row || (row[1] === '-') !== (row[2] === '-')) throw new Error('git diff --numstat 输出无效')
    stats.set(row[3], { additions: row[1] === '-' ? 0 : Number(row[1]), binary: row[1] === '-' })
  }
  const files = []
  for (let i = 0; i < records.length; i += 2) {
    if (!SINGLE_STATUS.test(records[i])) throw new Error(`git diff --name-status 出了预料之外的状态「${records[i]}」（${records[i + 1]}）：格式没钉住，不拿错位的文件表去判`)
    const name = records[i + 1]
    if (!stats.has(name)) throw new Error(`git diff --numstat 缺少 ${name}`)
    files.push({ path: name, status: records[i], ...stats.get(name) })
  }
  // 正文门岗只有路由表指定的内容和 package.json 删行需要补丁；大的报告只读取计数。
  // 不传范围的调用者仍取得完整补丁。按批传 literal pathspec，路径中的 glob 也按字面匹配。
  const patches = []
  if (contentScope) {
    const scope = new RegExp(contentScope)
    const paths = files.filter(file => file.path === 'package.json' || (scope.test(file.path) && !isGeneratedArtifact(file.path.replaceAll('\\', '/')))).map(file => `:(literal)${file.path}`)
    for (let i = 0; i < paths.length; i += 128) patches.push(diff(['-U0'], paths.slice(i, i + 128)))
  } else {
    patches.push(diff(['-U0']))
  }
  const patch = patches.join('')
  const packageBlock = patch.split(/^diff --git /m).find((block) => block.startsWith('a/package.json b/package.json')) ?? ''
  return {
    files,
    addedByFile: addedLinesByFile(patch),
    packageRemovedLines: packageBlock.split('\n').filter((line) => line.startsWith('-') && !line.startsWith('---')).map((line) => line.slice(1)),
  }
}
