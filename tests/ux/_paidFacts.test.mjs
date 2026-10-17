import { makeTempDir } from '../../scripts/_test-temp.mjs'
// 真付费验收的「事实读数」与「判据」：用合成的项目目录 / 收据库钉住，不起 App、不花钱。
import fs from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import {
  acceptedByRuns, deltaFacts, readDecidedByTable, readSpendFacts, stepBrakeVerdict, stepDirectBatchVerdict, stepManuscriptBatchVerdict, stepStopVerdict, stepSwitchVerdict,
} from './_paidFacts.mjs'
import { IMAGE_HARD_CAP, collectProblems, createSpendCap, waitForSpendUiOrIdle } from './_permissionTiersPaidSteps.mjs'

const roots = []
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }) })

/** 造一个项目目录 + 能力核收据库。runs: [{ runId, jobs:[{jobId, providerTaskId?, status}], approvals:[{approvalId, receiptId, decidedBy}] }] */
function fixture(runs) {
  const root = makeTempDir('nomi-paid-facts-test-')
  roots.push(root)
  const projectRoot = path.join(root, 'project')
  const capabilityDir = path.join(root, 'capability')
  fs.mkdirSync(capabilityDir, { recursive: true })
  const receipts = {}
  runs.forEach((run, index) => {
    const dir = path.join(projectRoot, '.nomi', 'runs', run.runId)
    fs.mkdirSync(dir, { recursive: true })
    const jobs = run.jobs.map((job) => ({ provider: 'apimart', model: 'z-image-turbo', ...job }))
    fs.writeFileSync(path.join(dir, 'run.json'), JSON.stringify({ run: { runId: run.runId, createdAt: `2026-10-16T00:0${index}:00Z`, jobs } }))
    fs.writeFileSync(path.join(dir, 'approvals.ndjson'), run.approvals.map((approval) => JSON.stringify({ runId: run.runId, jobIds: [], ...approval })).join('\n') + '\n')
    for (const approval of run.approvals) if (approval.receiptId && approval.decidedBy) receipts[approval.receiptId] = { receipt: { receiptId: approval.receiptId, decidedBy: approval.decidedBy } }
  })
  fs.writeFileSync(path.join(capabilityDir, 'approval-receipts.json'), JSON.stringify({ receipts }))
  return { projectRoot, capabilityDir }
}

const twoShotRun = {
  runId: 'run-a',
  jobs: [{ jobId: 'j1', providerTaskId: 'task-1', status: 'adopted' }, { jobId: 'j2', providerTaskId: 'task-2', status: 'adopted' }],
  approvals: [
    { approvalId: 'ap1', receiptId: 'r1', decidedBy: 'policy:full_auto' },
    { approvalId: 'ap2', receiptId: 'r2', decidedBy: 'policy:full_auto' },
  ],
}

describe('readSpendFacts：从盘上读事实', () => {
  test('受理次数 = 拿到供应商任务号的 job；收据条数与 decidedBy 经收据库查出来', () => {
    const { projectRoot, capabilityDir } = fixture([twoShotRun])
    const facts = readSpendFacts({ projectRoot, capabilityDir })
    expect(facts.accepted).toBe(2)
    expect(facts.receipts).toBe(2)
    expect(facts.decidedBy).toEqual(['policy:full_auto', 'policy:full_auto'])
    expect(facts.models).toEqual(['apimart/z-image-turbo'])
  })

  test('Run 把供应商记成 canvas:<供应商> 时，models 去掉这层前缀', () => {
    const { projectRoot, capabilityDir } = fixture([{ runId: 'run-m', jobs: [{ jobId: 'j1', providerTaskId: 't1', status: 'adopted', provider: 'canvas:apimart', model: 'z-image-turbo' }], approvals: [] }])
    expect(readSpendFacts({ projectRoot, capabilityDir }).models).toEqual(['apimart/z-image-turbo'])
  })

  test('没拿到供应商任务号的 job（刹车 / 被拒）不算受理；收据库里查不到的收据记 unknown，不编', () => {
    const { projectRoot, capabilityDir } = fixture([{
      runId: 'run-b', jobs: [{ jobId: 'j3', status: 'needs_attention' }], approvals: [{ approvalId: 'ap3', receiptId: 'r-missing' }],
    }])
    const facts = readSpendFacts({ projectRoot, capabilityDir })
    expect(facts.accepted).toBe(0)
    expect(facts.decidedBy).toEqual(['unknown'])
  })

  test('收据库缺失 = 空表，不抛', () => {
    expect(readDecidedByTable(path.join(makeTempDir('nomi-paid-facts-empty-'), 'none')).size).toBe(0)
  })

  test('deltaFacts：只数这一步新增的', () => {
    const { projectRoot, capabilityDir } = fixture([twoShotRun])
    const before = readSpendFacts({ projectRoot, capabilityDir })
    const none = deltaFacts(before, before)
    expect(none).toMatchObject({ accepted: 0, receipts: 0, decidedBy: [] })
    const second = fixture([twoShotRun, { runId: 'run-c', jobs: [{ jobId: 'j9', providerTaskId: 'task-9', status: 'adopted' }], approvals: [{ approvalId: 'ap9', receiptId: 'r9', decidedBy: 'human:gesture' }] }])
    const after = readSpendFacts(second)
    const delta = deltaFacts(before, after)
    expect(delta.accepted).toBe(1)
    expect(delta.decidedBy).toEqual(['human:gesture'])
  })
})

const ok = { accepted: 0, receipts: 0, decidedBy: [] }
const two = { accepted: 2, receipts: 2, decidedBy: ['policy:full_auto', 'policy:full_auto'] }

describe('acceptedByRuns：轻量受理数', () => {
  test('只数拿到任务号的 job，重复的任务号只算一次', () => {
    const { projectRoot } = fixture([{ runId: 'run-x', jobs: [{ jobId: 'a', providerTaskId: 't1' }, { jobId: 'b', providerTaskId: 't1' }, { jobId: 'c' }], approvals: [] }])
    expect(acceptedByRuns(projectRoot)).toBe(1)
  })
})

describe('判据：成立时返回空清单，不成立时说清哪里不对', () => {
  test('步骤 1 切档：档位不对、花了钱、铸了收据都红', () => {
    expect(stepSwitchVerdict({ mode: 'direct', delta: ok })).toEqual([])
    expect(stepSwitchVerdict({ mode: 'request', delta: { ...ok, accepted: 1, receipts: 1 } })).toHaveLength(3)
  })

  test('步骤 2 直接生成前两镜：弹了卡 / 受理数不对 / 收据数不对 / decidedBy 不是策略 / 花在授权之外，各自红', () => {
    const base = { expected: 2, cardAppearances: 0, delta: two, models: ['apimart/z-image-turbo'], allowedModel: 'apimart/z-image-turbo' }
    expect(stepDirectBatchVerdict(base)).toEqual([])
    expect(stepDirectBatchVerdict({ ...base, cardAppearances: 1 })).toHaveLength(1)
    expect(stepDirectBatchVerdict({ ...base, dialogAppearances: 1 }).join()).toContain('全局确认框')
    expect(stepDirectBatchVerdict({ ...base, delta: { ...two, accepted: 1 } })).toHaveLength(1)
    expect(stepDirectBatchVerdict({ ...base, delta: { ...two, receipts: 1, decidedBy: ['policy:full_auto'] } }), '一批 2 镜共用一道门 = 1 张收据，成立').toEqual([])
    expect(stepDirectBatchVerdict({ ...base, delta: { ...two, receipts: 0, decidedBy: [] } })).toHaveLength(1)
    expect(stepDirectBatchVerdict({ ...base, delta: { ...two, receipts: 3 } })).toHaveLength(1)
    expect(stepDirectBatchVerdict({ ...base, delta: { ...two, decidedBy: ['policy:full_auto', 'human:gesture'] } })).toHaveLength(1)
    expect(stepDirectBatchVerdict({ ...base, models: ['apimart/gpt-image-2'] })).toHaveLength(1)
  })

  test('步骤 2 文稿方案（#1224：每批问一次）：整批确认恰好 1 次、受理 N、收据 1～N、决定人是人才成立；没弹 / 弹两次 / 出卡 / 代答 / 受理不对各自红', () => {
    const human = { accepted: 2, receipts: 1, decidedBy: ['human:gesture'] }
    const base = { expected: 2, batchDialogs: 1, cardAppearances: 0, delta: human, models: ['apimart/z-image-turbo'], allowedModel: 'apimart/z-image-turbo' }
    expect(stepManuscriptBatchVerdict(base)).toEqual([])
    expect(stepManuscriptBatchVerdict({ ...base, batchDialogs: 0 }).join()).toContain('恰好弹 1 次')
    expect(stepManuscriptBatchVerdict({ ...base, batchDialogs: 2 }).join()).toContain('恰好弹 1 次')
    expect(stepManuscriptBatchVerdict({ ...base, cardAppearances: 1 })).toHaveLength(1)
    expect(stepManuscriptBatchVerdict({ ...base, delta: { ...human, decidedBy: ['policy:full_auto'] } }).join()).toContain('policy:full_auto')
    expect(stepManuscriptBatchVerdict({ ...base, delta: { ...human, accepted: 1 } })).toHaveLength(1)
    expect(stepManuscriptBatchVerdict({ ...base, delta: { ...human, receipts: 0, decidedBy: [] } })).toHaveLength(1)
    expect(stepManuscriptBatchVerdict({ ...base, models: ['apimart/other'] })).toHaveLength(1)
  })

  test('步骤 3 刹车：卡弹了 + 有刹车那一行 + 去掉之后不再受理不铸收据 = 成立；没弹卡但多出了受理 = 边界（不算失败）；什么都没发生 = 红', () => {
    expect(stepBrakeVerdict({ cardAppeared: true, brakeLineShown: true, acceptedTotal: 2, deltaAfterRemove: ok })).toEqual({ problems: [], boundary: false })
    expect(stepBrakeVerdict({ cardAppeared: true, brakeLineShown: false, acceptedTotal: 2, deltaAfterRemove: ok }).problems).toHaveLength(1)
    expect(stepBrakeVerdict({ cardAppeared: true, brakeLineShown: true, acceptedTotal: 3, deltaAfterRemove: { ...ok, accepted: 1, receipts: 1 } }).problems).toHaveLength(2)
    expect(stepBrakeVerdict({ cardAppeared: false, brakeLineShown: false, acceptedTotal: 3, deltaAfterRemove: ok })).toEqual({ problems: [], boundary: true })
    expect(stepBrakeVerdict({ cardAppeared: false, brakeLineShown: false, acceptedTotal: 2, deltaAfterRemove: ok }).problems).toHaveLength(1)
  })

  test('步骤 4 停止：停后新增提交、重开后重复提交、没有交出、任务号重复，各自红', () => {
    const base = { acceptedAtStop: 3, acceptedAfterSettle: 3, acceptedAfterReopen: 3, deliveredTaskIds: ['t3'] }
    expect(stepStopVerdict(base)).toEqual([])
    expect(stepStopVerdict({ ...base, acceptedAfterSettle: 4, acceptedAfterReopen: 4 })).toHaveLength(1)
    expect(stepStopVerdict({ ...base, acceptedAfterReopen: 4 })).toHaveLength(1)
    expect(stepStopVerdict({ ...base, deliveredTaskIds: [] })).toHaveLength(1)
    expect(stepStopVerdict({ ...base, deliveredTaskIds: ['t3', 't3'] })).toHaveLength(1)
  })

  test('collectProblems：问题带步骤名；边界与停止钮不在的步骤另列为 unverified', () => {
    const { problems, unverified } = collectProblems({
      '1': { problems: [] }, '2': { problems: ['x'] }, '3': { boundary: true, problems: [] }, '4': { stopAvailable: false, problems: [] }, '5': { inconclusive: true, problems: [] }, '6': { lostRace: true, problems: [] },
    })
    expect(problems).toEqual(['2：x'])
    expect(unverified).toEqual(['3', '4', '5', '6'])
  })
})

describe('花钱保险丝', () => {
  test('受理数超过当前上限就停 App，只停一次；上限不能被调高到总上限之上', async () => {
    let accepted = 2
    let stops = 0
    const cap = createSpendCap({ projectRoot: 'x', stopApp: () => { stops += 1 }, intervalMs: 10, read: () => accepted })
    cap.setCeiling(99)
    expect(() => cap.assertNotBreached()).not.toThrow()
    accepted = IMAGE_HARD_CAP + 1
    await new Promise((resolve) => setTimeout(resolve, 80))
    expect(stops).toBe(1)
    expect(() => cap.assertNotBreached()).toThrow(/保险丝/)
    cap.stop()
  })

  test('当前上限收到 2 时，第 3 次受理就跳', async () => {
    let accepted = 2
    let stops = 0
    const cap = createSpendCap({ projectRoot: 'x', stopApp: () => { stops += 1 }, intervalMs: 10, read: () => accepted })
    cap.setCeiling(2)
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(stops).toBe(0)
    accepted = 3
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(stops).toBe(1)
    cap.stop()
  })
})

describe('waitForSpendUiOrIdle（假时钟：不靠墙钟，机器再忙也一样）', () => {
  // 假时钟：waitForTimeout 把假的「现在」往前推 ms，tick 记第几次轮询；Date.now() 由 vi.useFakeTimers 接管，真实耗时对结果没有影响。
  const POLL = 500
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })
  const win = (script) => {
    let tick = 0
    return {
      locator: (selector) => ({ count: async () => script(selector, tick) }),
      waitForTimeout: async (ms) => { tick += 1; vi.setSystemTime(Date.now() + ms) },
    }
  }
  const PANEL = '[data-panel]'
  const options = { timeout: 10_000, graceMs: 5_000, pollMs: POLL }
  test('卡在第 2 次轮询出现（早于起飞宽限）→ card；确认框同理 → dialog', async () => {
    expect(await waitForSpendUiOrIdle(win((selector, tick) => (selector.includes('data-kind="spend"') && tick >= 2 ? 1 : 0)), PANEL, options)).toBe('card')
    expect(await waitForSpendUiOrIdle(win((selector, tick) => (selector.includes('data-spend-confirm-dialog') && tick >= 2 ? 1 : 0)), PANEL, options)).toBe('dialog')
  })
  test('什么都没弹且没在跑：宽限之内不判 idle，过了宽限才判 idle', async () => {
    // 宽限 5 秒 = 第 11 次轮询之后（假时钟精确），而卡在第 12 次轮询才出现——宽限之内不能抢先判 idle。
    expect(await waitForSpendUiOrIdle(win((selector, tick) => (selector.includes('data-kind="spend"') && tick >= 10 ? 1 : 0)), PANEL, options)).toBe('card')
    expect(await waitForSpendUiOrIdle(win(() => 0), PANEL, options)).toBe('idle')
  })
  test('一直在跑、什么都没弹 → timeout（假时钟推过 timeout）', async () => {
    expect(await waitForSpendUiOrIdle(win((selector) => (selector.includes('running') ? 1 : 0)), PANEL, { timeout: 3_000, graceMs: 0, pollMs: POLL })).toBe('timeout')
  })
})
