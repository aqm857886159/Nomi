/**
 * 生成入口登记表（**单一数据源**）。
 *
 * 一条记录回答五问的前两问：「这是用户的哪个动作」「它最终汇到哪个函数」。
 * 门岗 `scripts/check-generation-entrances.mjs` 反向扫代码里所有能组装并发出供应商生成请求的
 * 调用点，凡是没出现在这张表（经 `scripts/generation-entrances-ledger.json`）里的一律红——
 * **新入口不登记即红**。对等矩阵正向跑这张表，逐字段比出站报文。
 *
 * `engine` 的两个取值就是今天真实存在的两台发动机（sweep2 §二 表 1）：
 *   · `runtime`  ＝ `electron/runtime.ts:309 runTask`；参数由 `extras` 直通，档案声明什么就送什么。
 *   · `provider` ＝ `createGenerationProviderBootstrap()` 造出来的 provider；参数先过
 *                  `executionContract.ts:111 compileParameters` 的闭合白名单。
 *   · `canvas-run` ＝ 画布单节点 ↑ 收敛后的路（发动机收敛第一刀）：单镜 Run 的冻结合同 → 画布传输执行器
 *                  （`canvasTransportProvider`）→ 同一个 `runtime.runTask`，只是批准不再是令牌。
 */

export type ParityEngine = "runtime" | "provider" | "canvas-run";

export type GenerationEntrance = {
  id: string;
  /** 用户动作（用户镜头）。 */
  userAction: string;
  engine: ParityEngine;
  /** 入口自己那一段代码（不是共享下游）。 */
  entrySite: string;
  /** 真正发出请求的那个函数。 */
  dispatchSite: string;
  /**
   * 这条入口**在自己那一段**就做了 `@[asset:…]` → `@imageN` 的投影（A5 那条轴）。
   *
   * 2026-09-21 起投影本身收在引擎的出口上（引擎 A 在 `runtime.ts:334 runTask`，
   * 引擎 B 在 `executionContract.projectContractPrompt`），所以这里为 `false`
   * **不代表**这条路会把内部标记外泄——它只说明「入口自己没做，靠出口那一份」。
   * 矩阵刻意保持这个区分：夹具只替 `true` 的入口预投影，于是 `false` 的那几条绿了
   * 证明的是生产代码真的投影了，而不是夹具替它投影了。
   */
  projectsPromptMentions: boolean;
  /** QA 定向重试追加的指令（只此一路有）。 */
  appendsRetryDirective: boolean;
  /**
   * 「按构造就该逐字节相同」的分组。同组之间的差异一定是回归（有人给其中一路加了私有预处理），
   * 所以矩阵对同组额外加一条硬断言。
   */
  dispatchProfile: string;
  /**
   * 请求发出之前，画布上有没有这一镜的节点（架构③，用户 2026-10-08 拍板「生成那一刻 = 落画布那一刻」）。
   *   · `node-first`：先有节点、请求才发出；`owner` = 保证这一点的那一个文件（和符号）。
   *   · `exception`：批准的例外，理由只住在 scripts/generation-entrances-ledger.json 的 `landingExceptions` 里。
   * 门岗 check:generation-entrances 逐条核：不声明 / 例外没理由 / owner 不存在都红。
   */
  landing: { kind: "node-first"; owner: string } | { kind: "exception" };
};

export const GENERATION_ENTRANCES: readonly GenerationEntrance[] = [
  {
    id: "canvas-node",
    userAction: "在画布节点上按生成（矩阵基准）",
    engine: "runtime",
    entrySite: "src/workbench/generationCanvas/runner/catalogTaskActions.ts:304-315",
    dispatchSite: "electron/runtime.ts:309 runTask",
    projectsPromptMentions: true,
    appendsRetryDirective: false,
    dispatchProfile: "runtime+projection",
    landing: { kind: "node-first", owner: "src/workbench/generationCanvas/runner/generationRunController.ts" },
  },
  {
    id: "canvas-node-run",
    userAction: "在画布节点上按生成（收敛后：经单镜 Run 的提交出口，批准 = 这一下点击）",
    engine: "canvas-run",
    entrySite: "electron/capabilityCore/appIntegrationCanvasShot.ts createCanvasShotRuns",
    dispatchSite: "electron/capabilityCore/canvasTransportProvider.ts: lazyCanvasTransport → runtime runTask（RUN_APPROVED_ADMISSION）",
    projectsPromptMentions: true,
    appendsRetryDirective: false,
    dispatchProfile: "runtime+projection",
    landing: { kind: "node-first", owner: "electron/productionRun/shotLandingAdmission.ts admitShotsForDispatch" },
  },
  {
    id: "shot-table-row",
    userAction: "分镜表某一行上按生成（落画布后共用画布 runner）",
    engine: "runtime",
    entrySite: "src/workbench/creation/storyboard/exec/storyboardProjection.ts",
    dispatchSite: "electron/runtime.ts:309 runTask",
    projectsPromptMentions: true,
    appendsRetryDirective: false,
    dispatchProfile: "runtime+projection",
    landing: { kind: "node-first", owner: "src/workbench/generationCanvas/runner/generationRunController.ts" },
  },
  {
    id: "retake",
    userAction: "重拍（审片定向重试，带一句机器写的纠正指令）",
    engine: "runtime",
    entrySite: "src/workbench/generationCanvas/runner/catalogTaskActions.ts:311-315 promptSuffix",
    dispatchSite: "electron/runtime.ts:309 runTask",
    projectsPromptMentions: true,
    appendsRetryDirective: true,
    dispatchProfile: "runtime+projection+retry",
    landing: { kind: "node-first", owner: "src/workbench/generationCanvas/runner/generationRunController.ts" },
  },
  {
    id: "try-model",
    userAction: "接入试跑一次（`nomi_try_model`）",
    engine: "runtime",
    entrySite: "electron/capabilityCore/modelOnboarding/tryModel.ts:115",
    dispatchSite: "electron/runtime.ts:309 runTask",
    projectsPromptMentions: false,
    appendsRetryDirective: false,
    dispatchProfile: "runtime+raw",
    landing: { kind: "exception" },
  },
  {
    id: "agent-panel-spend-confirm",
    userAction: "Agent 面板付款卡上按「确认」",
    engine: "provider",
    entrySite: "electron/capabilityCore/appIntegrationSpendConfirm.ts",
    dispatchSite: "electron/capabilityCore/generationRuntimeAdapter.ts:282-292",
    projectsPromptMentions: false,
    appendsRetryDirective: false,
    dispatchProfile: "provider",
    landing: { kind: "node-first", owner: "electron/productionRun/shotLandingAdmission.ts admitShotsForDispatch" },
  },
  {
    id: "submit-execution-plan",
    userAction: "分镜表「提交执行计划」",
    engine: "provider",
    entrySite: "electron/capabilityCore/mcpGenerationTools.ts:308 createGenerationPlanningHandler",
    dispatchSite: "electron/capabilityCore/generationRuntimeAdapter.ts:282-292",
    projectsPromptMentions: false,
    appendsRetryDirective: false,
    dispatchProfile: "provider",
    landing: { kind: "node-first", owner: "electron/productionRun/shotLandingAdmission.ts admitShotsForDispatch" },
  },
  {
    id: "external-mcp-start-generation",
    userAction: "外部 MCP `nomi_start_generation`",
    engine: "provider",
    entrySite: "electron/capabilityCore/mcpStdioServer.ts:326-380",
    dispatchSite: "electron/capabilityCore/generationRuntimeAdapter.ts:282-292",
    projectsPromptMentions: false,
    appendsRetryDirective: false,
    dispatchProfile: "provider",
    landing: { kind: "node-first", owner: "electron/productionRun/shotLandingAdmission.ts admitShotsForDispatch" },
  },
  {
    id: "auto-run-batch",
    userAction: "全自动 / 批量调度（Run 自己往下推）",
    engine: "provider",
    entrySite: "electron/productionRun/productionGenerationSubmission.ts:465",
    dispatchSite: "electron/capabilityCore/generationRuntimeAdapter.ts:282-292",
    projectsPromptMentions: false,
    appendsRetryDirective: false,
    dispatchProfile: "provider",
    landing: { kind: "node-first", owner: "electron/productionRun/shotLandingAdmission.ts admitShotsForDispatch" },
  },
  {
    id: "continue-batch",
    userAction: "续批（多镜批次调度器接着往下发）",
    engine: "provider",
    entrySite: "electron/productionRun/multiShotBatchScheduler.ts",
    dispatchSite: "electron/capabilityCore/generationRuntimeAdapter.ts:282-292",
    projectsPromptMentions: false,
    appendsRetryDirective: false,
    dispatchProfile: "provider",
    landing: { kind: "node-first", owner: "electron/productionRun/shotLandingAdmission.ts admitShotsForDispatch" },
  },
];

/** 矩阵的基准入口：用户最常走、也是今天唯一把提示词投影做完的那一条。 */
export const BASELINE_ENTRANCE_ID = "canvas-node";

export function entranceById(id: string): GenerationEntrance {
  const hit = GENERATION_ENTRANCES.find((entrance) => entrance.id === id);
  if (!hit) throw new Error(`unregistered generation entrance: ${id}`);
  return hit;
}
