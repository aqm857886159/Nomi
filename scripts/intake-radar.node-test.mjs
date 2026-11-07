import { makeTempDir } from './_test-temp.mjs'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { parseTriageArgs, run, runTriage } from './intake-radar.mjs'
import { readInbox, untriagedItems } from './lib/intake-radar/inbox.mjs'
import { readState, rawFilePath, writeRawFile, writeState } from './lib/intake-radar/store.mjs'

function tmpCacheDir() {
  return makeTempDir('intake-radar-test-')
}

const OK_CREDENTIALS = () => ({ accountId: 'test-account', token: 'test-token' })

function fakeFeedbackContent(id) {
  // 占位内容，不含真实用户文本——只是让 JSON 能解析、字段齐全。
  return JSON.stringify({
    schemaVersion: 1,
    receivedAt: '2026-09-28T00:00:00.000Z',
    route: '/v1/feedback',
    receipt: id,
    ref: id,
    payload: { schemaVersion: 1, manifest: { app: { version: '0.22.3' }, system: { platform: 'win32', locale: 'zh-CN' } }, context: { surface: 'generation', summary: '占位摘要', errorCode: 'unknown', note: null, provider: 'custom', model: null }, attachments: {} },
  })
}

/** 一个极简的 R2 REST 模拟器：list 按 prefix 查表，get 按 key 查表。
 *  记录每一次 get 调用的 key，方便断言"已经在磁盘上的键不该再打网络请求"。 */
function makeFakeFetch({ objectsByPrefix, getLog = [] }) {
  const fetchImpl = async (url) => {
    const u = new URL(url)
    if (u.pathname.endsWith('/objects')) {
      const prefix = u.searchParams.get('prefix')
      const keys = objectsByPrefix[prefix] ?? []
      return { ok: true, json: async () => ({ success: true, result: keys.map((k) => ({ key: k })), result_info: { is_truncated: false, cursor: '' } }) }
    }
    const match = /\/objects\/(.+)$/.exec(u.pathname)
    const key = decodeURIComponent(match[1])
    getLog.push(key)
    const content = fakeFeedbackContent(key.split('/').pop().replace('.json', ''))
    return { ok: true, arrayBuffer: async () => Buffer.from(content) }
  }
  return { fetchImpl, getLog }
}

test('run(): 凭据解析失败 → 返回 1，不碰缓存目录', async () => {
  const cacheDir = tmpCacheDir()
  const errors = []
  const code = await run({
    cacheDirOverride: cacheDir,
    resolveCredentialsImpl: () => { throw new Error('拿不到 token') },
    errorLog: (msg) => errors.push(msg),
    log: () => {},
  })
  assert.equal(code, 1)
  assert.ok(errors.some((m) => m.includes('今天没查成')), `expected "今天没查成" in ${JSON.stringify(errors)}`)
  assert.equal(fs.existsSync(path.join(cacheDir, 'state.json')), false)
})

test('run(): list 失败 → 返回 1，明说"今天没查成"，不写 state', async () => {
  const cacheDir = tmpCacheDir()
  const errors = []
  const failingFetch = async () => ({ ok: false, status: 500, json: async () => ({}) })
  const code = await run({
    cacheDirOverride: cacheDir,
    resolveCredentialsImpl: OK_CREDENTIALS,
    fetchImpl: failingFetch,
    errorLog: (msg) => errors.push(msg),
    log: () => {},
  })
  assert.equal(code, 1)
  assert.ok(errors.some((m) => m.includes('今天没查成')))
  assert.equal(fs.existsSync(path.join(cacheDir, 'state.json')), false)
})

test('run(): 首次成功运行 → 全部键都算新的，写 state + 报告', async () => {
  const cacheDir = tmpCacheDir()
  const { fetchImpl, getLog } = makeFakeFetch({ objectsByPrefix: { 'feedback/': ['feedback/2026-09-27/a.json'], 'events/': [], 'trajectories/': [] } })
  const logs = []
  const code = await run({
    cacheDirOverride: cacheDir,
    resolveCredentialsImpl: OK_CREDENTIALS,
    fetchImpl,
    now: () => new Date('2026-09-29T08:00:00.000Z'),
    log: (msg) => logs.push(msg),
    errorLog: () => {},
  })
  assert.equal(code, 0)
  assert.deepEqual(getLog, ['feedback/2026-09-27/a.json'])
  assert.ok(fs.existsSync(rawFilePath(cacheDir, 'feedback/2026-09-27/a.json')))

  const state = readState(cacheDir)
  assert.ok(state.seenKeys['feedback/2026-09-27/a.json'])
  assert.equal(state.lastRunOk, true)

  assert.ok(fs.existsSync(path.join(cacheDir, 'reports', '2026-09-29T080000Z.md')))
  assert.ok(fs.existsSync(path.join(cacheDir, 'reports', '2026-09-29T080000Z.json')))
  const reportJson = JSON.parse(fs.readFileSync(path.join(cacheDir, 'reports', '2026-09-29T080000Z.json'), 'utf8'))
  assert.equal(reportJson.totals.newFeedbackCount, 1)
  assert.ok(logs.length > 0)
})

test('run(): 第二轮只把新键算"新增"，已见过的键不再重复下载', async () => {
  const cacheDir = tmpCacheDir()
  const shared = { objectsByPrefix: { 'feedback/': ['feedback/2026-09-27/a.json'], 'events/': [], 'trajectories/': [] } }

  const first = makeFakeFetch(shared)
  await run({ cacheDirOverride: cacheDir, resolveCredentialsImpl: OK_CREDENTIALS, fetchImpl: first.fetchImpl, now: () => new Date('2026-09-29T08:00:00.000Z'), log: () => {}, errorLog: () => {} })

  // 第二轮：R2 上多了一个新键，旧键还在。
  shared.objectsByPrefix['feedback/'].push('feedback/2026-09-29/b.json')
  const second = makeFakeFetch(shared)
  const logs2 = []
  const code2 = await run({ cacheDirOverride: cacheDir, resolveCredentialsImpl: OK_CREDENTIALS, fetchImpl: second.fetchImpl, now: () => new Date('2026-09-29T09:00:00.000Z'), log: (m) => logs2.push(m), errorLog: () => {} })

  assert.equal(code2, 0)
  // 旧键已经在磁盘上（第一轮下载过）——第二轮不该再为它打一次 get。
  assert.deepEqual(second.getLog, ['feedback/2026-09-29/b.json'])

  const reportJson = JSON.parse(fs.readFileSync(path.join(cacheDir, 'reports', '2026-09-29T090000Z.json'), 'utf8'))
  assert.equal(reportJson.totals.feedbackCount, 2) // 累计两条
  assert.equal(reportJson.totals.newFeedbackCount, 1) // 但本轮只有一条"新"
  assert.deepEqual(reportJson.newFeedback.map((i) => i.id), ['b'])
})

test('run(): 缓存目录里已经有文件、但 state.json 是空的（比如复用了别的下载脚本产出的缓存）→ 当成全部"新"，且不重新下载已存在的文件', async () => {
  const cacheDir = tmpCacheDir()
  // 模拟 D:\tmp\intake-pull.mjs 已经下载过的场景：raw 文件已经在磁盘上，但从没跑过这份 state.json。
  const preExistingKey = 'feedback/2026-09-27/pre.json'
  const dest = rawFilePath(cacheDir, preExistingKey)
  fs.mkdirSync(path.dirname(dest), { recursive: true })
  fs.writeFileSync(dest, fakeFeedbackContent('pre'))

  const { fetchImpl, getLog } = makeFakeFetch({ objectsByPrefix: { 'feedback/': [preExistingKey], 'events/': [], 'trajectories/': [] } })
  const code = await run({ cacheDirOverride: cacheDir, resolveCredentialsImpl: OK_CREDENTIALS, fetchImpl, now: () => new Date('2026-09-29T08:00:00.000Z'), log: () => {}, errorLog: () => {} })

  assert.equal(code, 0)
  assert.deepEqual(getLog, [], '文件已经在磁盘上，不该再触发一次 get 网络请求')
  const reportJson = JSON.parse(fs.readFileSync(path.join(cacheDir, 'reports', '2026-09-29T080000Z.json'), 'utf8'))
  assert.equal(reportJson.totals.newFeedbackCount, 1, '第一次跑这份雷达时，预先存在的文件仍应算"新"（state 里从没见过）')
})

test('run(): 单个 get 失败 → 整轮返回 1，明说"今天没查成"', async () => {
  const cacheDir = tmpCacheDir()
  const fetchImpl = async (url) => {
    const u = new URL(url)
    if (u.pathname.endsWith('/objects')) {
      return { ok: true, json: async () => ({ success: true, result: [{ key: 'feedback/2026-09-27/a.json' }], result_info: { is_truncated: false, cursor: '' } }) }
    }
    return { ok: false, status: 404 }
  }
  const errors = []
  const code = await run({ cacheDirOverride: cacheDir, resolveCredentialsImpl: OK_CREDENTIALS, fetchImpl, errorLog: (m) => errors.push(m), log: () => {} })
  assert.equal(code, 1)
  assert.ok(errors.some((m) => m.includes('今天没查成')))
})

test('version regression uses existing fetch/cache, returns nonzero and renders the final decision', async () => {
  const cacheDir=tmpCacheDir(),key='events/2026-10-29/synthetic.json',logs=[]
  const events=[23,24].flatMap(appMinor=>Array.from({length:appMinor===24?10:300},(_,i)=>({sessionId:`s${i%2}`,timestamp:'2026-10-29T00:00:00Z',eventName:'generation.completed',props:{capability:'image',result:appMinor===24?'failure':'success',durationBucket:'<1s',errorType:'unknown'},systemProps:{appMajor:0,appMinor}})))
  const { writeRawFile }=await import('./lib/intake-radar/store.mjs')
  writeRawFile(cacheDir,key,Buffer.from(JSON.stringify({payload:{events}})))
  const {fetchImpl,getLog}=makeFakeFetch({objectsByPrefix:{'events/':[key]}})
  const code=await run({cacheDirOverride:cacheDir,resolveCredentialsImpl:OK_CREDENTIALS,fetchImpl,now:()=>new Date('2026-10-29T08:00:00Z'),healthOptions:{newVersion:'0.24.0',oldVersion:'0.23.2'},log:m=>logs.push(m)})
  assert.equal(code,1);assert.deepEqual(getLog,[])
  assert.match(logs.at(-1).split('\n').at(-1),/^停止放量：/)
  const md=fs.readFileSync(path.join(cacheDir,'reports/2026-10-29T080000Z.md'),'utf8')
  assert.match(md.trimEnd().split('\n').at(-1),/^停止放量：/)
  assert.equal(readState(cacheDir).lastRunOk,true,'fetch succeeded even when release health stopped')
  fs.rmSync(cacheDir,{recursive:true,force:true})
})

// ---------------------------------------------------------------------------
// 新反馈漏不掉：同一天多跑不盖报告，待分诊账只有明确出账才清
// ---------------------------------------------------------------------------

const quiet = { resolveCredentialsImpl: OK_CREDENTIALS, log: () => {}, errorLog: () => {} }
const objects = (...keys) => ({ objectsByPrefix: { 'feedback/': keys, 'events/': [], 'trajectories/': [] } })
const runAt = (cacheDir, iso, shared, extra = {}) => run({ cacheDirOverride: cacheDir, fetchImpl: makeFakeFetch(shared).fetchImpl, now: () => new Date(iso), ...quiet, ...extra })
const pendingIds = (cacheDir) => untriagedItems(readInbox(cacheDir)).map((item) => item.id)
const reports = (cacheDir, extension = '.json') => fs.readdirSync(path.join(cacheDir, 'reports')).filter((name) => name.endsWith(extension)).sort()
const reportAt = (cacheDir, name) => JSON.parse(fs.readFileSync(path.join(cacheDir, 'reports', name), 'utf8'))
const triage = (cacheDir, argv, iso = '2026-11-01T00:00:00.000Z') => {
  const out = []
  const errors = []
  const code = runTriage({ argv, cacheDirOverride: cacheDir, now: () => new Date(iso), log: (line) => out.push(line), errorLog: (line) => errors.push(line) })
  return { code, out: out.join('\n'), errors: errors.join('\n') }
}

test('同一 UTC 日跑两次：两份报告都在，第一份里的新增还在（线上 10-29、10-31 各被盖过一次）', async () => {
  const cacheDir = tmpCacheDir()
  const key = 'feedback/2026-10-31/a.json'
  assert.equal(await runAt(cacheDir, '2026-10-31T19:45:15.000Z', objects(key)), 0)
  assert.equal(await runAt(cacheDir, '2026-10-31T22:45:43.000Z', objects(key)), 0)
  assert.deepEqual(reports(cacheDir), ['2026-10-31T194515Z.json', '2026-10-31T224543Z.json'])
  assert.equal(reportAt(cacheDir, '2026-10-31T194515Z.json').totals.newFeedbackCount, 1)
  const later = reportAt(cacheDir, '2026-10-31T224543Z.json')
  assert.equal(later.totals.newFeedbackCount, 0, '第二轮确实不算新增')
  assert.equal(later.triage.count, 1, '但它还在待分诊里，第二轮的报告看得到')
  assert.equal(later.triage.items[0].key, key)
})

test('新反馈一直在账上，直到明确出账；出账要写清记到了哪个待办', async () => {
  const cacheDir = tmpCacheDir()
  const shared = objects('feedback/2026-10-31/a.json', 'feedback/2026-10-31/b.json')
  await runAt(cacheDir, '2026-10-31T08:00:00.000Z', shared)
  await runAt(cacheDir, '2026-10-31T09:00:00.000Z', shared)
  await runAt(cacheDir, '2026-11-01T09:00:00.000Z', shared)
  assert.deepEqual(pendingIds(cacheDir).sort(), ['a', 'b'], '跑多少轮都不会自己清掉')

  const before = fs.readFileSync(path.join(cacheDir, 'inbox.json'), 'utf8')
  const noTodo = triage(cacheDir, ['--triaged', 'a'])
  assert.equal(noTodo.code, 1)
  assert.match(noTodo.errors, /--todo/)
  const unknown = triage(cacheDir, ['--triaged', 'a', 'no-such-id', '--todo', 'T-1'])
  assert.equal(unknown.code, 1)
  assert.match(unknown.errors, /账上没有这个编号：no-such-id/)
  const nothing = triage(cacheDir, ['--todo', 'T-1'])
  assert.equal(nothing.code, 1)
  const typo = triage(cacheDir, ['--triage', 'a', '--todo', 'T-1'])
  assert.equal(typo.code, 1)
  assert.match(typo.errors, /--triage/)
  assert.equal(fs.readFileSync(path.join(cacheDir, 'inbox.json'), 'utf8'), before, '出错的时候账一个字都不动，包括前面对得上的那个')

  const done = triage(cacheDir, ['--', '--triaged', 'a', '--todo', 'T-1'])
  assert.equal(done.code, 0)
  assert.match(done.out, /已出账 1 条：a/)
  assert.match(done.out, /还剩 1 条待分诊：b/)
  assert.deepEqual(pendingIds(cacheDir), ['b'])
  const row = readInbox(cacheDir).items['feedback/2026-10-31/a.json']
  assert.equal(row.todo, 'T-1')
  assert.equal(row.triagedAt, '2026-11-01T00:00:00.000Z')

  await runAt(cacheDir, '2026-11-02T09:00:00.000Z', shared)
  assert.deepEqual(pendingIds(cacheDir), ['b'], '出过账的不会被下一轮带回来')
})

test('账上只有编号和元数据，没有摘要和留言', async () => {
  const cacheDir = tmpCacheDir()
  await runAt(cacheDir, '2026-10-31T08:00:00.000Z', objects('feedback/2026-10-31/a.json'))
  assert.doesNotMatch(fs.readFileSync(path.join(cacheDir, 'inbox.json'), 'utf8'), /占位摘要/)
})

test('升级后第一次跑：之前看过的全部进账，首次看到的时间用当时的；一条命令出完', async () => {
  const cacheDir = tmpCacheDir()
  const keys = ['feedback/2026-10-29/old.json', 'feedback/2026-10-30/older.json']
  for (const key of keys) writeRawFile(cacheDir, key, Buffer.from(fakeFeedbackContent(key.split('/').pop().replace('.json', ''))))
  writeState(cacheDir, { schemaVersion: 1, seenKeys: { [keys[0]]: '2026-10-29T17:59:42.000Z', [keys[1]]: '2026-10-30T00:00:00.000Z' }, lastRunAt: null, lastRunOk: true })
  await runAt(cacheDir, '2026-11-01T00:00:00.000Z', objects(...keys))
  assert.equal(reportAt(cacheDir, reports(cacheDir)[0]).totals.newFeedbackCount, 0, '都看过了，不算新增')
  assert.deepEqual(pendingIds(cacheDir).sort(), ['old', 'older'], '但都还没人记过，要进账')
  assert.equal(readInbox(cacheDir).items[keys[0]].firstSeenAt, '2026-10-29T17:59:42.000Z')

  const bad = triage(cacheDir, ['--triaged-through', '10-30', '--todo', 'x'])
  assert.equal(bad.code, 1)
  const partial = triage(cacheDir, ['--triaged-through', '2026-09-27', '--todo', '对账'])
  assert.equal(partial.code, 0)
  assert.match(partial.out, /已出账 0 条/)
})

test('--triaged-through：这天及更早的全部出账，更晚的留着', async () => {
  const cacheDir = tmpCacheDir()
  const fetchImpl = async (url) => {
    const u = new URL(url)
    if (u.pathname.endsWith('/objects')) {
      const keys = u.searchParams.get('prefix') === 'feedback/' ? ['feedback/a.json', 'feedback/b.json'] : []
      return { ok: true, json: async () => ({ success: true, result: keys.map((key) => ({ key })), result_info: { is_truncated: false, cursor: '' } }) }
    }
    const name = decodeURIComponent(u.pathname).endsWith('a.json') ? 'a' : 'b'
    const receivedAt = name === 'a' ? '2026-10-30T00:00:00.000Z' : '2026-10-31T00:00:00.000Z'
    return { ok: true, arrayBuffer: async () => Buffer.from(JSON.stringify({ receivedAt, receipt: name, payload: { manifest: {}, context: {} } })) }
  }
  await run({ cacheDirOverride: cacheDir, fetchImpl, now: () => new Date('2026-11-01T00:00:00.000Z'), ...quiet })
  const done = triage(cacheDir, ['--triaged-through', '2026-10-30', '--todo', '一次性对账'])
  assert.equal(done.code, 0)
  assert.deepEqual(pendingIds(cacheDir), ['b'])
})

test('版本健康判停、退出码 1：账照样更新，新反馈照样在', async () => {
  const cacheDir = tmpCacheDir()
  const events = [23, 24].flatMap((appMinor) => Array.from({ length: appMinor === 24 ? 10 : 300 }, (_item, index) => ({ sessionId: `s${index % 2}`, timestamp: '2026-10-29T00:00:00Z', eventName: 'generation.completed', props: { capability: 'image', result: appMinor === 24 ? 'failure' : 'success', durationBucket: '<1s', errorType: 'unknown' }, systemProps: { appMajor: 0, appMinor } })))
  writeRawFile(cacheDir, 'events/2026-10-29/e.json', Buffer.from(JSON.stringify({ payload: { events } })))
  const code = await runAt(cacheDir, '2026-10-29T08:00:00.000Z', { objectsByPrefix: { 'feedback/': ['feedback/2026-10-29/a.json'], 'events/': ['events/2026-10-29/e.json'], 'trajectories/': [] } }, { healthOptions: { newVersion: '0.24.0', oldVersion: '0.23.2' } })
  assert.equal(code, 1)
  assert.deepEqual(pendingIds(cacheDir), ['a'])
})

test('拉取失败：账不动（不把「没查成」变成任何结论）', async () => {
  const cacheDir = tmpCacheDir()
  await runAt(cacheDir, '2026-10-31T08:00:00.000Z', objects('feedback/2026-10-31/a.json'))
  const before = fs.readFileSync(path.join(cacheDir, 'inbox.json'), 'utf8')
  const code = await run({ cacheDirOverride: cacheDir, fetchImpl: async () => ({ ok: false, status: 500, json: async () => ({}) }), ...quiet })
  assert.equal(code, 1)
  assert.equal(fs.readFileSync(path.join(cacheDir, 'inbox.json'), 'utf8'), before)
})

test('同一份报告送达多次：账上一行待分诊，出账一次就清', async () => {
  const cacheDir = tmpCacheDir()
  const createdAt = '2026-10-20T08:00:00.000Z'
  const write = (name, receivedAt) => writeRawFile(cacheDir, `feedback/2026-10-20/${name}.json`, Buffer.from(JSON.stringify({ receivedAt, receipt: name, payload: { manifest: { createdAt }, context: { summary: '同一件事' } } })))
  write('first', '2026-10-20T08:00:05.000Z')
  write('again', '2026-10-20T08:01:05.000Z')
  await runAt(cacheDir, '2026-11-01T00:00:00.000Z', objects('feedback/2026-10-20/first.json', 'feedback/2026-10-20/again.json'))
  assert.deepEqual(pendingIds(cacheDir), ['first'])
  assert.equal(readInbox(cacheDir).items['feedback/2026-10-20/again.json'].duplicateOf, 'first')
  assert.equal(reportAt(cacheDir, reports(cacheDir)[0]).totals.duplicateDeliveries, 1)
  // 编号对的是重复的那份：它不用出账，也不该让人以为出了账。
  const wrong = triage(cacheDir, ['--triaged', 'again', '--todo', 'T-1'])
  assert.equal(wrong.code, 1)
  assert.equal(triage(cacheDir, ['--triaged', 'first', '--todo', 'T-1']).code, 0)
  assert.deepEqual(pendingIds(cacheDir), [])
})

test('显示号撞了（接收端的序号不是原子的）：不替人猜，要求用完整 key', async () => {
  const cacheDir = tmpCacheDir()
  const write = (name, createdAt) => writeRawFile(cacheDir, `feedback/2026-10-20/${name}.json`, Buffer.from(JSON.stringify({ receivedAt: createdAt, receipt: 'NF-1020-0001', payload: { manifest: { createdAt }, context: { summary: name } } })))
  write('one', '2026-10-20T08:00:00.000Z')
  write('two', '2026-10-20T09:00:00.000Z')
  await runAt(cacheDir, '2026-11-01T00:00:00.000Z', objects('feedback/2026-10-20/one.json', 'feedback/2026-10-20/two.json'))
  const clash = triage(cacheDir, ['--triaged', 'NF-1020-0001', '--todo', 'T-1'])
  assert.equal(clash.code, 1)
  assert.match(clash.errors, /2 份不同的报告/)
  assert.match(clash.errors, /feedback\/2026-10-20\/one\.json/)
  assert.equal(triage(cacheDir, ['--triaged', 'feedback/2026-10-20/one.json', '--todo', 'T-1']).code, 0)
  assert.equal(untriagedItems(readInbox(cacheDir)).length, 1)
})

test('账文件坏了：下一轮从缓存重建，一条不丢，报告说明白；重建之前不许出账', async () => {
  const cacheDir = tmpCacheDir()
  const shared = objects('feedback/2026-10-31/a.json')
  await runAt(cacheDir, '2026-10-31T08:00:00.000Z', shared)
  assert.equal(triage(cacheDir, ['--triaged', 'a', '--todo', 'T-1']).code, 0)
  fs.writeFileSync(path.join(cacheDir, 'inbox.json'), '{ not json')
  assert.equal(triage(cacheDir, ['--triaged', 'a', '--todo', 'T-1']).code, 1)
  await runAt(cacheDir, '2026-10-31T09:00:00.000Z', shared)
  assert.deepEqual(pendingIds(cacheDir), ['a'], '宁可再出一次账，也不能漏')
  const report = reportAt(cacheDir, '2026-10-31T090000Z.json')
  assert.equal(report.triage.rebuilt, true)
})

test('反馈文件读不出来：也进账，它也是用户发来的', async () => {
  const cacheDir = tmpCacheDir()
  writeRawFile(cacheDir, 'feedback/2026-10-31/bad.json', Buffer.from('{ not json'))
  await runAt(cacheDir, '2026-10-31T08:00:00.000Z', objects('feedback/2026-10-31/bad.json'))
  assert.deepEqual(pendingIds(cacheDir), ['feedback/2026-10-31/bad.json'])
})

test('还没跑过新版雷达时出账：明说先跑一轮，不新建一本空账', () => {
  const cacheDir = tmpCacheDir()
  const result = triage(cacheDir, ['--triaged', 'a', '--todo', 'T-1'])
  assert.equal(result.code, 1)
  assert.match(result.errors, /先跑一轮/)
  assert.equal(fs.existsSync(path.join(cacheDir, 'inbox.json')), false)
})

test('出账不联网、不要凭据', async () => {
  const cacheDir = tmpCacheDir()
  await runAt(cacheDir, '2026-10-31T08:00:00.000Z', objects('feedback/2026-10-31/a.json'))
  const source = runTriage.toString()
  assert.doesNotMatch(source, /resolveCredentials|listAllKeys|getObjectBuffer|fetch/)
})

test('parseTriageArgs：pnpm 传下来的 -- 不算参数', () => {
  assert.deepEqual(parseTriageArgs(['--', '--triaged', 'a', 'b', '--todo', 'T-1']), { ids: ['a', 'b'], through: null, todo: 'T-1', unknown: [] })
  assert.deepEqual(parseTriageArgs(['--triaged-through', '2026-10-30', '--todo', 'x y']), { ids: [], through: '2026-10-30', todo: 'x y', unknown: [] })
  assert.deepEqual(parseTriageArgs(['--oops']), { ids: [], through: null, todo: null, unknown: ['--oops'] })
})
