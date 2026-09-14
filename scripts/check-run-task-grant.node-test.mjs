// 门岗自己的红/绿对照（R17：加规则必须先验它会红）。
//
// 阳性对照用的是 2026-09-11 真事故的原样写法：deconstructVideo 里自己拼 request 去发
// image_to_prompt，extras 里没有 grantId —— 那一版每一镜都在发请求前被付费闸抛回，
// 再被 catch 吞成一格「没读出」。阴性对照是修复后的写法（带 grantId）。
import assert from 'node:assert/strict'
import test from 'node:test'
import { scan, stripComments } from './check-run-task-grant.mjs'

const BROKEN = `
async function analyze(shot) {
  const result = await runTask({
    vendor: brain.vendor,
    request: {
      kind: "image_to_prompt",
      prompt: buildShotAnalysisPrompt(shot),
      extras: { projectId, modelKey: brain.modelKey, referenceImages: frameUrls },
    },
  });
}
`

const FIXED = `
async function analyze(shot) {
  const result = await runTask({
    vendor: brain.vendor,
    request: {
      kind: "image_to_prompt",
      prompt: buildShotAnalysisPrompt(shot),
      extras: { projectId, modelKey: brain.modelKey, referenceImages: frameUrls, grantId, nodeId },
    },
  });
}
`

test('漏带 grantId 的自拼 request 调用点被判红', () => {
  const hits = scan(stripComments(BROKEN), 'electron/video/deconstructVideo.ts')
  assert.equal(hits.length, 1)
  assert.equal(hits[0].line, 3)
})

test('带上 grantId 之后放行', () => {
  assert.deepEqual(scan(stripComments(FIXED), 'electron/video/deconstructVideo.ts'), [])
})

test('注入形态 runTaskFn 同样在管辖内（capabilityCore 的判分走的就是它）', () => {
  const src = `const r = await runTaskFn({ vendor: agent.vendor, request: { kind: 'image_to_prompt', prompt, extras: { modelKey } } })`
  assert.equal(scan(stripComments(src), 'electron/capabilityCore/shotVerifyDeps.ts').length, 1)
})

test('转发型调用不在管辖内：payload 从哪来，grantId 就从哪来', () => {
  assert.deepEqual(scan(stripComments('const r = await runTask(payload)'), 'electron/tasks/x.ts'), [])
})

test('注释里的 grantId 不算数（抹注释后仍判红），且抹注释逐行等高不挪行号', () => {
  const src = [
    'function f() {',
    '  // 这里以前带过 grantId',
    '  return runTask({ vendor, request: { kind: "transcribe", extras: { file } } })',
    '}',
  ].join('\n')
  const hits = scan(stripComments(src), 'electron/video/deconstructVideo.ts')
  assert.equal(hits.length, 1)
  assert.equal(hits[0].line, 3)
})
