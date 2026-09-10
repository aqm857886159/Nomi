import path from 'node:path'

import { createApprovalReceiptAuthority, type ApprovalReceiptAuthority } from './approvalReceipt'
import { capabilityCoreDir, ensureCapabilitySigningKey } from './security'
import { createProductionRunLock } from '../productionRun/productionRunLock'
import { getWorkspaceRepositoryDeps } from '../runtimePaths'
import { readWorkspaceProject } from '../workspace/workspaceRepository'

/**
 * 进程内**唯一**的人证签发/校验权威（P1：一个能力一个家）。
 *
 * 为什么要有这个模块：收据的密钥、落盘状态与锁必须是**同一份**，否则 A 处签的收据 B 处验不过，
 * 「验不过」又极易被当成「那就别验了」——2026-09-10 的 fail-open 根因就长在这个缝里：
 * capability-core 侧造了权威只给 dispatcher，而制作 Run 服务（MCP/批量侧的付费门所在）
 * 从来没拿到过它。装配点各造各的，等于没有真相源。
 *
 * 现在两侧（createDefaultAuthorities 与 productionRunRuntime.getProductionRunService）都从这里取，
 * 拿到的是同一个实例、同一把 macKey、同一个 approval-receipts.json、同一把锁。
 */
let sharedAuthority: ApprovalReceiptAuthority | null = null

export function getApprovalReceiptAuthority(): ApprovalReceiptAuthority {
  if (!sharedAuthority) {
    const authorityDir = capabilityCoreDir()
    sharedAuthority = createApprovalReceiptAuthority({
      filePath: path.join(authorityDir, 'approval-receipts.json'),
      macKey: ensureCapabilitySigningKey('approval-receipt'),
      storeMacKey: ensureCapabilitySigningKey('approval-receipt-store'),
      keyId: 'approval-receipt-v1',
      lock: createProductionRunLock({
        filePath: path.join(authorityDir, 'semantic-authorities.lock'),
        epochPath: path.join(authorityDir, 'semantic-authorities.epoch'),
        ownerId: `capability-core-${process.pid}`,
      }),
    })
  }
  return sharedAuthority
}

/**
 * 收据绑定的项目文档版本。收据只在它描述的那份项目文档还是当前版本时可用，所以「当前版本是多少」
 * 也只能有一个答案；两个装配点各写一份 `readWorkspaceProject(...)?.revision` 就是第二份真相源。
 */
export function currentProjectRevision(projectId: string): number | undefined {
  return readWorkspaceProject(projectId, getWorkspaceRepositoryDeps())?.revision
}

export function resetApprovalReceiptAuthorityForTests(): void {
  sharedAuthority = null
}
