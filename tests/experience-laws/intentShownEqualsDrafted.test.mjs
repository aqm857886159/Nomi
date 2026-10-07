// 铁律 ⑩「说的 = 摆的」宿主矩阵（确定性，进 CI）。链路与判据见 intentShownEqualsDrafted.mjs。
//
// 用例按「几类代表模型」挑，不按单个模型的特例：比例键名不同（size / ratio / aspect_ratio 各一）、
// 根本没有这个参数（不收时长的视频、图片说了时长）、像素档尺寸、时长只收几个档（说中 / 说越界）、带参考、张数、
// 没点名模型。每个用例写清 Agent 说了什么、期望宿主怎么回应；首跑发现的违反登记在 `knownViolations`，
// 指向逃逸账本 candidate（不当场修，由协调会话定）。棘轮：新违反红；登记的违反已不再出现也红（修好了删行）。
import { describe, expect, it } from 'vitest'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { loadEscapeLedger } from '../../scripts/escape-ledger-lib.mjs'
import { INTENT_FIELDS, observeIntent, seededWorld, violationsOf } from './intentShownEqualsDrafted.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const escapeLedger = loadEscapeLedger(path.resolve(here, '../..'))
const world = seededWorld()

const PROMPT = '清晨的渔港，一条小船出海'

/** 矩阵行。`expect` = 宿主该怎么回应：`land`（四站都摆出同样的值）或 `refuse`（当场说回给 Agent）。 */
const CASES = [
  { id: 'aspect-key-size', family: '比例键名 = size（比例语义）', intent: { providerId: 'apimart', modelId: 'doubao-seedance-2.5', count: 2, durationSec: 8 }, expect: 'land' },
  { id: 'aspect-key-ratio', family: '比例键名 = ratio', intent: { providerId: 'volcengine', modelId: 'doubao-seedance-2-0-260128', count: 1, durationSec: 5 }, expect: 'land' },
  { id: 'aspect-key-aspect_ratio', family: '比例键名 = aspect_ratio', intent: { providerId: 'apimart', modelId: 'kling-3.0-turbo', count: 1, durationSec: 5 }, expect: 'land' },
  { id: 'pixel-size', family: '像素档尺寸（size = 2048x2048 一类）', intent: { providerId: 'volcengine', modelId: 'doubao-seedream-4-5-251128', count: 3 }, expect: 'land' },
  { id: 'duration-in-steps', family: '时长只收几个档，说中了', intent: { providerId: 'apimart', modelId: 'MiniMax-Hailuo-2.3', count: 1, durationSec: 6 }, expect: 'land' },
  // 下面三条首跑是违反（LAW10-OUT-OF-RANGE-SPLIT / LAW10-SILENT-DROP）：宿主照收、各站各说各的。现在起草那一刻就拒，并说出合法值。
  { id: 'duration-out-of-steps', family: '时长只收几个档，说越界', intent: { providerId: 'apimart', modelId: 'MiniMax-Hailuo-2.3', count: 1, durationSec: 8 }, expect: 'refuse', refusal: /只支持 6 \/ 10 秒/ },
  { id: 'no-duration-param', family: '模型没有时长参数（视频）', intent: { providerId: 'apimart', modelId: 'veo3.1-fast', count: 1, durationSec: 8 }, expect: 'refuse', refusal: /没有时长参数/ },
  { id: 'still-with-duration', family: '图片说了时长（说明书写「静帧不填」）', intent: { providerId: 'apimart', modelId: 'gpt-image-2', count: 1, durationSec: 4 }, expect: 'refuse', refusal: /没有时长参数/ },
  { id: 'references', family: '带一张素材库参考', intent: { providerId: 'apimart', modelId: 'gpt-image-2', count: 1, references: ['asset-hero'] }, expect: 'land' },
  { id: 'count-four', family: '张数：一次四张', intent: { providerId: 'apimart', modelId: 'gpt-image-2', count: 4 }, expect: 'land' },
  // ── 比例一列（#1023：draft_shots 有了比例字段，宿主按所选模式翻成真实键）──
  { id: 'ratio-via-size', family: '比例：真实键是 size（选项是比例）', intent: { providerId: 'apimart', modelId: 'doubao-seedance-2.5', count: 1, aspectRatio: '16:9' }, expect: 'land' },
  { id: 'ratio-via-ratio', family: '比例：真实键是 ratio', intent: { providerId: 'volcengine', modelId: 'doubao-seedance-2-0-260128', count: 1, aspectRatio: '9:16' }, expect: 'land' },
  { id: 'ratio-via-aspect_ratio', family: '比例：真实键是 aspect_ratio', intent: { providerId: 'apimart', modelId: 'kling-3.0-turbo', count: 1, aspectRatio: '1:1' }, expect: 'land' },
  { id: 'ratio-next-to-size-tier', family: '比例：清晰度也叫 size（Agnes 视频 2.5，LAW11-ALIAS-DEDUPE 修过）', intent: { providerId: 'agnes', modelId: 'agnes-video-2.5', count: 1, aspectRatio: '16:9' }, expect: 'land' },
  { id: 'ratio-pixel-colon', family: '比例：选项是冒号像素串（Runway 1280:720 一类）', intent: { providerId: 'runway', modelId: 'gpt_image_2', count: 1, aspectRatio: '16:9' }, expect: 'land' },
  { id: 'ratio-pixel-x', family: '比例：只有像素档 size（2048x2048 一类，没有比例控件）', intent: { providerId: 'volcengine', modelId: 'doubao-seedream-4-5-251128', count: 1, aspectRatio: '16:9' }, expect: 'refuse', refusal: /no frame-ratio choice/ },
  { id: 'ratio-not-offered', family: '比例：模型不出这一档', intent: { providerId: 'apimart', modelId: 'veo3.1-fast', count: 1, aspectRatio: '1:1' }, expect: 'refuse', refusal: /16:9, 9:16/ },
  { id: 'reference-unknown', family: '参考给了素材库里没有的 id', intent: { providerId: 'apimart', modelId: 'gpt-image-2', count: 1, references: ['shot-2'] }, expect: 'refuse' },
  { id: 'model-not-in-catalog', family: '点名一个目录里没有的模型', intent: { providerId: 'apimart', modelId: 'no-such-model-9', count: 1 }, expect: 'refuse' },
]

describe('铁律 ⑩ 说的 = 摆的（宿主矩阵）', () => {
  it('矩阵列覆盖全部语义字段', () => {
    expect(INTENT_FIELDS).toEqual(['model', 'count', 'durationSec', 'references', 'aspectRatio'])
    expect(CASES.filter((testCase) => testCase.intent.aspectRatio !== undefined).length, '比例一列至少覆盖 size / ratio / aspect_ratio / 冒号像素档 / Agnes 改名 / 两种拒绝').toBeGreaterThanOrEqual(7)
  })

  it('判据会咬人：任一站改值或悄悄丢掉都算违反，宿主拒绝不算', () => {
    const said = { model: 'v/m', count: 2, durationSec: 8, references: 1 }
    const same = { model: 'v/m', count: 2, durationSec: 8, references: 1 }
    expect(violationsOf({ refused: false, said, draft: same, node: { ...same, references: undefined }, card: { ...same, sentDurationSec: 8 } })).toEqual([])
    expect(violationsOf({ refused: false, said, draft: same, node: { ...same, durationSec: 6, references: undefined }, card: { ...same, durationSec: undefined, sentDurationSec: 8 } }))
      .toEqual(['card.durationSec:dropped', 'card.durationSec:shown≠sent(undefined/8)', 'node.durationSec:differs(8→6)'])
    expect(violationsOf({ refused: true, said })).toEqual([])
    const ratioSaid = { model: 'v/m', count: 1, references: 0, aspectRatio: 16 / 9 }
    const ratioSame = { ...ratioSaid, aspectRatio: 1280 / 720 }
    expect(violationsOf({ refused: false, said: ratioSaid, draft: ratioSame, node: { ...ratioSame, references: undefined }, card: { ...ratioSame, sentAspectRatio: 16 / 9 } })).toEqual([])
    expect(violationsOf({ refused: false, said: ratioSaid, draft: ratioSame, node: { ...ratioSame, aspectRatio: 1, references: undefined }, card: { ...ratioSame, sentAspectRatio: 16 / 9 } }))
      .toEqual(['node.aspectRatio:differs(≈1.78→≈1.00)'])
  })

  for (const testCase of CASES) {
    it(`${testCase.id} · ${testCase.family}`, async () => {
      const observation = await observeIntent(world, { prompt: PROMPT, ...testCase.intent })
      if (testCase.expect === 'refuse') {
        expect(observation.refused, `宿主应当场拒绝并说回给 Agent，实际落了草稿：${JSON.stringify(observation)}`).toBe(true)
        if (testCase.refusal) expect(observation.refusal, '拒绝的话要说清合法值').toMatch(testCase.refusal)
        return
      }
      expect(observation.refused, `宿主不该拒绝：${observation.refusal ?? ''}`).toBe(false)
      const known = testCase.knownViolations ?? {}
      expect(violationsOf(observation), `说的 ≠ 摆的。逐站：${JSON.stringify(observation)}`).toEqual(Object.keys(known).sort())
      for (const ledgerId of Object.values(known)) {
        const entry = escapeLedger.entries.find((candidate) => candidate.id === ledgerId)
        expect(entry?.ironLaws, `${ledgerId} 应在逃逸账本里且标 ⑩`).toContain('⑩')
      }
    }, 60_000)
  }
})
