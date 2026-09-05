import { describe, expect, it } from 'vitest'

import * as projections from './productionRunProjections'
import * as service from './productionRunService'

/**
 * 投影层从 productionRunService.ts 抽出来后的公共面护栏。
 *
 * 这次抽取是纯结构搬迁：外部调用方（productionRunArtifactOperations.ts、
 * src/desktop/productionRunBridgeTypes.ts）仍从 productionRunService import 投影类型，
 * 靠的是 service 里那条 `export type ... from './productionRunProjections'`。那条再导出
 * 一旦被顺手删掉，TypeScript 只会在调用方报错、不会在这里报错——所以用运行期能查的
 * 「函数身份是同一个」把接缝钉住：抽出去的实现只能有一份，service 不许再长出第二份。
 */
describe('production run projection seam', () => {
  it('exports the projection functions the service delegates to', () => {
    expect(typeof projections.safeRunProjection).toBe('function')
    expect(typeof projections.runProjection).toBe('function')
    expect(typeof projections.eventProjection).toBe('function')
  })

  it('keeps the service as the public import path without cloning the implementation', () => {
    // service 是公共门面：它必须仍然导出服务入口，且**不能**自己再导出一份同名投影实现
    // （那就是 P1 说的并行版）。投影实现只住 productionRunProjections。
    expect(typeof service.createProductionRunService).toBe('function')
    for (const name of ['safeRunProjection', 'runProjection', 'eventProjection'] as const) {
      const reExported = (service as Record<string, unknown>)[name]
      if (reExported !== undefined) expect(reExported).toBe(projections[name])
    }
  })
})
