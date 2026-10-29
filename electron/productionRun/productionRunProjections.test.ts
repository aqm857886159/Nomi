import { describe, expect, it } from 'vitest'

import * as projections from './productionRunProjections'
import { knownRunBudget, safeRunProjection } from './productionRunProjections'
import * as service from './productionRunService'
import type { ProductionGate, ProductionRun } from './productionRunTypes'

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

// Agent 不把「不知道」说成 0（2026-10-27）：账本合计只加已知价，算不出价的笔记在另一根轴上（信封 unknownJobCount、
// 在途 unknownInFlight），实付从不回写。对外投影只给知道的数——以前原样外发合计，Agent 转述「预算上限 0 · 已花费 0」。
describe('knownRunBudget：对外只给知道的数', () => {
  const ledger = (patch: Partial<ProductionRun['budget']> = {}): ProductionRun['budget'] => ({
    currency: 'CNY', authorized: 0, reserved: 0, actual: 0, unsettled: 0, unknownInFlight: 0, ...patch,
  })
  /** unknownJobCount 缺省 = 开闸前封存的旧信封（没有这个字段）；null = 没有信封的门。 */
  const gate = (status: ProductionGate['status'], unknownJobCount?: number | null): ProductionGate => ({
    gateId: `gate-${status}`, scope: 'budget_envelope', status, jobIds: [],
    ...(unknownJobCount === null ? {} : {
      authorizationEnvelope: { budget: { currency: 'CNY', maximum: 0, ledgerCeiling: 0, ...(unknownJobCount === undefined ? {} : { unknownJobCount }) } },
    }),
  }) as unknown as ProductionGate
  const cases: Array<{ name: string; budget: ProductionRun['budget']; gates: ProductionGate[]; expected: { authorized: number | null; actual: number | null } }> = [
    { name: '草稿：什么都还没批（真 0）', budget: ledger(), gates: [], expected: { authorized: 0, actual: 0 } },
    { name: '全知价、门已批、还有预留中的笔', budget: ledger({ authorized: 12, reserved: 8 }), gates: [gate('approved', 0)], expected: { authorized: 12, actual: null } },
    { name: '全知价、所有笔都释放了', budget: ledger({ authorized: 12 }), gates: [gate('approved', 0)], expected: { authorized: 12, actual: 0 } },
    { name: '批过的信封全是算不出价的镜头，账面上限是 0', budget: ledger(), gates: [gate('approved', 2)], expected: { authorized: null, actual: 0 } },
    { name: '批过的信封里已知价与算不出价混着', budget: ledger({ authorized: 12 }), gates: [gate('approved', 0), gate('approved', 1)], expected: { authorized: null, actual: 0 } },
    { name: '未知价的笔在途', budget: ledger({ authorized: 12, unknownInFlight: 1 }), gates: [gate('approved', 1)], expected: { authorized: null, actual: null } },
    { name: '没有信封的门、未知价的笔在途', budget: ledger({ authorized: 5, unknownInFlight: 1 }), gates: [gate('approved', null)], expected: { authorized: null, actual: null } },
    { name: '有结果不明的笔', budget: ledger({ authorized: 12, unsettled: 4 }), gates: [gate('approved', 0)], expected: { authorized: 12, actual: null } },
    { name: '等待中 / 驳回的门里的未知价镜头不算批过', budget: ledger({ authorized: 12 }), gates: [gate('approved', 0), gate('waiting', 3), gate('rejected', 1)], expected: { authorized: 12, actual: 0 } },
    { name: '旧信封没有 unknownJobCount（当时未知价发不出信封）', budget: ledger({ authorized: 12 }), gates: [gate('approved')], expected: { authorized: 12, actual: 0 } },
    { name: '全部落定且记了实付', budget: ledger({ authorized: 12, actual: 7 }), gates: [gate('approved', 0)], expected: { authorized: 12, actual: 7 } },
  ]
  for (const { name, budget, gates, expected } of cases) {
    it(name, () => {
      expect(knownRunBudget({ budget, gates })).toEqual({ currency: 'CNY', ...expected })
    })
  }

  it('投影的 budget 只有 currency / authorized / actual：预留、未结算、在途笔数不外发', () => {
    const run = {
      schemaVersion: 1, runId: 'run-budget', projectId: 'p1', revision: 1, status: 'running', stageId: 'generate',
      playbook: { name: 'generation.single-shot', version: '1' }, origin: { host: 'semantic-mcp' },
      budget: ledger({ authorized: 12, reserved: 8, unsettled: 1, unknownInFlight: 2 }),
      policy: {}, planVersion: 1, snapshotCursor: 1, stages: [], gates: [], jobs: [], artifacts: [],
      createdAt: '2026-10-27T00:00:00.000Z', updatedAt: '2026-10-27T00:00:00.000Z',
    } as unknown as ProductionRun
    expect(safeRunProjection(run).budget).toEqual({ currency: 'CNY', authorized: null, actual: null })
  })
})
