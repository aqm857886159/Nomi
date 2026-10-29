// 拆解「点取消 + 整片拆完」走查的判分与量具读法（纯函数：不起 App、不花钱）。
// 真付费走查（deconstruct-real.paid.mjs）与零花费演练（deconstruct-real.rehearsal.walk.mjs）共用步骤 _deconstructRealSteps.mjs；
// 步骤从被测 App 里量事实（出站计数、主进程日志、表的状态），判分只在这里。
//
// 两个场景各一个判据：
//   · 取消：拆一条 8 镜的片子，读图并发 4，第一镜读完那一刻点「取消拆解」——
//       主进程日志出现 deconstruct.cancelled；取消之后等 60 秒，付费调用数不再增长；
//       出站调用数（收据）= 日志里「已过付费闸」的行数（sentOrUnknown）；点下去之后到收尾为止没有新发出的付费调用；取消不记成失败；表停在「已取消」。
//   · 整片拆完：同一张表再点「拆解」（取消不是死胡同），整片拆完，判原先那条付费拆解 e2e（已删，由本走查取代）那一套质量：
//       镜号连续、区间首尾相接且盖到片尾、每镜有画面描述与景别、每镜有原片帧、失败镜诚实回报；加：一镜恰好一次读图、没有取消日志。
//
// 判据分两档：checks 是产品的事实（红 = 产品有毛病）；gaugeProblems 是量具没能证明任何事（取消来得太晚、镜数不够……），
// 那一场的数不能用，但它不是「产品红」——真付费花了钱却什么都没证明，要明着说出来。

import fs from 'node:fs'
import path from 'node:path'

/** 取消那一刻主进程记的日志事件名（electron/video/deconstructVideo.ts）。修前不存在，也是付费走查的构建标记。 */
export const CANCEL_EVENT = 'deconstruct.cancelled'
/** 取消之后等多久，付费调用数不许再涨（协调口径）。 */
export const QUIET_AFTER_CANCEL_MS = 60_000
/** 取消场景要的最少镜数：读图并发 4，镜数不比 4 多多少，「第一镜读完」那一刻可能已经没有「还没发的」，取消什么都没拦就证明不了闸。 */
export const MIN_SHOTS_FOR_CANCEL = 6
/** 整场付费调用数的硬上限（取消场景 ≤ 8 + 整片场景 = 8）：走查盯着出站计数，越过就当场停，不指望判分兜底。 */
export const MAX_PAID_CALLS = 16

const FAILURE_EVENT = /\bdeconstruct\.[a-z-]+-failed\b/

function pairsOf(text) {
  const fields = {}
  for (const match of String(text).matchAll(/(\w+)=(\S+)/g)) fields[match[1]] = match[2]
  return fields
}

const CANCEL_LINE = new RegExp(`\\b${CANCEL_EVENT.replace(/\./g, '\\.')}\\b(.*)$`)

/** 主进程日志（一行一条，`[时间] 级别 域 事件 k=v …`）里 deconstruct.cancelled 那几行的字段。 */
export function parseCancelLines(logText) {
  const lines = []
  for (const line of String(logText ?? '').split('\n')) {
    const match = CANCEL_LINE.exec(line)
    if (!match) continue
    const fields = pairsOf(match[1])
    lines.push({
      projectId: fields.projectId ?? null, nodeId: fields.nodeId ?? null, requestId: fields.requestId ?? null,
      quotedCalls: Number(fields.quotedCalls), sentOrUnknown: Number(fields.sentOrUnknown), neverSent: Number(fields.neverSent),
      transcribe: fields.transcribe ?? null,
    })
  }
  return lines
}

/** 日志里记成失败的拆解事件（抽帧 / 读图 / 取音轨 / 转写）。取消不该留下任何一条。 */
export function failureLinesOf(logText) {
  return String(logText ?? '').split('\n').filter((line) => FAILURE_EVENT.test(line))
}

/**
 * 被测 App 的主进程日志全文（隔离资料目录下 logs/nomi-<日期>.log，滚动出来的上一代排在前）。
 * 只留非空行、行与行用 \n 连起来（末尾不带换行）：「第 N 行之后新增的」按行数切，行数口径必须与 logSince 的切法是同一个，
 * 不然文件末尾那个换行会让新增的第一行被数进「之前」。
 */
export function readMainLog(userDataDir) {
  const dir = path.join(userDataDir, 'logs')
  if (!fs.existsSync(dir)) return ''
  return fs.readdirSync(dir).filter((name) => /^nomi-\d{4}-\d{2}-\d{2}(?:\.\d+)?\.log$/.test(name)).sort()
    .flatMap((name) => fs.readFileSync(path.join(dir, name), 'utf8').split('\n')).filter(Boolean).join('\n')
}

/** readMainLog 的行数（与 logSince 同一个口径）。 */
export const lineCount = (text) => (text ? String(text).split('\n').length : 0)

/** 日志文本从 `fromLine` 行（含）之后新增的部分：每个场景只看自己那一段。 */
export function logSince(logText, fromLine) {
  return String(logText ?? '').split('\n').slice(fromLine).join('\n')
}

const check = (id, ok, detail) => ({ id, ok: Boolean(ok), detail })
const seriesIs = (samples, value) => samples.length > 0 && samples.every((sample) => sample === value)

/**
 * 取消场景的判分。facts 全是步骤量来的事实：
 *   preShots            开拆前本地切点数出的镜数（没有音轨 → 报价只有读图行，没有转写行）
 *   firstReadDoneAtClick 点取消那一刻，出站里已经有一次读图完整回来了（真的「第一镜读完」）
 *   wire                { atClick, atLog, quiet: number[], afterQuiet }：出站「已创建」的付费 POST 数在这几个时刻的读数
 *                        （atClick = 点下「取消拆解」那一刻；atLog = 日志里 deconstruct.cancelled 出现、在途的都收尾之后；quiet = 其后每一秒的读数）
 *   groundTruth?        演练才有：夹具收到的读图请求数 { atLog, afterQuiet }——证明出站计数本身是对的
 *   cancelLines         这一场新增的 deconstruct.cancelled 行（已按表节点过滤）
 *   failureLines        这一场新增的 *-failed 日志行
 *   table               { status, notice }；expectedNotice 是词典里「已取消」那一句
 */
export function judgeCancelScenario(facts) {
  const { preShots, wire, groundTruth, cancelLines, failureLines, table, expectedNotice } = facts
  const line = cancelLines.length === 1 ? cancelLines[0] : null
  const checks = [
    check('cancel-logged', cancelLines.length === 1, `主进程日志里这次拆解的 ${CANCEL_EVENT} 有 ${cancelLines.length} 行（要恰好 1 行）`),
    check('not-a-failure', failureLines.length === 0, failureLines.length ? `取消被记成了失败：${failureLines[0].slice(0, 160)}` : '零条 *-failed 日志'),
    check('table-cancelled', table.status === 'cancelled' && String(table.notice ?? '').trim() === String(expectedNotice ?? '').trim(), `表状态 ${table.status}；顶上那句：${JSON.stringify(table.notice)}`),
    check('receipt-equals-passed-gate', Boolean(line) && wire.atLog === line.sentOrUnknown,
      `出站收据 ${wire.atLog} 次付费调用，日志「已过付费闸」${line ? line.sentOrUnknown : '（没有日志行）'} 次`),
    check('quote-equals-shots', Boolean(line) && line.quotedCalls === preShots, `报价 ${line ? line.quotedCalls : '（没有日志行）'} 行，本地数出 ${preShots} 镜`),
    // 点下去那一刻已发出多少次，到取消收尾（日志出现、在途的都收完）为止，一次不许多：点了取消之后主进程不再发新的付费调用。
    // 取消那一刻已经过闸的那几次在点击之前就已经创建出站请求，所以不在这个差里；差 > 0 = 点了之后又有新的调用过了闸。
    check('no-new-calls-after-click', wire.atLog === wire.atClick,
      `点取消时已发出 ${wire.atClick} 次，取消收尾时 ${wire.atLog} 次：点了之后新发出 ${wire.atLog - wire.atClick} 次`),
    check('no-growth-after-cancel', seriesIs(wire.quiet, wire.atLog) && wire.afterQuiet === wire.atLog,
      `取消收尾后 ${wire.atLog} 次；其后 ${wire.quiet.length} 次取样 ${[...new Set(wire.quiet)].join('/') || '（没取到样）'}；等满后 ${wire.afterQuiet}`),
    ...(groundTruth ? [check('counter-equals-fixture', groundTruth.atLog === wire.atLog && groundTruth.afterQuiet === wire.afterQuiet,
      `出站计数 ${wire.atLog}→${wire.afterQuiet}，夹具收到 ${groundTruth.atLog}→${groundTruth.afterQuiet}`)] : []),
  ]
  const gaugeProblems = []
  if (preShots < MIN_SHOTS_FOR_CANCEL) gaugeProblems.push(`只有 ${preShots} 镜（< ${MIN_SHOTS_FOR_CANCEL}）：并发 4，取消那一刻几乎没有「还没发」的读图，证明不了付费闸`)
  if (!facts.firstReadDoneAtClick) gaugeProblems.push('点取消时还没有一次读图回来：不是「第一镜读完」那个时机')
  if (line && line.neverSent < 1) gaugeProblems.push('取消来得太晚：报价的读图在点取消之前已经全部发出，取消没有拦下任何一次，证明不了付费闸')
  if (wire.atClick < 1) gaugeProblems.push('点取消时出站计数是 0：计数器没看见任何付费请求，「不再增长」不作数')
  return { ok: checks.every((entry) => entry.ok), checks, gaugeProblems }
}

/**
 * 整片拆完的判分。facts：
 *   preShots / durationSeconds    本地数出的镜数；表上记的片长（秒）
 *   table                         { status, rows[], failedShotIndexes, hasAudio }（rows 取自表文档：order / startSeconds / endSeconds / keyframeRef / visionFailed / cells）
 *   wire.created                  这个场景里出站「已创建」的付费 POST 数；groundTruth.arrived（演练）夹具收到的读图请求数
 *   cancelLines / failureLines    这个场景新增的日志行
 */
export function judgeFullScenario(facts) {
  const { preShots, durationSeconds, table, wire, groundTruth, cancelLines, failureLines } = facts
  const { rows } = table
  const sorted = [...rows].sort((a, b) => a.order - b.order)
  const described = sorted.filter((row) => String(row.cells?.visual ?? '').trim() && String(row.cells?.shotSize ?? '').trim()).length
  const withFrame = sorted.filter((row) => row.keyframeRef).length
  const failedByRow = sorted.filter((row) => row.visionFailed).map((row) => row.order)
  const contiguous = sorted.every((row, index) => index === 0 || Math.abs(row.startSeconds - sorted[index - 1].endSeconds) < 0.01)
  const spoken = sorted.filter((row) => String(row.cells?.dialogue ?? '').trim()).length
  const checks = [
    check('ready', table.status === 'ready', `表状态 ${table.status}`),
    check('shots-at-least-two', rows.length >= 2, `${rows.length} 镜`),
    check('shots-equal-local-count', rows.length === preShots, `表 ${rows.length} 行，本地切点数出 ${preShots} 镜`),
    check('order-continuous', sorted.every((row, index) => row.order === index + 1), `镜号 ${sorted.map((row) => row.order).join(',')}`),
    check('intervals-contiguous', contiguous, '每镜起点 = 上一镜终点（不重叠不留缝）'),
    check('covers-the-tail', sorted.length > 0 && Math.abs(sorted[sorted.length - 1].endSeconds - durationSeconds) < 0.5,
      `最后一镜终点 ${sorted.length ? sorted[sorted.length - 1].endSeconds : '—'}s，片长 ${durationSeconds}s`),
    check('every-shot-described', rows.length > 0 && described === rows.length, `${described}/${rows.length} 镜有画面描述 + 景别`),
    check('every-shot-has-frame', rows.length > 0 && withFrame === rows.length, `${withFrame}/${rows.length} 镜有原片帧`),
    ...(table.hasAudio ? [check('dialogue-present-with-audio', spoken > 0, `${spoken}/${rows.length} 镜有对白`)] : []),
    check('failed-shots-honest', Array.isArray(table.failedShotIndexes) && failedByRow.join() === [...table.failedShotIndexes].sort((a, b) => a - b).join(),
      `表上记的失败镜 [${(table.failedShotIndexes ?? []).join(',')}]，行上标的 [${failedByRow.join(',')}]`),
    check('one-read-per-shot', wire.created === preShots, `出站 ${wire.created} 次付费调用，${preShots} 镜（逐镜一次、不重试）`),
    check('no-cancel-log', cancelLines.length === 0, `${CANCEL_EVENT} 有 ${cancelLines.length} 行（整片拆完不该有）`),
    check('no-failure-logs', failureLines.length === 0, failureLines.length ? failureLines[0].slice(0, 160) : '零条 *-failed 日志'),
    ...(groundTruth ? [check('counter-equals-fixture', groundTruth.arrived === wire.created, `出站计数 ${wire.created}，夹具收到 ${groundTruth.arrived}`)] : []),
  ]
  return { ok: checks.every((entry) => entry.ok), checks, gaugeProblems: [] }
}

// ── 场景定义：这条片子怎么从登记的真素材里切出来 ──────────────────────────────────────────────
// 登记的 15 秒真镜头（tests/ux/real-media-fixtures.json 的 video-canvas-follow-hand-1080p15）按产品自己的切点检测只切出 5 镜，
// 而读图并发 4：第一镜读完那一刻，剩下的几乎都已经发出，取消什么都没拦住，证明不了付费闸。所以从它里面再切一条 8 镜快剪片——
// 三段不同的真镜头（便利店店员 / 图书馆雨门 / 店员背影）轮流取 8 段（每段 0.7–1.1 秒），每个接缝都是硬切（实测场景分 0.31–0.53，
// 检测下限 0.1），不带音轨（没有转写那一行，也就不碰本机转写）。取段的起点避开第二段里 6.0–6.7 秒那处镜内闪切。
export const FASTCUT_SOURCE_ASSET = 'video-canvas-follow-hand-1080p15'
export const FASTCUT_PIECES = Object.freeze([[0.4, 1.1], [7.0, 1.0], [10.4, 1.1], [2.5, 1.0], [8.6, 1.0], [12.0, 1.1], [3.8, 1.0], [5.3, 0.7]])

/** 取段 → ffmpeg 的 filter_complex（每段 trim、缩到 640×360，再首尾相接；输出标签 [v]）。 */
export function fastCutFilter(pieces = FASTCUT_PIECES) {
  const labels = pieces.map((_, index) => `a${index}`)
  return [
    `[0:v]split=${pieces.length}${labels.map((label) => `[${label}]`).join('')}`,
    ...pieces.map(([start, seconds], index) => `[a${index}]trim=start=${start}:duration=${seconds},setpts=PTS-STARTPTS,scale=640:360[v${index}]`),
    `${pieces.map((_, index) => `[v${index}]`).join('')}concat=n=${pieces.length}:v=1:a=0[v]`,
  ].join(';')
}

/** 一句话摘要（报告与终端都印这个）。 */
export function describeVerdict(name, verdict) {
  const failed = verdict.checks.filter((entry) => !entry.ok)
  return `${name}：${verdict.ok && verdict.gaugeProblems.length === 0 ? '全部达标' : `未达标 ${failed.length} 项${verdict.gaugeProblems.length ? `、量具问题 ${verdict.gaugeProblems.length} 个` : ''}`}`
    + verdict.checks.map((entry) => `\n  ${entry.ok ? '✓' : '✗'} ${entry.id} — ${entry.detail}`).join('')
    + verdict.gaugeProblems.map((problem) => `\n  ⚠ 量具：${problem}`).join('')
}
