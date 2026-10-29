import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import test from 'node:test'
import yaml from 'js-yaml'
import { makeTempDir } from './_test-temp.mjs'
import { METADATA, percentage, planMetadata, planPause, runRollout } from './release-rollout.mjs'
const sha = t => crypto.createHash('sha256').update(t).digest('hex')
function fixture(value) {
  const text = `version: 1.2.3\nfiles:\n  - url: installer.zip\n    sha512: unchanged\n    size: 42\n${value === undefined ? '' : `stagingPercentage: ${value}\n`}`
  return { 'latest.yml': text, 'latest-mac.yml': text, 'SHA256SUMS.txt': METADATA.map(n => `${sha(text)}  ${n}\n`).join('') + 'a'.repeat(64) + '  installer.zip\n' }
}
for (const n of [20, 100]) test(`manifest fixture writes ${n} on both platforms with valid checksums`, () => {
  const original = fixture(), plan = planMetadata(original, n, '1.2.3')
  for (const name of METADATA) {
    const doc = yaml.load(plan.files[name]);assert.equal(doc.stagingPercentage, n)
    assert.deepEqual(doc.files, yaml.load(original[name]).files)
    assert.ok(plan.files['SHA256SUMS.txt'].includes(`${sha(plan.files[name])}  ${name}`))
  }
  assert.ok(plan.files['SHA256SUMS.txt'].includes('a'.repeat(64) + '  installer.zip'))
})
for (const n of [undefined, '', 0, 101, -1, 1.5, '20x', 'NaN', '1e1']) test(`reject invalid percentage ${n}`, () => assert.throws(() => percentage(n), /整数/))
for (const mutation of [files => delete files['latest-mac.yml'], files => files['latest.yml'] += 'stagingPercentage: 10\nstagingPercentage: 20\n', files => files['latest-mac.yml'] = '[]', files => files['latest-mac.yml'] = files['latest-mac.yml'].replace('1.2.3', '1.2.2'), files => files['SHA256SUMS.txt'] = 'bad']) test('invalid platform metadata fails before local writes', () => {
  const dir = makeTempDir('nomi-release-fixture-');const files = fixture();mutation(files)
  try {
    for (const [n,t] of Object.entries(files)) fs.writeFileSync(path.join(dir,n),t)
    assert.throws(() => runRollout(['prepare','--dir',dir,'--tag','v1.2.3','--percentage','20','--yes'], { log() {} }))
    assert.equal(fs.readFileSync(path.join(dir,'latest.yml'),'utf8'), files['latest.yml'])
  } finally { fs.rmSync(dir,{recursive:true,force:true}) }
})
test('pause preserves YAML and requests prerelease; missing previous stable is rejected', () => {
  const files = fixture(20), r = {tag_name:'v1.2.3'}
  assert.deepEqual(planPause(r,{tag_name:'v1.2.2'},files).files, files)
  assert.equal(planPause(r,{tag_name:'v1.2.2'},files).prerelease,true)
  for(const prev of [undefined,{tag_name:'v1.2.4'},{tag_name:'v1.2.2',prerelease:true}]) assert.throws(()=>planPause(r,prev,files))
})
function remote() {
  const files=fixture(20), calls=[], release={id:2,tag_name:'v1.2.3',draft:false,prerelease:false,immutable:false,updated_at:'fixed'}
  let latest=release
  const gh=args=>{
    calls.push(args)
    if(args[0]==='api') {
      const endpoint=args[1]
      if(endpoint.endsWith('immutable-releases')) return JSON.stringify({enabled:false})
      if(endpoint.endsWith('releases/latest')) return JSON.stringify(latest)
      if(endpoint.includes('releases?')) { assert.ok(args.includes('--jq'),'project release list before it enters bounded stdout');return JSON.stringify([release,{id:1,tag_name:'v1.2.2'}]) }
      return JSON.stringify(release)
    }
    if(args[1]==='download') { const dir=args[args.indexOf('--dir')+1];for(const [n,t] of Object.entries(files))fs.writeFileSync(path.join(dir,n),t) }
    if(args[1]==='upload') for(const n of args.slice(3,args.indexOf('--repo')))files[path.basename(n)]=fs.readFileSync(n,'utf8')
    if(args[1]==='edit'){release.prerelease=true;latest={id:1,tag_name:'v1.2.2'}}
    return ''
  }
  return {gh,calls,files,release}
}
for(const action of ['full','pause']) for(const yes of [false,true])test(`${action} public mutation requires yes=${yes}, prints first, reads back`,()=>{
  const r=remote();let printed=false
  const gh=args=>{if(['edit','upload'].includes(args[1]))assert.equal(printed,true);return r.gh(args)}
  runRollout([action,'--tag','v1.2.3',...(yes?['--yes']:[])],{gh,log(){printed=true}})
  assert.equal(r.calls.some(a=>['upload','edit'].includes(a[1])),yes)
  if(action==='full')assert.equal(yaml.load(r.files['latest.yml']).stagingPercentage,yes?100:20)
  else assert.equal(r.release.prerelease,yes)
})
test('immutable release refuses full before downloading',()=>{
  const r=remote();r.release.immutable=true
  assert.throws(()=>runRollout(['full','--tag','v1.2.3','--yes'],{gh:r.gh}),/不可变/)
  assert.equal(r.calls.some(a=>a[1]==='upload'),false)
})
test('release workflow uses the single metadata writer after validation and before upload',()=>{
  const text=fs.readFileSync(new URL('../.github/workflows/desktop-release.yml',import.meta.url),'utf8')
  const workflow=yaml.load(text),job=workflow.jobs.promote,steps=job.steps
  assert.equal(workflow.on.workflow_dispatch.inputs.staging_percentage.default,'20')
  assert.equal(job.env.STAGING_PERCENTAGE,'${{ inputs.staging_percentage }}')
  const writers=steps.filter(s=>s.run?.includes('release-rollout.mjs'))
  assert.equal(writers.length,1)
  assert.equal(writers[0].run,'node scripts/release-rollout.mjs prepare --dir publish --tag "$RELEASE_TAG" --percentage "$STAGING_PERCENTAGE" --yes')
  assert.ok(steps.indexOf(writers[0])>steps.findIndex(s=>s.name==='Prepare and checksum public assets'))
  assert.ok(steps.indexOf(writers[0])<steps.findIndex(s=>s.name==='Upload and verify the exact RC artifacts'))
  for(const step of steps.filter(s=>s!==writers[0]))assert.doesNotMatch(step.run??'',/stagingPercentage|(?:sed|python|node\s+-[ep])[^\n]*(?:latest|publish|\.yml)/)
})
