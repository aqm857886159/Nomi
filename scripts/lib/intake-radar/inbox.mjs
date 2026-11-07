// Intake Radar —— 待分诊账。一条反馈从进缓存到被明确记进待办，这段时间一直在这本账上。
//
// 为什么要有它（2026-11-01 查实）：「新增 N 条」看过一次就清零——seenKeys 是整台机器共享的，谁先跑谁吃掉；
// 同一天第二轮运行还会盖掉第一轮的报告；开会话的摘要又只留输出最后几行，那一行早被别的内容挤出去了。
// 所以「新增」只回答「这一轮多了什么」，「还有谁没人管」归这本账：
//   · 进账是自动的：缓存里有、账上没有的，一律进账，不看 seenKeys（宁可多看一眼，不能漏）；
//   · 出账必须明说记到了哪个待办（`--triaged … --todo …`），雷达再跑多少轮都不会自己清掉。
// 和 Linear Triage 同一个模型：外面来的东西进收件箱，要有人做了决定才离开。
//
// 账放在仓库外的缓存目录。账上只有编号和元数据，没有摘要和留言：原文在 `feedback/` 下面，要看去报告里看。
import fs from 'node:fs'
import path from 'node:path'

const INBOX_FILE = 'inbox.json'

const emptyInbox = () => ({ schemaVersion: 1, items: {} })

function inboxPath(cacheDir) {
  return path.join(cacheDir, INBOX_FILE)
}

/**
 * 读账。没有文件是正常的（还没跑过新版雷达）；文件坏了不抛，从空开始：
 * 下一轮会把缓存里的全部重新记进来，已出账的要再出一次，但一条都不会丢。
 */
export function readInbox(cacheDir) {
  const file = inboxPath(cacheDir)
  if (!fs.existsSync(file)) return { ...emptyInbox(), exists: false, rebuilt: false }
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'))
    if (!raw || typeof raw !== 'object' || !raw.items || typeof raw.items !== 'object' || Array.isArray(raw.items)) throw new Error('形状不对')
    return { schemaVersion: 1, items: raw.items, exists: true, rebuilt: false }
  } catch {
    return { ...emptyInbox(), exists: true, rebuilt: true }
  }
}

/** 先写临时文件再改名：雷达跑超时会被 hook 杀掉，账不能写到一半。 */
export function writeInbox(cacheDir, inbox) {
  fs.mkdirSync(cacheDir, { recursive: true })
  const file = inboxPath(cacheDir)
  const temp = `${file}.${process.pid}.tmp`
  fs.writeFileSync(temp, `${JSON.stringify({ schemaVersion: 1, items: inbox.items }, null, 2)}\n`)
  fs.renameSync(temp, file)
}

/**
 * 把缓存里有、账上没有的记进来。`feedbackItems` 含重复送达的那些（`duplicateOf` 不为空）：
 * 它们也记一行，这样同一个 key 不会被当成新的反复进账，但不算待分诊。读不出来的文件也进账，它也是一份用户发来的反馈。
 */
export function reconcileInbox(inbox, { feedbackItems, corruptKeys = [], seenKeys = {}, nowIso }) {
  const items = { ...inbox.items }
  for (const item of feedbackItems) {
    if (items[item.key]) continue
    items[item.key] = {
      id: item.id,
      date: item.date,
      surface: item.surface,
      version: item.version,
      system: item.system,
      firstSeenAt: seenKeys[item.key] ?? nowIso,
      triagedAt: null,
      todo: null,
      duplicateOf: item.duplicateOf ?? null,
    }
  }
  for (const key of corruptKeys) {
    if (items[key]) continue
    items[key] = {
      id: key,
      date: key.split('/')[1] ?? 'unknown',
      surface: 'unknown',
      version: 'unknown',
      system: 'unknown',
      firstSeenAt: seenKeys[key] ?? nowIso,
      triagedAt: null,
      todo: null,
      duplicateOf: null,
      unreadable: true,
    }
  }
  return { ...inbox, items }
}

/** 还没人管的，新的在前。 */
export function untriagedItems(inbox) {
  return Object.entries(inbox.items)
    .filter(([, item]) => !item.triagedAt && !item.duplicateOf)
    .map(([key, item]) => ({ key, ...item }))
    .sort((a, b) => String(b.date).localeCompare(String(a.date)) || a.key.localeCompare(b.key))
}

/**
 * 出账。全有或全无：有一个编号对不上就整批不动，不留「出了一半」的账。
 * `ids` 是编号或完整 key；`through` 是日期，这天及更早的待分诊全部出账（升级后第一次的一次性对账用）。
 */
export function triageInbox(inbox, { ids = [], through = null, todo, nowIso }) {
  const items = { ...inbox.items }
  const entries = Object.entries(items)
  const targets = new Set()
  for (const id of ids) {
    const matches = entries.filter(([key, item]) => (key === id || item.id === id) && !item.duplicateOf)
    if (matches.length === 0) throw new Error(`账上没有这个编号：${id}`)
    // 接收端的显示号不是原子的，两份不同的报告可能撞号（见 infra/feedback-worker/README.md）。不替人猜是哪份。
    if (matches.length > 1) throw new Error(`编号 ${id} 对应 ${matches.length} 份不同的报告，请用完整 key 分别出账：${matches.map(([key]) => key).join(' ')}`)
    targets.add(matches[0][0])
  }
  if (through) {
    for (const item of untriagedItems(inbox)) {
      if (String(item.date) <= through) targets.add(item.key)
    }
  }
  const newlyTriaged = []
  for (const key of targets) {
    if (items[key].triagedAt) continue
    items[key] = { ...items[key], triagedAt: nowIso, todo }
    newlyTriaged.push(items[key].id)
  }
  return { inbox: { ...inbox, items }, newlyTriaged }
}
