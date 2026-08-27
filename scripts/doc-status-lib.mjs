/**
 * 方案文档「状态标记」的唯一定义。
 *
 * 为什么独立成库：check:doc-status（拦缺状态）与 build-delivery-ledger（按状态出账本）
 * 都要认这套标记。两处各写一份正则，迟早漂成两套语义——这正是 R14.1 与
 * check:vocabularies 要拦的「同一语义有几份定义」。改标记只改这里。
 *
 * 登记制语义：
 *   📋 方案待拍板   ⏳ 已拍板·未开工   🚧 进行中      ← 欠账，进账本现役区、进每日提醒
 *   🧊 暂缓/远期                                    ← 分诊过，列出但不催
 *   ✅ 已交付      ⛔ 已废弃         📎 交接/日志    ← 已结案
 *   （无标记）                                      ← 未登记存量，不打扰
 */

import fs from 'node:fs'
import path from 'node:path'

/** 方案文档所在目录（相对仓库根）。新增 plan 根目录时改这里。 */
export const PLAN_ROOTS = ['docs/plan', 'docs/superpowers/plans']

export const STATUS_MARKERS = ['✅', '🚧', '⏳', '🧊', '📋', '⛔', '📎']

/** 欠账三态：进账本现役区，会被每日提醒。 */
export const OPEN_STATUSES = ['📋', '⏳', '🚧']
/** 分诊过的远期项：账本列出，但不催。 */
export const DEFERRED_STATUSES = ['🧊']
/** 已结案。 */
export const CLOSED_STATUSES = ['✅', '⛔', '📎']

export const STATUS_LABEL = {
  '📋': '方案待拍板',
  '⏳': '已拍板·未开工',
  '🚧': '进行中',
  '🧊': '暂缓/远期',
  '✅': '已交付',
  '⛔': '已废弃',
  '📎': '交接/日志',
}

/** 状态标记只在文档开头这么多行内生效——正文里出现的同款 emoji 不算声明。 */
export const STATUS_HEAD_LINES = 12

const MARKER_CLASS = `[${STATUS_MARKERS.join('')}]`
const MARKER_AT_START = new RegExp(`^\\s*(?:>\\s*)?(?:\\*\\*)?(${MARKER_CLASS})`, 'u')
// 窗口必须紧。原来是 30 字符，会把正文散文当成状态声明——设计文档里一句
// 「状态标（仅非终态显示：进行中 = ⏳ …）」曾被误判为该文档已登记状态。
// 真实状态行一律是「状态：<标记>」，标记紧跟冒号/空白。
const LABELLED_MARKER = new RegExp(`状态(?!图例)[：:\\s]{0,3}(?:\\*\\*)?(${MARKER_CLASS})`, 'u')

/** 从单行里取状态标记；取不到返回 null。 */
export function statusOf(line) {
  const atStart = MARKER_AT_START.exec(line)
  if (atStart) return atStart[1]
  return LABELLED_MARKER.exec(line)?.[1] ?? null
}

/** 从整篇文档取状态（只看开头 STATUS_HEAD_LINES 行）。返回 { status, markerLine } 。 */
export function documentStatus(text) {
  const lines = text.split(/\r?\n/).slice(0, STATUS_HEAD_LINES)
  for (const [index, line] of lines.entries()) {
    const status = statusOf(line)
    if (status) return { status, markerLine: index }
  }
  return { status: null, markerLine: -1 }
}

/** 递归收集 markdown。INDEX.md 是索引本身，不是被审的方案文档。 */
export function collectPlanDocuments(repoRoot) {
  const walk = (dir) => {
    if (!fs.existsSync(dir)) return []
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) return walk(full)
      return entry.isFile() && entry.name.endsWith('.md') && entry.name !== 'INDEX.md' ? [full] : []
    })
  }
  return PLAN_ROOTS.flatMap((root) => walk(path.join(repoRoot, root)))
    .map((file) => path.relative(repoRoot, file).split(path.sep).join('/'))
    .sort()
}

/** 文档 H1 标题；没有就退回文件名。 */
export function documentTitle(text, relativePath) {
  const match = /^#\s+(.+?)\s*$/m.exec(text)
  const raw = match ? match[1] : path.basename(relativePath, '.md')
  return raw.replace(/\s+/g, ' ').trim()
}
