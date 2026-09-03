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
