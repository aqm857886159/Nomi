import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  dayOf,
  extractFeedbackItem,
  buildFeedbackItems,
  flattenEvents,
  groupGenerationResults,
  rankErrorCodes,
  latestTwoDatesWithData,
  detectGenerationSpikes,
  tallyLaunches,
  tallyUpdateActions,
  buildIntakeReport,
  isAutomatedEvent,
  splitAutomatedEvents,
  rankFailureReasons,
  summarizePerf,
} from './aggregate.mjs'
import { renderMarkdown, renderTerminalSummary } from './render.mjs'

// 夹具：占位句，不放任何真实用户原文（任务书 §要做 1 明确要求）。形状照
// D:\tmp\nomi-intake 里的真实结构（receivedAt/receipt/ref/payload.manifest/payload.context）。
function fakeFeedback({ key, receivedAt, receipt = null, version = '0.22.3', platform = 'win32', surface = 'generation', errorCode = 'unknown', provider = 'custom', model = null, summary = '占位摘要文本', note = null }) {
  return {
    key,
    record: {
      schemaVersion: 1,
      receivedAt,
      route: '/v1/feedback',
      receipt,
      ref: key.split('/').pop().replace('.json', ''),
      payload: {
        schemaVersion: 1,
        manifest: { schemaVersion: 1, createdAt: receivedAt, app: { version, electron: '43.0.0', node: '24.0.0', chrome: '150' }, system: { platform, arch: 'x64', osRelease: '10.0', locale: 'zh-CN', timeZone: 'Asia/Shanghai' }, projectId: null, entries: [], excluded: [], totalBytes: 0 },
        context: { surface, summary, errorCode, note, contentIncluded: false, provider, model },
        attachments: {},
      },
    },
  }
}

function fakeEventsRecord({ key, events }) {
  return { key, record: { schemaVersion: 1, receivedAt: `${events[0]?.timestamp ?? '2026-09-24T00:00:00.000Z'}`, route: '/v1/events', receipt: null, ref: key, payload: { events } } }
}

function genEvent({ timestamp, capability, result, sessionId = 's1', appMajor = 0, appMinor = 22, osFamily = 'windows' }) {
  return { schemaVersion: 1, timestamp, sessionId, eventName: 'generation.completed', props: { capability, durationBucket: '1-5s', result, attemptCountBucket: '1' }, systemProps: { locale: 'zh-CN', osFamily, appMajor, appMinor } }
}

test('dayOf 截取 ISO 时间戳的日期部分', () => {
  assert.equal(dayOf('2026-09-24T01:37:00.617Z'), '2026-09-24')
  assert.equal(dayOf(''), '')
  assert.equal(dayOf(undefined), '')
})

test('extractFeedbackItem 取出报告要的那几格，缺字段兜底不抛', () => {
  const item = extractFeedbackItem('feedback/2026-01-01/a.json', fakeFeedback({ key: 'feedback/2026-01-01/a.json', receivedAt: '2026-01-01T08:00:00.000Z', receipt: 'NF-0101-0001', summary: '占位：素材内容与扩展名不符', note: '占位留言' }).record)
  assert.deepEqual(item, {
    key: 'feedback/2026-01-01/a.json',
    date: '2026-01-01',
    receivedAt: '2026-01-01T08:00:00.000Z',
    createdAt: '2026-01-01T08:00:00.000Z',
    queueDelaySeconds: 0,
    logTail: { attached: false, why: 'unlisted' },
    duplicateOf: null,
    id: 'NF-0101-0001',
    version: '0.22.3',
    system: 'win32',
    locale: 'zh-CN',
    surface: 'generation',
    errorCode: 'unknown',
    provider: 'custom',
    model: null,
    summary: '占位：素材内容与扩展名不符',
    note: '占位留言',
    perf: null,
  })
})

test('extractFeedbackItem 对畸形 payload 兜底，不抛', () => {
  const item = extractFeedbackItem('feedback/x.json', { receivedAt: '2026-09-01T00:00:00.000Z', ref: 'x' })
  assert.equal(item.id, 'x')
  assert.equal(item.version, 'unknown')
  assert.equal(item.surface, 'unknown')
  assert.equal(item.errorCode, null)
})

test('buildFeedbackItems 按日期新到旧排序', () => {
  const items = buildFeedbackItems([
    fakeFeedback({ key: 'feedback/2026-01-01/a.json', receivedAt: '2026-09-27T00:00:00.000Z', receipt: 'NF-1' }),
    fakeFeedback({ key: 'feedback/2026-09-28/b.json', receivedAt: '2026-09-28T00:00:00.000Z', receipt: 'NF-2' }),
  ])
  assert.deepEqual(items.map((i) => i.id), ['NF-2', 'NF-1'])
})

test('flattenEvents 拍平多条事件并跳过畸形条目', () => {
  const events = flattenEvents([
    fakeEventsRecord({ key: 'events/2026-09-24/a.json', events: [genEvent({ timestamp: '2026-09-24T00:00:00.000Z', capability: 'image', result: 'success' }), 'not-an-object', { eventName: 123 }] }),
  ])
  assert.equal(events.length, 1)
  assert.equal(events[0].date, '2026-09-24')
  assert.equal(events[0].sourceKey, 'events/2026-09-24/a.json')
})

test('groupGenerationResults 按能力/版本/系统/日期分组并算比例', () => {
  const events = flattenEvents([
    fakeEventsRecord({
      key: 'events/2026-09-24/a.json',
      events: [
        genEvent({ timestamp: '2026-09-24T00:00:00.000Z', capability: 'image', result: 'success' }),
        genEvent({ timestamp: '2026-09-24T00:00:00.000Z', capability: 'image', result: 'failure' }),
        genEvent({ timestamp: '2026-09-24T00:00:00.000Z', capability: 'image', result: 'failure' }),
        genEvent({ timestamp: '2026-09-24T00:00:00.000Z', capability: 'video', result: 'cancel' }),
      ],
    }),
  ])
  const gr = groupGenerationResults(events)
  assert.equal(gr.overall.total, 4)
  assert.equal(gr.overall.success, 1)
  assert.equal(gr.overall.failure, 2)
  assert.equal(gr.overall.cancel, 1)
  assert.equal(gr.overall.successRate, 25)
  const image = gr.byCapabilityOverall.find((c) => c.capability === 'image')
  assert.equal(image.total, 3)
  assert.equal(image.failure, 2)
  const group = gr.byGroup.find((g) => g.capability === 'image')
  assert.equal(group.appVersion, '0.22')
  assert.equal(group.osFamily, 'windows')
  assert.equal(group.date, '2026-09-24')
})

test('groupGenerationResults 对没有 generation.completed 的空输入不报错', () => {
  const gr = groupGenerationResults([])
  assert.equal(gr.overall.total, 0)
  assert.equal(gr.overall.successRate, 0)
  assert.deepEqual(gr.byGroup, [])
})

test('rankErrorCodes 按出现次数降序，同数按字母序', () => {
  const items = buildFeedbackItems([
    fakeFeedback({ key: 'feedback/2026-09-28/a.json', receivedAt: '2026-09-28T00:00:00.000Z', errorCode: 'input' }),
    fakeFeedback({ key: 'feedback/2026-09-28/b.json', receivedAt: '2026-09-28T00:00:00.000Z', errorCode: 'input' }),
    fakeFeedback({ key: 'feedback/2026-09-28/c.json', receivedAt: '2026-09-28T00:00:00.000Z', errorCode: 'asset-upload-failed' }),
    fakeFeedback({ key: 'feedback/2026-09-28/d.json', receivedAt: '2026-09-28T00:00:00.000Z', errorCode: null }),
  ])
  assert.deepEqual(rankErrorCodes(items), [
    { errorCode: 'input', count: 2 },
    { errorCode: 'asset-upload-failed', count: 1 },
  ])
})

test('latestTwoDatesWithData 跳过没有数据的空档日', () => {
  const events = [{ date: '2026-09-20' }, { date: '2026-09-24' }]
  assert.deepEqual(latestTwoDatesWithData(events), { latestDate: '2026-09-24', previousDate: '2026-09-20' })
  assert.deepEqual(latestTwoDatesWithData([]), { latestDate: null, previousDate: null })
})

test('detectGenerationSpikes 标出相对与绝对都够大的涨幅', () => {
  const events = flattenEvents([
    fakeEventsRecord({ key: 'events/2026-09-23/a.json', events: [genEvent({ timestamp: '2026-09-23T00:00:00.000Z', capability: 'video', result: 'failure' }), genEvent({ timestamp: '2026-09-23T00:00:00.000Z', capability: 'video', result: 'failure' })] }),
    fakeEventsRecord({
      key: 'events/2026-09-24/a.json',
      events: [
        genEvent({ timestamp: '2026-09-24T00:00:00.000Z', capability: 'video', result: 'failure' }),
        genEvent({ timestamp: '2026-09-24T00:00:00.000Z', capability: 'video', result: 'failure' }),
        genEvent({ timestamp: '2026-09-24T00:00:00.000Z', capability: 'video', result: 'failure' }),
        genEvent({ timestamp: '2026-09-24T00:00:00.000Z', capability: 'video', result: 'failure' }),
        genEvent({ timestamp: '2026-09-24T00:00:00.000Z', capability: 'video', result: 'failure' }),
      ],
    }),
  ])
  const spikes = detectGenerationSpikes(events)
  const labels = spikes.map((s) => s.dimension)
  assert.ok(labels.includes('生成失败'), `expected 生成失败 in ${JSON.stringify(labels)}`)
  assert.ok(labels.includes('video 失败'))
})

test('detectGenerationSpikes 不把小涨幅或小绝对数报成突增', () => {
  const events = flattenEvents([
    fakeEventsRecord({ key: 'events/2026-09-23/a.json', events: [genEvent({ timestamp: '2026-09-23T00:00:00.000Z', capability: 'image', result: 'failure' })] }),
    fakeEventsRecord({ key: 'events/2026-09-24/a.json', events: [genEvent({ timestamp: '2026-09-24T00:00:00.000Z', capability: 'image', result: 'failure' }), genEvent({ timestamp: '2026-09-24T00:00:00.000Z', capability: 'image', result: 'failure' })] }),
  ])
  // 1 -> 2：绝对数只有 2，低于 SPIKE_MIN_COUNT=3，不该报
  const spikes = detectGenerationSpikes(events)
  assert.deepEqual(spikes, [])
})

test('detectGenerationSpikes 处理"上一窗口是 0"的新增情况', () => {
  const events = flattenEvents([
    fakeEventsRecord({ key: 'events/2026-09-23/a.json', events: [genEvent({ timestamp: '2026-09-23T00:00:00.000Z', capability: 'image', result: 'success' })] }),
    fakeEventsRecord({ key: 'events/2026-09-24/a.json', events: [genEvent({ timestamp: '2026-09-24T00:00:00.000Z', capability: 'image', result: 'cancel' }), genEvent({ timestamp: '2026-09-24T00:00:00.000Z', capability: 'image', result: 'cancel' }), genEvent({ timestamp: '2026-09-24T00:00:00.000Z', capability: 'image', result: 'cancel' })] }),
  ])
  const spikes = detectGenerationSpikes(events)
  assert.ok(spikes.some((s) => s.dimension === '生成取消' && s.previousCount === 0 && s.currentCount === 3))
})

test('detectGenerationSpikes 数据不足两天时不报突增（不是"从 0 突增"的假信号）', () => {
  const events = flattenEvents([fakeEventsRecord({ key: 'events/2026-09-24/a.json', events: [genEvent({ timestamp: '2026-09-24T00:00:00.000Z', capability: 'image', result: 'failure' })] })])
  assert.deepEqual(detectGenerationSpikes(events), [])
})

test('tallyLaunches 按日期计数 app.started', () => {
  const events = flattenEvents([
    fakeEventsRecord({ key: 'events/2026-09-24/a.json', events: [{ schemaVersion: 1, timestamp: '2026-09-24T00:00:00.000Z', sessionId: 's', eventName: 'app.started', props: { appMajor: 0, appMinor: 22, osFamily: 'windows', locale: 'zh-CN' }, systemProps: { locale: 'zh-CN', osFamily: 'windows', appMajor: 0, appMinor: 22 } }] }),
  ])
  const launches = tallyLaunches(events)
  assert.equal(launches.total, 1)
  assert.deepEqual(launches.byDate, [{ date: '2026-09-24', count: 1 }])
})

test('tallyUpdateActions 按 action × result 计数', () => {
  const mk = (action, result) => ({ schemaVersion: 1, timestamp: '2026-09-24T00:00:00.000Z', sessionId: 's', eventName: 'update.action', props: { action, result }, systemProps: { locale: 'zh-CN', osFamily: 'windows', appMajor: 0, appMinor: 22 } })
  const events = flattenEvents([fakeEventsRecord({ key: 'events/2026-09-24/a.json', events: [mk('check', 'success'), mk('check', 'success'), mk('download', 'failure')] })])
  assert.deepEqual(tallyUpdateActions(events), [
    { action: 'check', result: 'success', count: 2 },
    { action: 'download', result: 'failure', count: 1 },
  ])
})

test('tallyUpdateActions 失败带 reason 时按原因分开计数', () => {
  const mk = (props) => ({ schemaVersion: 1, timestamp: '2026-09-24T00:00:00.000Z', sessionId: 's', eventName: 'update.action', props, systemProps: { locale: 'zh-CN', osFamily: 'windows', appMajor: 0, appMinor: 22 } })
  const events = flattenEvents([fakeEventsRecord({ key: 'events/2026-09-24/b.json', events: [mk({ action: 'check', result: 'failure', reason: 'network' }), mk({ action: 'check', result: 'failure', reason: 'network' }), mk({ action: 'check', result: 'failure' })] })])
  assert.deepEqual(tallyUpdateActions(events), [
    { action: 'check', result: 'failure', reason: 'network', count: 2 },
    { action: 'check', result: 'failure', count: 1 },
  ])
})

test('buildIntakeReport 只把 newFeedbackKeys 里的键当"本次新增反馈"', () => {
  const feedbackRecords = [
    fakeFeedback({ key: 'feedback/2026-01-01/old.json', receivedAt: '2026-09-27T00:00:00.000Z', receipt: 'NF-OLD' }),
    fakeFeedback({ key: 'feedback/2026-09-28/new.json', receivedAt: '2026-09-28T00:00:00.000Z', receipt: 'NF-NEW' }),
  ]
  const report = buildIntakeReport({
    feedbackRecords,
    eventRecords: [],
    trajectoriesCount: 0,
    newFeedbackKeys: ['feedback/2026-09-28/new.json'],
    newEventKeys: [],
    generatedAt: '2026-09-29T00:00:00.000Z',
  })
  assert.equal(report.totals.feedbackCount, 2)
  assert.equal(report.totals.newFeedbackCount, 1)
  assert.deepEqual(report.newFeedback.map((i) => i.id), ['NF-NEW'])
  assert.equal(report.totals.trajectoriesCount, 0)
})

test('buildIntakeReport 把本地解析失败的文件计入 dataQuality，不影响其余统计', () => {
  const report = buildIntakeReport({
    feedbackRecords: [],
    eventRecords: [],
    trajectoriesCount: 0,
    newFeedbackKeys: [],
    newEventKeys: [],
    corruptFiles: [{ key: 'feedback/2026-09-01/broken.json', error: 'Unexpected token' }],
    generatedAt: '2026-09-29T00:00:00.000Z',
  })
  assert.equal(report.dataQuality.corruptFileCount, 1)
  assert.equal(report.totals.feedbackCount, 0)
})

// ---- 自动化事件排除 + 失败原因排行（夹具：真实用户 3 条 + 走查 4 条）----

function withAuto(evt) {
  return { ...evt, systemProps: { ...evt.systemProps, automated: true } }
}
function withReason(evt, errorType) {
  return { ...evt, props: { ...evt.props, errorType } }
}

function mixedFixture() {
  const t = '2026-10-01T00:00:00.000Z'
  const real = [
    withReason(genEvent({ timestamp: t, capability: 'video', result: 'failure' }), 'asset-upload-failed'),
    withReason(genEvent({ timestamp: t, capability: 'video', result: 'failure' }), 'asset-upload-failed'),
    genEvent({ timestamp: t, capability: 'image', result: 'success' }),
  ]
  const auto = [
    withAuto(withReason(genEvent({ timestamp: t, capability: 'video', result: 'failure' }), 'model-unavailable-upstream')),
    withAuto(withReason(genEvent({ timestamp: t, capability: 'video', result: 'failure' }), 'model-unavailable-upstream')),
    withAuto(withReason(genEvent({ timestamp: t, capability: 'video', result: 'failure' }), 'model-unavailable-upstream')),
    withAuto({ ...genEvent({ timestamp: t, capability: 'image', result: 'success' }) }),
  ]
  return { real, auto, records: [fakeEventsRecord({ key: 'events/2026-10-01/a.json', events: [...real, ...auto] })] }
}

test('isAutomatedEvent 只认 systemProps.automated === true', () => {
  const t = '2026-10-01T00:00:00.000Z'
  assert.equal(isAutomatedEvent(withAuto(genEvent({ timestamp: t, capability: 'image', result: 'success' }))), true)
  assert.equal(isAutomatedEvent(genEvent({ timestamp: t, capability: 'image', result: 'success' })), false)
  assert.equal(isAutomatedEvent({ systemProps: { automated: 'true' } }), false)
})

test('splitAutomatedEvents 把自动化事件拆出去并单独计数', () => {
  const { real, auto } = mixedFixture()
  const split = splitAutomatedEvents([...real, ...auto])
  assert.equal(split.real.length, 3)
  assert.equal(split.excluded.count, 4)
  assert.deepEqual(split.excluded.byEvent, [{ eventName: 'generation.completed', count: 4 }])
})

test('rankFailureReasons 按原因排行；老版本没带原因的单独成一类', () => {
  const t = '2026-10-01T00:00:00.000Z'
  const ranking = rankFailureReasons([
    withReason(genEvent({ timestamp: t, capability: 'video', result: 'failure' }), 'balance'),
    withReason(genEvent({ timestamp: t, capability: 'video', result: 'failure' }), 'balance'),
    withReason(genEvent({ timestamp: t, capability: 'video', result: 'failure' }), 'network'),
    genEvent({ timestamp: t, capability: 'video', result: 'failure' }),
    genEvent({ timestamp: t, capability: 'video', result: 'success' }),
  ])
  assert.equal(ranking.total, 4)
  assert.deepEqual(ranking.ranking.map((r) => [r.reason, r.count]), [['balance', 2], ['network', 1], ['（旧版本未上报）', 1]])
  assert.equal(ranking.ranking[0].share, 50)
})

test('buildIntakeReport 默认排除自动化：成功率与失败排行只算真实用户，被排除的条数单独列出', () => {
  const { records } = mixedFixture()
  const report = buildIntakeReport({ feedbackRecords: [], eventRecords: records, trajectoriesCount: 0, newFeedbackKeys: [], newEventKeys: [], generatedAt: '2026-10-01T12:00:00.000Z' })
  assert.equal(report.totals.eventsCount, 3)
  assert.equal(report.totals.excludedAutomatedCount, 4)
  assert.equal(report.generationResults.overall.total, 3)
  assert.equal(report.generationResults.overall.failure, 2)
  assert.deepEqual(report.failureReasons.ranking.map((r) => r.reason), ['asset-upload-failed'])
  // 自动化的 3 次 model-unavailable-upstream 不许进排行，也不许造出假突增
  assert.equal(report.spikes.length, 0)
  const md = renderMarkdown(report)
  assert.match(md, /已排除 4 条/)
  assert.match(md, /1\. `asset-upload-failed` × 2/)
  assert.doesNotMatch(md, /model-unavailable-upstream/)
  assert.match(renderTerminalSummary(report), /已排除自动化事件 4 条/)
})

function perfEvent({ p75 = '100-200', os = 'windows', cores = '5-8', nodes = '1-20', timestamp = '2026-10-17T00:00:00.000Z' } = {}) {
  return {
    eventName: 'perf.session.summary',
    timestamp,
    date: dayOf(timestamp),
    systemProps: { osFamily: os, appMajor: 0, appMinor: 24, locale: 'zh-CN' },
    props: { interactionP75: p75, interactionP95: 'gt-500', longFramesPerMin: '1-3', longestFrame: '100-250', observedMinutes: '5-30', page: 'generation', nodes, imageNodes: '0', generating: false, cpuCores: cores, memoryGb: '8plus' },
  }
}

test('summarizePerf：按维度数偏慢占比，样本少的格子标出来，只数性能事件', () => {
  const perf = summarizePerf([
    perfEvent({ p75: '200-500', nodes: '101-300' }),
    perfEvent({ p75: 'gt-500', nodes: '101-300' }),
    perfEvent({ p75: 'lt-100', nodes: '1-20' }),
    perfEvent({ p75: '100-200', nodes: '1-20', os: 'macos' }),
    genEvent({ timestamp: '2026-10-17T00:00:00.000Z', capability: 'image', result: 'success' }),
  ])
  assert.equal(perf.total, 4)
  assert.equal(perf.slow, 2)
  assert.equal(perf.slowShare, 50)
  const nodes = perf.byDimension.nodes
  assert.deepEqual(nodes.map((r) => [r.value, r.total, r.slow, r.slowShare]), [['101-300', 2, 2, 100], ['1-20', 2, 0, 0]])
  assert.ok(nodes.every((r) => r.lowSample === true))
  assert.deepEqual(perf.byDimension.osFamily.map((r) => r.value).sort(), ['macos', 'windows'])
  assert.deepEqual(perf.distributions.interactionP75.map((r) => [r.value, r.count]), [['100-200', 1], ['200-500', 1], ['gt-500', 1], ['lt-100', 1]])
})

test('summarizePerf：没有性能事件时给零，不抛；反馈里的卡顿附件单独数', () => {
  const empty = summarizePerf([])
  assert.equal(empty.total, 0)
  assert.equal(empty.slowShare, 0)
  const withFeedback = summarizePerf([], [{ perf: { interactionP75: 'gt-500' } }, { perf: null }, { perf: { interactionP75: 'lt-100' } }])
  assert.deepEqual(withFeedback.feedbackWithPerf, { count: 2, slow: 1 })
})

test('perf 进报告与 Markdown / 终端摘要；自动化事件不进性能统计', () => {
  const automated = { ...perfEvent({ p75: 'gt-500' }), systemProps: { osFamily: 'windows', appMajor: 0, appMinor: 24, locale: 'zh-CN', automated: true } }
  const records = [{ key: 'events/a.json', record: { payload: { events: [perfEvent({ p75: '200-500' }), perfEvent({ p75: 'lt-100' }), automated] } } }]
  const report = buildIntakeReport({ feedbackRecords: [], eventRecords: records, trajectoriesCount: 0, newFeedbackKeys: [], newEventKeys: [], generatedAt: '2026-10-17T12:00:00.000Z' })
  assert.equal(report.perf.total, 2)
  assert.equal(report.perf.slow, 1)
  assert.match(renderMarkdown(report), /## 卡不卡/)
  assert.match(renderMarkdown(report), /共 2 份会话汇总，偏慢 1（50%）/)
  assert.match(renderTerminalSummary(report), /卡不卡：2 份会话汇总，偏慢 1（50%）/)
})

// ---------------------------------------------------------------------------
// 重复送达 / 送达 / 日志尾巴 / 摘要的顺序
// ---------------------------------------------------------------------------

function feedbackWith({ key, receivedAt, createdAt = receivedAt, summary = '占位摘要文本', version = '0.24.0', receipt = key, tail = null, excluded = null }) {
  const made = fakeFeedback({ key, receivedAt, receipt, version, summary })
  made.record.payload.manifest.createdAt = createdAt
  made.record.payload.manifest.entries = tail ? [{ path: 'logs/tail.txt', bytes: 10, what: '日志' }] : []
  made.record.payload.manifest.excluded = excluded ? [{ what: 'logs/tail.txt', why: excluded }] : []
  return made
}

const reportOf = (feedbackRecords, extra = {}) => buildIntakeReport({ feedbackRecords, eventRecords: [], trajectoriesCount: 0, newFeedbackKeys: [], newEventKeys: [], generatedAt: '2026-11-01T00:00:00.000Z', ...extra })

test('同一份报告送达多次：统计只算一条，最早到的是原件', () => {
  const createdAt = '2026-10-20T08:00:00.000Z'
  const records = [
    feedbackWith({ key: 'feedback/2026-10-20/b.json', receipt: 'NF-1020-0002', receivedAt: '2026-10-20T09:00:00.000Z', createdAt }),
    feedbackWith({ key: 'feedback/2026-10-20/a.json', receipt: 'NF-1020-0001', receivedAt: '2026-10-20T08:00:05.000Z', createdAt }),
    feedbackWith({ key: 'feedback/2026-10-20/c.json', receipt: 'NF-1020-0003', receivedAt: '2026-10-20T10:00:00.000Z', createdAt }),
    feedbackWith({ key: 'feedback/2026-10-20/other.json', receipt: 'NF-1020-0004', receivedAt: '2026-10-20T08:00:06.000Z', createdAt, summary: '另一件事' }),
  ]
  const items = buildFeedbackItems(records)
  assert.equal(items.find((item) => item.id === 'NF-1020-0001').duplicateOf, null)
  assert.equal(items.find((item) => item.id === 'NF-1020-0002').duplicateOf, 'NF-1020-0001')
  assert.equal(items.find((item) => item.id === 'NF-1020-0003').duplicateOf, 'NF-1020-0001')
  assert.equal(items.find((item) => item.id === 'NF-1020-0004').duplicateOf, null, '同一刻但说的是别的事，不是重复')

  const report = reportOf(records, { newFeedbackKeys: records.map((record) => record.key) })
  assert.equal(report.totals.feedbackCount, 2)
  assert.equal(report.totals.duplicateDeliveries, 2)
  assert.equal(report.totals.newFeedbackCount, 2, '重复的那几次不算新增')
  assert.equal(report.delivery.duplicateDeliveries, 2)
})

test('老版本没有创建时间的不折叠：宁可多算，不能把两份不同的报告算成一份', () => {
  const records = ['a', 'b'].map((name) => {
    const made = feedbackWith({ key: `feedback/2026-09-01/${name}.json`, receivedAt: '2026-09-01T00:00:00.000Z' })
    delete made.record.payload.manifest.createdAt
    return made
  })
  assert.equal(buildFeedbackItems(records).filter((item) => item.duplicateOf).length, 0)
})

test('送达：一分钟内到的算直达，按版本分开看', () => {
  const records = [
    feedbackWith({ key: 'feedback/d/1.json', version: '0.24.0', createdAt: '2026-10-20T08:00:00.000Z', receivedAt: '2026-10-20T08:00:30.000Z' }),
    feedbackWith({ key: 'feedback/d/2.json', version: '0.24.0', createdAt: '2026-10-20T09:00:00.000Z', receivedAt: '2026-10-20T09:01:00.000Z' }),
    feedbackWith({ key: 'feedback/d/3.json', version: '0.24.0', createdAt: '2026-10-20T10:00:00.000Z', receivedAt: '2026-10-27T10:00:00.000Z' }),
    feedbackWith({ key: 'feedback/d/4.json', version: '0.25.0', createdAt: '2026-10-20T11:00:00.000Z', receivedAt: '2026-10-20T11:00:01.000Z' }),
  ]
  const { delivery } = reportOf(records)
  assert.deepEqual(delivery.byVersion.map((row) => row.version), ['0.25.0', '0.24.0'], '新版本在前')
  const old = delivery.byVersion[1]
  assert.equal(old.direct, 2)
  assert.equal(old.late, 1)
  assert.equal(old.directShare, 66.7)
  assert.equal(old.slowestSeconds, 7 * 24 * 3600)
  assert.equal(delivery.byVersion[0].directShare, 100)
})

test('日志尾巴：坏掉的那些老版本不报警，比它新的缺了才报警（29 份全空都没人发现，就因为没有东西在数）', () => {
  const at = '2026-11-01T00:00:00.000Z'
  const quiet = reportOf([
    feedbackWith({ key: 'feedback/l/old.json', version: '0.24.1', receivedAt: at, excluded: 'logs-unavailable' }),
    feedbackWith({ key: 'feedback/l/new.json', version: '0.24.2', receivedAt: at, summary: 'b', tail: true }),
  ])
  assert.deepEqual(quiet.logTail.alarms, [])
  assert.deepEqual(quiet.logTail.byVersion.map((row) => [row.version, row.attached, row.total]), [['0.24.2', 1, 1], ['0.24.1', 0, 1]])
  assert.deepEqual(quiet.logTail.byVersion[1].missing, { 'logs-unavailable': 1 })
  assert.doesNotMatch(renderTerminalSummary(quiet), /没带日志尾巴/)

  const loud = reportOf([
    feedbackWith({ key: 'feedback/l/new-a.json', version: '0.24.2', receivedAt: at, summary: 'a', tail: true }),
    feedbackWith({ key: 'feedback/l/new-b.json', version: '0.24.2', receivedAt: at, summary: 'b', excluded: 'logs-empty' }),
  ])
  assert.equal(loud.logTail.alarms.length, 1)
  assert.match(renderTerminalSummary(loud), /0\.24\.2 有 1\/2 份反馈没带日志尾巴/)
  assert.match(renderMarkdown(loud), /0\.24\.2：1\/2 份没带日志尾巴/)
})

test('终端摘要：新增、待分诊、报告路径都在尾部，判定在最后一行（hook 只留最后几行）', () => {
  const key = 'feedback/2026-10-31/a.json'
  const report = reportOf([feedbackWith({ key, receipt: 'NF-1031-0001', receivedAt: '2026-10-31T11:51:00.000Z' })], {
    newFeedbackKeys: [key],
    inbox: { rebuilt: false, items: { [key]: { id: 'NF-1031-0001', date: '2026-10-31', triagedAt: null, duplicateOf: null } } },
  })
  const lines = renderTerminalSummary(report, { mdPath: '/r/a.md', jsonPath: '/r/a.json' }).split('\n')
  const tailLines = lines.slice(-6).join('\n')
  assert.match(tailLines, /新增反馈 1 条/)
  assert.match(tailLines, /待分诊 1 条：NF-1031-0001/)
  assert.match(tailLines, /报告 → \/r\/a\.md/)
  assert.equal(lines.at(-1), report.versionHealth.conclusion)
  assert.equal(lines.filter((line) => line.includes('新增反馈')).length, 1, '只说一遍')
})

test('待分诊很多时终端只列最新几个，全部的在报告里，报告里有摘要可以直接分诊', () => {
  const records = Array.from({ length: 8 }, (_item, index) => feedbackWith({ key: `feedback/2026-10-2${index}/x.json`, receipt: `NF-102${index}-0001`, receivedAt: `2026-10-2${index}T00:00:00.000Z`, summary: `占位 ${index}` }))
  const inbox = { rebuilt: false, items: Object.fromEntries(records.map((record) => [record.key, { id: record.record.receipt, date: record.record.receivedAt.slice(0, 10), triagedAt: null, duplicateOf: null }])) }
  const report = reportOf(records, { inbox })
  const summary = renderTerminalSummary(report)
  assert.match(summary, /待分诊 8 条：NF-1027-0001 NF-1026-0001 NF-1025-0001 NF-1024-0001 NF-1023-0001 …/)
  const markdown = renderMarkdown(report)
  assert.match(markdown, /## 待分诊（8 条）/)
  for (let index = 0; index < 8; index += 1) assert.match(markdown, new RegExp(`占位 ${index}`))
  assert.match(markdown, /--triaged/)
})

test('账上一条都没有时明说 0，新增 0 也照样有这一行', () => {
  const report = reportOf([])
  assert.match(renderTerminalSummary(report), /待分诊 0 条/)
  assert.match(renderMarkdown(report), /## 待分诊（0 条）/)
})

test('账坏了重建：报告和摘要都要说，已出账的要再出一次', () => {
  const report = reportOf([], { inbox: { rebuilt: true, items: {} } })
  assert.match(renderTerminalSummary(report), /待分诊账坏了/)
  assert.match(renderMarkdown(report), /账文件坏了/)
})

test('读不出来的反馈文件也在待分诊里：它也是用户发来的', () => {
  const report = reportOf([], { inbox: { rebuilt: false, items: { 'feedback/2026-10-31/bad.json': { id: 'feedback/2026-10-31/bad.json', date: '2026-10-31', triagedAt: null, duplicateOf: null, unreadable: true } } } })
  assert.equal(report.triage.count, 1)
  assert.match(renderMarkdown(report), /这份文件读不出来/)
})
