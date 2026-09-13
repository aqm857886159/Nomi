/**
 * 生成 Run 的「观察与调度驱动」——从 appIntegration 的装配里整块搬出来的一个关注点（R9 分层）。
 *
 * 这里住的是同一件事的两半，它们共享同一批 per-instance 状态（在飞的 drive、重踢定时器、
 * 单镜观察 epoch），所以必须待在一起：
 *   · 多镜：kickSchedulerForRun / driveScheduler —— 把一个 Run 推到静止点，没静止就定时重踢。
 *   · 单镜：observeSingleShotRun —— 提交后把轮询/落地放到 MCP 回合之外，按 Run 去重。
 * 两半的结果都只写进同一个 durable ProductionRun 仓储（settleSingleShot* 三个落状态的口子）。
 *
 * 为什么是工厂而不是模块级单例：这些状态归**某一次** capability-core 实例所有。核重启/替换时
 * 旧实例的 epoch 必须作废，不能让上一代的 worker 把过期状态写进新运行时（stop()）。
 */
import { logWarn } from '../logging/logger'
import type { MultiShotBatchScheduler } from '../productionRun/multiShotBatchScheduler'
import type { ProductionRun } from '../productionRun/productionRunTypes'
import type { createProductionGenerationSubmission } from '../productionRun/productionGenerationSubmission'
import type { ProductionRunRepository } from '../productionRun/productionRunRepository'
import { observeSingleShotGeneration } from '../productionRun/singleShotGenerationObserver'
import { createSingleShotObservationLifecycle } from '../productionRun/singleShotObservationLifecycle'
import {
  markSingleShotAttention,
  markSingleShotCompleted,
  markSingleShotRunning,
} from '../productionRun/singleShotRunLifecycle'

// 慢供应商未到静止点时定时重踢；Run lock、intent log 与 commandId 保证重启/并发幂等。
const REKICK_DELAY_MS = 15_000

export type RunObservationDrivers = {
  settleSingleShotRunning: (projectId: string, runId: string) => void;
  settleSingleShotCompleted: (projectId: string, runId: string, options?: { jobId?: string; artifactId?: string }) => void;
  settleSingleShotAttention: (projectId: string, runId: string, jobId?: string) => void;
  driveScheduler: (projectId: string, runId: string, scheduler: Pick<MultiShotBatchScheduler, 'runToQuiescence'>, label: string) => void;
  kickSchedulerForRun: (projectId: string, runId: string) => void;
  observeSingleShotRun: (
    submission: ReturnType<typeof createProductionGenerationSubmission>,
    projectId: string,
    runId: string,
  ) => void;
  /** 作废本实例的 epoch：中止在飞的单镜等待，清掉未触发的重踢定时器。 */
  stop: () => void;
};

export function createRunObservationDrivers(deps: {
  repository: ProductionRunRepository;
  landCanvasBestEffort: (projectId: string, runId: string, isCurrent?: () => boolean) => Promise<boolean>;
  buildSchedulerForRun: (projectId: string, runId: string, run: ProductionRun) => Pick<MultiShotBatchScheduler, 'runToQuiescence'> | null;
}): RunObservationDrivers {
  const { repository, landCanvasBestEffort, buildSchedulerForRun } = deps
  const activeBatchDrives = new Set<string>()
  const batchRekickTimers = new Map<string, ReturnType<typeof setTimeout>>()
  // Single-shot submissions intentionally return the durable provider receipt
  // immediately. Keep observation outside the MCP turn, but dedupe it by Run
  // so a replay/reconnect can never start two poll/materialize loops. The
  // lifecycle advances an epoch on core shutdown/restart and aborts stale
  // provider waits before they can materialize or touch the renderer.
  const singleShotObservationLifecycle = createSingleShotObservationLifecycle()
  // Single-shot lifecycle status is owned by the same durable ProductionRun
  // repository as the provider submission.  Keep these callbacks local to
  // the capability-core instance so a stopped/replaced instance cannot write
  // a stale status after its epoch is invalidated.
  const settleSingleShotRunning = (projectId: string, runId: string): void => {
    try {
      markSingleShotRunning(repository, projectId, runId)
    } catch (error) {
      logWarn('production-run', 'single-shot-running-status-failed', undefined, error)
    }
  }
  const settleSingleShotCompleted = (projectId: string, runId: string, options: { jobId?: string; artifactId?: string } = {}): void => {
    try {
      markSingleShotCompleted(repository, projectId, runId, options)
    } catch (error) {
      logWarn('production-run', 'single-shot-completion-status-failed', undefined, error)
    }
  }
  const settleSingleShotAttention = (projectId: string, runId: string, jobId?: string): void => {
    try {
      markSingleShotAttention(repository, projectId, runId, jobId)
    } catch (error) {
      logWarn('production-run', 'single-shot-attention-status-failed', undefined, error)
    }
  }
  const activeSingleShotJobId = (projectId: string, runId: string): string | undefined => {
    try {
      const run = repository.read(projectId, runId)
      return run?.jobs.find((job) => Boolean(job.providerTaskId) && !['adopted', 'cancelled_remote', 'detached', 'too_late'].includes(job.status))?.jobId
    } catch {
      return undefined
    }
  }
  const scheduleBatchRekick = (projectId: string, runId: string): void => {
    const key = `${projectId}:${runId}`
    if (batchRekickTimers.has(key)) return
    const timer = setTimeout(() => {
      batchRekickTimers.delete(key)
      kickSchedulerForRun(projectId, runId)
    }, REKICK_DELAY_MS)
    timer.unref?.()
    batchRekickTimers.set(key, timer)
  }
  const driveScheduler = (
    projectId: string,
    runId: string,
    scheduler: Pick<MultiShotBatchScheduler, 'runToQuiescence'>,
    label: string,
  ): void => {
    const key = `${projectId}:${runId}`
    activeBatchDrives.add(key)
    void scheduler.runToQuiescence()
      .then((outcome) => {
        if (!outcome.quiescent) scheduleBatchRekick(projectId, runId)
      })
      .catch((error) => {
        logWarn('production-run', 'observation-step-failed', { step: label }, error)
      })
      .finally(() => activeBatchDrives.delete(key))
  }
  const kickSchedulerForRun = (projectId: string, runId: string): void => {
    if (activeBatchDrives.has(`${projectId}:${runId}`)) return // 已有长跑 drive；它的下一轮派生会接住新状态
    let run
    try {
      run = repository.read(projectId, runId)
    } catch {
      return
    }
    if (!run || !run.generationPlan?.shots || run.generationPlan.shots.length === 0) return
    if (run.generationPlan.state !== 'submitted') return // 还没确认过的草稿不驱动
    if (['completed', 'cancelled', 'paused', 'pausing'].includes(run.status)) return // 已停/急停不自动续
    const scheduler = buildSchedulerForRun(projectId, runId, run)
    if (!scheduler) return
    driveScheduler(projectId, runId, scheduler, 'batch resume tick')
  }
  const observeSingleShotRun = (
    submission: ReturnType<typeof createProductionGenerationSubmission>,
    projectId: string,
    runId: string,
  ): void => {
    const key = `${projectId}:${runId}`
    void singleShotObservationLifecycle.run(key, async ({ signal, isCurrent }) => {
      try {
        const result = await observeSingleShotGeneration({
          submission,
          input: { projectId, operationId: runId },
          signal,
          isCurrent,
          // The Run/artifact store remains the only result owner. Reusing the
          // existing landing operation makes single-shot completion idempotent
          // and lets the renderer attach the local artifact to its placeholder.
          onMaterialized: async () => {
            if (!isCurrent()) return
            await landCanvasBestEffort(projectId, runId, isCurrent)
          },
        })
        // An owner stop is expected lifecycle control, not a provider failure;
        // leave the durable Run untouched for the next restart/open recovery.
        if (result.aborted) return
        if (result.nextAction === 'completed') {
          settleSingleShotCompleted(projectId, runId, {
            ...(result.materialized?.jobId ? { jobId: result.materialized.jobId } : {}),
            ...(result.materialized?.artifactId ? { artifactId: result.materialized.artifactId } : {}),
          })
        } else if (result.nextAction === 'attention') {
          settleSingleShotAttention(projectId, runId, result.lastPoll?.jobId ?? activeSingleShotJobId(projectId, runId))
        }
      } catch (error) {
        // Poll/materialization failures are durable attention, not a silent
        // promise rejection that causes the same provider task to be retried
        // forever on the next project reopen. Never submit from this path.
        if (isCurrent()) settleSingleShotAttention(projectId, runId, activeSingleShotJobId(projectId, runId))
        logWarn('production-run', 'single-shot-observation-failed', undefined, error)
      }
    }).catch((error) => {
      // The inner try/catch handles provider/materialization errors. A final
      // lifecycle rejection (for example, a duplicate observer) must not
      // write attention: by this point the worker may belong to an older
      // capability-core epoch and the current Run could be unrelated.
      logWarn('production-run', 'single-shot-observation-failed', undefined, error)
    })
  }
  return {
    settleSingleShotRunning,
    settleSingleShotCompleted,
    settleSingleShotAttention,
    driveScheduler,
    kickSchedulerForRun,
    observeSingleShotRun,
    stop: () => {
      singleShotObservationLifecycle.stop()
      for (const timer of batchRekickTimers.values()) clearTimeout(timer)
      batchRekickTimers.clear()
    },
  }
}
