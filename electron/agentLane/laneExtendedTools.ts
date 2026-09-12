import { laneGenerationContextText } from './laneGenerationContext'
import type { RuntimeToolCall, RuntimeToolDecision } from '../shared/agentCapabilities/transportContracts'
import type { LaneToolNextAction } from '../shared/agentLane/laneToolContract'
import { LANE_DEFERRED_TOOL_CATALOG } from './laneToolCatalog'
import { bindLaneTool, LaneDomainFailure, type LaneToolDescriptor } from './laneRuntimePort'

export interface LaneExtendedPort {
  execute(call: RuntimeToolCall, signal: AbortSignal): Promise<RuntimeToolDecision>
}

/**
 * 写动词成功时用户接下来看到什么（设计正本 §6.2）。这一句与面板投影同源：`generate` 之外的动词说的是
 * 「已生效、可撤」，`generate` 走失败通道（下面 `spendCardResult`），因为它要模型**停下来**。
 */
function nextActionFor(verb: string, result: unknown): LaneToolNextAction | undefined {
  const record = result && typeof result === 'object' ? result as Record<string, unknown> : {}
  const operation = record.operation && typeof record.operation === 'object' ? record.operation as Record<string, unknown> : undefined
  const draftId = typeof operation?.operationId === 'string' ? operation.operationId : typeof record.operationId === 'string' ? record.operationId : undefined
  switch (verb) {
    case 'draft_shots':
      return { kind: 'none', userSees: 'Draft shots are on the canvas with their model and price badge. Nothing has been generated and nothing has been spent; call generate when the user wants them made.', ...(draftId ? { jobId: draftId } : {}) }
    case 'edit_timeline':
      return { kind: 'user_sees_review_card', userSees: 'The timeline highlights the planned edit and a review card asks the user to apply it (in full-auto mode it is already applied).', ...(typeof record.undoToken === 'string' ? { changeId: record.undoToken } : {}) }
    case 'undo':
      return { kind: 'none', userSees: 'The timeline is back to before that change.' }
    case 'delete_from_canvas':
      return { kind: 'user_sees_confirm_card', userSees: 'The nodes are gone from the canvas after the user confirmed.' }
    case 'export_video':
      return { kind: 'job_running', userSees: 'The export is running; progress shows in the task list.', ...(typeof record.jobId === 'string' ? { jobId: record.jobId } : {}) }
    case 'cancel_job':
      return { kind: 'user_sees_confirm_card', userSees: 'The job was cancelled after the user confirmed; credit already spent is not refunded.' }
    case 'save_skill':
      return { kind: 'none', userSees: 'The skill is in the user\'s library and can be deleted there.' }
    default:
      return undefined
  }
}

/**
 * `generate` 的返回值抄 GitHub MCP `issue_write` 弹表单时的形状：**isError + 明文停下**。模型读到的是一条
 * 错误结果，所以它不会把「卡已经出了」说成「已经生成了」，也不会接着调下一个工具。
 */
function spendCardResult(result: unknown): never {
  const record = result && typeof result === 'object' ? result as Record<string, unknown> : {}
  const shots = Array.isArray(record.shots) ? record.shots.length : undefined
  throw new LaneDomainFailure({
    code: 'user_sees_spend_card',
    message: `The user now sees a priced confirmation card in Nomi${shots ? ` for ${shots} shot(s)` : ''}. Generation has NOT started and nothing has been spent; only the user can approve the card.`,
    nextAction: 'STOP. Do not call any other tools and do not claim generation has started or completed. Tell the user what the card shows and wait for their decision.',
  })
}

export function createExtendedLaneTools(port: LaneExtendedPort): LaneToolDescriptor[] {
  // Visibility groups do not transfer execution ownership: timeline reads keep their typed port
  // (`laneTimelineTools.ts`); `list_models` is native-assembled (`laneNativeAssembly.mts`).
  return LANE_DEFERRED_TOOL_CATALOG
    .filter(spec => spec.contractId !== 'timeline.read')
    .map(spec => bindLaneTool(spec, async (args, context) => {
      const decision = await port.execute({ toolCallId: context.toolCallId, toolName: spec.name, args }, context.signal)
      if (!decision.ok) throw new LaneDomainFailure({ code: decision.code ?? 'capability_execution_failed',
        message: `${spec.name} could not complete the requested action (${decision.code ?? 'capability_execution_failed'}).`,
        nextAction: 'Read the current project state and review the current identifiers, revision and approval before requesting a new action. Do not repeat an unknown paid submission.',
      })
      if (spec.name === 'generate') spendCardResult(decision.result)
      const text = spec.name === 'list_models' ? laneGenerationContextText(decision.result, args) : JSON.stringify(decision.result ?? null)
      const nextAction = nextActionFor(spec.name, decision.result)
      return { ok: true, text, details: decision.result, ...(nextAction ? { nextAction } : {}) }
    }))
}
