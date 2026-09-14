import { laneGenerationContextText } from './laneGenerationContext'
import type { RuntimeToolCall, RuntimeToolDecision } from '../shared/agentCapabilities/transportContracts'
import { LANE_DEFERRED_TOOL_CATALOG } from './laneToolCatalog'
import { bindLaneTool, LaneDomainFailure, type LaneToolDescriptor } from './laneRuntimePort'

export interface LaneExtendedPort {
  execute(call: RuntimeToolCall, signal: AbortSignal): Promise<RuntimeToolDecision>
}

export function createExtendedLaneTools(port: LaneExtendedPort): LaneToolDescriptor[] {
  // Visibility groups do not transfer execution ownership: timeline reads keep their typed port
  // (`laneTimelineTools.ts`); the model catalog read (`nomi_read`) is not in this catalog at all —
  // its group is native-assembled (`laneNativeAssembly.mts`).
  return LANE_DEFERRED_TOOL_CATALOG
    .filter(spec => !(spec.contractId === 'timeline.read' && spec.effect === 'read' && spec.name !== 'propose_edit_plan'))
    .map(spec => bindLaneTool(spec, async (args, context) => {
    const decision = await port.execute({ toolCallId: context.toolCallId, toolName: spec.name, args }, context.signal)
    // 域端口给了一句比 code 更具体的话（比如常驻生成面此刻的相：按配置关掉 / 还在起 / 装配抛了）
    // 就带给模型；只有 code 的照旧。否则 owner 说得再清楚，模型看到的仍是一句零信息的「不可用」。
    if (!decision.ok) throw new LaneDomainFailure({ code: decision.code ?? 'capability_execution_failed',
      message: `${spec.name} could not complete the requested action (${decision.code ?? 'capability_execution_failed'}).`
        + (decision.message && decision.message !== decision.code ? ` ${decision.message}` : ''),
      nextAction: 'Read the current project state and review the current identifiers, revision and approval before requesting a new action. Do not repeat an unknown paid submission.',
    })
    const operation = args && typeof args === 'object' && 'operation' in args ? args.operation : undefined
    const text = spec.name === 'nomi_generation_plan' && operation === 'context'
      ? laneGenerationContextText(decision.result, args) : JSON.stringify(decision.result ?? null)
    return { ok: true, text, details: decision.result }
  }))
}
