import assert from 'node:assert/strict'
import fs from 'node:fs'
import { describe, it } from 'vitest'
import { validateGenerationRecord, validateProductionPlan, validateFrameAnalysis } from '../../scripts/realFilmContinuityContract.mjs'

const oldRecordPath = '/Users/aoqimin/Documents/Nomi Projects/未命名项目 08_21 03_57-mt1xzh1c-31b70fdc/.nomi/real-ai-film-30s.generation-record.json'

function oldRecord() {
  return JSON.parse(fs.readFileSync(oldRecordPath, 'utf8'))
}

function goodPlan() {
  const anchors = [
    { id: 'woman', kind: 'character', name: '小满', description: '短黑发，黄色雨衣，提暖灯。', carrier: 'visual' },
    { id: 'street', kind: 'scene', name: '雨夜街口', description: '同一条有半开门的霓虹街口。', carrier: 'visual' },
    { id: 'studio', kind: 'scene', name: '工作室', description: '门内同一张木桌和窗边。', carrier: 'visual' },
    { id: 'note', kind: 'prop', name: '湿纸条', description: '画着一扇门的湿纸条。', carrier: 'visual' },
  ]
  const transitions = [
    { type: 'match_cut', durationFrames: 8 },
    { type: 'dissolve', durationFrames: 10 },
    { type: 'cut' },
    { type: 'match_cut', durationFrames: 8 },
    { type: 'dissolve', durationFrames: 10 },
  ]
  const shots = [
    ['发现纸条', '她在雨水里捡起湿纸条并看见门的线稿', '目标建立：找到纸条指向的门', '她从街角走到半开门前，纸条和暖灯都在手里', '雨夜街口、黄色雨衣、暖灯、湿纸条在右手'],
    ['推门', '她用拿灯的手照亮门缝，另一只手压下门把', '决定：跟随纸条进入门内', '门从半开变成可通过，她跨过同一门槛', '门、门把、纸条、暖灯位置连续'],
    ['进入工作室', '她跨过门槛，把湿纸条带到门内木桌', '空间转折：街外变成同一门内工作室', '她背对门走向桌边，桌面和窗在同一方向', '门槛、木桌、雨水、黄色雨衣保持'],
    ['做第一张卡', '她把暖灯和湿纸条放在木桌上，摊平纸条画出第一张卡', '行动落地：把发现变成创作', '纸条被压在卡片旁，第一张卡出现', '同一木桌、暖灯、湿纸条、手的位置连续'],
    ['排成时间线', '她把第一张卡与新卡按从左到右排成时间线，最后按下播放键', '推进到结果：故事被组织成片', '时间线完整亮起，屏幕显示由卡片组成的粗剪', '卡片从上一镜位置被拿起并保持顺序'],
    ['看见结果', '清晨光线从同一工作室窗边进入，她看着屏幕上的完成粗剪并放下暖灯', '结果收束：她完成了自己的第一版', '屏幕继续播放，暖灯停在桌角，人物状态稳定', '同一桌、窗、屏幕、暖灯、纸条都能回指'],
  ].map((item, index) => ({
    index: index + 1,
    shotId: `shot-${index + 1}`,
    durationSec: 5,
    anchorIds: ['woman', index < 2 ? 'street' : 'studio', 'note'],
    narrativeGoal: item[0],
    actionChain: item[1],
    dramaticBeat: item[2],
    continuityLocks: item[4],
    previousShotId: index === 0 ? undefined : `shot-${index}`,
    firstFrameRef: index === 0 ? 'anchor:street' : `tail:shot-${index}`,
    ffDesc: item[4],
    motionDesc: item[1],
    lfDesc: item[3],
    prompt: `${item[1]}。画面必须保持${item[4]}。`,
    transition: index < transitions.length ? transitions[index] : undefined,
    subtitle: item[2],
  }))
  return { title: '纸条指向的第一版', anchors, shots }
}

function goodGenerationRecord() {
  return {
    schemaVersion: 2,
    kind: 'real-provider-generation-record',
    plan: goodPlan(),
    video: {
      provider: 'apimart',
      model: 'doubao-seedance-2.0',
      shots: goodPlan().shots.map((shot) => ({
        shotId: shot.shotId,
        previousShotId: shot.previousShotId,
        firstFrameRef: shot.firstFrameRef,
        firstFrameDesc: shot.ffDesc,
        lastFrameDesc: shot.lfDesc,
        references: shot.anchorIds,
        prompt: shot.prompt,
      })),
    },
  }
}

function goodFrameAnalysis() {
  return {
    film: { durationSeconds: 30, videoCodec: 'h264', audioCodec: 'aac', subtitleDurationSeconds: 29.9 },
    shots: Array.from({ length: 6 }, (_, index) => ({ shotId: `shot-${index + 1}`, frames: { early: 'x', middle: 'x', late: 'x' } })),
    boundaries: Array.from({ length: 5 }, (_, index) => ({
      fromShotId: `shot-${index + 1}`,
      toShotId: `shot-${index + 2}`,
      spatialContinuity: 'pass',
      causalHandoff: 'pass',
      characterState: 'pass',
      verdict: 'pass',
      evidence: [`boundary-${index + 1}.jpg`],
    })),
    narrative: { openingGoal: true, development: true, turn: true, result: true, verdict: 'pass' },
  }
}

describe('real film continuity contract', () => {
  it('rejects the prior real-provider film for the actual root causes', () => {
    const record = oldRecord()
    const result = validateGenerationRecord(record)
    assert.equal(result.ok, false)
    assert.ok(result.errors.some((error) => /previousShotId|tail|firstFrame/i.test(error)))
    assert.ok(result.errors.some((error) => /narrative|storyboard|plan/i.test(error)))
  })

  it('does not let a plan pass with slogans or missing causal handoffs', () => {
    const plan = goodPlan()
    plan.shots[2].actionChain = ''
    plan.shots[3].previousShotId = undefined
    const result = validateProductionPlan(plan)
    assert.equal(result.ok, false)
    assert.ok(result.errors.some((error) => /actionChain/i.test(error)))
    assert.ok(result.errors.some((error) => /previousShotId/i.test(error)))
  })

  it('accepts a plan and generation envelope with explicit state handoff', () => {
    assert.deepEqual(validateProductionPlan(goodPlan()), { ok: true, errors: [] })
    assert.deepEqual(validateGenerationRecord(goodGenerationRecord()), { ok: true, errors: [] })
  })

  it('rejects frame analysis that was not actually reviewed at every boundary', () => {
    const analysis = goodFrameAnalysis()
    analysis.boundaries[2].verdict = undefined
    const result = validateFrameAnalysis(analysis)
    assert.equal(result.ok, false)
    assert.ok(result.errors.some((error) => /boundary|verdict/i.test(error)))
  })

  it('accepts frame analysis only when all technical and visual evidence is present', () => {
    assert.deepEqual(validateFrameAnalysis(goodFrameAnalysis()), { ok: true, errors: [] })
  })
})
