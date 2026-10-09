import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { classifyGenerationError } from './classifyError'
import { localProcessingError } from './localProcessingError'
import { narrateGenerationErrorActions, narrateIsVendorSideFailure } from './narrate'

describe('本机处理失败 = 一类（失败卡只留「重试」）', () => {
  it('带码的失败：分到 local-processing，动作只有重试，不点名服务商，不印「服务商原话」', () => {
    const report = classifyGenerationError(localProcessingError('截帧失败：ffmpeg 抽帧失败（code 1）'))
    expect(report.kind).toBe('local-processing')
    expect([report.primary, report.secondary]).toEqual(['retry', null])
    expect(report.vendorSide).toBe(false)
    expect(report.providerMessage).toBeUndefined()
    expect(report.raw).toContain('ffmpeg')
    expect(report.raw).not.toContain('NOMI_ERR')
  })

  it('对照：没带码的认不出失败仍然是「重试 + 换个模型」（探针活着——这条判据真的在区分）', () => {
    const report = classifyGenerationError('something odd happened')
    expect(report.kind).toBe('unknown')
    expect(report.secondary).toBe('switch-model')
  })

  it('动作表与「是不是服务商那一侧」表都有这一类的答案', () => {
    expect(narrateGenerationErrorActions('local-processing')).toEqual({ primary: 'retry', secondary: null })
    expect(narrateIsVendorSideFailure('local-processing')).toBe(false)
  })

  // 现有的本机处理入口：失败文案必须过 localProcessingError，否则会掉回「认不出」那一类、长出「换个模型」。
  // 新增入口时把它加进来；漏掉的话，这里不会替你发现——这是一张登记表，不是扫描（扫描要先定义「什么叫本机处理」）。
  it.each([
    'src/workbench/generationCanvas/nodes/extractVideoFrameToNode.ts',
    'src/workbench/generationCanvas/videoDepth/startVideoDepthDerivation.ts',
    'src/workbench/generationCanvas/adapters/assetImportAdapter.ts',
  ])('%s 的失败走 localProcessingError', (file) => {
    expect(fs.readFileSync(path.resolve(process.cwd(), file), 'utf8')).toContain('localProcessingError(')
  })
})
