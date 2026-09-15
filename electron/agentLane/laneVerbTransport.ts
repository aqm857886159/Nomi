// Agent lane · 延迟组动词 → 传输层方法调用的**唯一对应表**。
//
// 传输适配器（`capabilityCore/*TransportAdapters.ts`）按契约的 `method` 词表认路（`GENERATION_METHODS.plan` /
// `export_timeline` / `delete_canvas_nodes` …），那是宿主的方法名，模型永远看不见。模型看见的是 20 个动词
// （`verbs/`）。这里把「动词 + 参数」翻成「方法 + 参数」；反向不存在——没有任何一条路把方法名再暴露给模型。
//
// 方法名**不在这里手写**：生成域的取自 `GENERATION_METHODS`（字面量类型 `GenerationMethodName`，改名少一边
// 就是 tsc 红），其余取自各契约导出的别名表。`laneVerbTransport.test.ts` 再真跑一遍：每个动词翻出的方法
// 必须被目标 lane 的适配器认——那正是 #777 上整组生成动词恒 `generation_surface_unavailable` 的那条裂缝。
import type { RuntimeToolCall } from '../shared/agentCapabilities/transportContracts'
import { GENERATION_METHODS, type GenerationMethodName } from '../shared/agentCapabilities/generation'
import { TIMELINE_WRITE_ALIASES } from '../shared/agentCapabilities/timelineWrite'
import { EXPORT_READ_ALIASES, EXPORT_WRITE_ALIASES } from '../shared/agentCapabilities/exportCapabilities'
import { CANVAS_DELETE_ALIAS } from '../shared/agentCapabilities/canvasDelete'
import { SKILL_READ_ALIASES } from '../shared/agentCapabilities/skillRead'
import { SKILL_WRITE_ALIASES } from '../shared/agentCapabilities/skillWrite'
import { assetReadInputOf } from '../shared/agentCapabilities/verbs/verbSemanticInput'

type Args = Record<string, unknown>

/** 一次翻译的结果：走哪条传输、方法名与方法参数。生成 lane 的方法名按字面量类型收窄。 */
export type VerbTransportCall =
  | Readonly<{ lane: 'generation'; call: RuntimeToolCall & { toolName: GenerationMethodName } }>
  | Readonly<{ lane: 'timeline' | 'canvas' | 'export' | 'media' | 'skillRead' | 'skillWrite' | 'modelSetup'; call: RuntimeToolCall }>

/** 生成 lane 的一次调用：`toolName` 只能是 `GENERATION_METHODS` 里的名字。 */
function generationCall(base: { toolCallId: string }, toolName: GenerationMethodName, args: Args): VerbTransportCall {
  return { lane: 'generation', call: { ...base, toolName, args } }
}

/** `draft_shots` 的一镜 → 生成契约 `shots[]` 的一镜（语义字段；候选身份由宿主按目录合成）。 */
function draftShotToPlanShot(shot: Args): Args {
  const { shotId, role, prompt, taskKind, durationSec, modelKey, modeId, parameters, references, title } = shot as {
    shotId?: string; role?: string; prompt: string; taskKind?: string; durationSec?: number; modelKey?: string; modeId?: string;
    parameters?: Args; references?: string[]; title?: string
  }
  return {
    ...(shotId ? { shotId } : {}), ...(role ? { role } : {}), prompt,
    ...(title ? { title } : {}),
    ...(taskKind ? { taskKind } : {}), ...(durationSec !== undefined ? { durationSeconds: durationSec } : {}),
    ...(modelKey ? { modelId: modelKey } : {}), ...(modeId ? { modeId } : {}),
    ...(parameters ? { parameters } : {}),
    ...(references ? { references: references.map((assetId) => ({ assetId })) } : {}),
  }
}

/**
 * 把一个延迟组动词调用翻成传输层调用。返回 `undefined` = 这个动词不走延迟组（常驻工具自己绑执行）。
 * 参数在这里**只改形状不改语义**：schema 已由 pi 的 ajv 验过。
 */
export function verbToTransportCall(call: RuntimeToolCall): VerbTransportCall | undefined {
  const args = (call.args && typeof call.args === 'object' ? call.args : {}) as Args
  const base = { toolCallId: call.toolCallId }
  switch (call.toolName) {
    case 'draft_shots': {
      const shots = (Array.isArray(args.shots) ? args.shots : []) as Args[]
      const draftId = typeof args.draftId === 'string' ? args.draftId : undefined
      if (draftId) {
        // 修改已有草稿：单镜草稿按顶层候选 patch（多镜按 shotId 的 patch 不在本刀，返回值会说清）。
        const first = shots[0] ?? {}
        const { shotId: _shotId, role: _role, title: _title, ...rest } = draftShotToPlanShot(first)
        return generationCall(base, GENERATION_METHODS.plan, { operation: 'patch', operationId: draftId, patch: rest })
      }
      // 草稿建即落画布、带单价角标，但报价卡先藏着（`cardHidden`）——出卡是 `generate` 的事，不是建草稿的副作用。
      if (shots.length === 1 && !shots[0]?.role) {
        // 单镜：走单镜 create（宿主从 prompt/taskKind 合成候选），与「一句话生成一张图」同一条路。
        const { shotId: _shotId, title: _title, ...single } = draftShotToPlanShot(shots[0]!)
        return generationCall(base, GENERATION_METHODS.plan, { operation: 'create', ...single, cardHidden: true })
      }
      return generationCall(base, GENERATION_METHODS.plan, { operation: 'create', shots: shots.map(draftShotToPlanShot), cardHidden: true })
    }
    case 'generate':
      return generationCall(base, GENERATION_METHODS.plan, { operation: 'present', operationId: args.draftId, ...(args.shotIds ? { shotIds: args.shotIds } : {}) })
    case 'check_job':
      return generationCall(base, GENERATION_METHODS.status, { operation: 'read', operationId: args.jobId })
    case 'cancel_job':
      return generationCall(base, GENERATION_METHODS.status, { operation: 'cancel', operationId: args.jobId })
    case 'look_at_media': {
      // 五合一读 → 契约五个方法之一（`assetReadInputOf`，与对外 MCP 同一张表）；方法名就是 phase4 读适配器认的别名。
      const { operation, ...methodArgs } = assetReadInputOf(args) as { operation: string } & Args
      return { lane: 'media', call: { ...base, toolName: operation, args: methodArgs } }
    }
    case 'edit_timeline': {
      const { revision, ...plan } = args as { revision: string } & Args
      return { lane: 'timeline', call: { ...base, toolName: TIMELINE_WRITE_ALIASES.applyPlan, args: { planId: `plan-${call.toolCallId}`, baseRevision: revision, ...plan } } }
    }
    case 'undo':
      return { lane: 'timeline', call: { ...base, toolName: TIMELINE_WRITE_ALIASES.undo, args: { undoToken: args.changeId, expectedRevision: args.expectedRevision } } }
    case 'delete_from_canvas':
      return { lane: 'canvas', call: { ...base, toolName: CANVAS_DELETE_ALIAS, args } }
    case 'export_video':
      return { lane: 'export', call: { ...base, toolName: EXPORT_WRITE_ALIASES.start, args } }
    case 'read_skill':
      return { lane: 'skillRead', call: { ...base, toolName: SKILL_READ_ALIASES.load, args: { name: args.name } } }
    case 'save_skill':
      return { lane: 'skillWrite', call: { ...base, toolName: SKILL_WRITE_ALIASES.author, args } }
    case 'start_model_setup':
      return { lane: 'modelSetup', call: { ...base, toolName: 'nomi_open_model_setup', args } }
    default:
      return undefined
  }
}

/** `check_job` / `cancel_job` 的导出那一半：生成域说「不认识这个 id」时再问导出域。 */
export function exportJobTransportCall(call: RuntimeToolCall): RuntimeToolCall {
  const args = (call.args && typeof call.args === 'object' ? call.args : {}) as Args
  return {
    toolCallId: call.toolCallId,
    toolName: call.toolName === 'cancel_job' ? EXPORT_WRITE_ALIASES.cancel : EXPORT_READ_ALIASES.inspect,
    args: { jobId: args.jobId },
  }
}
