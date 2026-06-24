// 能力核 · 工程网关（A/B 模式的统一抽象，单一逻辑 P1）。
//
// core.ts 的画布/生成函数不再各自 readProject/saveProject，而是经一个 ProjectGateway 读/写画布、
// 取付费授权。两种实现：
// - 磁盘网关（B 模式，app 关着）：直读写 project.json（headless host 是唯一写者，安全）。
// - 渲染层网关（A 模式，app 开着且该项目正打开）：把读/写转发给运行中的渲染层 store，所见即所得；
//   付费确认弹实时卡，真人点了才铸令牌。
//
// 这样「外部 agent 驱动生成」无论 app 开没开都走同一套 core 逻辑，只换网关——不存在并行版。
import { readProject, saveProject } from '../projects/repository'
import { mintSpendGrant } from '../spendGrant'
import { normalizeSnapshot, type CanvasSnapshot } from './canvasGraph'
import { requestRenderer } from './rendererBridge'

/** 弹付费确认卡需要的上下文（让用户一眼看懂谁要花钱、花在哪、花多少）。 */
export type SpendConfirmInfo = {
  projectId: string
  /** 目标项目名——确认卡显示「AI 想在项目 X 生成」，让用户在非当前项目时也知道花在哪。 */
  projectName?: string
  nodeId: string
  intent: string
  vendor: string
  modelKey: string
  prompt: string
}

export interface ProjectGateway {
  /** 读当前画布文档快照（A 模式读运行中 store，B 模式读盘）。 */
  readDoc(): Promise<CanvasSnapshot>
  /** 写回画布快照（A 模式应用进 store→实时刷新，B 模式落盘）。 */
  apply(snapshot: CanvasSnapshot): Promise<void>
  /** 取付费授权：返回 grantId（已确认）或 null（未确认/超时/无 UI）。enforcement 仍在 runTask 硬闸。 */
  confirmSpend(info: SpendConfirmInfo): Promise<string | null>
}

function readDiskSnapshot(projectId: string): CanvasSnapshot {
  const record = readProject(projectId)
  if (!record) throw new Error(`项目不存在: ${projectId}`)
  const payload = record.payload && typeof record.payload === 'object' ? (record.payload as Record<string, unknown>) : {}
  return normalizeSnapshot(payload.generationCanvas)
}

function writeDiskSnapshot(projectId: string, snapshot: CanvasSnapshot): void {
  const record = readProject(projectId)
  if (!record) throw new Error(`项目不存在: ${projectId}`)
  const payload = record.payload && typeof record.payload === 'object' ? { ...(record.payload as Record<string, unknown>) } : {}
  payload.generationCanvas = snapshot
  saveProject(projectId, { ...record, payload })
}

/**
 * 磁盘网关（B 模式：app 关着，headless host 内）。本进程无窗口可弹应用内确认卡，
 * 故付费授权认 env NOMI_LOOP_SPEND_OK：它=「本次 host 调用已被显式授权」，两个合法来源——
 * ① 评测/CLI 脚本显式设（nomiClient.mjs spawn host 时按本次调用注入）；进程内 MCP server 走的是
 *    makeConfirmedGateway（elicitation 真人确认后直铸令牌，mcpStdioServer.ts），不碰本 env。
 * 两者都是「真人/脚本显式授权」,模型自己设不了 env → 红队信任边界不破。无授权 → null → runTask 硬闸拦。
 */
export function createDiskGateway(projectId: string): ProjectGateway {
  return {
    async readDoc() {
      return readDiskSnapshot(projectId)
    },
    async apply(snapshot) {
      writeDiskSnapshot(projectId, snapshot)
    },
    async confirmSpend(info) {
      return process.env.NOMI_LOOP_SPEND_OK === '1' ? mintSpendGrant({ nodeIds: [info.nodeId] }) : null
    },
  }
}

// 画布读写转发超时：界面 store 操作是本地同步的，15s 足够兜「渲染层卡住」。
const RENDERER_APPLY_TIMEOUT_MS = 15_000
// 付费确认等待：卡片自身 60s 倒计时，主进程这道兜底略长（65s），防渲染层异常永不应答（不死等）。
const RENDERER_SPEND_TIMEOUT_MS = 65_000

/**
 * 混合网关：窗口活着、但目标项目**没在前台**时用。
 * 读写走盘（绝不动非活动项目的运行中 store，免串台），但**付费确认走渲染层弹全局卡**
 * （用户拍板 A：全局确认、不打断）——治「外部 MCP 生成到非当前项目 → 静默黑洞」根因。
 * 安全不变量不破：令牌仍只在真人点确认卡后由主进程铸（复用 createRendererGateway.confirmSpend）。
 */
export function createHybridGateway(projectId: string): ProjectGateway {
  const disk = createDiskGateway(projectId)
  const renderer = createRendererGateway(projectId)
  return {
    readDoc: disk.readDoc,
    apply: disk.apply,
    confirmSpend: renderer.confirmSpend,
  }
}

/** 渲染层网关（A 模式）。读/写转发进运行中 store；付费确认弹实时卡，真人点了才在主进程铸令牌。 */
export function createRendererGateway(projectId: string): ProjectGateway {
  return {
    async readDoc() {
      return normalizeSnapshot(await requestRenderer('canvas.read-doc', { projectId }, RENDERER_APPLY_TIMEOUT_MS))
    },
    async apply(snapshot) {
      await requestRenderer('canvas.apply', { projectId, snapshot }, RENDERER_APPLY_TIMEOUT_MS)
    },
    async confirmSpend(info) {
      try {
        const reply = (await requestRenderer('spend.confirm', info, RENDERER_SPEND_TIMEOUT_MS)) as { confirmed?: boolean } | null
        // 真人点确认才到这里；铸令牌发生在主进程、消费仍在 runTask 硬闸（信任边界不破）。
        return reply?.confirmed ? mintSpendGrant({ nodeIds: [info.nodeId] }) : null
      } catch {
        // 超时/渲染层不可用 → 当作未确认（不死等，把干净错误透传给 agent）。
        return null
      }
    },
  }
}
