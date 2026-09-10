import {
  HumanApprovalRequiredError,
  ReceiptExpiredError,
  ReceiptScopeError,
  type ApprovalReceiptAuthority,
  type HumanApprovalReceiptV1,
} from '../capabilityCore/approvalReceipt'
import { isSpendGate } from './productionRunGateIdentity'
import type { ProductionRun, RunCommand } from './productionRunTypes'

export type ProjectRevisionResolver = (projectId: string) => number | undefined

export type GateApprovalReceipt = { token: string; receipt: HumanApprovalReceiptV1 }

/** A receipt is only usable while the project document it describes is current. */
export function assertCurrentProjectRevision(
  projectId: string,
  expectedProjectRevision: unknown,
  projectRevisionResolver: ProjectRevisionResolver | undefined,
): number {
  const currentProjectRevision = projectRevisionResolver?.(projectId)
  if (typeof currentProjectRevision !== 'number' || !Number.isSafeInteger(currentProjectRevision)
    || !Number.isSafeInteger(expectedProjectRevision)
    || currentProjectRevision !== expectedProjectRevision) {
    throw new ReceiptScopeError('Approval receipt project revision does not match the current project')
  }
  return currentProjectRevision
}

function suppliedReceiptHandles(command: RunCommand): { receiptId: string; suppliedToken: string } {
  return {
    receiptId: typeof command.payload.receiptId === 'string' ? command.payload.receiptId.trim() : '',
    suppliedToken: typeof command.payload.receiptToken === 'string' ? command.payload.receiptToken.trim() : '',
  }
}

function verifySuppliedReceipt(
  authority: ApprovalReceiptAuthority,
  projectId: string,
  runId: string,
  command: RunCommand,
  projectRevisionResolver: ProjectRevisionResolver | undefined,
): GateApprovalReceipt {
  const { receiptId, suppliedToken } = suppliedReceiptHandles(command)
  try {
    const token = suppliedToken || authority.resolveReceiptToken(receiptId)
    const receipt = authority.verifyReceipt(token)
    const projectRevision = assertCurrentProjectRevision(projectId, command.payload.projectRevision ?? receipt.projectRevision, projectRevisionResolver)
    const expected: Array<[keyof HumanApprovalReceiptV1, unknown]> = [
      ['projectId', projectId],
      ['runId', runId],
      ['gateId', command.payload.gateId],
      ['contractHash', command.payload.contractHash],
      ['targetHash', command.payload.targetHash],
      ['projectRevision', projectRevision],
    ]
    for (const [key, value] of expected) {
      if (value !== undefined && value !== null && String(receipt[key]) !== String(value)) {
        throw new ReceiptScopeError('Approval receipt ' + String(key) + ' does not match the current run')
      }
    }
    if (receiptId && receipt.receiptId !== receiptId) throw new ReceiptScopeError('Approval receipt id is invalid')
    return { token, receipt }
  } catch (error) {
    if (error instanceof HumanApprovalRequiredError || error instanceof ReceiptScopeError || error instanceof ReceiptExpiredError) throw error
    throw new ReceiptScopeError(error instanceof Error ? error.message : 'Approval receipt is invalid')
  }
}

/**
 * Run 命令边界上的「人证」持有者。**每一个** `gate.decide`（渲染层 IPC、RPC dispatcher、MCP 传输适配器、
 * Agent 工具、driver 自动批准、批次 scheduler）都经 productionRunService.command → 这里，所以不变量归它管。
 *
 * 不变量：**付费门（isSpendGate）批准，必须随附一条主进程自己能背书的人证**，只有两种：
 *  ① 主进程收据权威验过的 receipt（远端/MCP 路径，见 capabilityCore/approvalReceipt.ts 的 HMAC+TTL+一次性）；
 *  ② `humanGesture` —— 由 productionRunIpc 在 `assertTrustedSender` 之后自己盖的章（Nomi 自己的窗口里
 *     真人点了确认卡）。这个字段**只在主进程内部装配**，不从渲染层 payload 抄，MCP 客户端够不着。
 * 免费门（创意门 / 定妆检查点 / 导出 / 发布）语义不变：不要求收据；带了收据仍照常验。
 *
 * 装配不变量：service 构造时若没拿到收据权威，持有的就是 fail-closed 的这份（`createGateApprovalOwner(undefined)`），
 * 而不是「undefined 于是跳过校验」。缺权威 ⇒ 途径①不可用 ⇒ 除了 Nomi 窗口里的真人手势，谁都批不动付费门。
 * 这是 2026-09-10 的根因：生产装配从没注入过权威，于是这条链上**任何**调用者的付费门决议都是直接放行。
 */
export type GateApprovalOwner = {
  /** 校验一次 gate.decide 的人证。返回待消费的收据（没有则 undefined）；不合格必抛。 */
  verifyGateDecision(projectId: string, runId: string, current: ProductionRun, command: RunCommand): GateApprovalReceipt | undefined
  /** 已决议门的重放 no-op：带了收据仍要验，避免用一张废收据换一句「已批准」。 */
  duplicateGateDecisionFor(projectId: string, runId: string, current: ProductionRun, command: RunCommand): { current: ProductionRun; gateReceipt?: GateApprovalReceipt } | undefined
  /** 事件落库后一次性消费收据。没有权威时是 no-op（那条路径上根本不可能有收据）。 */
  consume(receipt: GateApprovalReceipt | undefined): void
  /** 这套装配能不能验收据。付费门在没有权威时只剩主进程手势一条路。 */
  readonly hasReceiptAuthority: boolean
}

export function createGateApprovalOwner(
  authority: ApprovalReceiptAuthority | undefined,
  projectRevisionResolver?: ProjectRevisionResolver,
): GateApprovalOwner {
  function verifyGateDecision(projectId: string, runId: string, current: ProductionRun, command: RunCommand): GateApprovalReceipt | undefined {
    if (command.type !== 'gate.decide') return undefined
    const { receiptId, suppliedToken } = suppliedReceiptHandles(command)
    if (!receiptId && !suppliedToken) {
      // 没带收据。免费门与「否决」一向不需要人证（否决不花钱，且是安全方向）。
      if (command.payload.status !== 'approved') return undefined
      const gateId = typeof command.payload.gateId === 'string' ? command.payload.gateId.trim() : ''
      const gate = current.gates.find((item) => item.gateId === gateId)
      // 门不存在 → 交给 repository 响亮地拒（`Production gate not found`），这里不替它猜付费与否。
      if (!gate || !isSpendGate(gate)) return undefined
      if (command.humanGesture === true) return undefined
      throw new HumanApprovalRequiredError('This gate authorizes provider spend and needs a verified Nomi confirmation')
    }
    // 带了收据就必须验得动。没有权威 = 验不动 = 拒，绝不「验不了就放行」。
    if (!authority) throw new HumanApprovalRequiredError('The main-process approval receipt authority is not assembled for this production service')
    return verifySuppliedReceipt(authority, projectId, runId, command, projectRevisionResolver)
  }

  function duplicateGateDecisionFor(projectId: string, runId: string, current: ProductionRun, command: RunCommand) {
    const gateId = typeof command.payload.gateId === 'string' ? command.payload.gateId.trim() : ''
    const decidedGate = current.gates.find((item) => item.gateId === gateId)
    if (!decidedGate || decidedGate.status === 'waiting' || decidedGate.status !== command.payload.status) return undefined
    const { receiptId, suppliedToken } = suppliedReceiptHandles(command)
    if (!receiptId && !suppliedToken) return { current }
    if (!authority) throw new HumanApprovalRequiredError('The main-process approval receipt authority is not assembled for this production service')
    return { current, gateReceipt: verifySuppliedReceipt(authority, projectId, runId, command, projectRevisionResolver) }
  }

  return {
    verifyGateDecision,
    duplicateGateDecisionFor,
    consume(receipt) {
      if (receipt && authority) authority.consumeReceipt(receipt.token)
    },
    hasReceiptAuthority: Boolean(authority),
  }
}
