import {
  HumanApprovalRequiredError,
  ReceiptExpiredError,
  ReceiptScopeError,
  type ApprovalReceiptAuthority,
  type HumanApprovalReceiptV1,
} from '../capabilityCore/approvalReceipt'
import { isSpendGate } from './productionRunGateIdentity'
import { readTrustGrantBinding } from './productionRunTrustGrant'
import { normalizeTrustLevel, trustLevelOf, type ProductionRun, type RunCommand } from './productionRunTypes'
import { isTrustDowngrade } from './productionRunTrustAuthority'

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

/**
 * 一张收据必须与什么逐字相等。`gate.decide` 的期望来自命令 payload（用户在那道门上表的态），
 * 信任降档的期望来自已封存授权（见 productionRunTrustGrant.ts）；两者共用同一条校验，
 * 因为「收据算不算数」只该有一个答案。undefined/null 的项跳过（该字段这条路径上不绑）。
 */
type ReceiptExpectations = Partial<Record<keyof HumanApprovalReceiptV1, unknown>> & { projectRevision?: unknown }

/**
 * 收据上的项目版本要和**哪一个**版本相等：
 *  · `live`：项目此刻的版本（创意门、信任降档——批的就是「项目现在这个样子」）；
 *  · `sealed`：付费门自己那份信封封好时的版本（付费卡① 第 14 条，2026-10-01）。批的是信封里冻住的那几镜：合同哈希、
 *    线上报文哈希、幂等键逐字钉死了发出去的东西。确认卡开着的时候 Nomi 自己往画布上落了别的镜、用户改了下一镜，项目
 *    版本都会前进——以前这里拿活的版本比，于是用户点「生成这张」被拒成「项目有变动」，而卡上的东西一个字没变。
 */
type ReceiptRevisionRule = { kind: 'live' } | { kind: 'sealed'; projectRevision: number }

function verifySuppliedReceipt(
  authority: ApprovalReceiptAuthority,
  projectId: string,
  runId: string,
  command: RunCommand,
  expectations: ReceiptExpectations,
  projectRevisionResolver: ProjectRevisionResolver | undefined,
  revisionRule: ReceiptRevisionRule = { kind: 'live' },
): GateApprovalReceipt {
  const { receiptId, suppliedToken } = suppliedReceiptHandles(command)
  try {
    const token = suppliedToken || authority.resolveReceiptToken(receiptId)
    const receipt = authority.verifyReceipt(token)
    const projectRevision = revisionRule.kind === 'sealed'
      ? sealedProjectRevision(revisionRule.projectRevision, expectations.projectRevision)
      : assertCurrentProjectRevision(projectId, expectations.projectRevision ?? receipt.projectRevision, projectRevisionResolver)
    const expected: Array<[keyof HumanApprovalReceiptV1, unknown]> = [
      ['projectId', projectId],
      ['runId', runId],
      ...(Object.entries(expectations) as Array<[keyof HumanApprovalReceiptV1, unknown]>)
        .filter(([key]) => key !== 'projectRevision' && key !== 'projectId' && key !== 'runId'),
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

/** 付费门：命令里说的版本（若说了）必须就是信封封好时的那个；比的是事实，不读项目此刻的版本。 */
function sealedProjectRevision(sealed: number, claimed: unknown): number {
  if (claimed !== undefined && claimed !== null && String(claimed) !== String(sealed)) {
    throw new ReceiptScopeError('Approval receipt project revision does not match the sealed authorization')
  }
  return sealed
}

/** 这道门的收据比哪一个项目版本：付费门比它自己那份信封（第 14 条），其余比项目此刻的版本。 */
function revisionRuleFor(current: ProductionRun, gateId: unknown): ReceiptRevisionRule {
  const gate = typeof gateId === 'string' ? current.gates.find((item) => item.gateId === gateId.trim()) : undefined
  const sealed = gate && isSpendGate(gate) ? gate.authorizationEnvelope?.projectRevision : undefined
  return typeof sealed === 'number' && Number.isSafeInteger(sealed) ? { kind: 'sealed', projectRevision: sealed } : { kind: 'live' }
}

/** `gate.decide` 的期望绑定：用户在**这道门、这份合同、这个项目版本**上表的态。 */
function gateExpectations(command: RunCommand): ReceiptExpectations {
  return {
    gateId: command.payload.gateId,
    contractHash: command.payload.contractHash,
    targetHash: command.payload.targetHash,
    projectRevision: command.payload.projectRevision,
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
 * 2026-09-10 21:00 用户拍板补一条：**「以后 ¥X 内别再逐镜问」（降到 budget_only）也是一次付费放行**，
 * 走 `verifyTrustGrant`，同样只认这两种凭证。确认弹在**调用方客户端**（elicitation）还是 Nomi 窗口里
 * 不影响判据——Nomi 只坚持「每笔付费放行都对应一次真人答过的确认」，不坚持「必须回 Nomi 点」。
 *
 * 装配不变量：service 构造时若没拿到收据权威，持有的就是 fail-closed 的这份（`createGateApprovalOwner(undefined)`），
 * 而不是「undefined 于是跳过校验」。缺权威 ⇒ 途径①不可用 ⇒ 除了 Nomi 窗口里的真人手势，谁都批不动付费门。
 * 这是 2026-09-10 的根因：生产装配从没注入过权威，于是这条链上**任何**调用者的付费门决议都是直接放行。
 */
export type GateApprovalOwner = {
  /** 校验一次 gate.decide 的人证。返回待消费的收据（没有则 undefined）；不合格必抛。 */
  verifyGateDecision(projectId: string, runId: string, current: ProductionRun, command: RunCommand): GateApprovalReceipt | undefined
  /**
   * 校验一次「降到 budget_only」的人证（= 以后 ¥X 内不再逐镜问）。同样两种凭证：主进程手势章，
   * 或一张绑死「预算上限 + runId」的 elicitation 收据。返回待消费的收据（手势路径 undefined）；不合格必抛。
   */
  verifyTrustGrant(projectId: string, runId: string, current: ProductionRun, command: RunCommand): GateApprovalReceipt | undefined
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
    return verifySuppliedReceipt(authority, projectId, runId, command, gateExpectations(command), projectRevisionResolver, revisionRuleFor(current, command.payload.gateId))
  }

  /**
   * 降到 budget_only = 一次付费放行：此后逐镜确认门不再生成，剩余镜头直接提交给供应商。所以它与
   * 付费门同权——必须有一次真人答过的确认。两条路（与付费门逐字同构）：
   *  ① `humanGesture`：Nomi 自己窗口里的真人操作（受信 IPC 边界自己盖的章）；
   *  ② 一张收据：绑死 runId + 币种 + 上限（costScope）与已封存授权的 digest（contractHash）——
   *     改上限、改计划或换 run 都会失配。收据由主进程签发（HMAC + TTL + 一次性），客户端只是
   *     **问人的那个面**，答案本身仍由主进程背书（MCP 安全基线：客户端自述的同意不构成授权）。
   * 收紧（升档到 key_confirm / confirm_all）不放行任何东西，不进这条闸。
   *
   * 2026-09-21：这里原来还有一句「`current.policy` 不是 confirm_all 就直接 return undefined」——
   * 即 key_confirm → budget_only **一份证据都不要**。理由曾是「那一档只跳过免费的创意/样片门，
   * 钱门一道不跳」。但跳过创意门本身就是用户拍板过的那件事：**全自动档要不要开，由用户的设置或
   * 一次真人答过的确认决定，不是调用方在参数里说了算**（09-21）。真机已证：一个只持裸 bearer 的
   * 本机进程能把一个 Run 的方向门批掉而没有任何人看见。所以证据标准对齐——任何往 budget_only 的
   * 降档都要 ① 手势章 或 ② 一张收据；只有 confirm_all → budget_only 额外绑死花费范围
   * （那一档真的拿掉了逐镜付费确认）。
   */
  function verifyTrustGrant(projectId: string, runId: string, current: ProductionRun, command: RunCommand): GateApprovalReceipt | undefined {
    if (command.type !== 'run.control' || command.payload.action !== 'set_trust') return undefined
    if (normalizeTrustLevel(command.payload.trustLevel) !== 'budget_only') return undefined
    if (!isTrustDowngrade(trustLevelOf(current.policy), 'budget_only')) return undefined
    const { receiptId, suppliedToken } = suppliedReceiptHandles(command)
    if (!receiptId && !suppliedToken) {
      if (command.humanGesture === true) return undefined
      throw new HumanApprovalRequiredError('Lowering this run to budget_only skips checkpoints and needs a verified Nomi confirmation')
    }
    if (!authority) throw new HumanApprovalRequiredError('The main-process approval receipt authority is not assembled for this production service')
    // 上限从**已封存授权**重算，不从命令里抄——抄来的上限等于让调用方自己写自己的额度。
    const binding = readTrustGrantBinding(current)
    const verified = verifySuppliedReceipt(authority, projectId, runId, command, {
      gateId: binding.gateId,
      contractHash: binding.digest,
      targetHash: binding.digest,
      costScope: binding.costScope,
      projectRevision: binding.projectRevision,
    }, projectRevisionResolver)
    // 降档收据只由客户端确认框 / Nomi 兜底卡签出，不会「出生即用掉」：已经用掉的那张（降过一次又调回来）
    // 不能再让降档生效，要再问一次人。「用没用掉」读收据库的只读结论（概念 spend.approval-decision 的 readDecisionRecord）；
    // 不 import 生成门主人：这个文件在渲染层的类型依赖图里，引主人会把整个能力层拖进渲染层可达范围（check:boundaries）。
    // 付费门收据不走这条：画布那张出生即用掉，崩溃重试要拿回它。
    if (authority.readDecisionRecord({ receiptToken: verified.token }).state === 'used') {
      throw new HumanApprovalRequiredError('Lowering this run to budget_only skips checkpoints and needs a verified Nomi confirmation')
    }
    return verified
  }

  function duplicateGateDecisionFor(projectId: string, runId: string, current: ProductionRun, command: RunCommand) {
    const gateId = typeof command.payload.gateId === 'string' ? command.payload.gateId.trim() : ''
    const decidedGate = current.gates.find((item) => item.gateId === gateId)
    if (!decidedGate || decidedGate.status === 'waiting' || decidedGate.status !== command.payload.status) return undefined
    const { receiptId, suppliedToken } = suppliedReceiptHandles(command)
    if (!receiptId && !suppliedToken) return { current }
    if (!authority) throw new HumanApprovalRequiredError('The main-process approval receipt authority is not assembled for this production service')
    return { current, gateReceipt: verifySuppliedReceipt(authority, projectId, runId, command, gateExpectations(command), projectRevisionResolver, revisionRuleFor(current, gateId)) }
  }

  return {
    verifyGateDecision,
    verifyTrustGrant,
    duplicateGateDecisionFor,
    consume(receipt) {
      if (receipt && authority) authority.consumeReceipt(receipt.token)
    },
    hasReceiptAuthority: Boolean(authority),
  }
}
