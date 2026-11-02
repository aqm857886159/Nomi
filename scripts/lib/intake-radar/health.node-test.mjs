import assert from 'node:assert/strict'
import test from 'node:test'
import * as healthModule from './health.mjs'
const { buildVersionHealth, renderVersionHealth } = healthModule
const newcombeDifference = (...args) => healthModule.newcombeDifference(...args)
const opts = { generatedAt: '2026-10-29T18:00:00Z', newVersion: '0.24.0', oldVersion: '0.23.2' }
const event = (minor, eventName, props = {}, date = '2026-10-29', sessionId = 's1') => ({ date, eventName, props, sessionId, systemProps: { appMajor: 0, appMinor: minor } })
function generation(minor, n, failures, capability = 'image', sessions = 2) {
  return Array.from({ length: n }, (_, i) => event(minor, 'generation.completed', { capability, result: i < failures ? 'failure' : 'success', durationBucket: '1-5s', errorType: 'network' }, '2026-10-29', `s${i % sessions}`))
}
const launches = () => Array.from({ length: 10 }, (_, i) => event(24, 'app.started', {}, ['2026-10-27', '2026-10-28', '2026-10-29'][i % 3]))
const fixture = () => [...launches(), ...generation(24, 20, 0), ...generation(23, 300, 0)]
const health = events => buildVersionHealth(events, opts)
const image = h => h.rows.find(r => r.key === 'generation.image')

test('Newcombe 1998 Table II(a), method 10: 56/70 - 48/80 gives [0.0524, 0.3339]', () => {
  // Original pp.876–877: https://www.researchgate.net/publication/13687790
  const ci = newcombeDifference(56, 70, 48, 80)
  assert.equal(ci.difference.toFixed(4), '0.2000')
  assert.equal(ci.lower.toFixed(4), '0.0524')
  assert.equal(ci.upper.toFixed(4), '0.3339')
})
test('Newcombe zero/all failure edges, swapping groups, empty denominator and invalid counts', () => {
  for (const [a,n,b,m] of [[0,10,0,20],[10,10,0,10],[0,10,20,20],[1,3,2,7]]) {
    const x = newcombeDifference(a,n,b,m), y = newcombeDifference(b,m,a,n)
    assert.ok(x.lower >= -1 && x.upper <= 1 && x.lower <= x.difference && x.upper >= x.difference)
    assert.ok(Math.abs(x.lower + y.upper) < 1e-12)
  }
  assert.equal(newcombeDifference(0,0,0,10), null)
  for (const args of [[-1,10,0,10],[11,10,0,10],[1,1.5,0,10],[NaN,10,0,10]]) assert.throws(() => newcombeDifference(...args), /计数/)
})
test('full at 3 UTC dates, 10 launches and image n=20; absent secondary telemetry does not block', () => {
  const h = health(fixture())
  assert.match(h.conclusion, /^可以全量：image 失败率最多变差 \+[\d.]+ 点（95% 上界，n=20\/300）；未覆盖：/)
  assert.match(h.conclusion, /Agent 回合（遥测没有这一项）/)
  assert.match(h.conclusion, /image-edit失败率.*video失败率.*更新download.*更新install/)
  assert.equal(renderVersionHealth(h).split('\n').at(-1), h.conclusion)
})
test('only new cohort dates, launches, image sample and unknown results block; exact deficits', () => {
  const cases = [
    [fixture().filter(e => e.date !== '2026-10-27'), /观察日期还差1天/],
    [fixture().filter((e,i) => i !== 0), /启动还差1次/],
    [[...launches(), ...generation(24,19,0), ...generation(23,300,0)], /image主指标样本还差1次/],
    [[...fixture(), event(24,'generation.completed',{capability:'image',result:'unknown'})], /image主指标未知结果1个/],
  ]
  for (const [events, pattern] of cases) { const h = health(events); assert.match(h.conclusion,/^样本不够：/); assert.match(h.conclusion,pattern) }
  assert.match(health(fixture().filter(e => e.systemProps.appMinor !== 23)).conclusion,/^可以全量：.*\+100.0 点/)
})
test('stop takes priority over missing primary observation dates and sample deficits', () => {
  const h = health([...generation(24,10,10), ...generation(23,300,0)])
  assert.equal(h.stop,true); assert.match(h.conclusion,/^停止放量：image失败率.*n=10\/300/)
})
test('stop boundary n=9 misses by one despite positive lower bound and large difference', () => {
  const h = health([...generation(24,9,9), ...generation(23,300,0)])
  assert.ok(image(h).interval.lower > 0); assert.ok(image(h).interval.difference >= .05); assert.equal(h.stop,false)
})
test('stop boundary lower bound just below zero despite n>=10 and difference>=5 points', () => {
  const h = health([...generation(24,42,22), ...generation(23,300,111)])
  assert.ok(image(h).interval.lower <= 0); assert.ok(image(h).interval.lower > -.01)
  assert.ok(image(h).interval.difference >= .05); assert.equal(h.stop,false)
})
test('stop boundary difference=4.99 points despite positive lower bound and n>=10', () => {
  const h = health([...generation(24,10000,499), ...generation(23,10000,0)])
  assert.ok(image(h).interval.lower > 0); assert.ok(image(h).interval.difference < .05); assert.equal(h.stop,false)
  assert.equal(health([...generation(24,10000,500), ...generation(23,10000,0)]).stop,true)
  assert.equal(health([...generation(24,10000,3500), ...generation(23,10000,3000)]).stop,true, '35% minus 30% is exactly the 5-point boundary')
})
test('one failure session is listed as concentrated and does not stop; two do stop', () => {
  const events = [...fixture(), ...generation(24,42,40,'video',1), ...generation(23,300,0,'video')]
  const h = health(events); assert.equal(h.stop,false); assert.match(h.conclusion,/^可以全量/)
  assert.match(renderVersionHealth(h),/集中在一个会话.*video失败率/)
  events.find(e => e.props.capability === 'video' && e.props.result === 'failure').sessionId = 's2'
  assert.equal(health(events).stop,true)
})
test('unknown/missing session IDs never fabricate independent failures', () => {
  const events = [...generation(24,20,20), ...generation(23,300,0)]
  for (const e of events) delete e.sessionId
  const h = health(events); assert.equal(h.stop,false); assert.match(renderVersionHealth(h),/失败.*缺sessionId/)
})
test('every secondary metric can stop; low samples and unknown results only disclose coverage', () => {
  for (const capability of ['image-edit','video']) assert.equal(health([...fixture(),...generation(24,10,10,capability),...generation(23,300,0,capability)]).stop,true)
  for (const name of ['download','install','agent']) {
    const events = [23,24].flatMap(v => Array.from({length:v === 24 ? 10 : 300},(_,i) => event(v,name === 'agent' ? 'agent.turn.completed' : 'update.action',{action:name,result:v === 24 ? 'failure' : 'success'},'2026-10-29',`s${i%2}`)))
    assert.equal(health([...fixture(),...events]).stop,true)
  }
  const h = health([...fixture(),event(24,'generation.completed',{capability:'video',result:'unknown'})])
  assert.match(h.conclusion,/^可以全量/); assert.match(renderVersionHealth(h),/video失败率.*未知1/)
})
test('conditional local rejection denominator, sessions and missing classification are explicit', () => {
  const events = [...fixture(),...generation(24,20,20),...generation(23,300,300)]
  for (const e of events.filter(e => e.systemProps.appMinor === 24 && e.props.result === 'failure')) Object.assign(e.props,{errorType:'unknown',durationBucket:'<1s'})
  let h = health(events); const r = h.rows.find(r => r.key === 'local.image')
  assert.equal(r.newer.n,20); assert.equal(r.newer.failure,20); assert.equal(r.newer.failureSessions,2); assert.equal(r.stop,true)
  delete events.at(-1).props.errorType
  h = health(events); assert.equal(h.rows.find(r => r.key === 'local.image').older.unknown,1)
})
test('outside window, future, malformed date and automated events cannot fill samples or cause stops', () => {
  const extra = ['2026-10-26','2026-10-30','2026-02-30'].flatMap(date => generation(24,100,100).map(e => ({...e,date})))
  const auto = generation(24,100,100).map(e => ({...e,systemProps:{...e.systemProps,automated:true}}))
  assert.deepEqual(health([...fixture(),...extra,...auto]),health(fixture()))
})
test('cancel and unknown are excluded from denominator; only primary new unknown blocks full', () => {
  const events = [...fixture(),event(24,'generation.completed',{capability:'image',result:'cancel'}),event(23,'generation.completed',{capability:'image',result:'unknown'})]
  assert.equal(image(health(events)).newer.n,20); assert.equal(image(health(events)).newer.cancel,1); assert.match(health(events).conclusion,/^可以全量/)
  events.push(event(24,'generation.completed',{capability:'image'})); assert.match(health(events).conclusion,/样本不够：.*未知结果1个/)
})
test('corrupt cache becomes primary result uncertainty and cannot authorize full', () => {
  assert.match(buildVersionHealth(fixture(),{...opts,corruptFileCount:1}).conclusion,/样本不够：.*image主指标.*缓存损坏1个.*缺失量未知/)
})
test('input validation and indistinguishable patch cohorts', () => {
  for (const patch of [{newVersion:'bad'}, {newVersion:'0.23.3'}, {oldVersion:'0.25'}, {generatedAt:'2026-02-30'}]) assert.throws(() => buildVersionHealth(fixture(),{...opts,...patch}))
  for (const patch of [{windowDays:0},{minLaunches:NaN},{stopMinIncrease:-1}]) assert.throws(() => buildVersionHealth(fixture(),{...opts,thresholds:patch}),/政策/)
})
// Seeded LCG; each trial uses the production event aggregator and decision including session rule.
function simulate(newRate) {
  let seed = 20261030, stops = 0
  const random = () => { seed = (Math.imul(seed,1664525) + 1013904223) >>> 0; return seed / 4294967296 }
  for (let run=0; run<1000; run++) {
    const draw = (n,p) => Array.from({length:n},() => random() < p ? 1 : 0).reduce((a,b) => a+b,0)
    const oldFailures = draw(300,.36), newFailures = draw(42,newRate)
    if (health([...generation(24,42,newFailures),...generation(23,300,oldFailures)]).stop) stops++
  }
  return stops
}
for (const [rate, expected, condition] of [[.36,30,count => count <= 50],[.66,966,count => count >= 800]]) {
  const measured = simulate(rate)
  test(`fixed seed: new=${rate}, old=0.36, n=42/300, stop ${measured}/1000 (${(measured/10).toFixed(1)}%)`, () => {
    assert.equal(measured, expected)
    assert.ok(condition(measured))
  })
}


test('D3: local-refusal is excluded from generation failure rate and included in local rejection, unknown keeps its old rule', () => {
  const extra = ['local-refusal', 'local_refusal', 'unknown'].map(errorType => event(24, 'generation.completed', { capability: 'image', result: 'failure', errorType, durationBucket: '<1s' }))
  const h = health([...fixture(), ...extra])
  assert.equal(image(h).newer.failure, 2)
  assert.equal(image(h).newer.n, 22)
  assert.equal(h.rows.find(r => r.key === 'local.image').newer.failure, 2)
})
