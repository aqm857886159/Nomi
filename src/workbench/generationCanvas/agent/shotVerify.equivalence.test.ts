import { describe, expect, it } from 'vitest'

// 反漂移守恒：judge 纯核（组 prompt / 解析判决 / 判偏差）有两份实现——
//  · src 侧 `shotVerify.ts`（渲染层手动画布路径用，import 得到 reconcile 类型）；
//  · electron 侧 `shotVerifyCore.ts`（主进程 MCP 生成路径的**单一真相源**，反向 import 不了 src，故镜像）。
// electron production 反向 import 不了 src（tsconfig rootDir 硬限制），故不能物理 re-export；改用本仓既定
// 「重复 + 等价测试守恒」模式（同 nodeKindDomain.equivalence / thumbnailDerive.equivalence）：vitest 下
// 两侧都可 import，这里把它们逐项钉死——维度/阈值 ===，buildShotVerifyPrompt 对同一批 ctx 产出**逐字节相同**，
// parseShotVerifyVerdict 对同一批脏输入解析结果相同，deviationsFromVerdict/normalizeShotScore 同结果。
// 任一侧改了另一侧没跟 → 立刻红。
import {
  SHOT_VERIFY_DIMENSIONS as SRC_DIMENSIONS,
  SHOT_VERIFY_PASS_THRESHOLD as SRC_THRESHOLD,
  activeDimensions as srcActiveDimensions,
  buildShotVerifyPrompt as srcBuildPrompt,
  parseShotVerifyVerdict as srcParse,
  deviationsFromVerdict as srcDeviations,
  normalizeShotScore as srcNormalize,
  type ShotVerifyContext as SrcCtx,
} from './shotVerify'

// electron 侧单一真相源（vitest 可跨侧 import；electron 的 `electron` 依赖被 vitest alias 成桩，本核零 electron import 故无碍）。
import {
  SHOT_VERIFY_DIMENSIONS as CORE_DIMENSIONS,
  SHOT_VERIFY_PASS_THRESHOLD as CORE_THRESHOLD,
  activeDimensions as coreActiveDimensions,
  buildShotVerifyPrompt as coreBuildPrompt,
  parseShotVerifyVerdict as coreParse,
  deviationsFromVerdict as coreDeviations,
  normalizeShotScore as coreNormalize,
  type ShotVerifyContext as CoreCtx,
} from '../../../../electron/capabilityCore/shotVerifyCore'

// 覆盖各分支的固定 ctx：有前镜(评三轴)/无前镜(不评 continuity)/无锚/prompt 含特殊字符与换行。
const FIXTURES: Array<SrcCtx & CoreCtx> = [
  {
    shotNodeId: 'n-1',
    shotTitle: '#1 外·夜',
    shotPrompt: '暴雨中的便利店招牌，2:17 的钟面特写',
    anchorDescriptions: ['短发圆脸、左眉一颗痣，深蓝工装', '暴雨夜便利店内景，冷白灯光'],
  },
  {
    shotNodeId: 'n-2',
    shotTitle: '#2 内',
    shotPrompt: '小周整理货架，玻璃映出街对面的人影',
    anchorDescriptions: [],
    previousShotPrompt: '暴雨中的便利店招牌，2:17 的钟面特写',
  },
  {
    shotNodeId: 'n-3',
    shotTitle: '  首尾空格标题  ',
    shotPrompt: '',
    anchorDescriptions: ['  带前后空格的锚  ', '', '第二个锚"含引号"与\\反斜杠'],
    previousShotPrompt: '   ', // 全空白 → 视作无前镜
  },
  // 英文界面：判官被要求用英文写 reason。两侧必须同样追加这一句,否则英文用户在一侧看到中文理由。
  {
    shotNodeId: 'n-4',
    shotTitle: '#4 内·日',
    shotPrompt: '小周把伞收进桶里',
    anchorDescriptions: ['短发圆脸、左眉一颗痣，深蓝工装'],
    previousShotPrompt: '暴雨中的便利店招牌',
    reasonLanguage: 'en',
  },
  // 视频镜 + 英文：framePair 与 reasonLanguage 同时生效的组合。
  {
    shotNodeId: 'n-5',
    shotTitle: '#5 外·夜',
    shotPrompt: '镜头缓缓推近招牌',
    anchorDescriptions: [],
    framePair: true,
    reasonLanguage: 'en',
  },
  // 显式中文：必须与「不传」逐字节一致(不许因为加了这个字段就给中文 prompt 多出空行)。
  {
    shotNodeId: 'n-6',
    shotTitle: '#6 内',
    shotPrompt: '货架特写',
    anchorDescriptions: ['冷白灯光'],
    reasonLanguage: 'zh-CN',
  },
]

describe('shotVerify 等价性（electron shotVerifyCore === src shotVerify 单一真相源）', () => {
  it('维度表逐项一致（key/name/desc/anchors/requiresPreviousShot）', () => {
    expect(CORE_DIMENSIONS).toEqual(SRC_DIMENSIONS)
    expect(CORE_DIMENSIONS.length).toBe(SRC_DIMENSIONS.length)
  })

  it('过线阈值一致', () => {
    expect(CORE_THRESHOLD).toBe(SRC_THRESHOLD)
  })

  it('activeDimensions 对每个 ctx 一致（首镜去 continuity）', () => {
    for (const ctx of FIXTURES) {
      expect(coreActiveDimensions(ctx)).toEqual(srcActiveDimensions(ctx))
    }
  })

  it('buildShotVerifyPrompt 对每个 ctx 产出逐字节相同的 prompt', () => {
    for (const ctx of FIXTURES) {
      const core = coreBuildPrompt(ctx)
      const src = srcBuildPrompt(ctx)
      // 逐字节：先长度、再整串（===）——任一字符漂移即红。
      expect(core.length).toBe(src.length)
      expect(core).toBe(src)
    }
  })

  it('parseShotVerifyVerdict 对同一批脏输入解析结果相同', () => {
    const dirty = [
      '{"reason":"ok","scores":{"identity":5,"composition":4,"continuity":3}}',
      '```json\n{"scores":{"identity":1,"composition":2}}\n```',
      '前面一段废话 {"scores":{"identity":"2","continuity":9},"reason":"带尾逗号",} 后面废话',
      '完全不是 JSON 的一段话', // 两侧都应抛
      '{"scores":{}}',
      '',
    ]
    for (const raw of dirty) {
      let coreOut: unknown
      let srcOut: unknown
      let coreErr = false
      let srcErr = false
      try { coreOut = coreParse(raw) } catch { coreErr = true }
      try { srcOut = srcParse(raw) } catch { srcErr = true }
      expect(coreErr).toBe(srcErr) // 同一输入两侧「抛/不抛」一致
      if (!coreErr && !srcErr) expect(coreOut).toEqual(srcOut)
    }
  })

  it('deviationsFromVerdict 对同一判决产出相同内容偏差', () => {
    const verdicts = [
      { scores: { identity: 1, composition: 5, continuity: 2 }, reason: '身份对不上' },
      { scores: { identity: 5, composition: 5, continuity: 5 }, reason: '' },
      { scores: { identity: 2, composition: 2, continuity: 1 }, reason: '' },
    ]
    for (const ctx of FIXTURES) {
      for (const v of verdicts) {
        expect(coreDeviations(ctx, v)).toEqual(srcDeviations(ctx, v))
      }
    }
  })

  it('normalizeShotScore 逐档一致', () => {
    for (const s of [-3, 0, 1, 2, 3, 4, 5, 7, 2.4, 3.6]) {
      expect(coreNormalize(s)).toBe(srcNormalize(s))
    }
  })
})
