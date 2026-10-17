// 付费走查「每一步记事实」的读数与判据（2026-10-16，#1203 两档权限的真付费验收用）。
//
// 只读盘上的事实，不读界面、不猜：
//   · 供应商受理次数 = 制作 Run 里拿到供应商任务号（providerTaskId）的 job 去重 + 画布节点上带任务号的运行记录
//     （同一份读法在 _paidRun.mjs 的 spendReceipt，这里直接用它，不写第二份）；
//   · 收据条数与 decidedBy = 项目 `.nomi/runs/<runId>/approvals.ndjson` 里每条批准记录带的 receiptId，
//     到能力核的收据库（`<capabilityDir>/approval-receipts.json`）里查那张收据的 decidedBy。
//     收据库只读不改；它在隔离副本里，跑完随副本一起删，所以事实必须在副本删除之前取走。
// 判据（step*Verdict）是纯函数：喂事实、吐「哪里不对」的清单，空清单 = 这一步成立。
import fs from 'node:fs'
import path from 'node:path'

import { laneMessages, readLaneTranscripts } from './agent-lane-observer.mjs'
import { readProductionRuns, spendReceipt } from './_paidRun.mjs'

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) } catch { return null }
}

function readJsonLines(file) {
  if (!fs.existsSync(file)) return []
  return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((line) => {
    try { return JSON.parse(line) } catch { return null }
  }).filter(Boolean)
}

/** 收据库里 receiptId → decidedBy。库不在或读不出来 = 空表（事实里会记成 'unknown'，不编）。 */
export function readDecidedByTable(capabilityDir) {
  const store = readJson(path.join(capabilityDir ?? '', 'approval-receipts.json'))
  const table = new Map()
  for (const [key, record] of Object.entries(store?.receipts ?? {})) {
    const receipt = record?.receipt
    if (receipt?.decidedBy) table.set(receipt.receiptId ?? key, receipt.decidedBy)
  }
  return table
}

/**
 * 此刻盘上的付费事实快照。每一步前后各取一次，步的事实 = 两次的差（见 `deltaFacts`）。
 * 返回里只有计数、id、状态词；不含 key，不含提示词原文。
 */
export function readSpendFacts({ projectRoot, capabilityDir }) {
  const decidedByOf = readDecidedByTable(capabilityDir)
  const runs = readProductionRuns(projectRoot)
  const approvals = []
  for (const run of runs) {
    const file = path.join(projectRoot, '.nomi', 'runs', run.runId, 'approvals.ndjson')
    for (const approval of readJsonLines(file)) {
      approvals.push({
        runId: run.runId, approvalId: approval.approvalId, receiptId: approval.receiptId ?? null,
        decidedBy: approval.receiptId ? decidedByOf.get(approval.receiptId) ?? 'unknown' : 'none',
        jobIds: approval.jobIds ?? [], revoked: Boolean(approval.revokedAt),
      })
    }
  }
  const media = spendReceipt(projectRoot).media
  const accepted = media.filter((entry) => entry.taskId)
  const jobs = runs.flatMap((run) => (run.jobs ?? []).map((job) => ({
    runId: run.runId, jobId: job.jobId, status: job.status, providerTaskId: job.providerTaskId ?? null,
  })))
  return {
    accepted: accepted.length,
    taskIds: accepted.map((entry) => entry.taskId),
    // 文稿方案 / 画布单镜的 Run 把供应商记成 `canvas:<供应商>`（演练实测 canvas:apimart）：判「花在谁身上」时去掉这层前缀。
    models: [...new Set(media.map((entry) => `${String(entry.vendor).replace(/^canvas:/, "")}/${entry.model}`))],
    runs: runs.length,
    receipts: approvals.filter((approval) => approval.receiptId).length,
    decidedBy: approvals.filter((approval) => approval.receiptId).map((approval) => approval.decidedBy),
    approvals,
    jobs,
  }
}

/**
 * 轻量读法：供应商已受理的次数，只数制作 Run 里拿到任务号的 job（不读项目文档与 Agent 转录）。
 * 保险丝和「受理第一张就点停止」的 100ms 轮询用它；完整事实用 readSpendFacts。
 */
export function acceptedByRuns(projectRoot) {
  return new Set(readProductionRuns(projectRoot).flatMap((run) => (run.jobs ?? []).map((job) => job.providerTaskId).filter(Boolean))).size
}

/**
 * Agent 转录里调过几次某个工具（按 toolCall 数，不看结果）。转录读不出来返回 -1（调用方当「不知道」，不当 0）。
 * 「大脑没调 generate」就靠它判：D-L19 诊断（2026-10-16）V4 Flash 建了 3 次草稿、一次 generate 都没调，
 * 「直接生成」档的代答根本没被触发——那不是档位的问题，走查要当场说清、别往下花 token。
 */
export function countLaneToolCalls(projectRoot, toolName) {
  try {
    let count = 0
    for (const session of readLaneTranscripts(projectRoot)) {
      for (const message of laneMessages(session)) {
        if (message.role !== 'assistant' || !Array.isArray(message.content)) continue
        count += message.content.filter((part) => part.type === 'toolCall' && part.name === toolName).length
      }
    }
    return count
  } catch { return -1 }
}

/** 两次快照之差：这一步新增了什么。 */
export function deltaFacts(before, after) {
  const seenTasks = new Set(before.taskIds)
  const seenApprovals = new Set(before.approvals.map((approval) => approval.approvalId))
  const approvals = after.approvals.filter((approval) => !seenApprovals.has(approval.approvalId))
  const newReceipts = approvals.filter((approval) => approval.receiptId)
  return {
    accepted: after.taskIds.filter((id) => !seenTasks.has(id)).length,
    receipts: newReceipts.length,
    decidedBy: newReceipts.map((approval) => approval.decidedBy),
    approvals,
  }
}

const countBy = (values) => values.reduce((acc, value) => ({ ...acc, [value]: (acc[value] ?? 0) + 1 }), {})

// ── 判据（纯函数：事实 → 哪里不对）──────────────────────────────────────────────

/** 步骤 1：切到直接生成。切档本身不花钱：不能有新的受理、不能有新的收据。 */
export function stepSwitchVerdict({ mode, delta }) {
  const problems = []
  if (mode !== 'direct') problems.push(`确认之后档位应为 direct，实际 ${mode}`)
  if (delta.accepted !== 0) problems.push(`切档不该花钱，供应商新受理 ${delta.accepted} 次`)
  if (delta.receipts !== 0) problems.push(`切档不该铸收据，新增 ${delta.receipts} 条`)
  return problems
}

/** 步骤 2：直接生成档下前两镜——不弹报价卡 / 确认框、受理恰好 N 次、收据（每道门一条）全是策略代答。 */
export function stepDirectBatchVerdict({ expected, cardAppearances, dialogAppearances = 0, delta, models, allowedModel }) {
  const problems = []
  if (cardAppearances !== 0) problems.push(`直接生成档下报价卡不该弹，实际弹了 ${cardAppearances} 次`)
  if (dialogAppearances !== 0) problems.push(`直接生成档下弹出了全局确认框（旧版 SpendConfirmDialog）${dialogAppearances} 次——这一笔没有走策略代答`)
  if (delta.accepted !== expected) problems.push(`供应商受理次数应为 ${expected}，实际 ${delta.accepted}`)
  // 收据按「付费门」铸：一批 N 镜可以共用一道门（loopback 演练里画布 2 镜 = 1 张收据），所以下限是 1、上限是镜数；
  // 实际条数照实记进报告，由协调会话对照 D-L19 写的「2 条」看。
  if (delta.receipts < 1 || delta.receipts > expected) problems.push(`收据应为 1～${expected} 条（每道付费门一条），实际 ${delta.receipts}`)
  const bySource = countBy(delta.decidedBy)
  if (Object.keys(bySource).some((source) => source !== 'policy:full_auto')) problems.push(`decidedBy 应全是 policy:full_auto，实际 ${JSON.stringify(bySource)}`)
  const stray = models.filter((model) => model !== allowedModel)
  if (stray.length) problems.push(`花在了被授权模型之外：${stray.join('、')}`)
  return problems
}

/**
 * 步骤 2（文稿方案，直接生成档）：#1224 协调定 A——文稿方案两档下都**每批问一次**（整批确认「生成这 N 项？」，如实标注），
 * 直接生成档对它不代答。所以预期是：整批确认**恰好弹一次**（没弹 = 档位悄悄代答了，弹两次 = 重复问），点确认后受理 N 次、
 * 收据 1～N 条、决定人是人（不是 policy:full_auto）。Agent 面板的报价卡不该出现（文稿方案没有出价）。
 */
export function stepManuscriptBatchVerdict({ expected, batchDialogs, cardAppearances = 0, delta, models, allowedModel }) {
  const problems = []
  if (batchDialogs !== 1) problems.push(`文稿方案的整批确认应恰好弹 1 次（#1224：两档下都每批问一次），实际 ${batchDialogs} 次`)
  if (cardAppearances !== 0) problems.push(`文稿方案不该出 Agent 面板报价卡，实际出了 ${cardAppearances} 次`)
  if (delta.accepted !== expected) problems.push(`点确认后供应商受理次数应为 ${expected}，实际 ${delta.accepted}`)
  if (delta.receipts < 1 || delta.receipts > expected) problems.push(`收据应为 1～${expected} 条，实际 ${delta.receipts}`)
  if (delta.decidedBy.some((source) => source === 'policy:full_auto')) problems.push(`文稿方案是人点的整批确认，decidedBy 不该是 policy:full_auto，实际 ${JSON.stringify(delta.decidedBy)}`)
  const stray = models.filter((model) => model !== allowedModel)
  if (stray.length) problems.push(`花在了被授权模型之外：${stray.join('、')}`)
  return problems
}

/**
 * 步骤 3：计划外的镜——报价卡立刻弹、卡上有刹车那一行、点「去掉」之后供应商受理次数不变（刹车不铸收据、不发请求）。
 * 模型这一步另起了新方案时刹车拦不到（拍板项 5 的边界）：不算失败，`boundary` 记 true，其余判据不看。
 * `acceptedTotal` = 这条消息起到此刻的受理总数；`plannedFront` = 前面说好的镜数。
 */
export function stepBrakeVerdict({ cardAppeared, brakeLineShown, acceptedTotal, deltaAfterRemove, plannedFront = 2 }) {
  const problems = []
  let boundary = false
  if (!cardAppeared) {
    if (acceptedTotal > plannedFront) boundary = true // 模型另起了新方案并被直接代答：记为边界，不算失败
    else problems.push('补第 3 镜之后既没弹报价卡、也没有多出受理——这一步什么都没发生，无法判断')
  } else {
    if (!brakeLineShown) problems.push('报价卡弹了，但卡上没有计划外刹车那一行')
    if (deltaAfterRemove.accepted !== 0) problems.push(`点「去掉」之后供应商不该再受理，新增 ${deltaAfterRemove.accepted} 次`)
    if (deltaAfterRemove.receipts !== 0) problems.push(`刹车不该铸收据，新增 ${deltaAfterRemove.receipts} 条`)
  }
  return { problems, boundary }
}

/** 步骤 4：供应商受理第一张后点停止——停止后新增提交 0；已交出的那张照常完成、只扣一次；重开面板后没有重复提交。 */
export function stepStopVerdict({ acceptedAtStop, acceptedAfterSettle, acceptedAfterReopen, deliveredTaskIds }) {
  const problems = []
  if (acceptedAfterSettle - acceptedAtStop !== 0) problems.push(`停止之后新增提交应为 0，实际 ${acceptedAfterSettle - acceptedAtStop}`)
  if (acceptedAfterReopen - acceptedAfterSettle !== 0) problems.push(`重开面板后不该有重复提交，实际新增 ${acceptedAfterReopen - acceptedAfterSettle}`)
  if (deliveredTaskIds.length < 1) problems.push('已受理的那张最后没有交出成品（job 没到 adopted / ready）——「已交出的照常完成」不成立')
  if (new Set(deliveredTaskIds).size !== deliveredTaskIds.length) problems.push('已交出的图出现重复的供应商任务号（同一张被扣了不止一次）')
  return problems
}
