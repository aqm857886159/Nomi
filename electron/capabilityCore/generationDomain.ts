/**
 * 生成这一套怎么接起来——只有这一处。
 *
 * 两个宿主（应用内 `appIntegration.ts`、独立进程 `mcpStdioServer.ts`）以前各手写一遍：目录运行时、
 * 操作存储、规划逻辑、准备授权、开拍、核对……三百行里绝大多数逐字相同，不同的那几处是真差异也是漏接：
 * 9-22 一个宿主漏接素材身份解析器、9-03 打包态漏接确认通道、11-16 两个宿主都把启动时的模型表交给了门、
 * 11-21 查到独立进程一直没接「结果未知的镜别再发」。每次都是「判据写对了，另一个宿主没把东西递下去，
 * 而且没有任何东西会红」。
 *
 * 所以：
 *  · 这里没有任何「模型表 / 目录从参数来」的入口——目录只有 `createLiveGenerationRuntime()` 这一份；
 *  · 宿主只交 `GenerationHostPorts`：两个宿主**真不一样**的那几样，全部必填，漏一样类型检查就红；
 *  · 用到规划的那几个位置（门的权威、派发入口、界面的窄通道、常驻生成面）只认这里发出去的规划：
 *    类型上带记号，装上的那一刻再核一遍名单（`generationPlanningIssue.ts`）。
 */
import { resolveProjectAssetReferenceIdentity } from "../assets/projectAssetStore";
import { ensureCapabilitySigningKey } from "./security";
import { desktopNoticeLocale, landBatchBeforeKick } from "./appIntegrationLandFirst";
import { canvasAwareOutputMaterializer } from "./canvasShotRunApi";
import { hasGenerationOperationProviderReadiness } from "./generationOperationProviderReadiness";
import { createGenerationOutputMaterializer } from "./generationOutputMaterializer";
import { createGenerationProviderBootstrap } from "./generationProviderBootstrap";
import { claimGenerationPlanningIssuer, type IssuedByGenerationDomain } from "./generationPlanningIssue";
import { createGenerationReferenceScopeGuard } from "./generationReferenceScope";
import { createLiveGenerationRuntime, type LiveGenerationCallCatalog, type LiveGenerationRuntime } from "./liveGenerationRuntime";
import { createGenerationPlanningHandler, type GenerationOperation, type GenerationOperationStore, type GenerationPlanningHandler, type GenerationPlanningHandlerDependencies } from "./mcpGenerationTools";
import type { SemanticBatchStartDependencies } from "./mcpSemanticBatchStart";
import { planStoryboardFromScript } from "./mcpStoryboardPlanner";
import { resolveIndexedReferencePreview } from "./pendingSpendReferences";
import type { ProjectLeaseV2 } from "./projectLease";
import { createMultiShotBatchScheduler } from "../productionRun/multiShotBatchScheduler";
import { prepareProductionGenerationAuthorizationWithReferences } from "../productionRun/prepareProductionGenerationAuthorization";
import { createProductionGenerationOperationStore } from "../productionRun/productionGenerationOperationStore";
import { createProductionGenerationSubmission } from "../productionRun/productionGenerationSubmission";
import type { ProductionRunService } from "../productionRun/productionRunService";
import type { LandShotsOnCanvas } from "../productionRun/shotLandingAdmission";
import { startSingleShotProduction } from "../productionRun/singleShotProductionStart";
import { getWorkspaceRepositoryDeps } from "../runtimePaths";
import { productionFixtureBaseOriginFromEnv } from "../shared/productionRunE2eFixtureGate";
import { unknownSubmissionShotLabels } from "../shared/productionShotPhase";
import { recommendVideoGeneration } from "../shared/videoCapabilities";
import { readWorkspaceProject, resolveWorkspaceProjectDir } from "../workspace/workspaceRepository";

type PlanningDeps = GenerationPlanningHandlerDependencies<LiveGenerationCallCatalog>;
type SubmissionProviders = Parameters<typeof createProductionGenerationSubmission>[0]["providers"];
export type GenerationSubmission = ReturnType<typeof createProductionGenerationSubmission>;

/** 生成装配工厂发出去的规划（记号和名单见 `generationPlanningIssue.ts`）。 */
export type IssuedGenerationPlanning = GenerationPlanningHandler & IssuedByGenerationDomain;

// 往名单里记的能力只发一次，这个模块在加载时拿走：别处再想自己发，进程一起来就红。
const issue = claimGenerationPlanningIssuer();

/**
 * 两个宿主真不一样的地方。全部必填：一个宿主没有的东西也要写出来「没有、为什么」，
 * 不许靠缺省悄悄少接一样。
 */
export type GenerationHostPorts = Readonly<{
  /** 制作账本（两个宿主各自进程里的那一台）。 */
  runs: ProductionRunService;
  /**
   * 渲染层通道。应用内两条都有；独立进程没有窗口，交 `null`（规划里要渲染层的路——文稿方案的作者正文、
   * 需要人在界面里选的决定——在那里如实拒）。
   */
  renderer: Readonly<{
    request: NonNullable<PlanningDeps["requestRenderer"]>;
    requestDecision: NonNullable<PlanningDeps["requestRendererDecision"]>;
  }> | null;
  /** 派发前把镜头落到画布上。应用内 = 真落；独立进程没有画布 = 拒（Run 停在 landing_failed，请用户打开项目）。 */
  landShots: LandShotsOnCanvas;
  /** 草稿建了 / 改了：应用内即刻投影到画布；独立进程没有画布，什么都不做。 */
  onPlanChanged: (projectId: string, operationId: string) => void;
  /**
   * 封授权信封之前等自己在飞的画布落地落完（它会让项目版本前进，不等的话信封盖的是旧版本）。
   * 独立进程不往画布上投影，没有可等的。
   */
  settleBeforeAuthorization: (projectId: string) => Promise<void>;
  /**
   * 多镜批次怎么推起来。工厂把「读 Run / 记成已提交 / 造调度器」都备好，宿主只决定顺序和怎么驱动：
   * 应用内交给它那台会定时重踢、核重启时一起作废的驱动；独立进程走 `startSemanticMultiShotBatch`，推一趟到静止点。
   * 两边行为是不是该统一没有查清，这一刀原样保留。
   */
  kickMultiShotBatch: (input: Readonly<{
    operation: GenerationOperation;
    lease: ProjectLeaseV2;
    readRun: SemanticBatchStartDependencies["readRun"];
    submitPlan: SemanticBatchStartDependencies["submitPlan"];
    createScheduler: () => ReturnType<typeof createMultiShotBatchScheduler>;
  }>) => Promise<Readonly<{ operationId: string; state: string; nextAction: string }>>;
  /** 单镜受理之后在回合外接着看结果。应用内有观察者；独立进程没有（它也发不出去——没有画布可落）。 */
  observeSingleShot: (submission: GenerationSubmission, projectId: string, runId: string) => void;
  /**
   * 核对查到了结果之后怎么收尾。独立进程当场把单镜 Run 记成完成 / 要人处理；
   * 应用内今天不在这里记（是不是漏接没有查清，这一刀原样保留）。
   */
  onReconciled: (event:
    | Readonly<{ kind: "materialized"; projectId: string; runId: string; jobId: string; artifactId?: string }>
    | Readonly<{ kind: "attention"; projectId: string; runId: string; jobId?: string }>) => void;
}>;

export type GenerationDomain = Readonly<{
  /** 目录的那一份。调用之外的后台活读 `catalog.current()`；规划调用里的那一版由规划自己在入口取。 */
  catalog: LiveGenerationRuntime;
  operations: GenerationOperationStore;
  planning: IssuedGenerationPlanning;
  /** 一个 Run 的提交门面。宿主的后台活（恢复调度、画布单镜、返工）和规划的开拍 / 核对共用这一个造法。 */
  buildSubmission: (input: Readonly<{ projectRoot: string; immutableProjectUuid: string; projectGeneration: number; providers: SubmissionProviders }>) => GenerationSubmission;
}>;

export function createGenerationDomain(host: GenerationHostPorts): GenerationDomain {
  const { runs } = host;
  const fixtureBaseUrlOverride = productionFixtureBaseOriginFromEnv(process.env);
  const catalog = createLiveGenerationRuntime({
    bootstrap: (state, options) => createGenerationProviderBootstrap(state, {
      ...options,
      ...(fixtureBaseUrlOverride ? { fixtureBaseUrlOverride } : {}),
    }),
  });
  // The fetch policy (timeout / size / provider route) is the shared owner's (fetchProviderMedia).
  const outputMaterializer = createGenerationOutputMaterializer();
  const operations = createProductionGenerationOperationStore(runs, { onPlanChanged: host.onPlanChanged });

  const readProject = (projectId: string) => readWorkspaceProject(projectId, getWorkspaceRepositoryDeps());
  const projectRootOf = (projectId: string) => resolveWorkspaceProjectDir(projectId, getWorkspaceRepositoryDeps());

  // lease 身份（immutableProjectUuid / projectGeneration）由调用方给：规划调用里取自 lease，恢复时取自工作区记录。
  const buildSubmission: GenerationDomain["buildSubmission"] = (input) => createProductionGenerationSubmission({
    repository: runs.repository,
    projectRoot: input.projectRoot,
    immutableProjectUuid: input.immutableProjectUuid,
    projectGeneration: input.projectGeneration,
    intentMacKey: ensureCapabilitySigningKey("generation-intent"),
    providers: input.providers,
    // 画布那台交回来的产物已经落在项目里：记进 Run，不再下载一次；不是本地地址的走通用物化。
    materializeOutput: canvasAwareOutputMaterializer(input.projectRoot, outputMaterializer),
  });

  const planning = createGenerationPlanningHandler<LiveGenerationCallCatalog>({
    catalog,
    operations,
    ...(host.renderer ? { requestRenderer: host.renderer.request, requestRendererDecision: host.renderer.requestDecision } : {}),
    resolveStoryboardReferenceUrl: resolveIndexedReferencePreview,
    // 参考素材的身份（内容哈希 + 版本）归项目素材库管，模型只给 assetId。
    // 2026-09-22：应用内那个宿主漏接过这一行，`draft_shots` 只要带参考就必定被拒，而且没有任何东西会红。
    resolveAssetReferenceIdentity: (projectId, assetId) => resolveProjectAssetReferenceIdentity(projectId, assetId),
    planStoryboard: planStoryboardFromScript,
    recommendVideoGeneration,
    prepareAuthorization: async ({ lease, operation, contract, multiShot }, call) => {
      await host.settleBeforeAuthorization(lease.projectId);
      const projectRecord = readProject(lease.projectId);
      if (!projectRecord || !Number.isInteger(projectRecord.revision)) throw new Error("Generation authorization requires the current project revision");
      const authorizationRun = runs.repository.read(lease.projectId, operation.operationId);
      // attempt 谱系、负债合计和硬上限全部从这份快照里算。读不到就停在这里。
      if (!authorizationRun) throw new Error("Generation authorization requires the current Run snapshot");
      const assertCurrent = createGenerationReferenceScopeGuard({
        lease,
        operation,
        contract,
        ...(multiShot ? { multiShot } : {}),
        initialRun: authorizationRun,
        readProject: () => {
          const current = readProject(lease.projectId);
          return current ? { id: current.id, immutableProjectUuid: current.immutableProjectUuid, projectGeneration: current.projectGeneration } : null;
        },
        readRun: () => runs.repository.read(lease.projectId, operation.operationId),
      });
      return prepareProductionGenerationAuthorizationWithReferences({
        lease,
        assertCurrent,
        projectRevision: projectRecord.revision,
        operation,
        contract,
        ...(multiShot ? { multiShot } : {}),
        // 执行器和价格都取这次调用入口那一版目录：等落地 / 解析参考的那几秒里目录变了，信封里记的仍是入口那一版。
        providers: call.bootstrap.providers,
        resolveShotPrice: call.resolveShotPrice,
        run: authorizationRun,
        now: new Date().toISOString(),
      });
    },
    start: async (operation, lease, call) => {
      const { providers } = call.bootstrap;
      const projectRoot = projectRootOf(lease.projectId);
      const projectRecord = readProject(lease.projectId);
      // A multi-shot plan may put an image anchor in the top-level contract while its video shots use
      // another provider. Readiness must be derived from every included shot (the scheduler's real
      // submission set), not just operation.contract.providerId.
      if (!hasGenerationOperationProviderReadiness(operation, providers)
        || !projectRoot || !operation.contract || !projectRecord || !Number.isInteger(projectRecord.revision)) {
        return { operationId: operation.operationId, state: operation.state, nextAction: "provider_not_configured" };
      }
      const submission = buildSubmission({ projectRoot, immutableProjectUuid: lease.immutableProjectUuid, projectGeneration: lease.projectGeneration, providers });
      // 多镜走耐久批次调度器（锚 → 检查点 → 镜头批，带预算停和停止）；单镜保持一次调用的开拍。
      if (operation.shots && operation.shots.length > 0) {
        // 先落节点、再发请求：kick 之前先经唯一准入点把这批镜落到画布上。落不下来的镜不派。
        // 这里先落一次，是为了把「没放到画布上」当场如实回给 Agent。
        const landing = await landBatchBeforeKick({ repository: runs.repository, landShots: host.landShots, projectId: lease.projectId, runId: operation.operationId });
        const started = await host.kickMultiShotBatch({
          operation,
          lease,
          readRun: (projectId, runId) => runs.repository.read(projectId, runId),
          // 调度器只驱动 state==='submitted' 的多镜计划：先经耐久命令记成已提交（幂等）。
          submitPlan: (run) => runs.command(lease.projectId, operation.operationId, {
            commandId: `generation.submit:${operation.operationId}:v${run.planVersion}`,
            expectedRevision: run.revision,
            type: "generation.submit",
            payload: {},
            issuedAt: new Date().toISOString(),
          }),
          createScheduler: () => createMultiShotBatchScheduler({
            repository: runs.repository,
            submission,
            projectId: lease.projectId,
            runId: operation.operationId,
            landShots: host.landShots,
            onBatchComplete: () => runs.advanceSemanticProduction(lease.projectId, operation.operationId),
          }),
        });
        // 按镜头算：一镜都没落下才是整批的 canvas_landing_failed；落下了一部分就照常观察，逐镜那一句说清哪几镜没发。
        return landing ? { ...started, nextAction: landing.allNotPlaced ? "canvas_landing_failed" : "observe", ...landing } : started;
      }
      // 单镜与多镜同一个准入点：先落画布、落下了才交。落不下来 = 不交、停在 landing_failed。
      const started = await startSingleShotProduction({
        repository: runs.repository, submission, landShots: host.landShots,
        projectId: lease.projectId, runId: operation.operationId, now: () => new Date().toISOString(), locale: desktopNoticeLocale(),
      });
      if (started.nextAction === "observe") host.observeSingleShot(submission, lease.projectId, operation.operationId);
      return started;
    },
    // 结果未知的镜（供应商可能已经收下）：读任务状态时逐镜点名，告诉 Agent 别再 generate。
    // 2026-11-21：独立进程那个宿主一直没接这一行——创作者关掉 Nomi 之后助手读到的是「还在等」。
    unknownShotsOf: (operation, lease) => unknownSubmissionShotLabels(runs.repository.read(lease.projectId, operation.operationId)),
    reconcile: async (operation, outcome, lease, call) => {
      if (outcome === "not_found") return { operationId: operation.operationId, outcome, nextAction: "manual_review" };
      const { providers } = call.bootstrap;
      const provider = providers.find((candidate) => candidate.providerId === operation.contract?.providerId);
      const projectRoot = projectRootOf(lease.projectId);
      const projectRecord = readProject(lease.projectId);
      if (!provider || !projectRoot || !operation.contract || !projectRecord || !Number.isInteger(projectRecord.revision)) return { operationId: operation.operationId, outcome, nextAction: "manual_review" };
      if (!provider.query || !provider.capabilities.query) return { operationId: operation.operationId, outcome, nextAction: "manual_review", recoveryNotice: "该供应商没有可用的任务查询；请到供应商核对。" };
      const submission = buildSubmission({ projectRoot, immutableProjectUuid: lease.immutableProjectUuid, projectGeneration: lease.projectGeneration, providers });
      try {
        const polled = await submission.poll({ projectId: lease.projectId, operationId: operation.operationId });
        if (polled.nextAction === "materialize") {
          const materialized = await submission.materialize({ projectId: lease.projectId, operationId: operation.operationId });
          host.onReconciled({ kind: "materialized", projectId: lease.projectId, runId: operation.operationId, jobId: materialized.jobId, artifactId: materialized.artifactId });
          return materialized;
        }
        if (polled.nextAction === "attention") host.onReconciled({ kind: "attention", projectId: lease.projectId, runId: operation.operationId, jobId: polled.jobId });
        return polled;
      } catch (error) {
        const code = (error as { code?: unknown })?.code;
        if (code === "provider_materialization_unsupported" || code === "materialization_failed") return { operationId: operation.operationId, outcome, nextAction: "manual_review", recoveryNotice: "供应商任务已完成，但结果还没有安全落到 Nomi 项目；请到供应商核对或稍后重试。" };
        throw error;
      }
    },
  });

  return { catalog, operations, planning: issue(planning), buildSubmission };
}
