import { beforeEach, describe, expect, it, vi } from 'vitest'

// production.plan-directions（B1 方向门候选）接线测试。
// driver 侧 proposeDirections 会调 requestRenderer('production.plan-directions', …) 让渲染层拟
// 2-3 个方向候选（形状 { candidates: [{ key, title, oneLiner }] }，见 productionRunDriverOps.ts）。
// 这条 case 一度**没接**——renderer 的 switch 没有它 → 真机走 default 抛 unknownOperation，
// driver catch 后只能用 gate 的 title/summary 兜底，用户看不到真正的三选一候选。
//
// 这里在 handleCapabilityApply 这一层锁：① 有 case（不再落 default）② 走真实 LLM 通道
// （桩掉 runDirectionPlanner，只验接线：入参透传 + 返回 { candidates } 透传）③ LLM 失败诚实抛错
// （不静默编候选，让 driver 走既有兜底）。

const runDirectionPlanner = vi.fn()

vi.mock('../generationCanvas/agent/runDirectionPlanner', () => ({
  runDirectionPlanner: (...args: unknown[]) => runDirectionPlanner(...args),
}))

// 当前打开的项目 = 请求项目（否则 handler 会以「项目已切换」拒绝，与本测试无关）。
vi.mock('../project/workbenchProjectSession', () => ({
  getActiveWorkbenchProjectId: () => 'proj-1',
}))

import { handleCapabilityApply } from './capabilityApplyHandler'

const BRIEF = { goal: '给独立创作者的本地优先 AI 视频工作台宣传片', tone: '真诚' }
const BASE_PAYLOAD = { projectId: 'proj-1', runId: 'run-1', brief: BRIEF, playbook: { key: 'brand.promo' } }

describe('production.plan-directions 接线', () => {
  beforeEach(() => {
    runDirectionPlanner.mockReset()
  })

  it('把 brief/playbook 透传给 direction planner，并原样返回 { candidates }', async () => {
    const candidates = [
      { key: 'documentary', title: '纪录片式温度', oneLiner: '真实的创作者、真实的桌面，一条诚实的本地优先工作流。' },
      { key: 'kinetic', title: '动感产品剪辑', oneLiner: '跟着节拍快切画布与时间轴的运动镜头。' },
    ]
    runDirectionPlanner.mockResolvedValue({ candidates })

    const result = await handleCapabilityApply('production.plan-directions', BASE_PAYLOAD)

    expect(runDirectionPlanner).toHaveBeenCalledTimes(1)
    const arg = runDirectionPlanner.mock.calls[0][0] as Record<string, unknown>
    expect(arg.brief).toEqual(BRIEF)
    expect(arg.playbook).toEqual({ key: 'brand.promo' })
    expect(result).toEqual({ candidates })
  })

  it('LLM 不可用/失败时冒泡抛错（不静默编造候选，让 driver 走既有兜底）', async () => {
    runDirectionPlanner.mockRejectedValue(new Error('text model unavailable'))

    await expect(handleCapabilityApply('production.plan-directions', BASE_PAYLOAD)).rejects.toThrow(
      'text model unavailable',
    )
  })
})
