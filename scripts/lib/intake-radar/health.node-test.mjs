import assert from 'node:assert/strict'
import test from 'node:test'
import { buildVersionHealth, renderVersionHealth } from './health.mjs'
const keys=['generation.image','generation.video','local.image','local.video','update.download','update.install','agent']
const thresholds={windowDays:1,minLaunches:2,approvalPending:[],metrics:Object.fromEntries(keys.map(k=>[k,{minSamples:2,maxIncrease:.2}]))}
const opts={generatedAt:'2026-10-29T18:00:00Z',newVersion:'0.24.0',oldVersion:'0.23.2',thresholds}
const event=(minor,eventName,props={},date='2026-10-29')=>({date,eventName,props,systemProps:{appMajor:0,appMinor:minor}})
function fixture(){return [23,24].flatMap(v=>[
  ...['image','video'].flatMap(capability=>Array.from({length:2},()=>event(v,'generation.completed',{capability,result:'success'}))),
  ...Array.from({length:2},()=>event(v,'app.started')),
  ...['download','install'].flatMap(action=>Array.from({length:2},()=>event(v,'update.action',{action,result:'success'}))),
  ...Array.from({length:2},()=>event(v,'agent.turn.completed',{result:'success'})),
])}
test('full only with every required metric at the sample boundary and approved policy',()=>assert.equal(buildVersionHealth(fixture(),opts).conclusion,'可以全量'))
test('one below either version minimum stays insufficient and reports exact deficit',()=>{
  for(const minor of [23,24]){const e=fixture();e.splice(e.findIndex(e=>e.systemProps.appMinor===minor&&e.props.capability==='image'),1)
    const h=buildVersionHealth(e,opts);assert.match(h.conclusion,/样本不够/);assert.match(h.conclusion,/image失败率缺新版[01] \/ 旧版[01]/)}
})
test('regression takes priority over missing other metrics and makes stop true',()=>{
  const events=fixture().filter(e=>e.eventName!=='agent.turn.completed')
  for(const e of events.filter(e=>e.systemProps.appMinor===24&&e.props.capability==='image'))Object.assign(e.props,{result:'failure',errorType:'unknown',durationBucket:'<1s'})
  const h=buildVersionHealth(events,opts);assert.equal(h.stop,true);assert.match(h.conclusion,/停止放量：image失败率.*100.0%.*0.0%.*n=2\/2/)
})
test('outside window, future and automated events cannot fill samples or cause regressions',()=>{
  const extra=['2026-10-26','2026-10-30'].flatMap(d=>Array.from({length:5},()=>event(24,'generation.completed',{capability:'image',result:'failure'},d)))
  const auto=event(24,'generation.completed',{capability:'image',result:'failure'});auto.systemProps.automated=true
  assert.equal(buildVersionHealth([...fixture(),...extra,auto],opts).conclusion,'可以全量')
})
test('cancel and unknown do not count as success; unknown blocks approval',()=>{
  for(const result of ['cancel','unknown']){const e=fixture();e.find(e=>e.systemProps.appMinor===24&&e.props.capability==='video').props.result=result;assert.match(buildVersionHealth(e,opts).conclusion,/样本不够/)}
})
test('missing Agent, installation samples, corrupt cache and pending policy never approve',()=>{
  assert.match(buildVersionHealth(fixture().filter(e=>e.eventName!=='agent.turn.completed'),opts).conclusion,/遥测缺这一项/)
  assert.match(buildVersionHealth(fixture().filter(e=>e.props.action!=='install'),opts).conclusion,/install.*缺新版2 \/ 旧版2/)
  assert.match(buildVersionHealth(fixture(),{...opts,corruptFileCount:1}).conclusion,/缓存损坏/)
  assert.match(buildVersionHealth(fixture(),{...opts,thresholds:{...thresholds,approvalPending:['待协调定']}}).conclusion,/待协调定/)
})
test('conditional local rejection share reports denominator and preserves missing error type',()=>{
  const e=fixture();for(const v of [23,24])for(let i=0;i<2;i++)e.push(event(v,'generation.completed',{capability:'image',result:'failure',durationBucket:'<1s',errorType:v===24?'unknown':'network'}))
  const h=buildVersionHealth(e,opts),r=h.rows.find(r=>r.key==='local.image');assert.equal(r.newer.failure,2);assert.equal(r.newer.n,2);assert.match(h.conclusion,/疑似本地拒绝/)
  delete e.at(-1).props.errorType;assert.match(buildVersionHealth(e,opts).conclusion,/未知结果/)
})
test('patch versions cannot be claimed as distinguishable cohorts',()=>assert.throws(()=>buildVersionHealth(fixture(),{...opts,newVersion:'0.23.3'}),/major.minor/))
test('default historical policy stays pending, and last line is always conclusion',()=>{
  const h=buildVersionHealth(fixture(),{...opts,thresholds:undefined});assert.match(h.conclusion,/待协调定/)
  assert.equal(renderVersionHealth(h).split('\n').at(-1),h.conclusion)
})

test('a burst on one day cannot substitute for three observation dates',()=>{
  const thresholds3={...thresholds,windowDays:3}
  assert.match(buildVersionHealth(fixture(),{...opts,thresholds:thresholds3}).conclusion,/观察日期缺新版2 \/ 旧版2天/)
  const extra=[23,24].flatMap(v=>['2026-10-27','2026-10-28'].map(d=>event(v,'app.started',{},d)))
  assert.equal(buildVersionHealth([...fixture(),...extra],{...opts,thresholds:thresholds3}).conclusion,'可以全量')
})
