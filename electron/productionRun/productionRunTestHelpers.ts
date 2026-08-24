import type { createProductionRunService } from './productionRunService'

type ProductionService = ReturnType<typeof createProductionRunService>

/** 驱动型测试（跑 run 全程的那些）的单测超时。
 *
 * 不变量：**它必须大于单条测试路径上所有内层 waitForProduction 期限之和**——
 * 这样先炸的永远是内层期限，报错才说得出「卡在哪个条件」。目前最长一条 34s
 * （productionShotGate「否决某镜」= 5000 + 6000(批剧本) + 3000(批分镜) + 5000×4），
 * 45s 留出余量。vitest 默认 5s，**低于**上面好几条链——所以在此之前先炸的是外层，
 * 只能报「Test timed out in 5000ms」，看不出卡在哪一门。
 * 新增/调长内层等待时，回来重算这个数。 */
export const PRODUCTION_DRIVER_TEST_TIMEOUT_MS = 45_000

/** 轮询等待某个条件成立；超时即抛，且**报错里带上等的是什么条件**。
 *
 * 只拿得到一个闭包，所以默认把谓词源码打进消息（多行压成一行）；调用方给了
 * label 就优先用 label。等待时长也一并报出——分得清「等满了才死」和「早早就死」。 */
export async function waitForProduction(
  check: () => boolean,
  timeoutMs = 3000,
  label?: string,
): Promise<void> {
  const startedAt = Date.now()
  const deadline = startedAt + timeoutMs
  while (!check() && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 5))
  if (!check()) {
    const condition = label ?? check.toString().replace(/\s+/g, ' ').trim()
    throw new Error(`waitFor timed out after ${Date.now() - startedAt}ms (deadline ${timeoutMs}ms): ${condition}`)
  }
}

/** Move legacy production fixtures through the same script review gate as the
 * real Agent path. Tests that care about later gates should not bypass it. */
export async function approveLatestScript(
  service: ProductionService,
  projectId: string,
  runId: string,
): Promise<void> {
  await waitForProduction(() => service.readFull(projectId, runId).artifacts.some((artifact) => artifact.kind === 'script'))
  const run = service.readFull(projectId, runId)
  const script = [...run.artifacts].reverse().find((artifact) => artifact.kind === 'script' && artifact.status === 'candidate')
  if (!script) throw new Error('script candidate missing in test fixture')
  await service.command(projectId, runId, {
    commandId: `approve-script-${runId}`,
    expectedRevision: run.revision,
    type: 'script.review',
    payload: { artifactId: script.artifactId, decision: 'approved' },
    issuedAt: new Date().toISOString(),
  })
  await waitForProduction(() => service.readFull(projectId, runId).artifacts.some((artifact) => artifact.kind === 'storyboard'))
}

export async function approveLatestStoryboard(
  service: ProductionService,
  projectId: string,
  runId: string,
): Promise<void> {
  await waitForProduction(() => service.readFull(projectId, runId).artifacts.some((artifact) => artifact.kind === 'storyboard'))
  const run = service.readFull(projectId, runId)
  const storyboard = [...run.artifacts].reverse().find((artifact) => artifact.kind === 'storyboard' && artifact.status === 'candidate')
  if (!storyboard) throw new Error('storyboard candidate missing in test fixture')
  await service.command(projectId, runId, {
    commandId: `approve-storyboard-${runId}`,
    expectedRevision: run.revision,
    type: 'artifact.review',
    payload: { artifactId: storyboard.artifactId, decision: 'approved' },
    issuedAt: new Date().toISOString(),
  })
}
