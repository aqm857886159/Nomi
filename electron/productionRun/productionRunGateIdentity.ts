// 制作 Run 的「门身份」与门状态谓词：gateId 怎么算、某个门算不算某一类、当前 Run 上这类门处于什么状态。
//
// 为什么从 productionRunDriverOps 抽出来（2026-09-03）：那份文件是 driver 编排工厂（createDriverOps
// 一个函数就 600+ 行），而这组函数是**纯计算**——不碰仓库、不碰 renderer 桥、不闭包任何注入依赖，
// 只吃 ProductionRun 读出的字段。它们混在编排层里既顶着 R9 的 800 行上限，又让「门 id 规则」这件
// 跨模块共享的事没有单一落点（productionRunService 也要用 isShotGate）。抽出后编排层只留编排。
//
// 门 id 是**持久且对外可见的标识**（写进 Run 的 gates、进 MCP 投影、进深链），所以这里的算法不可
// 随手改：改了等于让历史 Run 的门失配。要改必须走迁移。
import crypto from 'node:crypto'

import { trustLevelOf, type ProductionRun } from './productionRunTypes'

/** One durable, URL-safe gate per plan/job. The hash keeps ids stable even when node ids collide
 * after sanitization, while jobIds[0] remains the authoritative job identity. */
export function shotGateId(planVersion: number, jobId: string, round = 1): string {
  const slug = jobId.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(-48) || 'shot'
  const suffix = crypto.createHash('sha256').update(jobId).digest('hex').slice(0, 10)
  return `gate-shot-v${planVersion}-${slug}-${suffix}${round > 1 ? `-r${round}` : ''}`
}

export function isShotGate(gate: Pick<ProductionRun['gates'][number], 'gateId' | 'scope'>): boolean {
  return gate.scope === 'job_set' && gate.gateId.startsWith('gate-shot-')
}

/**
 * 付费门（spend gate）= **批准它会导致向供应商花钱**。这是「哪些门必须有真人授权」的唯一定义，
 * 由 scope 判、不看 gateId 前缀（前缀是展示用的身份，不是钱的语义）：
 * - `budget_envelope`：批准即写预算账本授权（productionRunRepository 只在这个 scope 上 authorize ledger）。
 * - `job_set`：按构造只有逐镜提交门（见 shotGateId / productionRunDriverOps），批准即放行
 *   `production.generate-node`，下一步就是真实供应商调用。
 * 其余 scope 都不发起付费调用：`stage`（方向/样片/冻结创意门）、`anchor_checkpoint`（定妆质量门，
 * 预算在确认卡上已批过）、`export`/`publish`（本地导出/发布，不调供应商）。
 *
 * 付费边界只许在这里改：改这个谓词 = 改「什么算花钱」，必须连带复核 productionRunApprovalReceipt 的
 * fail-closed 规则与 autoApproveGate 的拒绝清单。
 */
export function isSpendGate(gate: Pick<ProductionRun['gates'][number], 'gateId' | 'scope'>): boolean {
  return gate.scope === 'budget_envelope' || gate.scope === 'job_set'
}

/**
 * 「以后 ¥X 内别再逐镜问」= 把 Run 降到 budget_only 这一档。这个降档**会替真人放行后续付费提交**
 * （逐镜确认门从此不再生成），所以它和付费门同权：必须有一次真人答过的确认。
 *
 * 这两个函数是那次确认的**身份**——收据签在什么上、验的时候拿什么比：
 * - `trustGrantGateId`：合成门 id。刻意不用 `gate-` 前缀，于是一张信任收据永远落不进 `gate.decide`
 *   （那里按 `command.payload.gateId` 比对），反向也一样（真门收据的 costScope 不是 `trust.budget-only:`）。
 * - `trustGrantCostScope`：把「哪个 run + 什么币种 + 多少钱」编进 costScope（既有约定，见
 *   `generation.multi-shot:${runId}`）。**改上限或换 run ⇒ 串不一样 ⇒ 收据失配**，这就是「上限绑死」。
 */
export function trustGrantGateId(planVersion: number): string {
  return `trust-budget-only-v${planVersion}`;
}

export function trustGrantCostScope(runId: string, currency: string, maximum: number): string {
  if (!runId || !currency || !Number.isFinite(maximum) || maximum <= 0) {
    throw new Error("A trust grant needs a run, a currency and a positive ceiling");
  }
  return `trust.budget-only:${runId}:${currency}:${maximum}`;
}

export function sampleGateId(planVersion: number): string {
  return `gate-sample-v${planVersion}`
}

export function freezeGateId(planVersion: number): string {
  return `gate-freeze-v${planVersion}`
}

export function hasApprovedFreezeGate(run: ProductionRun): boolean {
  return run.gates.some((gate) => gate.gateId === freezeGateId(run.planVersion) && gate.status === 'approved')
}

export function hasWaitingFreezeGate(run: ProductionRun): boolean {
  return run.gates.some((gate) => gate.gateId === freezeGateId(run.planVersion) && gate.status === 'waiting')
}

export function hasWaitingSampleGate(run: ProductionRun): boolean {
  return run.gates.some((gate) => gate.gateId === sampleGateId(run.planVersion) && gate.status === 'waiting')
}

export function shouldSampleGate(run: ProductionRun): boolean {
  return trustLevelOf(run.policy) !== 'budget_only'
}
