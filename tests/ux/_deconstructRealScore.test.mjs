import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { makeTempDir } from '../../scripts/_test-temp.mjs'
import { uiText } from './full-walk/invariants.mjs'
import {
  CANCEL_EVENT, FASTCUT_PIECES, MAX_PAID_CALLS, MIN_SHOTS_FOR_CANCEL, QUIET_AFTER_CANCEL_MS,
  fastCutFilter, failureLinesOf, judgeCancelScenario, judgeFullScenario, lineCount, logSince, parseCancelLines, readMainLog,
} from './_deconstructRealScore.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const NOTICE = uiText('zh-CN', 'shotTable.cancelled')
const logLine = (event, fields = '') => `[2026-10-27T07:41:02.331Z] INFO  tasks          ${event}${fields ? ` ${fields}` : ''}`
const CANCEL_LINE = logLine(CANCEL_EVENT, 'projectId=project-1793 nodeId=gen-v2-shot_table-abc requestId=11111111-2222-4333-8444-555555555555 quotedCalls=8 sentOrUnknown=4 neverSent=4 transcribe=none')

describe('主进程日志读法', () => {
  it('读出 deconstruct.cancelled 那一行的字段，别的行不理', () => {
    const text = [logLine('session-start', 'version=0.23.2'), CANCEL_LINE, logLine('deconstruct.model-failed', 'projectId=project-1793 shot=3')].join('\n')
    expect(parseCancelLines(text)).toEqual([{
      projectId: 'project-1793', nodeId: 'gen-v2-shot_table-abc', requestId: '11111111-2222-4333-8444-555555555555',
      quotedCalls: 8, sentOrUnknown: 4, neverSent: 4, transcribe: 'none',
    }])
    expect(parseCancelLines('')).toEqual([])
    expect(parseCancelLines(undefined)).toEqual([])
  })

  it('事件名只认整词：别的事件里带这串字符不算', () => {
    expect(parseCancelLines(logLine('xdeconstruct.cancelledx', 'nodeId=n1'))).toEqual([])
  })

  it('失败行只挑 *-failed 的拆解事件，取消那一行不算失败', () => {
    const text = [CANCEL_LINE, logLine('deconstruct.frame-failed', 'shot=2'), logLine('deconstruct.model-failed', 'shot=3'), logLine('deconstruct.transcribe-failed'), logLine('vendor', 'call status=200')].join('\n')
    expect(failureLinesOf(text)).toHaveLength(3)
    expect(failureLinesOf(CANCEL_LINE)).toEqual([])
  })

  it('每个场景只看自己那一段：从第 N 行起', () => {
    expect(logSince('a\nb\nc\nd', 2)).toBe('c\nd')
    expect(logSince('', 0)).toBe('')
  })

  it('读隔离资料目录下的日志：文件以换行结尾也不吞掉场景开始后新增的第一行（行数口径与切法是同一个）', () => {
    const userData = makeTempDir('deconstruct-real-log-')
    const logs = path.join(userData, 'logs')
    fs.mkdirSync(logs)
    const file = path.join(logs, 'nomi-2026-10-27.log')
    fs.writeFileSync(file, `${logLine('session-start')}\n${logLine('rpc-listening')}\n`)
    const before = lineCount(readMainLog(userData))
    expect(before).toBe(2)
    fs.appendFileSync(file, `${CANCEL_LINE}\n`)
    expect(parseCancelLines(logSince(readMainLog(userData), before))).toHaveLength(1)
    expect(parseCancelLines(logSince(readMainLog(userData), before + 1))).toHaveLength(0)
  })

  it('滚动出来的上一代排在前，别的文件名不读', () => {
    const userData = makeTempDir('deconstruct-real-log-')
    const logs = path.join(userData, 'logs')
    fs.mkdirSync(logs)
    fs.writeFileSync(path.join(logs, 'nomi-2026-10-27.log'), `${logLine('newer')}\n`)
    fs.writeFileSync(path.join(logs, 'nomi-2026-10-27.1.log'), `${logLine('older')}\n`)
    fs.writeFileSync(path.join(logs, 'nomi-crash.log'), `${logLine('crash-trail')}\n`)
    const lines = readMainLog(userData).split('\n')
    expect(lines).toHaveLength(2)
    expect(lines[0]).toContain('older')
    expect(lines[1]).toContain('newer')
    expect(readMainLog(path.join(userData, 'no-such-profile'))).toBe('')
  })
})

/** 一个全部达标的取消场景：8 镜，第一镜读完点取消，已发出 4 次，其后 60 次取样都不涨。 */
const goodCancel = () => ({
  preShots: 8, expectedNotice: NOTICE, firstReadDoneAtClick: true,
  wire: { atClick: 4, atLog: 4, quiet: Array(60).fill(4), afterQuiet: 4 },
  groundTruth: { atLog: 4, afterQuiet: 4 },
  cancelLines: parseCancelLines(CANCEL_LINE), failureLines: [], table: { status: 'cancelled', notice: NOTICE },
})
const failedIds = (verdict) => verdict.checks.filter((entry) => !entry.ok).map((entry) => entry.id)

describe('取消场景判分', () => {
  it('全部达标：日志有取消行、收据 = 已过闸行数、取消后不再涨、表停在已取消', () => {
    const verdict = judgeCancelScenario(goodCancel())
    expect(verdict.ok).toBe(true)
    expect(verdict.gaugeProblems).toEqual([])
    expect(verdict.checks.map((entry) => entry.id)).toEqual(expect.arrayContaining(['cancel-logged', 'receipt-equals-passed-gate', 'no-new-calls-after-click', 'no-growth-after-cancel', 'counter-equals-fixture']))
  })

  it('取消之后付费调用数又涨了 → 红（这是这条走查要守的核心：点了取消就不许再发）', () => {
    const facts = goodCancel()
    facts.wire = { atClick: 4, atLog: 4, quiet: [4, 4, 4, 5], afterQuiet: 5 }
    facts.groundTruth = { atLog: 4, afterQuiet: 5 }
    expect(failedIds(judgeCancelScenario(facts))).toEqual(['no-growth-after-cancel'])
  })

  it('点了取消之后，主进程又发出新的付费调用（取消没拦住新的读图）→ 红，不能被当成「取消来得太晚」', () => {
    const facts = goodCancel()
    facts.wire = { atClick: 4, atLog: 8, quiet: Array(60).fill(8), afterQuiet: 8 }
    facts.groundTruth = { atLog: 8, afterQuiet: 8 }
    facts.cancelLines = [{ ...facts.cancelLines[0], sentOrUnknown: 8, neverSent: 0 }]
    const verdict = judgeCancelScenario(facts)
    expect(failedIds(verdict)).toEqual(['no-new-calls-after-click'])
    expect(verdict.checks.find((entry) => entry.id === 'no-new-calls-after-click').detail).toContain('新发出 4 次')
  })

  it('等满之后的读数涨了，哪怕取样当时没看见 → 红', () => {
    const facts = goodCancel()
    facts.wire = { atClick: 4, atLog: 4, quiet: Array(60).fill(4), afterQuiet: 5 }
    facts.groundTruth = { atLog: 4, afterQuiet: 5 }
    expect(failedIds(judgeCancelScenario(facts))).toEqual(['no-growth-after-cancel'])
  })

  it('一次取样都没取到，不能当成「没涨」', () => {
    const facts = goodCancel()
    facts.wire = { atClick: 4, atLog: 4, quiet: [], afterQuiet: 4 }
    expect(failedIds(judgeCancelScenario(facts))).toEqual(['no-growth-after-cancel'])
  })

  it('出站收据和日志里「已过付费闸」的行数对不上 → 红', () => {
    const facts = goodCancel()
    facts.wire = { atClick: 5, atLog: 5, quiet: Array(60).fill(5), afterQuiet: 5 }
    facts.groundTruth = { atLog: 5, afterQuiet: 5 }
    expect(failedIds(judgeCancelScenario(facts))).toEqual(['receipt-equals-passed-gate'])
  })

  it('日志里没有取消那一行（取消没走主进程那条路）→ 红', () => {
    const facts = goodCancel()
    facts.cancelLines = []
    expect(failedIds(judgeCancelScenario(facts))).toEqual(expect.arrayContaining(['cancel-logged', 'receipt-equals-passed-gate', 'quote-equals-shots']))
  })

  it('取消被记成了失败、表没停在已取消、报价行数对不上镜数、夹具收到的和计数器不一样 → 各自红', () => {
    const failure = goodCancel(); failure.failureLines = [logLine('deconstruct.model-failed', 'shot=2')]
    expect(failedIds(judgeCancelScenario(failure))).toEqual(['not-a-failure'])
    const notCancelled = goodCancel(); notCancelled.table = { status: 'failed', notice: '' }
    expect(failedIds(judgeCancelScenario(notCancelled))).toEqual(['table-cancelled'])
    const wrongNotice = goodCancel(); wrongNotice.table = { status: 'cancelled', notice: '这次拆解被中断了' }
    expect(failedIds(judgeCancelScenario(wrongNotice))).toEqual(['table-cancelled'])
    const quote = goodCancel(); quote.preShots = 7
    expect(failedIds(judgeCancelScenario(quote))).toEqual(['quote-equals-shots'])
    const truth = goodCancel(); truth.groundTruth = { atLog: 3, afterQuiet: 3 }
    expect(failedIds(judgeCancelScenario(truth))).toEqual(['counter-equals-fixture'])
  })

  it('量具问题和产品红分开记：取消来得太晚 / 镜数不够 / 不是第一镜读完 / 计数器是 0', () => {
    const late = goodCancel(); late.cancelLines = [{ ...late.cancelLines[0], sentOrUnknown: 8, neverSent: 0 }]; late.wire = { atClick: 8, atLog: 8, quiet: Array(60).fill(8), afterQuiet: 8 }; late.groundTruth = { atLog: 8, afterQuiet: 8 }
    expect(judgeCancelScenario(late).ok).toBe(true)
    expect(judgeCancelScenario(late).gaugeProblems.join()).toContain('取消来得太晚')
    const few = goodCancel(); few.preShots = MIN_SHOTS_FOR_CANCEL - 1
    expect(judgeCancelScenario(few).gaugeProblems.join()).toContain('镜')
    const early = goodCancel(); early.firstReadDoneAtClick = false
    expect(judgeCancelScenario(early).gaugeProblems.join()).toContain('第一镜读完')
    const blind = goodCancel(); blind.wire = { atClick: 0, atLog: 0, quiet: Array(60).fill(0), afterQuiet: 0 }; blind.cancelLines = [{ ...blind.cancelLines[0], sentOrUnknown: 0, neverSent: 8 }]; blind.groundTruth = { atLog: 0, afterQuiet: 0 }
    expect(judgeCancelScenario(blind).gaugeProblems.join()).toContain('计数器')
  })
})

/** 一个全部达标的整片拆完场景：8 镜、区间首尾相接盖到 8 秒、每镜都读出来、一镜一次读图。 */
const goodFull = () => ({
  preShots: 8, durationSeconds: 8,
  table: {
    status: 'ready', failedShotIndexes: [], hasAudio: false,
    rows: Array.from({ length: 8 }, (_, index) => ({
      order: index + 1, startSeconds: index, endSeconds: index + 1, keyframeRef: `nomi-local://project/frame-${index + 1}.png`, visionFailed: false,
      cells: { shotSize: '中景', visual: `第 ${index + 1} 镜画面`, dialogue: '' },
    })),
  },
  wire: { created: 8 }, groundTruth: { arrived: 8 }, cancelLines: [], failureLines: [],
})

describe('整片拆完判分（旧付费 e2e 那一套质量）', () => {
  it('全部达标', () => {
    expect(judgeFullScenario(goodFull())).toMatchObject({ ok: true, gaugeProblems: [] })
  })

  it('镜号不连续 / 区间有缝 / 没盖到片尾 → 各自红', () => {
    const order = goodFull(); order.table.rows[3].order = 9
    expect(failedIds(judgeFullScenario(order))).toEqual(expect.arrayContaining(['order-continuous']))
    const gap = goodFull(); gap.table.rows[4].startSeconds = 4.5
    expect(failedIds(judgeFullScenario(gap))).toEqual(['intervals-contiguous'])
    const tail = goodFull(); tail.durationSeconds = 9
    expect(failedIds(judgeFullScenario(tail))).toEqual(['covers-the-tail'])
  })

  it('有镜没读出画面描述 / 景别、没有原片帧 → 红', () => {
    const empty = goodFull(); empty.table.rows[2].cells.visual = '  '
    expect(failedIds(judgeFullScenario(empty))).toEqual(['every-shot-described'])
    const shotSize = goodFull(); shotSize.table.rows[2].cells.shotSize = ''
    expect(failedIds(judgeFullScenario(shotSize))).toEqual(['every-shot-described'])
    const frame = goodFull(); frame.table.rows[6].keyframeRef = null
    expect(failedIds(judgeFullScenario(frame))).toEqual(['every-shot-has-frame'])
  })

  it('失败镜要诚实回报：行上标了失败，表上也得记着；记了没标同样红', () => {
    const honest = goodFull(); honest.table.rows[1].visionFailed = true; honest.table.failedShotIndexes = [2]
    expect(failedIds(judgeFullScenario(honest))).toEqual([])
    const hidden = goodFull(); hidden.table.rows[1].visionFailed = true
    expect(failedIds(judgeFullScenario(hidden))).toEqual(['failed-shots-honest'])
    const phantom = goodFull(); phantom.table.failedShotIndexes = [2]
    expect(failedIds(judgeFullScenario(phantom))).toEqual(['failed-shots-honest'])
  })

  it('一镜恰好一次读图：多发（重试）或少发都红；整片拆完不该有取消日志、失败日志', () => {
    const extra = goodFull(); extra.wire.created = 9; extra.groundTruth.arrived = 9
    expect(failedIds(judgeFullScenario(extra))).toEqual(['one-read-per-shot'])
    const cancelLog = goodFull(); cancelLog.cancelLines = parseCancelLines(CANCEL_LINE)
    expect(failedIds(judgeFullScenario(cancelLog))).toEqual(['no-cancel-log'])
    const failed = goodFull(); failed.failureLines = [logLine('deconstruct.frame-failed')]
    expect(failedIds(judgeFullScenario(failed))).toEqual(['no-failure-logs'])
    const truth = goodFull(); truth.groundTruth.arrived = 7
    expect(failedIds(judgeFullScenario(truth))).toEqual(['counter-equals-fixture'])
  })

  it('有音轨才要求对白列有内容（登记里的片子没有音轨，这条是为带音轨的片子留的）', () => {
    const silent = goodFull(); silent.table.hasAudio = true
    expect(failedIds(judgeFullScenario(silent))).toEqual(['dialogue-present-with-audio'])
    silent.table.rows[0].cells.dialogue = '你好'
    expect(failedIds(judgeFullScenario(silent))).toEqual([])
  })

  it('表没落到 ready（失败 / 中断 / 又被取消）→ 红', () => {
    const failed = goodFull(); failed.table.status = 'failed'
    expect(failedIds(judgeFullScenario(failed))).toContain('ready')
  })
})

describe('场景定义', () => {
  it('快剪片：8 段取自登记的真素材，每段的起止都落在 15 秒之内，且不压进第二段 6.0–6.7 秒那处镜内闪切', () => {
    expect(FASTCUT_PIECES).toHaveLength(8)
    for (const [start, seconds] of FASTCUT_PIECES) {
      expect(start + seconds).toBeLessThanOrEqual(15)
      expect(start + seconds <= 6.0 || start >= 6.7).toBe(true)
    }
  })

  it('filter_complex：每段一个 trim，最后 concat 成 [v]，无音轨', () => {
    const graph = fastCutFilter()
    expect(graph.match(/trim=start=/g)).toHaveLength(FASTCUT_PIECES.length)
    expect(graph).toContain(`split=${FASTCUT_PIECES.length}`)
    expect(graph).toContain(`concat=n=${FASTCUT_PIECES.length}:v=1:a=0[v]`)
    expect(graph).not.toContain('[0:a]')
  })

  it('数字口径：取消后等 60 秒；整场付费调用上限 = 两个场景各一镜一次', () => {
    expect(QUIET_AFTER_CANCEL_MS).toBe(60_000)
    expect(MAX_PAID_CALLS).toBe(2 * FASTCUT_PIECES.length)
    expect(FASTCUT_PIECES.length).toBeGreaterThanOrEqual(MIN_SHOTS_FOR_CANCEL)
  })
})

describe('构建标记', () => {
  const source = fs.readFileSync(path.join(repoRoot, 'electron/video/deconstructVideo.ts'), 'utf8')
  const walkFiles = ['tests/ux/deconstruct-real.paid.mjs', 'tests/ux/deconstruct-real.rehearsal.walk.mjs']

  it('产品源码里记着这个事件名（会原样进主进程产物；函数名会被压缩，不能当标记）', () => {
    expect(source).toContain(`"${CANCEL_EVENT}"`)
  })

  it.each(walkFiles)('%s 的构建标记就是这个事件名（门岗要求每个文件里写成字面量，这里核两处不漂移）', (file) => {
    const text = fs.readFileSync(path.join(repoRoot, file), 'utf8')
    expect(text).toContain(`const CANCEL_BUILD_MARKER = '${CANCEL_EVENT}'`)
    expect(text).toMatch(/buildMarkers:\s*\[CANCEL_BUILD_MARKER\]/)
  })
})
